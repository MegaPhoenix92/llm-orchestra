/**
 * Authentication Routes for LLM Orchestra Dashboard
 * Handles user registration, login, logout, token refresh, and profile retrieval
 */

import { Hono, type Context } from 'hono';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import type { Database } from '../../db/index.js';
import { users, organizations, orgMembers, sessions } from '../../db/schema.js';
import {
  hashPassword,
  verifyPassword,
  generateTokenPair,
  verifyToken,
  type EncryptionConfig,
} from '../../auth/index.js';
import { createEncryptionContext, hashEmailForLookup } from '../../db/encrypted-fields.js';
import { generateSlug } from '../../utils/slug.js';
import { createRateLimiter } from '../../utils/rate-limit.js';
import { getRequestMetadata, writeAuditLog } from '../../utils/audit.js';

export interface AuthRoutesOptions {
  db: Database;
  jwtSecret: string;
  /** Optional encryption configuration for sensitive data at rest */
  encryption?: EncryptionConfig;
}

/** 7 days in milliseconds for refresh token expiration */
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_MAX_AGE = Math.floor(REFRESH_TOKEN_EXPIRY_MS / 1000);

/** Rate limiter configuration for auth endpoints */
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_LIMIT_MAX_REQUESTS = 20;
const authRateLimiter = createRateLimiter({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  maxRequests: AUTH_RATE_LIMIT_MAX_REQUESTS,
});

/**
 * Email validation regex pattern
 * Matches standard email formats: user@domain.tld
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Determine if request is secure for cookie flags
 */
function isSecureRequest(c: Context): boolean {
  const forwarded = c.req.header('x-forwarded-proto');
  if (forwarded) {
    return forwarded.split(',')[0].trim() === 'https';
  }
  try {
    return new URL(c.req.url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Set the refresh token cookie using secure defaults
 */
function setRefreshCookie(c: Context, token: string): void {
  const parts = [
    `${REFRESH_COOKIE_NAME}=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Strict',
    `Max-Age=${REFRESH_COOKIE_MAX_AGE}`,
  ];

  if (isSecureRequest(c)) {
    parts.push('Secure');
  }

  c.header('Set-Cookie', parts.join('; '));
}

/**
 * Clear the refresh token cookie
 */
function clearRefreshCookie(c: Context): void {
  const parts = [
    `${REFRESH_COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'SameSite=Strict',
    'Max-Age=0',
  ];

  if (isSecureRequest(c)) {
    parts.push('Secure');
  }

  c.header('Set-Cookie', parts.join('; '));
}

/**
 * Extract refresh token from cookie header
 */
function getRefreshTokenFromCookie(c: Context): string | null {
  const cookieHeader = c.req.header('Cookie');
  const match = cookieHeader?.match(/(?:^|;\s*)refresh_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Get client identifier for rate limiting
 */
function getClientIdentifier(c: Context, email?: string): string {
  const forwardedFor = c.req.header('x-forwarded-for');
  const ip =
    forwardedFor?.split(',')[0].trim() ||
    c.req.header('x-real-ip') ||
    c.req.header('cf-connecting-ip') ||
    'unknown';

  return email ? `${ip}:${email.toLowerCase()}` : ip;
}

/**
 * Hash a refresh token for secure storage
 * @param token - The refresh token to hash
 * @returns SHA-256 hash of the token
 */
function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Validate email format
 * @param email - The email to validate
 * @returns true if valid, false otherwise
 */
function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

/**
 * Validate password strength
 * @param password - The password to validate
 * @returns true if valid (>= 8 chars), false otherwise
 */
function isValidPassword(password: string): boolean {
  return typeof password === 'string' && password.length >= 8;
}

/**
 * Extract bearer token from Authorization header
 * @param authHeader - The Authorization header value
 * @returns The token or null if invalid format
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

/**
 * Create authentication routes for the dashboard
 * @param options - Options containing database instance and JWT secret
 * @returns Hono router with auth endpoints
 */
export function createAuthRoutes(options: AuthRoutesOptions): Hono {
  const { db, jwtSecret, encryption } = options;
  const auth = new Hono();

  // Create encryption context for sensitive data
  const enc = createEncryptionContext(encryption);

  /**
   * POST /api/auth/register
   * Register a new user with a new organization
   */
  auth.post('/register', async (c) => {
    try {
      const body = await c.req.json();
      const { password, name, orgName } = body;
      // Normalize email to lowercase early (with type safety)
      const rawEmail = body.email;
      const email = typeof rawEmail === 'string' ? rawEmail.toLowerCase().trim() : undefined;

      const rateKey = `register:${getClientIdentifier(c, email)}`;
      const rate = authRateLimiter.check(rateKey);
      if (!rate.allowed) {
        const retryAfter = Math.ceil((rate.resetAt - Date.now()) / 1000);
        c.header('Retry-After', String(retryAfter));
        return c.json(
          {
            error: 'Too many requests',
            message: 'Please wait before trying again',
          },
          429
        );
      }
      c.header('X-RateLimit-Remaining', String(rate.remaining));

      // Validate required fields
      if (!email || !password || !orgName) {
        return c.json(
          { error: 'Missing required fields: email, password, and orgName are required' },
          400
        );
      }

      // Validate email format
      if (!isValidEmail(email)) {
        return c.json({ error: 'Invalid email format' }, 400);
      }

      // Validate password length
      if (!isValidPassword(password)) {
        return c.json({ error: 'Password must be at least 8 characters long' }, 400);
      }

      // Check if email already exists (use hash for lookup when encryption is enabled)
      const emailHash = enc.enabled ? hashEmailForLookup(email) : null;
      const existingUser = emailHash
        ? await db.select().from(users).where(eq(users.emailHash, emailHash)).limit(1)
        : await db.select().from(users).where(eq(users.email, email)).limit(1);

      if (existingUser.length > 0) {
        return c.json({ error: 'A user with this email already exists' }, 409);
      }

      // Generate IDs with proper prefixes
      const userId = `usr_${nanoid(21)}`;
      const orgId = `org_${nanoid(21)}`;
      const memberId = `mem_${nanoid(21)}`;
      const sessionId = `ses_${nanoid(21)}`;

      // Hash password
      const passwordHash = await hashPassword(password);

      // Generate organization slug
      const slug = generateSlug(orgName);

      // Check if slug exists and append random suffix if needed
      const existingOrg = await db
        .select()
        .from(organizations)
        .where(eq(organizations.slug, slug))
        .limit(1);

      const finalSlug = existingOrg.length > 0 ? `${slug}-${nanoid(6)}` : slug;

      const now = new Date();

      // Generate token pair before transaction
      const tokens = generateTokenPair({ userId, email }, jwtSecret);

      // Hash refresh token for storage
      const hashedToken = hashRefreshToken(tokens.refreshToken);

      // Wrap all database operations in a transaction to ensure atomicity
      // If any operation fails, all changes are rolled back
      await db.transaction(async (tx) => {
        // Create user (encrypt sensitive fields if encryption is enabled)
        const userData = enc.encryptUser({
          id: userId,
          email,
          emailHash: emailHash || undefined,
          passwordHash,
          name: name || null,
          createdAt: now,
          updatedAt: now,
        });
        await tx.insert(users).values(userData);

        // Create organization
        await tx.insert(organizations).values({
          id: orgId,
          name: orgName,
          slug: finalSlug,
          plan: 'free',
          createdAt: now,
          updatedAt: now,
        });

        // Create org membership with owner role
        await tx.insert(orgMembers).values({
          id: memberId,
          orgId,
          userId,
          role: 'owner',
          createdAt: now,
        });

        // Store session with hashed refresh token
        await tx.insert(sessions).values({
          id: sessionId,
          userId,
          hashedToken,
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
          createdAt: now,
        });
      });

      setRefreshCookie(c, tokens.refreshToken);

      const { ip, userAgent } = getRequestMetadata(c);
      await writeAuditLog(db, {
        orgId,
        actorType: 'user',
        actorId: userId,
        action: 'auth.register',
        resourceType: 'user',
        resourceId: userId,
        ip,
        userAgent,
        metadata: { email, orgName, orgSlug: finalSlug },
      });

      return c.json({
        user: {
          id: userId,
          email,
          name: name || null,
        },
        organization: {
          id: orgId,
          name: orgName,
          slug: finalSlug,
        },
        tokens: {
          accessToken: tokens.accessToken,
          expiresIn: tokens.expiresIn,
        },
      });
    } catch (error) {
      console.error('Registration error:', error);
      return c.json({ error: 'An error occurred during registration' }, 500);
    }
  });

  /**
   * POST /api/auth/login
   * Authenticate user with email and password
   */
  auth.post('/login', async (c) => {
    try {
      const body = await c.req.json();
      const { password } = body;
      // Normalize email to lowercase early (with type safety)
      const rawEmail = body.email;
      const email = typeof rawEmail === 'string' ? rawEmail.toLowerCase().trim() : undefined;

      const rateKey = `login:${getClientIdentifier(c, email)}`;
      const rate = authRateLimiter.check(rateKey);
      if (!rate.allowed) {
        const retryAfter = Math.ceil((rate.resetAt - Date.now()) / 1000);
        c.header('Retry-After', String(retryAfter));
        return c.json(
          {
            error: 'Too many requests',
            message: 'Please wait before trying again',
          },
          429
        );
      }
      c.header('X-RateLimit-Remaining', String(rate.remaining));

      // Validate required fields
      if (!email || !password) {
        return c.json({ error: 'Email and password are required' }, 400);
      }

      // Find user by email (use hash for lookup when encryption is enabled)
      const loginEmailHash = enc.enabled ? hashEmailForLookup(email) : null;
      const userResults = loginEmailHash
        ? await db.select().from(users).where(eq(users.emailHash, loginEmailHash)).limit(1)
        : await db.select().from(users).where(eq(users.email, email)).limit(1);

      if (userResults.length === 0) {
        return c.json({ error: 'Invalid email or password' }, 401);
      }

      // Decrypt user data if encryption is enabled
      const user = enc.decryptUser(userResults[0]);

      // Verify password
      const isValid = await verifyPassword(password, user.passwordHash);

      if (!isValid) {
        return c.json({ error: 'Invalid email or password' }, 401);
      }

      // Generate token pair
      const tokens = generateTokenPair({ userId: user.id, email: user.email }, jwtSecret);

      // Hash refresh token for storage
      const hashedToken = hashRefreshToken(tokens.refreshToken);

      // Store session
      const sessionId = `ses_${nanoid(21)}`;
      await db.insert(sessions).values({
        id: sessionId,
        userId: user.id,
        hashedToken,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
        createdAt: new Date(),
      });

      setRefreshCookie(c, tokens.refreshToken);

      const { ip, userAgent } = getRequestMetadata(c);
      await writeAuditLog(db, {
        actorType: 'user',
        actorId: user.id,
        action: 'auth.login',
        resourceType: 'session',
        resourceId: sessionId,
        ip,
        userAgent,
        metadata: { email: user.email },
      });

      return c.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        tokens: {
          accessToken: tokens.accessToken,
          expiresIn: tokens.expiresIn,
        },
      });
    } catch (error) {
      console.error('Login error:', error);
      return c.json({ error: 'An error occurred during login' }, 500);
    }
  });

  /**
   * POST /api/auth/logout
   * Invalidate the current session
   * Requires: Authorization: Bearer <access_token>
   */
  auth.post('/logout', async (c) => {
    try {
      // Extract token from Authorization header
      const authHeader = c.req.header('Authorization');
      const token = extractBearerToken(authHeader);

      if (!token) {
        return c.json({ error: 'Authorization header required' }, 401);
      }

      // Verify token
      const payload = verifyToken(token, jwtSecret);

      if (!payload || payload.type !== 'access') {
        return c.json({ error: 'Invalid or expired token' }, 401);
      }

      // Delete all sessions for this user
      // In a more sophisticated implementation, we might track specific sessions
      await db.delete(sessions).where(eq(sessions.userId, payload.sub));

      clearRefreshCookie(c);

      const { ip, userAgent } = getRequestMetadata(c);
      await writeAuditLog(db, {
        actorType: 'user',
        actorId: payload.sub,
        action: 'auth.logout',
        resourceType: 'session',
        resourceId: payload.sub,
        ip,
        userAgent,
      });

      return c.json({ success: true });
    } catch (error) {
      console.error('Logout error:', error);
      return c.json({ error: 'An error occurred during logout' }, 500);
    }
  });

  /**
   * POST /api/auth/refresh
   * Refresh access token using refresh token
   */
  auth.post('/refresh', async (c) => {
    try {
      let body: { refreshToken?: string } = {};
      try {
        body = await c.req.json();
      } catch {
        body = {};
      }
      const refreshToken = body.refreshToken || getRefreshTokenFromCookie(c);

      if (!refreshToken) {
        return c.json({ error: 'Refresh token is required' }, 400);
      }

      // Verify refresh token structure and signature
      const payload = verifyToken(refreshToken, jwtSecret);

      if (!payload || payload.type !== 'refresh') {
        return c.json({ error: 'Invalid refresh token' }, 401);
      }

      // Hash the refresh token to find the session
      const hashedToken = hashRefreshToken(refreshToken);

      // Find session by hashed token
      const sessionResults = await db
        .select()
        .from(sessions)
        .where(eq(sessions.hashedToken, hashedToken))
        .limit(1);

      if (sessionResults.length === 0) {
        return c.json({ error: 'Session not found or expired' }, 401);
      }

      const session = sessionResults[0];

      // Check if session is expired
      if (new Date() > session.expiresAt) {
        // Delete expired session
        await db.delete(sessions).where(eq(sessions.id, session.id));
        return c.json({ error: 'Session expired' }, 401);
      }

      // Get user info for new tokens
      const refreshUserResults = await db
        .select()
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1);

      if (refreshUserResults.length === 0) {
        return c.json({ error: 'User not found' }, 401);
      }

      // Decrypt user data if encryption is enabled
      const user = enc.decryptUser(refreshUserResults[0]);

      // Generate new token pair
      const tokens = generateTokenPair({ userId: user.id, email: user.email }, jwtSecret);

      // Hash new refresh token
      const newHashedToken = hashRefreshToken(tokens.refreshToken);

      // Update session with new refresh token hash
      await db
        .update(sessions)
        .set({
          hashedToken: newHashedToken,
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
        })
        .where(eq(sessions.id, session.id));

      setRefreshCookie(c, tokens.refreshToken);

      const { ip, userAgent } = getRequestMetadata(c);
      await writeAuditLog(db, {
        actorType: 'user',
        actorId: user.id,
        action: 'auth.refresh',
        resourceType: 'session',
        resourceId: session.id,
        ip,
        userAgent,
      });

      return c.json({
        tokens: {
          accessToken: tokens.accessToken,
          expiresIn: tokens.expiresIn,
        },
      });
    } catch (error) {
      console.error('Token refresh error:', error);
      return c.json({ error: 'An error occurred during token refresh' }, 500);
    }
  });

  /**
   * GET /api/auth/me
   * Get current user profile with organizations
   * Requires: Authorization: Bearer <access_token>
   */
  auth.get('/me', async (c) => {
    try {
      // Extract token from Authorization header
      const authHeader = c.req.header('Authorization');
      const token = extractBearerToken(authHeader);

      if (!token) {
        return c.json({ error: 'Authorization header required' }, 401);
      }

      // Verify token
      const payload = verifyToken(token, jwtSecret);

      if (!payload || payload.type !== 'access') {
        return c.json({ error: 'Invalid or expired token' }, 401);
      }

      // Get user
      const userResults = await db
        .select()
        .from(users)
        .where(eq(users.id, payload.sub))
        .limit(1);

      if (userResults.length === 0) {
        return c.json({ error: 'User not found' }, 404);
      }

      // Decrypt user data if encryption is enabled
      const user = enc.decryptUser(userResults[0]);

      // Get user's organizations with roles
      const memberResults = await db
        .select({
          orgId: orgMembers.orgId,
          role: orgMembers.role,
          orgName: organizations.name,
          orgSlug: organizations.slug,
          orgPlan: organizations.plan,
        })
        .from(orgMembers)
        .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
        .where(eq(orgMembers.userId, user.id));

      const orgs = memberResults.map((m) => ({
        id: m.orgId,
        name: m.orgName,
        slug: m.orgSlug,
        plan: m.orgPlan,
        role: m.role,
      }));

      return c.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          createdAt: user.createdAt,
        },
        organizations: orgs,
      });
    } catch (error) {
      console.error('Get profile error:', error);
      return c.json({ error: 'An error occurred while fetching profile' }, 500);
    }
  });

  return auth;
}
