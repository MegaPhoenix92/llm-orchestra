/**
 * Server Middleware Exports
 *
 * Authentication and authorization middleware for the LLM Orchestra dashboard.
 */

// JWT authentication for web users
export { createAuthMiddleware, type AuthMiddlewareOptions } from './auth.js';

// API key authentication for SDK ingestion
export { createApiKeyMiddleware, type ApiKeyMiddlewareOptions } from './api-key.js';
