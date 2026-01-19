/**
 * JWT Authentication Middleware for Web Users
 *
 * Validates JWT tokens from the Authorization header and sets
 * the authenticated user on the Hono context for downstream handlers.
 */

import type { MiddlewareHandler } from 'hono';
import { verifyToken, type JwtPayload } from '../../auth/jwt.js';

// Extend Hono's context variables type
declare module 'hono' {
  interface ContextVariableMap {
    user: JwtPayload;
    userId: string;
  }
}

export interface AuthMiddlewareOptions {
  /** JWT signing secret for token verification */
  jwtSecret: string;
}

/**
 * Creates JWT authentication middleware for protecting web dashboard routes.
 *
 * The middleware extracts the Bearer token from the Authorization header,
 * verifies it, and sets the user payload on the context.
 *
 * @param options - Configuration options including the JWT secret
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * const authMiddleware = createAuthMiddleware({ jwtSecret: process.env.JWT_SECRET });
 *
 * // Protect all routes under /dashboard
 * app.use('/dashboard/*', authMiddleware);
 *
 * // Access user in handler
 * app.get('/dashboard/profile', (c) => {
 *   const user = c.get('user');
 *   return c.json({ userId: user.sub, email: user.email });
 * });
 * ```
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions): MiddlewareHandler {
  const { jwtSecret } = options;

  return async (c, next) => {
    // Extract Authorization header
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'Missing Authorization header',
        },
        401
      );
    }

    // Validate Bearer token format
    if (!authHeader.startsWith('Bearer ')) {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'Invalid Authorization header format. Expected: Bearer <token>',
        },
        401
      );
    }

    const token = authHeader.slice(7); // Remove 'Bearer ' prefix

    if (!token) {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'Missing token in Authorization header',
        },
        401
      );
    }

    // Verify the JWT token
    const payload = verifyToken(token, jwtSecret);

    if (!payload) {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'Invalid or expired token',
        },
        401
      );
    }

    // Ensure this is an access token, not a refresh token
    if (payload.type !== 'access') {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'Invalid token type. Expected access token',
        },
        401
      );
    }

    // Set user payload and userId on context for downstream handlers
    c.set('user', payload);
    c.set('userId', payload.sub);

    await next();
  };
}
