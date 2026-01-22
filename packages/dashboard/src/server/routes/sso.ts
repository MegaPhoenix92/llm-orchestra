/**
 * SSO Routes for Azure AD / OIDC Authentication
 *
 * Provides endpoints for:
 * - /api/auth/sso/azure - Initiate Azure AD login
 * - /api/auth/sso/azure/callback - Handle Azure AD callback
 * - /api/auth/sso/status - Check SSO availability
 */

import { Hono, type Context } from 'hono';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Database } from '../../db/index.js';
import { users, organizations, orgMembers, sessions } from '../../db/schema.js';
import { generateTokenPair, type EncryptionConfig } from '../../auth/index.js';
import { createEncryptionContext, hashEmailForLookup } from '../../db/encrypted-fields.js';
import { generateSlug } from '../../utils/slug.js';
import { getRequestMetadata, writeAuditLog } from '../../utils/audit.js';
import crypto from 'crypto';
import {
  type SsoConfig,
  type OidcClientConfig,
  createOidcClient,
  generateAuthorizationUrl,
  handleCallback,
  retrieveOidcState,
  isEmailAllowed,
  isSsoEnabled,
} from '../../auth/sso.js';

export interface SsoRoutesOptions {
  db: Database;
  jwtSecret: string;
  sso?: SsoConfig;
  /** Optional encryption configuration for sensitive data at rest */
  encryption?: EncryptionConfig;
}

/** 7 days in milliseconds for refresh token expiration */
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_MAX_AGE = Math.floor(REFRESH_TOKEN_EXPIRY_MS / 1000);

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
    'SameSite=Lax', // Lax for SSO redirect compatibility
    `Max-Age=${REFRESH_COOKIE_MAX_AGE}`,
  ];

  if (isSecureRequest(c)) {
    parts.push('Secure');
  }

  c.header('Set-Cookie', parts.join('; '));
}

/**
 * Hash a refresh token for secure storage
 */
function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Create SSO routes for Azure AD authentication
 */
export function createSsoRoutes(options: SsoRoutesOptions): Hono {
  const { db, jwtSecret, sso, encryption } = options;
  const ssoRouter = new Hono();

  // Create encryption context for sensitive data
  const enc = createEncryptionContext(encryption);

  // Cache OIDC client to avoid repeated discovery
  let oidcClientPromise: Promise<OidcClientConfig> | null = null;

  /**
   * Get or create OIDC client (lazy initialization)
   */
  async function getOidcClient(): Promise<OidcClientConfig | null> {
    if (!sso || !isSsoEnabled(sso)) {
      return null;
    }

    if (!oidcClientPromise) {
      oidcClientPromise = createOidcClient(sso);
    }

    return oidcClientPromise;
  }

  /**
   * GET /api/auth/sso/status
   * Check if SSO is enabled and available
   */
  ssoRouter.get('/status', async (c) => {
    const enabled = isSsoEnabled(sso);
    return c.json({
      enabled,
      provider: enabled ? 'azure' : null,
      allowedDomains: sso?.allowedDomains || null,
    });
  });

  /**
   * GET /api/auth/sso/azure
   * Initiate Azure AD login flow
   */
  ssoRouter.get('/azure', async (c) => {
    try {
      const oidcClient = await getOidcClient();

      if (!oidcClient) {
        return c.json({ error: 'SSO is not configured' }, 400);
      }

      // Get optional return URL from query
      const returnTo = c.req.query('returnTo') || '/';

      // Generate authorization URL with PKCE
      const { url } = await generateAuthorizationUrl(oidcClient, returnTo);

      // Redirect to Azure AD
      return c.redirect(url);
    } catch (error) {
      console.error('SSO initiation error:', error);
      return c.json({ error: 'Failed to initiate SSO login' }, 500);
    }
  });

  /**
   * GET /api/auth/sso/azure/callback
   * Handle Azure AD callback after authentication
   */
  ssoRouter.get('/azure/callback', async (c) => {
    try {
      const oidcClient = await getOidcClient();

      if (!oidcClient) {
        return c.json({ error: 'SSO is not configured' }, 400);
      }

      // Get the full callback URL
      const callbackUrl = new URL(c.req.url);

      // Check for error response from Azure AD
      const error = callbackUrl.searchParams.get('error');
      if (error) {
        const errorDescription = callbackUrl.searchParams.get('error_description') || 'Unknown error';
        console.error('Azure AD error:', error, errorDescription);
        return c.redirect(`/?error=sso_failed&message=${encodeURIComponent(errorDescription)}`);
      }

      // Get state from callback
      const state = callbackUrl.searchParams.get('state');
      if (!state) {
        return c.redirect('/?error=sso_failed&message=Missing+state+parameter');
      }

      // Retrieve stored state
      const storedState = retrieveOidcState(state);
      if (!storedState) {
        return c.redirect('/?error=sso_failed&message=Invalid+or+expired+state');
      }

      // Exchange code for tokens and get user info
      const userInfo = await handleCallback(oidcClient, callbackUrl, storedState);

      // Validate email domain if configured
      if (!isEmailAllowed(userInfo.email, sso?.allowedDomains)) {
        const { ip, userAgent } = getRequestMetadata(c);
        await writeAuditLog(db, {
          actorType: 'system',
          actorId: 'sso',
          action: 'sso.domain_rejected',
          resourceType: 'user',
          resourceId: userInfo.azureId,
          ip,
          userAgent,
          status: 'denied',
          metadata: { email: userInfo.email, allowedDomains: sso?.allowedDomains },
        });
        return c.redirect('/?error=sso_failed&message=Email+domain+not+allowed');
      }

      // Find or create user (use email hash for lookup when encryption is enabled)
      const ssoEmailHash = enc.enabled ? hashEmailForLookup(userInfo.email) : null;
      const existingUser = ssoEmailHash
        ? await db.select().from(users).where(eq(users.emailHash, ssoEmailHash)).limit(1)
        : await db.select().from(users).where(eq(users.email, userInfo.email)).limit(1);

      let userId: string;
      let isNewUser = false;

      if (existingUser.length > 0) {
        // Existing user - update SSO ID if not set
        userId = existingUser[0].id;

        // Optionally update user name from SSO if changed (encrypt the name if needed)
        const decryptedUser = enc.decryptUser(existingUser[0]);
        if (userInfo.name && userInfo.name !== decryptedUser.name) {
          const encryptedUpdate = enc.encryptUser({ name: userInfo.name, updatedAt: new Date() });
          await db.update(users).set(encryptedUpdate).where(eq(users.id, userId));
        }
      } else {
        // New user - create account
        isNewUser = true;
        userId = `usr_${nanoid(21)}`;
        const now = new Date();

        // Encrypt user data if encryption is enabled
        const userData = enc.encryptUser({
          id: userId,
          email: userInfo.email,
          emailHash: ssoEmailHash || undefined,
          passwordHash: '', // No password for SSO users
          name: userInfo.name || null,
          ssoProvider: 'azure',
          ssoId: userInfo.azureId,
          createdAt: now,
          updatedAt: now,
        });
        await db.insert(users).values(userData);

        // If default org is configured, add user to it
        if (sso?.defaultOrgId) {
          const orgExists = await db
            .select()
            .from(organizations)
            .where(eq(organizations.id, sso.defaultOrgId))
            .limit(1);

          if (orgExists.length > 0) {
            // Check if already a member
            const existingMember = await db
              .select()
              .from(orgMembers)
              .where(and(eq(orgMembers.orgId, sso.defaultOrgId), eq(orgMembers.userId, userId)))
              .limit(1);

            if (existingMember.length === 0) {
              await db.insert(orgMembers).values({
                id: `mem_${nanoid(21)}`,
                orgId: sso.defaultOrgId,
                userId,
                role: sso.defaultRole || 'member',
                createdAt: now,
              });
            }
          }
        } else {
          // Create personal organization for new SSO user
          const orgId = `org_${nanoid(21)}`;
          const orgName = userInfo.name
            ? `${userInfo.name}'s Organization`
            : `${userInfo.email.split('@')[0]}'s Organization`;
          const slug = generateSlug(orgName);

          // Check if slug exists
          const existingOrg = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
          const finalSlug = existingOrg.length > 0 ? `${slug}-${nanoid(6)}` : slug;

          await db.insert(organizations).values({
            id: orgId,
            name: orgName,
            slug: finalSlug,
            plan: 'free',
            createdAt: now,
            updatedAt: now,
          });

          await db.insert(orgMembers).values({
            id: `mem_${nanoid(21)}`,
            orgId,
            userId,
            role: 'owner',
            createdAt: now,
          });
        }
      }

      // Generate token pair
      const tokens = generateTokenPair({ userId, email: userInfo.email }, jwtSecret);

      // Hash refresh token for storage
      const hashedToken = hashRefreshToken(tokens.refreshToken);

      // Store session
      const sessionId = `ses_${nanoid(21)}`;
      await db.insert(sessions).values({
        id: sessionId,
        userId,
        hashedToken,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
        createdAt: new Date(),
      });

      // Set refresh token cookie
      setRefreshCookie(c, tokens.refreshToken);

      // Write audit log
      const { ip, userAgent } = getRequestMetadata(c);
      await writeAuditLog(db, {
        actorType: 'user',
        actorId: userId,
        action: isNewUser ? 'sso.register' : 'sso.login',
        resourceType: 'session',
        resourceId: sessionId,
        ip,
        userAgent,
        metadata: {
          email: userInfo.email,
          provider: 'azure',
          azureId: userInfo.azureId,
          isNewUser,
        },
      });

      // Redirect to return URL with access token
      // Frontend should extract token from URL fragment and store it
      const returnTo = storedState.returnTo || '/';
      const separator = returnTo.includes('?') ? '&' : '?';
      return c.redirect(`${returnTo}${separator}access_token=${tokens.accessToken}&expires_in=${tokens.expiresIn}`);
    } catch (error) {
      console.error('SSO callback error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return c.redirect(`/?error=sso_failed&message=${encodeURIComponent(errorMessage)}`);
    }
  });

  return ssoRouter;
}
