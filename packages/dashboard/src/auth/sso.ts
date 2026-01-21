/**
 * Azure AD SSO / OIDC Integration for LLM Orchestra Dashboard
 *
 * Implements OpenID Connect authentication flow with Azure AD (Entra ID).
 * Supports automatic user provisioning and organization membership.
 */

import * as client from 'openid-client';

/**
 * SSO Provider configuration
 */
export interface SsoConfig {
  /** Azure AD tenant ID or 'common' for multi-tenant */
  tenantId: string;
  /** Azure AD application (client) ID */
  clientId: string;
  /** Azure AD client secret */
  clientSecret: string;
  /** Redirect URI after Azure AD authentication */
  redirectUri: string;
  /** Optional: Default organization ID to add SSO users to */
  defaultOrgId?: string;
  /** Optional: Default role for SSO users in the organization */
  defaultRole?: 'member' | 'viewer';
  /** Optional: Allowed email domains (e.g., ['trozlan.com']) */
  allowedDomains?: string[];
}

/**
 * OIDC state stored in session during authentication
 */
export interface OidcState {
  /** Random state value for CSRF protection */
  state: string;
  /** PKCE code verifier */
  codeVerifier: string;
  /** Original URL to redirect to after login */
  returnTo?: string;
  /** Nonce for ID token validation */
  nonce: string;
}

/**
 * User info extracted from Azure AD tokens
 */
export interface SsoUserInfo {
  /** Azure AD object ID (sub claim) */
  azureId: string;
  /** User email */
  email: string;
  /** User display name */
  name?: string;
  /** Given name (first name) */
  givenName?: string;
  /** Family name (last name) */
  familyName?: string;
  /** Profile picture URL */
  picture?: string;
}

/**
 * OIDC client configuration for Azure AD
 */
export interface OidcClientConfig {
  config: client.Configuration;
  ssoConfig: SsoConfig;
}

/**
 * In-memory store for OIDC states (should be Redis in production)
 */
const stateStore = new Map<string, OidcState>();

/**
 * State expiration time (10 minutes)
 */
const STATE_EXPIRY_MS = 10 * 60 * 1000;

/**
 * Clean up expired states periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, _value] of stateStore.entries()) {
    // States are cleaned up after 10 minutes
    // In production, use Redis with TTL
    if (stateStore.size > 1000) {
      // Emergency cleanup if too many states
      stateStore.clear();
      break;
    }
  }
}, STATE_EXPIRY_MS);

/**
 * Store OIDC state for callback verification
 */
export function storeOidcState(state: OidcState): void {
  stateStore.set(state.state, state);

  // Auto-cleanup after expiry
  setTimeout(() => {
    stateStore.delete(state.state);
  }, STATE_EXPIRY_MS);
}

/**
 * Retrieve and remove OIDC state
 */
export function retrieveOidcState(state: string): OidcState | null {
  const storedState = stateStore.get(state);
  if (storedState) {
    stateStore.delete(state);
    return storedState;
  }
  return null;
}

/**
 * Discover Azure AD OIDC configuration and create client
 */
export async function createOidcClient(ssoConfig: SsoConfig): Promise<OidcClientConfig> {
  const issuer =
    ssoConfig.tenantId === 'common'
      ? 'https://login.microsoftonline.com/common/v2.0'
      : `https://login.microsoftonline.com/${ssoConfig.tenantId}/v2.0`;

  const config = await client.discovery(new URL(issuer), ssoConfig.clientId, ssoConfig.clientSecret);

  return { config, ssoConfig };
}

/**
 * Generate authorization URL for Azure AD login
 */
export function generateAuthorizationUrl(oidcClient: OidcClientConfig, returnTo?: string): {
  url: string;
  state: OidcState;
} {
  const state = client.randomState();
  const nonce = client.randomNonce();
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = client.calculatePKCECodeChallenge(codeVerifier);

  const oidcState: OidcState = {
    state,
    codeVerifier,
    nonce,
    returnTo,
  };

  // Store state for callback verification
  storeOidcState(oidcState);

  const url = client.buildAuthorizationUrl(oidcClient.config, {
    redirect_uri: oidcClient.ssoConfig.redirectUri,
    scope: 'openid profile email',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    response_type: 'code',
    response_mode: 'query',
    prompt: 'select_account', // Allow account selection
  });

  return { url: url.href, state: oidcState };
}

/**
 * Exchange authorization code for tokens and extract user info
 */
export async function handleCallback(
  oidcClient: OidcClientConfig,
  callbackUrl: URL,
  storedState: OidcState
): Promise<SsoUserInfo> {
  // Exchange code for tokens
  const tokens = await client.authorizationCodeGrant(oidcClient.config, callbackUrl, {
    pkceCodeVerifier: storedState.codeVerifier,
    expectedState: storedState.state,
    expectedNonce: storedState.nonce,
    idTokenExpected: true,
  });

  // Get claims from ID token
  const claims = tokens.claims();
  if (!claims) {
    throw new Error('No claims in ID token');
  }

  const email = claims.email as string | undefined;
  const preferredUsername = claims.preferred_username as string | undefined;
  const userEmail = email || preferredUsername;

  if (!userEmail) {
    throw new Error('No email claim in ID token');
  }

  return {
    azureId: claims.sub as string,
    email: userEmail.toLowerCase(),
    name: claims.name as string | undefined,
    givenName: claims.given_name as string | undefined,
    familyName: claims.family_name as string | undefined,
    picture: claims.picture as string | undefined,
  };
}

/**
 * Validate that user email is from an allowed domain
 */
export function isEmailAllowed(email: string, allowedDomains?: string[]): boolean {
  if (!allowedDomains || allowedDomains.length === 0) {
    return true;
  }

  const emailDomain = email.split('@')[1]?.toLowerCase();
  return allowedDomains.some((domain) => domain.toLowerCase() === emailDomain);
}

/**
 * Check if SSO is enabled based on configuration
 */
export function isSsoEnabled(config?: Partial<SsoConfig>): boolean {
  return !!(config?.tenantId && config?.clientId && config?.clientSecret && config?.redirectUri);
}
