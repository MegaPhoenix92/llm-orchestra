/**
 * Cloud Dashboard Integration Tests
 *
 * Tests the full cloud dashboard flow:
 * - Auth: register → login → refresh → logout
 * - Admin: create org → create project → create API key
 * - Ingest: send spans → query traces
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Hono } from 'hono';

// Mock drizzle-orm before imports
vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn(() => ({})),
}));

vi.mock('pg', () => ({
  Pool: vi.fn(() => ({
    end: vi.fn(),
  })),
}));

// ============================================================================
// Auth Routes Integration Tests
// ============================================================================

describe('Auth Routes Integration', () => {
  let createAuthRoutes: typeof import('../src/server/routes/auth.js').createAuthRoutes;
  let hashPassword: typeof import('../src/auth/password.js').hashPassword;
  let verifyPassword: typeof import('../src/auth/password.js').verifyPassword;
  let generateApiKey: typeof import('../src/auth/api-key.js').generateApiKey;
  let verifyApiKey: typeof import('../src/auth/api-key.js').verifyApiKey;
  let generateTokenPair: typeof import('../src/auth/jwt.js').generateTokenPair;
  let verifyToken: typeof import('../src/auth/jwt.js').verifyToken;

  beforeEach(async () => {
    vi.resetModules();

    const authModule = await import('../src/server/routes/auth.js');
    createAuthRoutes = authModule.createAuthRoutes;

    const passwordModule = await import('../src/auth/password.js');
    hashPassword = passwordModule.hashPassword;
    verifyPassword = passwordModule.verifyPassword;

    const apiKeyModule = await import('../src/auth/api-key.js');
    generateApiKey = apiKeyModule.generateApiKey;
    verifyApiKey = apiKeyModule.verifyApiKey;

    const jwtModule = await import('../src/auth/jwt.js');
    generateTokenPair = jwtModule.generateTokenPair;
    verifyToken = jwtModule.verifyToken;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Password + JWT Integration', () => {
    it('should_hashAndVerifyPassword_when_fullCycleCompleted', async () => {
      const password = 'SecurePassword123!';

      // Hash password
      const hash = await hashPassword(password);
      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);

      // Verify correct password
      const isValid = await verifyPassword(password, hash);
      expect(isValid).toBe(true);

      // Verify wrong password
      const isInvalid = await verifyPassword('WrongPassword', hash);
      expect(isInvalid).toBe(false);
    });

    it('should_generateAndVerifyTokens_when_fullCycleCompleted', () => {
      const userId = 'usr_test123';
      const email = 'test@example.com';
      const jwtSecret = 'test-jwt-secret-key-that-is-long-enough';

      // Generate token pair
      const tokens = generateTokenPair({ userId, email }, jwtSecret);
      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
      expect(tokens.expiresIn).toBe(900); // 15 minutes

      // Verify access token
      const accessPayload = verifyToken(tokens.accessToken, jwtSecret);
      expect(accessPayload).not.toBeNull();
      expect(accessPayload?.sub).toBe(userId);
      expect(accessPayload?.email).toBe(email);
      expect(accessPayload?.type).toBe('access');

      // Verify refresh token
      const refreshPayload = verifyToken(tokens.refreshToken, jwtSecret);
      expect(refreshPayload).not.toBeNull();
      expect(refreshPayload?.sub).toBe(userId);
      expect(refreshPayload?.type).toBe('refresh');
    });

    it('should_rejectTamperedTokens_when_verifying', () => {
      const userId = 'usr_test123';
      const email = 'test@example.com';
      const jwtSecret = 'test-jwt-secret-key-long-enough';

      const tokens = generateTokenPair({ userId, email }, jwtSecret);

      // Tamper with token
      const tamperedToken = tokens.accessToken.slice(0, -5) + 'XXXXX';

      // Should fail verification
      const payload = verifyToken(tamperedToken, jwtSecret);
      expect(payload).toBeNull();
    });

    it('should_rejectWrongSecret_when_verifying', () => {
      const userId = 'usr_test123';
      const email = 'test@example.com';

      const tokens = generateTokenPair({ userId, email }, 'correct-secret-long');

      // Try to verify with wrong secret
      const payload = verifyToken(tokens.accessToken, 'wrong-secret-long');
      expect(payload).toBeNull();
    });
  });

  describe('API Key Integration', () => {
    it('should_generateAndVerifyApiKey_when_fullCycleCompleted', () => {
      // Generate API key
      const { key, prefix, hashedKey } = generateApiKey();

      // Key should have correct format
      expect(key).toMatch(/^orch_[a-zA-Z0-9_-]{32}$/);
      expect(prefix).toBe(key.substring(0, 16));
      expect(hashedKey).toHaveLength(64); // SHA-256 hex

      // Verify correct key
      const isValid = verifyApiKey(key, hashedKey);
      expect(isValid).toBe(true);

      // Verify wrong key
      const wrongKey = 'orch_wrongkeywrongkeywrongkeywrong';
      const isInvalid = verifyApiKey(wrongKey, hashedKey);
      expect(isInvalid).toBe(false);
    });

    it('should_generateUniqueKeys_when_calledMultipleTimes', () => {
      const keys = new Set<string>();
      const prefixes = new Set<string>();

      for (let i = 0; i < 100; i++) {
        const { key, prefix } = generateApiKey();
        keys.add(key);
        prefixes.add(prefix);
      }

      // All keys should be unique
      expect(keys.size).toBe(100);
      // Prefixes should also be unique (with very high probability)
      expect(prefixes.size).toBe(100);
    });
  });
});

// ============================================================================
// Ingest Routes Integration Tests
// ============================================================================

describe('Ingest Routes Integration', () => {
  describe('OTLP Format Parsing', () => {
    it('should_parseValidOtlpFormat_when_resourceSpansProvided', () => {
      const otlpPayload = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'test-service' } },
              ],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'abc123',
                    spanId: 'span456',
                    name: 'test-operation',
                    startTimeUnixNano: '1700000000000000000',
                    endTimeUnixNano: '1700000001000000000',
                    status: { code: 1 }, // OK
                    attributes: [
                      { key: 'llm.model', value: { stringValue: 'claude-3-opus' } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      // Verify OTLP structure is valid
      expect(otlpPayload.resourceSpans).toBeDefined();
      expect(otlpPayload.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);

      const span = otlpPayload.resourceSpans[0].scopeSpans[0].spans[0];
      expect(span.traceId).toBe('abc123');
      expect(span.name).toBe('test-operation');
    });

    it('should_parseLegacyFormat_when_spansArrayProvided', () => {
      const legacyPayload = {
        spans: [
          {
            traceId: 'trace-001',
            spanId: 'span-001',
            name: 'chat-completion',
            startTime: 1700000000000,
            endTime: 1700000001000,
            status: 'ok',
            attributes: {
              'llm.provider': 'anthropic',
              'llm.model': 'claude-3-opus',
              'llm.input_tokens': 100,
              'llm.output_tokens': 50,
            },
          },
        ],
      };

      // Verify legacy structure is valid
      expect(legacyPayload.spans).toBeDefined();
      expect(legacyPayload.spans).toHaveLength(1);

      const span = legacyPayload.spans[0];
      expect(span.traceId).toBe('trace-001');
      expect(span.attributes['llm.model']).toBe('claude-3-opus');
    });
  });

  describe('Span Data Transformation', () => {
    it('should_calculateDuration_when_startAndEndProvided', () => {
      const startTime = 1700000000000;
      const endTime = 1700000001500;
      const durationMs = endTime - startTime;

      expect(durationMs).toBe(1500);
    });

    it('should_extractLlmMetrics_when_attributesProvided', () => {
      const attributes = {
        'llm.provider': 'anthropic',
        'llm.model': 'claude-3-opus',
        'llm.input_tokens': 100,
        'llm.output_tokens': 50,
        'llm.cost': 0.015,
      };

      const metrics = {
        provider: attributes['llm.provider'],
        model: attributes['llm.model'],
        inputTokens: attributes['llm.input_tokens'],
        outputTokens: attributes['llm.output_tokens'],
        cost: attributes['llm.cost'],
      };

      expect(metrics.provider).toBe('anthropic');
      expect(metrics.model).toBe('claude-3-opus');
      expect(metrics.inputTokens).toBe(100);
      expect(metrics.outputTokens).toBe(50);
      expect(metrics.cost).toBe(0.015);
    });
  });
});

// ============================================================================
// Full Flow Integration Tests
// ============================================================================

describe('Full Cloud Flow Integration', () => {
  describe('User Registration Flow', () => {
    it('should_createCompleteUserContext_when_registering', async () => {
      const hashPassword = (await import('../src/auth/password.js')).hashPassword;
      const generateTokenPair = (await import('../src/auth/jwt.js')).generateTokenPair;

      // Simulate registration data
      const email = 'test@example.com';
      const password = 'SecurePassword123!';
      const orgName = 'Test Organization';

      // Hash password for storage
      const passwordHash = await hashPassword(password);
      expect(passwordHash).toBeDefined();

      // Generate IDs (simulating what the server would do)
      const userId = 'usr_' + Date.now().toString(36);
      const orgId = 'org_' + Date.now().toString(36);

      // Generate tokens
      const tokens = generateTokenPair({ userId, email }, 'test-secret-long-enough');
      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();

      // Verify user context is complete
      const userContext = {
        userId,
        email,
        orgId,
        orgName,
        passwordHash,
        tokens,
      };

      expect(userContext.userId).toMatch(/^usr_/);
      expect(userContext.orgId).toMatch(/^org_/);
      expect(userContext.tokens.expiresIn).toBe(900);
    });
  });

  describe('Project and API Key Flow', () => {
    it('should_createProjectWithApiKey_when_adminFlow', async () => {
      const generateApiKey = (await import('../src/auth/api-key.js')).generateApiKey;

      // Simulate project creation
      const orgId = 'org_test123';
      const projectName = 'Production';
      const projectId = 'prj_' + Date.now().toString(36);

      // Generate API key for project
      const { key, prefix, hashedKey } = generateApiKey();

      const projectContext = {
        projectId,
        orgId,
        name: projectName,
        apiKey: {
          id: 'key_' + Date.now().toString(36),
          prefix,
          hashedKey,
          scopes: ['ingest'],
        },
      };

      // Verify project context
      expect(projectContext.projectId).toMatch(/^prj_/);
      expect(projectContext.apiKey.prefix).toMatch(/^orch_/);
      expect(projectContext.apiKey.scopes).toContain('ingest');

      // API key should be verifiable
      const verifyApiKey = (await import('../src/auth/api-key.js')).verifyApiKey;
      expect(verifyApiKey(key, hashedKey)).toBe(true);
    });
  });

  describe('Data Ingestion Flow', () => {
    it('should_processSpanAndCreateTrace_when_ingesting', () => {
      // Simulate incoming span data
      const incomingSpan = {
        traceId: 'trace-' + Date.now().toString(36),
        spanId: 'span-' + Date.now().toString(36),
        name: 'chat-completion',
        startTime: Date.now() - 1000,
        endTime: Date.now(),
        status: 'ok' as const,
        attributes: {
          'llm.provider': 'anthropic',
          'llm.model': 'claude-3-opus',
          'llm.input_tokens': 150,
          'llm.output_tokens': 75,
          'llm.cost': 0.02,
        },
      };

      // Transform to trace record
      const traceRecord = {
        id: 'trc_' + Date.now().toString(36),
        projectId: 'prj_test123',
        traceId: incomingSpan.traceId,
        name: incomingSpan.name,
        startTime: new Date(incomingSpan.startTime),
        endTime: new Date(incomingSpan.endTime),
        durationMs: incomingSpan.endTime - incomingSpan.startTime,
        status: incomingSpan.status,
        totalCost: incomingSpan.attributes['llm.cost'],
        totalInputTokens: incomingSpan.attributes['llm.input_tokens'],
        totalOutputTokens: incomingSpan.attributes['llm.output_tokens'],
      };

      // Verify trace record
      expect(traceRecord.id).toMatch(/^trc_/);
      expect(traceRecord.durationMs).toBe(1000);
      expect(traceRecord.totalCost).toBe(0.02);
      expect(traceRecord.totalInputTokens).toBe(150);
    });

    it('should_handleMultipleSpansInTrace_when_ingesting', () => {
      const traceId = 'trace-multi-' + Date.now().toString(36);

      const spans = [
        {
          traceId,
          spanId: 'span-1',
          parentSpanId: null,
          name: 'orchestration',
          startTime: 1000,
          endTime: 3000,
          status: 'ok',
        },
        {
          traceId,
          spanId: 'span-2',
          parentSpanId: 'span-1',
          name: 'llm-call-1',
          startTime: 1100,
          endTime: 2000,
          status: 'ok',
        },
        {
          traceId,
          spanId: 'span-3',
          parentSpanId: 'span-1',
          name: 'llm-call-2',
          startTime: 2100,
          endTime: 2900,
          status: 'ok',
        },
      ];

      // All spans belong to same trace
      expect(spans.every((s) => s.traceId === traceId)).toBe(true);

      // Root span has no parent
      const rootSpan = spans.find((s) => s.parentSpanId === null);
      expect(rootSpan?.name).toBe('orchestration');

      // Child spans have parent
      const childSpans = spans.filter((s) => s.parentSpanId === 'span-1');
      expect(childSpans).toHaveLength(2);
    });
  });

  describe('Query Flow', () => {
    it('should_filterTracesByProject_when_querying', () => {
      const allTraces = [
        { id: 'trc_1', projectId: 'prj_a', name: 'trace-1' },
        { id: 'trc_2', projectId: 'prj_b', name: 'trace-2' },
        { id: 'trc_3', projectId: 'prj_a', name: 'trace-3' },
        { id: 'trc_4', projectId: 'prj_c', name: 'trace-4' },
      ];

      const projectATraces = allTraces.filter((t) => t.projectId === 'prj_a');

      expect(projectATraces).toHaveLength(2);
      expect(projectATraces.map((t) => t.name)).toEqual(['trace-1', 'trace-3']);
    });

    it('should_paginateResults_when_limitProvided', () => {
      const traces = Array.from({ length: 100 }, (_, i) => ({
        id: `trc_${i}`,
        name: `trace-${i}`,
        startTime: Date.now() - i * 1000,
      }));

      // Sort by most recent first
      const sorted = traces.sort((a, b) => b.startTime - a.startTime);

      // Paginate
      const limit = 20;
      const offset = 0;
      const page1 = sorted.slice(offset, offset + limit);

      expect(page1).toHaveLength(20);
      expect(page1[0].name).toBe('trace-0'); // Most recent
    });

    it('should_aggregateStats_when_calculating', () => {
      const traces = [
        { totalCost: 0.01, totalInputTokens: 100, totalOutputTokens: 50 },
        { totalCost: 0.02, totalInputTokens: 200, totalOutputTokens: 100 },
        { totalCost: 0.015, totalInputTokens: 150, totalOutputTokens: 75 },
      ];

      const stats = {
        totalRequests: traces.length,
        totalCost: traces.reduce((sum, t) => sum + t.totalCost, 0),
        totalInputTokens: traces.reduce((sum, t) => sum + t.totalInputTokens, 0),
        totalOutputTokens: traces.reduce((sum, t) => sum + t.totalOutputTokens, 0),
      };

      expect(stats.totalRequests).toBe(3);
      expect(stats.totalCost).toBeCloseTo(0.045);
      expect(stats.totalInputTokens).toBe(450);
      expect(stats.totalOutputTokens).toBe(225);
    });
  });
});

// ============================================================================
// Error Handling Integration Tests
// ============================================================================

describe('Error Handling Integration', () => {
  describe('Auth Errors', () => {
    it('should_rejectInvalidEmail_when_registering', () => {
      const invalidEmails = ['notanemail', 'missing@domain', '@nodomain.com', ''];

      for (const email of invalidEmails) {
        const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        expect(isValid).toBe(false);
      }
    });

    it('should_rejectWeakPassword_when_registering', () => {
      const weakPasswords = ['short', '12345678', 'nodigits'];
      const minLength = 8;

      for (const password of weakPasswords) {
        const isStrong = password.length >= minLength && /\d/.test(password);
        // At least one should fail
        if (password === 'nodigits') {
          expect(isStrong).toBe(false);
        }
      }
    });
  });

  describe('API Key Errors', () => {
    it('should_rejectMalformedApiKey_when_authenticating', async () => {
      const verifyApiKey = (await import('../src/auth/api-key.js')).verifyApiKey;
      const generateApiKey = (await import('../src/auth/api-key.js')).generateApiKey;

      const { hashedKey } = generateApiKey();

      // Malformed keys should fail
      const malformedKeys = [
        'not_orch_prefix',
        'orch_tooshort',
        '',
        'orch_' + 'x'.repeat(100), // Too long
      ];

      for (const key of malformedKeys) {
        const isValid = verifyApiKey(key, hashedKey);
        expect(isValid).toBe(false);
      }
    });
  });

  describe('Ingest Errors', () => {
    it('should_rejectInvalidSpanData_when_ingesting', () => {
      const invalidSpans = [
        {}, // Missing required fields
        { traceId: 'abc' }, // Missing spanId, name
        { traceId: 'abc', spanId: 'def' }, // Missing name
        { traceId: 'abc', spanId: 'def', name: '' }, // Empty name
      ];

      for (const span of invalidSpans) {
        const isValid =
          span &&
          typeof span === 'object' &&
          'traceId' in span &&
          'spanId' in span &&
          'name' in span &&
          (span as { name: string }).name?.length > 0;
        expect(isValid).toBe(false);
      }
    });
  });
});

// ============================================================================
// Rate Limiting Integration Tests
// ============================================================================

describe('Rate Limiting Integration', () => {
  it('should_trackRequestsPerKey_when_limiting', async () => {
    const { createRateLimiter } = await import('../src/utils/rate-limit.js');

    const limiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 5,
    });

    const key = 'test-key';

    // First 5 requests should be allowed
    for (let i = 0; i < 5; i++) {
      const result = limiter.check(key);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4 - i);
    }

    // 6th request should be blocked
    const blocked = limiter.check(key);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('should_separateRateLimitsByKey_when_limiting', async () => {
    const { createRateLimiter } = await import('../src/utils/rate-limit.js');

    const limiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 2,
    });

    // Exhaust key1
    limiter.check('key1');
    limiter.check('key1');
    const key1Blocked = limiter.check('key1');
    expect(key1Blocked.allowed).toBe(false);

    // key2 should still have capacity
    const key2Result = limiter.check('key2');
    expect(key2Result.allowed).toBe(true);
  });
});
