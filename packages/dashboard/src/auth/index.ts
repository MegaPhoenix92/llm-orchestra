/**
 * Authentication Utilities for LLM Orchestra Dashboard
 *
 * This module provides secure authentication primitives:
 * - Password hashing with bcrypt
 * - API key generation and verification
 * - JWT token management
 * - Azure AD SSO / OIDC integration
 */

// Password utilities
export { hashPassword, verifyPassword } from './password.js';

// API key utilities
export {
  generateApiKey,
  hashApiKey,
  verifyApiKey,
  getApiKeyPrefix,
  getLookupPrefixLength,
  type GeneratedApiKey,
} from './api-key.js';

// JWT utilities
export {
  generateTokenPair,
  verifyToken,
  generateAccessToken,
  generateRefreshToken,
  type JwtPayload,
  type TokenPair,
} from './jwt.js';

// SSO / OIDC utilities
export {
  createOidcClient,
  generateAuthorizationUrl,
  handleCallback,
  storeOidcState,
  retrieveOidcState,
  isEmailAllowed,
  isSsoEnabled,
  type SsoConfig,
  type OidcState,
  type SsoUserInfo,
  type OidcClientConfig,
} from './sso.js';
