/**
 * API Key Authentication Middleware for SDK Ingestion
 *
 * Validates API keys from the Authorization header against the database
 * and sets the authenticated API key details on the Hono context.
 */

import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import { verifyApiKey, getApiKeyPrefix } from '../../auth/api-key.js';
import type { Database } from '../../db/index.js';
import { apiKeys } from '../../db/schema.js';

// Extend Hono's context variables type
declare module 'hono' {
  interface ContextVariableMap {
    apiKey: { id: string; projectId: string; scopes: string[] };
    projectId: string;
  }
}

export interface ApiKeyMiddlewareOptions {
  /** Database instance for API key lookup */
  db: Database;
}

/**
 * Creates API key authentication middleware for protecting SDK ingestion routes.
 *
 * The middleware extracts the Bearer token from the Authorization header,
 * looks up the API key by prefix in the database, verifies the full key
 * against the stored hash, checks expiration, and updates the lastUsedAt timestamp.
 *
 * @param options - Configuration options including the database instance
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * const apiKeyMiddleware = createApiKeyMiddleware({ db });
 *
 * // Protect all routes under /api/ingest
 * app.use('/api/ingest/*', apiKeyMiddleware);
 *
 * // Access API key info in handler
 * app.post('/api/ingest/traces', (c) => {
 *   const { projectId, scopes } = c.get('apiKey');
 *   // Ingest traces for the project
 * });
 * ```
 */
export function createApiKeyMiddleware(options: ApiKeyMiddlewareOptions): MiddlewareHandler {
  const { db } = options;

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
          message: 'Invalid Authorization header format. Expected: Bearer <api_key>',
        },
        401
      );
    }

    const key = authHeader.slice(7); // Remove 'Bearer ' prefix

    if (!key) {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'Missing API key in Authorization header',
        },
        401
      );
    }

    // Validate API key format (should start with orch_)
    if (!key.startsWith('orch_')) {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'Invalid API key format',
        },
        401
      );
    }

    // Extract prefix for database lookup
    const prefix = getApiKeyPrefix(key);

    // Look up API key by prefix
    const [apiKeyRecord] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.prefix, prefix))
      .limit(1);

    if (!apiKeyRecord) {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'Invalid API key',
        },
        401
      );
    }

    // Verify the full key against the stored hash
    const isValid = verifyApiKey(key, apiKeyRecord.hashedKey);

    if (!isValid) {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'Invalid API key',
        },
        401
      );
    }

    // Check if the key has expired
    if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'API key has expired',
        },
        401
      );
    }

    // Update lastUsedAt timestamp asynchronously (don't block the request)
    db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, apiKeyRecord.id))
      .catch((err) => {
        // Log but don't fail the request if timestamp update fails
        console.error('Failed to update API key lastUsedAt:', err);
      });

    // Set API key details on context for downstream handlers
    c.set('apiKey', {
      id: apiKeyRecord.id,
      projectId: apiKeyRecord.projectId,
      scopes: apiKeyRecord.scopes ?? ['ingest'],
    });
    c.set('projectId', apiKeyRecord.projectId);

    await next();
  };
}
