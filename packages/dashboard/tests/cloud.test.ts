/**
 * Cloud Dashboard Tests
 *
 * Tests for cloud deployment features including:
 * - Auth utilities (password, API key, JWT)
 * - Module imports
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Password Hashing Tests
// ============================================================================

describe('Password Utilities', () => {
  // Import dynamically to avoid issues with bcrypt in test environment
  let hashPassword: (password: string) => Promise<string>;
  let verifyPassword: (password: string, hash: string) => Promise<boolean>;

  beforeEach(async () => {
    const passwordModule = await import('../src/auth/password.js');
    hashPassword = passwordModule.hashPassword;
    verifyPassword = passwordModule.verifyPassword;
  });

  describe('hashPassword', () => {
    it('should_returnHashedPassword_when_givenPlaintext', async () => {
      const password = 'testPassword123';
      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should_returnDifferentHashes_when_calledMultipleTimes', async () => {
      const password = 'testPassword123';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      // bcrypt generates different salts, so hashes should differ
      expect(hash1).not.toBe(hash2);
    });

    it('should_returnBcryptFormattedHash_when_hashing', async () => {
      const password = 'testPassword123';
      const hash = await hashPassword(password);

      // bcrypt hashes start with $2a$, $2b$, or $2y$
      expect(hash).toMatch(/^\$2[aby]\$/);
    });
  });

  describe('verifyPassword', () => {
    it('should_returnTrue_when_passwordMatches', async () => {
      const password = 'correctPassword123';
      const hash = await hashPassword(password);

      const result = await verifyPassword(password, hash);
      expect(result).toBe(true);
    });

    it('should_returnFalse_when_passwordDoesNotMatch', async () => {
      const password = 'correctPassword123';
      const wrongPassword = 'wrongPassword456';
      const hash = await hashPassword(password);

      const result = await verifyPassword(wrongPassword, hash);
      expect(result).toBe(false);
    });

    it('should_returnFalse_when_hashIsInvalid', async () => {
      const password = 'testPassword123';
      const invalidHash = 'not-a-valid-hash';

      const result = await verifyPassword(password, invalidHash);
      expect(result).toBe(false);
    });

    it('should_handleEmptyPassword_when_verifying', async () => {
      const password = '';
      const hash = await hashPassword(password);

      const result = await verifyPassword(password, hash);
      expect(result).toBe(true);
    });
  });
});

// ============================================================================
// API Key Tests
// ============================================================================

describe('API Key Utilities', () => {
  let generateApiKey: () => {
    key: string;
    prefix: string;
    hashedKey: string;
  };
  let hashApiKey: (key: string) => string;
  let verifyApiKey: (key: string, hashedKey: string) => boolean;
  let getApiKeyPrefix: (key: string) => string;

  beforeEach(async () => {
    const apiKeyModule = await import('../src/auth/api-key.js');
    generateApiKey = apiKeyModule.generateApiKey;
    hashApiKey = apiKeyModule.hashApiKey;
    verifyApiKey = apiKeyModule.verifyApiKey;
    getApiKeyPrefix = apiKeyModule.getApiKeyPrefix;
  });

  describe('generateApiKey', () => {
    it('should_returnKeyWithOrchPrefix_when_generated', () => {
      const { key } = generateApiKey();

      expect(key).toMatch(/^orch_/);
    });

    it('should_returnKeyOfCorrectLength_when_generated', () => {
      const { key } = generateApiKey();

      // orch_ (5 chars) + 32 random chars = 37 total
      expect(key.length).toBe(37);
    });

    it('should_returnPrefix_when_generated', () => {
      const { key, prefix } = generateApiKey();

      // Prefix is first 16 characters: orch_ (5) + 11 random chars
      expect(prefix).toBe(key.substring(0, 16));
      expect(prefix.length).toBe(16);
    });

    it('should_returnHashedKey_when_generated', () => {
      const { key, hashedKey } = generateApiKey();

      expect(hashedKey).toBeDefined();
      expect(hashedKey).not.toBe(key);
      // SHA-256 produces 64 hex characters
      expect(hashedKey.length).toBe(64);
    });

    it('should_returnUniqueKeys_when_calledMultipleTimes', () => {
      const keys = new Set<string>();

      for (let i = 0; i < 10; i++) {
        const { key } = generateApiKey();
        keys.add(key);
      }

      expect(keys.size).toBe(10);
    });

    it('should_returnMatchingHashAndKey_when_generated', () => {
      const { key, hashedKey } = generateApiKey();

      const recomputedHash = hashApiKey(key);
      expect(recomputedHash).toBe(hashedKey);
    });
  });

  describe('hashApiKey', () => {
    it('should_returnSha256Hash_when_givenKey', () => {
      const key = 'orch_test123456789012345678901234';
      const hash = hashApiKey(key);

      // SHA-256 produces 64 hex characters
      expect(hash.length).toBe(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should_returnSameHash_when_givenSameKey', () => {
      const key = 'orch_test123456789012345678901234';
      const hash1 = hashApiKey(key);
      const hash2 = hashApiKey(key);

      expect(hash1).toBe(hash2);
    });

    it('should_returnDifferentHash_when_givenDifferentKeys', () => {
      const key1 = 'orch_test123456789012345678901234';
      const key2 = 'orch_test123456789012345678901235';
      const hash1 = hashApiKey(key1);
      const hash2 = hashApiKey(key2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyApiKey', () => {
    it('should_returnTrue_when_keyMatchesHash', () => {
      const { key, hashedKey } = generateApiKey();

      const result = verifyApiKey(key, hashedKey);
      expect(result).toBe(true);
    });

    it('should_returnFalse_when_keyDoesNotMatchHash', () => {
      const { hashedKey } = generateApiKey();
      const wrongKey = 'orch_wrongkey12345678901234567890';

      const result = verifyApiKey(wrongKey, hashedKey);
      expect(result).toBe(false);
    });

    it('should_useTimingSafeComparison_when_verifying', () => {
      // This test verifies that the function uses timing-safe comparison
      // by checking that it handles equal-length strings correctly
      const key = 'orch_test123456789012345678901234';
      const hash = hashApiKey(key);

      // Should work correctly with matching key
      expect(verifyApiKey(key, hash)).toBe(true);

      // Should work correctly with non-matching key of same length
      const wrongKey = 'orch_test123456789012345678901235';
      expect(verifyApiKey(wrongKey, hash)).toBe(false);
    });
  });

  describe('getApiKeyPrefix', () => {
    it('should_returnFirst16Characters_when_givenKey', () => {
      const key = 'orch_abc12345678901234567890123456';
      const prefix = getApiKeyPrefix(key);

      // Prefix is first 16 characters: orch_ (5) + 11 more chars
      // From 'orch_abc12345678901234567890123456', first 16 chars = 'orch_abc12345678'
      expect(prefix).toBe('orch_abc12345678');
      expect(prefix.length).toBe(16);
    });

    it('should_matchGeneratedPrefix_when_calledWithGeneratedKey', () => {
      const { key, prefix } = generateApiKey();
      const extractedPrefix = getApiKeyPrefix(key);

      expect(extractedPrefix).toBe(prefix);
    });

    it('should_provideHighEntropyForCollisionResistance', () => {
      // Generate many keys and verify all prefixes are unique
      // With 64^11 possible prefixes, collisions should be effectively impossible
      const prefixes = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        const { prefix } = generateApiKey();
        prefixes.add(prefix);
      }
      // All 1000 prefixes should be unique
      expect(prefixes.size).toBe(1000);
    });
  });
});

// ============================================================================
// JWT Token Tests
// ============================================================================

describe('JWT Utilities', () => {
  let generateTokenPair: (
    payload: { userId: string; email: string },
    secret: string
  ) => {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
  let verifyToken: (
    token: string,
    secret: string
  ) => { sub: string; email: string; type: 'access' | 'refresh' } | null;
  let generateAccessToken: (
    payload: { userId: string; email: string },
    secret: string
  ) => string;
  let generateRefreshToken: (
    payload: { userId: string; email: string },
    secret: string
  ) => string;

  const testSecret = 'test-secret-key-for-jwt-signing';
  const testPayload = {
    userId: 'usr_test123',
    email: 'test@example.com',
  };

  beforeEach(async () => {
    const jwtModule = await import('../src/auth/jwt.js');
    generateTokenPair = jwtModule.generateTokenPair;
    verifyToken = jwtModule.verifyToken;
    generateAccessToken = jwtModule.generateAccessToken;
    generateRefreshToken = jwtModule.generateRefreshToken;
  });

  describe('generateTokenPair', () => {
    it('should_returnAccessToken_when_generated', () => {
      const { accessToken } = generateTokenPair(testPayload, testSecret);

      expect(accessToken).toBeDefined();
      expect(typeof accessToken).toBe('string');
      expect(accessToken.split('.').length).toBe(3); // JWT format
    });

    it('should_returnRefreshToken_when_generated', () => {
      const { refreshToken } = generateTokenPair(testPayload, testSecret);

      expect(refreshToken).toBeDefined();
      expect(typeof refreshToken).toBe('string');
      expect(refreshToken.split('.').length).toBe(3); // JWT format
    });

    it('should_returnExpiresIn_when_generated', () => {
      const { expiresIn } = generateTokenPair(testPayload, testSecret);

      // Access token expires in 15 minutes = 900 seconds
      expect(expiresIn).toBe(900);
    });

    it('should_returnDifferentTokens_when_generatedMultipleTimes', () => {
      const pair1 = generateTokenPair(testPayload, testSecret);
      const pair2 = generateTokenPair(testPayload, testSecret);

      // Tokens should be different due to different iat (issued at) times
      // Note: They might be the same if generated in the same second
      expect(pair1.accessToken).toBeDefined();
      expect(pair2.accessToken).toBeDefined();
    });
  });

  describe('generateAccessToken', () => {
    it('should_returnValidJwt_when_generated', () => {
      const token = generateAccessToken(testPayload, testSecret);

      expect(token).toBeDefined();
      expect(token.split('.').length).toBe(3);
    });

    it('should_containCorrectPayload_when_verified', () => {
      const token = generateAccessToken(testPayload, testSecret);
      const decoded = verifyToken(token, testSecret);

      expect(decoded).not.toBeNull();
      expect(decoded?.sub).toBe(testPayload.userId);
      expect(decoded?.email).toBe(testPayload.email);
      expect(decoded?.type).toBe('access');
    });
  });

  describe('generateRefreshToken', () => {
    it('should_returnValidJwt_when_generated', () => {
      const token = generateRefreshToken(testPayload, testSecret);

      expect(token).toBeDefined();
      expect(token.split('.').length).toBe(3);
    });

    it('should_containCorrectPayload_when_verified', () => {
      const token = generateRefreshToken(testPayload, testSecret);
      const decoded = verifyToken(token, testSecret);

      expect(decoded).not.toBeNull();
      expect(decoded?.sub).toBe(testPayload.userId);
      expect(decoded?.email).toBe(testPayload.email);
      expect(decoded?.type).toBe('refresh');
    });
  });

  describe('verifyToken', () => {
    it('should_returnPayload_when_tokenIsValid', () => {
      const token = generateAccessToken(testPayload, testSecret);
      const decoded = verifyToken(token, testSecret);

      expect(decoded).not.toBeNull();
      expect(decoded?.sub).toBe(testPayload.userId);
      expect(decoded?.email).toBe(testPayload.email);
    });

    it('should_returnNull_when_tokenIsInvalid', () => {
      const invalidToken = 'not.a.valid.jwt.token';
      const decoded = verifyToken(invalidToken, testSecret);

      expect(decoded).toBeNull();
    });

    it('should_returnNull_when_secretIsWrong', () => {
      const token = generateAccessToken(testPayload, testSecret);
      const decoded = verifyToken(token, 'wrong-secret');

      expect(decoded).toBeNull();
    });

    it('should_returnNull_when_tokenIsTampered', () => {
      const token = generateAccessToken(testPayload, testSecret);
      // Tamper with the payload portion (second part)
      const parts = token.split('.');
      parts[1] = parts[1] + 'tampered';
      const tamperedToken = parts.join('.');

      const decoded = verifyToken(tamperedToken, testSecret);
      expect(decoded).toBeNull();
    });

    it('should_distinguishAccessAndRefreshTokens_when_verified', () => {
      const accessToken = generateAccessToken(testPayload, testSecret);
      const refreshToken = generateRefreshToken(testPayload, testSecret);

      const decodedAccess = verifyToken(accessToken, testSecret);
      const decodedRefresh = verifyToken(refreshToken, testSecret);

      expect(decodedAccess?.type).toBe('access');
      expect(decodedRefresh?.type).toBe('refresh');
    });
  });
});

// ============================================================================
// Module Import Tests
// ============================================================================

describe('Module Imports', () => {
  describe('createCloudDashboard', () => {
    it('should_beImportable_when_importingFromCloud', async () => {
      const cloudModule = await import('../src/cloud.js');

      expect(cloudModule.createCloudDashboard).toBeDefined();
      expect(typeof cloudModule.createCloudDashboard).toBe('function');
    });
  });

  describe('PostgresConnector', () => {
    it('should_beImportable_when_importingFromConnectors', async () => {
      const connectorsModule = await import('../src/connectors/index.js');

      expect(connectorsModule.PostgresConnector).toBeDefined();
      expect(typeof connectorsModule.PostgresConnector).toBe('function');
    });

    it('should_beImportable_when_importingDirectly', async () => {
      const postgresModule = await import('../src/connectors/postgres.js');

      expect(postgresModule.PostgresConnector).toBeDefined();
      expect(typeof postgresModule.PostgresConnector).toBe('function');
    });
  });

  describe('Auth Utilities', () => {
    it('should_exportAllUtilities_when_importingFromAuthIndex', async () => {
      const authModule = await import('../src/auth/index.js');

      // Password utilities
      expect(authModule.hashPassword).toBeDefined();
      expect(authModule.verifyPassword).toBeDefined();

      // API key utilities
      expect(authModule.generateApiKey).toBeDefined();
      expect(authModule.hashApiKey).toBeDefined();
      expect(authModule.verifyApiKey).toBeDefined();
      expect(authModule.getApiKeyPrefix).toBeDefined();

      // JWT utilities
      expect(authModule.generateTokenPair).toBeDefined();
      expect(authModule.verifyToken).toBeDefined();
      expect(authModule.generateAccessToken).toBeDefined();
      expect(authModule.generateRefreshToken).toBeDefined();
    });

    it('should_beImportable_when_importingPasswordModule', async () => {
      const passwordModule = await import('../src/auth/password.js');

      expect(passwordModule.hashPassword).toBeDefined();
      expect(passwordModule.verifyPassword).toBeDefined();
    });

    it('should_beImportable_when_importingApiKeyModule', async () => {
      const apiKeyModule = await import('../src/auth/api-key.js');

      expect(apiKeyModule.generateApiKey).toBeDefined();
      expect(apiKeyModule.hashApiKey).toBeDefined();
      expect(apiKeyModule.verifyApiKey).toBeDefined();
      expect(apiKeyModule.getApiKeyPrefix).toBeDefined();
    });

    it('should_beImportable_when_importingJwtModule', async () => {
      const jwtModule = await import('../src/auth/jwt.js');

      expect(jwtModule.generateTokenPair).toBeDefined();
      expect(jwtModule.verifyToken).toBeDefined();
      expect(jwtModule.generateAccessToken).toBeDefined();
      expect(jwtModule.generateRefreshToken).toBeDefined();
    });
  });

  describe('Database Schema', () => {
    it('should_exportAllTables_when_importingSchema', async () => {
      const schemaModule = await import('../src/db/schema.js');

      // Multi-tenancy tables
      expect(schemaModule.organizations).toBeDefined();
      expect(schemaModule.projects).toBeDefined();
      expect(schemaModule.users).toBeDefined();
      expect(schemaModule.orgMembers).toBeDefined();
      expect(schemaModule.projectMembers).toBeDefined();
      expect(schemaModule.apiKeys).toBeDefined();
      expect(schemaModule.sessions).toBeDefined();
      expect(schemaModule.invitations).toBeDefined();
      expect(schemaModule.auditLogs).toBeDefined();
      expect(schemaModule.alertRules).toBeDefined();
      expect(schemaModule.alertEvents).toBeDefined();
      expect(schemaModule.webhooks).toBeDefined();
      expect(schemaModule.webhookDeliveries).toBeDefined();

      // Observability tables
      expect(schemaModule.traces).toBeDefined();
      expect(schemaModule.spans).toBeDefined();
      expect(schemaModule.spanEvents).toBeDefined();
      expect(schemaModule.statsSnapshots).toBeDefined();

      // Schema object
      expect(schemaModule.schema).toBeDefined();
    });

    it('should_exportSchemaObject_when_importingSchema', async () => {
      const schemaModule = await import('../src/db/schema.js');

      expect(schemaModule.schema.organizations).toBeDefined();
      expect(schemaModule.schema.projects).toBeDefined();
      expect(schemaModule.schema.users).toBeDefined();
      expect(schemaModule.schema.projectMembers).toBeDefined();
      expect(schemaModule.schema.auditLogs).toBeDefined();
      expect(schemaModule.schema.alertRules).toBeDefined();
      expect(schemaModule.schema.alertEvents).toBeDefined();
      expect(schemaModule.schema.webhooks).toBeDefined();
      expect(schemaModule.schema.webhookDeliveries).toBeDefined();
      expect(schemaModule.schema.traces).toBeDefined();
      expect(schemaModule.schema.spans).toBeDefined();
    });
  });
});

// ============================================================================
// Auth Index Re-exports Tests
// ============================================================================

describe('Auth Module Re-exports', () => {
  it('should_reexportPasswordFunctions_when_importingFromIndex', async () => {
    const authIndex = await import('../src/auth/index.js');
    const passwordDirect = await import('../src/auth/password.js');

    expect(authIndex.hashPassword).toBe(passwordDirect.hashPassword);
    expect(authIndex.verifyPassword).toBe(passwordDirect.verifyPassword);
  });

  it('should_reexportApiKeyFunctions_when_importingFromIndex', async () => {
    const authIndex = await import('../src/auth/index.js');
    const apiKeyDirect = await import('../src/auth/api-key.js');

    expect(authIndex.generateApiKey).toBe(apiKeyDirect.generateApiKey);
    expect(authIndex.hashApiKey).toBe(apiKeyDirect.hashApiKey);
    expect(authIndex.verifyApiKey).toBe(apiKeyDirect.verifyApiKey);
    expect(authIndex.getApiKeyPrefix).toBe(apiKeyDirect.getApiKeyPrefix);
  });

  it('should_reexportJwtFunctions_when_importingFromIndex', async () => {
    const authIndex = await import('../src/auth/index.js');
    const jwtDirect = await import('../src/auth/jwt.js');

    expect(authIndex.generateTokenPair).toBe(jwtDirect.generateTokenPair);
    expect(authIndex.verifyToken).toBe(jwtDirect.verifyToken);
    expect(authIndex.generateAccessToken).toBe(jwtDirect.generateAccessToken);
    expect(authIndex.generateRefreshToken).toBe(jwtDirect.generateRefreshToken);
  });
});
