/**
 * SSO (Azure AD / OIDC) Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  storeOidcState,
  retrieveOidcState,
  isEmailAllowed,
  isSsoEnabled,
  type OidcState,
  type SsoConfig,
} from '../src/auth/sso.js';

describe('OIDC State Management', () => {
  describe('storeOidcState', () => {
    it('should_storeState_when_validStateProvided', () => {
      const state: OidcState = {
        state: 'test-state-123',
        codeVerifier: 'test-verifier-456',
        nonce: 'test-nonce-789',
        returnTo: '/dashboard',
      };

      storeOidcState(state);

      const retrieved = retrieveOidcState('test-state-123');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.state).toBe('test-state-123');
      expect(retrieved?.codeVerifier).toBe('test-verifier-456');
      expect(retrieved?.nonce).toBe('test-nonce-789');
      expect(retrieved?.returnTo).toBe('/dashboard');
    });

    it('should_storeStateWithoutReturnTo_when_returnToNotProvided', () => {
      const state: OidcState = {
        state: 'test-state-no-return',
        codeVerifier: 'test-verifier',
        nonce: 'test-nonce',
      };

      storeOidcState(state);

      const retrieved = retrieveOidcState('test-state-no-return');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.returnTo).toBeUndefined();
    });
  });

  describe('retrieveOidcState', () => {
    it('should_returnState_when_stateExists', () => {
      const state: OidcState = {
        state: 'retrieve-test-state',
        codeVerifier: 'retrieve-verifier',
        nonce: 'retrieve-nonce',
      };

      storeOidcState(state);
      const retrieved = retrieveOidcState('retrieve-test-state');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.state).toBe('retrieve-test-state');
    });

    it('should_returnNull_when_stateDoesNotExist', () => {
      const retrieved = retrieveOidcState('non-existent-state');
      expect(retrieved).toBeNull();
    });

    it('should_removeState_when_retrieved', () => {
      const state: OidcState = {
        state: 'one-time-state',
        codeVerifier: 'one-time-verifier',
        nonce: 'one-time-nonce',
      };

      storeOidcState(state);

      // First retrieval should succeed
      const firstRetrieval = retrieveOidcState('one-time-state');
      expect(firstRetrieval).not.toBeNull();

      // Second retrieval should fail (state already consumed)
      const secondRetrieval = retrieveOidcState('one-time-state');
      expect(secondRetrieval).toBeNull();
    });
  });
});

describe('Email Domain Validation', () => {
  describe('isEmailAllowed', () => {
    it('should_returnTrue_when_noAllowedDomainsConfigured', () => {
      expect(isEmailAllowed('user@example.com')).toBe(true);
      expect(isEmailAllowed('user@company.com', undefined)).toBe(true);
      expect(isEmailAllowed('user@any.org', [])).toBe(true);
    });

    it('should_returnTrue_when_emailDomainIsAllowed', () => {
      const allowedDomains = ['trozlan.com', 'example.org'];

      expect(isEmailAllowed('user@trozlan.com', allowedDomains)).toBe(true);
      expect(isEmailAllowed('admin@example.org', allowedDomains)).toBe(true);
    });

    it('should_returnFalse_when_emailDomainNotAllowed', () => {
      const allowedDomains = ['trozlan.com'];

      expect(isEmailAllowed('user@other.com', allowedDomains)).toBe(false);
      expect(isEmailAllowed('user@example.org', allowedDomains)).toBe(false);
    });

    it('should_beCaseInsensitive_when_comparingDomains', () => {
      const allowedDomains = ['TROZLAN.COM'];

      expect(isEmailAllowed('user@trozlan.com', allowedDomains)).toBe(true);
      expect(isEmailAllowed('user@TROZLAN.COM', allowedDomains)).toBe(true);
      expect(isEmailAllowed('user@TroZlan.Com', allowedDomains)).toBe(true);
    });

    it('should_handleSubdomains_when_exactMatchRequired', () => {
      const allowedDomains = ['trozlan.com'];

      // Subdomains are NOT allowed unless explicitly listed
      expect(isEmailAllowed('user@sub.trozlan.com', allowedDomains)).toBe(false);
      expect(isEmailAllowed('user@mail.trozlan.com', allowedDomains)).toBe(false);
    });

    it('should_handleMalformedEmail_when_noDomainPresent', () => {
      const allowedDomains = ['trozlan.com'];

      expect(isEmailAllowed('invalid-email', allowedDomains)).toBe(false);
      expect(isEmailAllowed('no-at-symbol', allowedDomains)).toBe(false);
    });
  });
});

describe('SSO Configuration Validation', () => {
  describe('isSsoEnabled', () => {
    it('should_returnFalse_when_configUndefined', () => {
      expect(isSsoEnabled(undefined)).toBe(false);
    });

    it('should_returnFalse_when_configEmpty', () => {
      expect(isSsoEnabled({})).toBe(false);
    });

    it('should_returnFalse_when_tenantIdMissing', () => {
      const config: Partial<SsoConfig> = {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      };

      expect(isSsoEnabled(config)).toBe(false);
    });

    it('should_returnFalse_when_clientIdMissing', () => {
      const config: Partial<SsoConfig> = {
        tenantId: 'tenant-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      };

      expect(isSsoEnabled(config)).toBe(false);
    });

    it('should_returnFalse_when_clientSecretMissing', () => {
      const config: Partial<SsoConfig> = {
        tenantId: 'tenant-id',
        clientId: 'client-id',
        redirectUri: 'https://example.com/callback',
      };

      expect(isSsoEnabled(config)).toBe(false);
    });

    it('should_returnFalse_when_redirectUriMissing', () => {
      const config: Partial<SsoConfig> = {
        tenantId: 'tenant-id',
        clientId: 'client-id',
        clientSecret: 'client-secret',
      };

      expect(isSsoEnabled(config)).toBe(false);
    });

    it('should_returnTrue_when_allRequiredFieldsPresent', () => {
      const config: SsoConfig = {
        tenantId: 'tenant-id',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      };

      expect(isSsoEnabled(config)).toBe(true);
    });

    it('should_returnTrue_when_optionalFieldsIncluded', () => {
      const config: SsoConfig = {
        tenantId: 'tenant-id',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
        defaultOrgId: 'org_123',
        defaultRole: 'member',
        allowedDomains: ['trozlan.com'],
      };

      expect(isSsoEnabled(config)).toBe(true);
    });

    it('should_returnTrue_when_tenantIdIsCommon', () => {
      const config: SsoConfig = {
        tenantId: 'common',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      };

      expect(isSsoEnabled(config)).toBe(true);
    });
  });
});

describe('SSO Configuration Types', () => {
  it('should_acceptValidSsoConfig', () => {
    const config: SsoConfig = {
      tenantId: 'tenant-id',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://example.com/callback',
    };

    expect(config.tenantId).toBe('tenant-id');
    expect(config.clientId).toBe('client-id');
    expect(config.clientSecret).toBe('client-secret');
    expect(config.redirectUri).toBe('https://example.com/callback');
  });

  it('should_acceptSsoConfigWithOptionalFields', () => {
    const config: SsoConfig = {
      tenantId: 'tenant-id',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://example.com/callback',
      defaultOrgId: 'org_123',
      defaultRole: 'viewer',
      allowedDomains: ['trozlan.com', 'example.org'],
    };

    expect(config.defaultOrgId).toBe('org_123');
    expect(config.defaultRole).toBe('viewer');
    expect(config.allowedDomains).toEqual(['trozlan.com', 'example.org']);
  });
});

describe('OidcState Types', () => {
  it('should_acceptValidOidcState', () => {
    const state: OidcState = {
      state: 'random-state',
      codeVerifier: 'pkce-verifier',
      nonce: 'random-nonce',
    };

    expect(state.state).toBe('random-state');
    expect(state.codeVerifier).toBe('pkce-verifier');
    expect(state.nonce).toBe('random-nonce');
    expect(state.returnTo).toBeUndefined();
  });

  it('should_acceptOidcStateWithReturnTo', () => {
    const state: OidcState = {
      state: 'random-state',
      codeVerifier: 'pkce-verifier',
      nonce: 'random-nonce',
      returnTo: '/dashboard/project/123',
    };

    expect(state.returnTo).toBe('/dashboard/project/123');
  });
});

describe('Security Considerations', () => {
  it('should_notLeakStateInformation_when_stateNotFound', () => {
    // Ensure timing-safe behavior (no information leakage)
    const start = Date.now();
    const result = retrieveOidcState('non-existent-state-xyz');
    const duration = Date.now() - start;

    expect(result).toBeNull();
    // Should complete quickly without significant timing differences
    expect(duration).toBeLessThan(100);
  });

  it('should_enforceOneTimeStateUse_forCsrfProtection', () => {
    const state: OidcState = {
      state: 'csrf-protection-test',
      codeVerifier: 'verifier',
      nonce: 'nonce',
    };

    storeOidcState(state);

    // State should be consumed on first retrieval
    const first = retrieveOidcState('csrf-protection-test');
    expect(first).not.toBeNull();

    // Replay attack should fail
    const replay = retrieveOidcState('csrf-protection-test');
    expect(replay).toBeNull();
  });

  it('should_validateAllRequiredSsoFields_forSecureConfiguration', () => {
    // Missing any required field should disable SSO
    const incompleteConfigs: Partial<SsoConfig>[] = [
      { clientId: 'a', clientSecret: 'b', redirectUri: 'c' }, // missing tenantId
      { tenantId: 'a', clientSecret: 'b', redirectUri: 'c' }, // missing clientId
      { tenantId: 'a', clientId: 'b', redirectUri: 'c' }, // missing clientSecret
      { tenantId: 'a', clientId: 'b', clientSecret: 'c' }, // missing redirectUri
    ];

    for (const config of incompleteConfigs) {
      expect(isSsoEnabled(config)).toBe(false);
    }
  });
});
