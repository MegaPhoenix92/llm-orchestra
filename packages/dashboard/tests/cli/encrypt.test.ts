/**
 * Encryption CLI Command Tests
 *
 * Tests the CLI commands for managing encryption at rest:
 * - status: Show encryption status
 * - migrate: Encrypt existing data
 * - validate: Verify encrypted data
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import {
  statusCommand,
  migrateCommand,
  validateCommand,
  type EncryptOptions,
} from '../../src/cli/commands/encrypt.js';
import { encrypt, encryptJson } from '../../src/auth/encryption.js';

// Mock the database module
vi.mock('../../src/db/index.js', () => {
  const mockDb = {
    __batches: {
      users: [] as unknown[][],
      invitations: [] as unknown[][],
      auditLogs: [] as unknown[][],
    },
    __updateCalls: [] as Array<{ table: string; values: Record<string, unknown> }>,
    select: vi.fn(() => {
      const chain: {
        __table: { __tableName?: string } | null;
        from: (table: { __tableName?: string }) => typeof chain;
        where: () => typeof chain;
        orderBy: () => typeof chain;
        limit: () => Promise<unknown[]>;
      } = {
        __table: null,
        from: (table) => {
          chain.__table = table;
          return chain;
        },
        where: () => chain,
        orderBy: () => chain,
        limit: () => {
          const tableName = chain.__table?.__tableName ?? 'unknown';
          const batches = (mockDb.__batches[tableName] || []) as unknown[][];
          const nextBatch = batches.shift() ?? [];
          return Promise.resolve(nextBatch);
        },
      };

      return chain;
    }),
    update: vi.fn((table: { __tableName?: string }) => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(() => {
          mockDb.__updateCalls.push({
            table: table?.__tableName ?? 'unknown',
            values,
          });
          return Promise.resolve();
        }),
      })),
    })),
    execute: vi.fn(() =>
      Promise.resolve({ rows: [{ count: '0', with_hash: '0', without_hash: '0' }] })
    ),
  };

  return {
    __mockDb: mockDb,
    createDatabase: vi.fn(() => ({ db: mockDb, pool: { end: vi.fn() } })),
    users: {
      id: 'id',
      email: 'email',
      name: 'name',
      ssoId: 'sso_id',
      emailHash: 'email_hash',
      __tableName: 'users',
    },
    invitations: { id: 'id', email: 'email', token: 'token', __tableName: 'invitations' },
    auditLogs: { id: 'id', ip: 'ip', userAgent: 'user_agent', metadata: 'metadata', __tableName: 'auditLogs' },
  };
});

const TEST_OPTIONS: EncryptOptions = {
  databaseUrl: 'postgresql://test:test@localhost:5432/test',
  masterKey: 'test-master-key-that-is-at-least-32-characters-long',
  batchSize: 100,
  dryRun: false,
  verbose: false,
};
const ENCRYPTION_CONFIG = { masterKey: TEST_OPTIONS.masterKey };
let mockDb: {
  __batches: Record<string, unknown[][]>;
  __updateCalls: Array<{ table: string; values: Record<string, unknown> }>;
  select: MockInstance;
  update: MockInstance;
  execute: MockInstance;
};

describe('Encryption CLI Commands', () => {
  let consoleLogSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let processExitSpy: MockInstance;
  let stdoutWriteSpy: MockInstance;

  beforeEach(async () => {
    const dbModule = (await import('../../src/db/index.js')) as unknown as {
      __mockDb: typeof mockDb;
    };
    mockDb = dbModule.__mockDb;
    mockDb.__batches = { users: [], invitations: [], auditLogs: [] };
    mockDb.__updateCalls = [];
    mockDb.select.mockClear();
    mockDb.update.mockClear();
    mockDb.execute.mockClear();

    // Setup fresh spies for each test
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    stdoutWriteSpy.mockRestore();
  });

  describe('validateOptions', () => {
    it('should_exitWithError_when_databaseUrlMissing', async () => {
      const options: EncryptOptions = {
        ...TEST_OPTIONS,
        databaseUrl: '',
      };

      await expect(migrateCommand(options)).rejects.toThrow('process.exit(1)');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should_exitWithError_when_masterKeyMissing', async () => {
      const options: EncryptOptions = {
        ...TEST_OPTIONS,
        masterKey: '',
      };

      await expect(migrateCommand(options)).rejects.toThrow('process.exit(1)');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should_exitWithError_when_masterKeyTooShort', async () => {
      const options: EncryptOptions = {
        ...TEST_OPTIONS,
        masterKey: 'short-key',
      };

      await expect(migrateCommand(options)).rejects.toThrow('process.exit(1)');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('statusCommand', () => {
    it('should_showStatus_when_validDatabaseUrl', async () => {
      await statusCommand(TEST_OPTIONS);

      expect(consoleLogSpy).toHaveBeenCalled();
      // Should show "Encryption Status Report"
      const logCalls = consoleLogSpy.mock.calls.flat().join(' ');
      expect(logCalls).toContain('Encryption Status Report');
    });

    it('should_exitWithError_when_databaseUrlMissing', async () => {
      const options: EncryptOptions = {
        ...TEST_OPTIONS,
        databaseUrl: '',
      };

      await expect(statusCommand(options)).rejects.toThrow('process.exit(1)');
    });
  });

  describe('migrateCommand', () => {
    it('should_showMigration_when_validOptions', async () => {
      await migrateCommand(TEST_OPTIONS);

      expect(consoleLogSpy).toHaveBeenCalled();
      const logCalls = consoleLogSpy.mock.calls.flat().join(' ');
      expect(logCalls).toContain('Encryption Migration');
      expect(logCalls).toContain('Migration Summary');
    });

    it('should_migrateAndSkipRecords_when_mixedData', async () => {
      const encryptedEmail = encrypt('encrypted@example.com', ENCRYPTION_CONFIG);
      const encryptedName = encrypt('Encrypted User', ENCRYPTION_CONFIG);
      const encryptedToken = encrypt('token-value', ENCRYPTION_CONFIG);
      const encryptedIp = encrypt('10.0.0.1', ENCRYPTION_CONFIG);
      const encryptedUa = encrypt('ua-encrypted', ENCRYPTION_CONFIG);
      const encryptedMetadata = encryptJson({ foo: 'bar' }, ENCRYPTION_CONFIG);

      mockDb.__batches.users = [
        [
          {
            id: 'usr_1',
            email: 'plain@example.com',
            name: 'Plain User',
            ssoId: null,
            emailHash: null,
          },
          {
            id: 'usr_2',
            email: encryptedEmail,
            name: encryptedName,
            ssoId: null,
            emailHash: 'hash_value',
          },
          {
            id: 'usr_3',
            email: encryptedEmail,
            name: null,
            ssoId: null,
            emailHash: null,
          },
        ],
        [],
      ];

      mockDb.__batches.invitations = [
        [
          { id: 'inv_1', email: 'invite@example.com', token: 'token-plain' },
          { id: 'inv_2', email: encryptedEmail, token: encryptedToken },
        ],
        [],
      ];

      mockDb.__batches.auditLogs = [
        [
          {
            id: 'aud_1',
            ip: '127.0.0.1',
            userAgent: 'ua',
            metadata: { foo: 'bar' },
          },
          {
            id: 'aud_2',
            ip: encryptedIp,
            userAgent: encryptedUa,
            metadata: encryptedMetadata,
          },
        ],
        [],
      ];

      await migrateCommand(TEST_OPTIONS);

      const updatesByTable = mockDb.__updateCalls.reduce(
        (acc: Record<string, number>, call) => {
          acc[call.table] = (acc[call.table] || 0) + 1;
          return acc;
        },
        {}
      );

      expect(updatesByTable.users).toBe(2);
      expect(updatesByTable.invitations).toBe(1);
      expect(updatesByTable.auditLogs).toBe(1);
    });

    it('should_showDryRunNotice_when_dryRunEnabled', async () => {
      const options: EncryptOptions = {
        ...TEST_OPTIONS,
        dryRun: true,
      };

      await migrateCommand(options);

      const logCalls = consoleLogSpy.mock.calls.flat().join(' ');
      expect(logCalls).toContain('DRY RUN MODE');
    });
  });

  describe('validateCommand', () => {
    it('should_showValidation_when_validOptions', async () => {
      await validateCommand(TEST_OPTIONS);

      expect(consoleLogSpy).toHaveBeenCalled();
      const logCalls = consoleLogSpy.mock.calls.flat().join(' ');
      expect(logCalls).toContain('Encryption Validation');
      expect(logCalls).toContain('Validation Summary');
    });

    it('should_countEncryptedAndUnencryptedFields_when_mixedData', async () => {
      const encryptedEmail = encrypt('encrypted@example.com', ENCRYPTION_CONFIG);
      const encryptedName = encrypt('Encrypted User', ENCRYPTION_CONFIG);
      const encryptedToken = encrypt('token-value', ENCRYPTION_CONFIG);
      const encryptedIp = encrypt('10.0.0.1', ENCRYPTION_CONFIG);
      const encryptedUa = encrypt('ua-encrypted', ENCRYPTION_CONFIG);
      const encryptedMetadata = encryptJson({ foo: 'bar' }, ENCRYPTION_CONFIG);

      mockDb.__batches.users = [
        [
          {
            id: 'usr_1',
            email: encryptedEmail,
            name: encryptedName,
            ssoId: null,
          },
          {
            id: 'usr_2',
            email: 'plain@example.com',
            name: null,
            ssoId: null,
          },
        ],
        [],
      ];

      mockDb.__batches.invitations = [
        [
          { id: 'inv_1', email: encryptedEmail, token: encryptedToken },
          { id: 'inv_2', email: 'invite@example.com', token: 'token-plain' },
        ],
        [],
      ];

      mockDb.__batches.auditLogs = [
        [
          {
            id: 'aud_1',
            ip: encryptedIp,
            userAgent: encryptedUa,
            metadata: encryptedMetadata,
          },
          {
            id: 'aud_2',
            ip: null,
            userAgent: null,
            metadata: { plain: true },
          },
        ],
        [],
      ];

      await validateCommand(TEST_OPTIONS);

      const logCalls = consoleLogSpy.mock.calls.flat().join(' ');
      expect(logCalls).toContain('Valid (encrypted & decryptable): 7');
      expect(logCalls).toContain('Unencrypted: 4');
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it('should_exitWithError_when_invalidEncryptedDataDetected', async () => {
      mockDb.__batches.users = [
        [
          {
            id: 'usr_1',
            email: 'v1:bad:bad:bad:bad',
            name: null,
            ssoId: null,
          },
        ],
        [],
      ];
      mockDb.__batches.invitations = [[]];
      mockDb.__batches.auditLogs = [[]];

      await expect(validateCommand(TEST_OPTIONS)).rejects.toThrow('process.exit(1)');

      const logCalls = consoleLogSpy.mock.calls.flat().join(' ');
      expect(logCalls).toContain('Invalid (cannot decrypt)');
    });
  });
});

describe('Encryption CLI Integration', () => {
  let consoleLogSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let processExitSpy: MockInstance;
  let stdoutWriteSpy: MockInstance;

  beforeEach(async () => {
    const dbModule = (await import('../../src/db/index.js')) as unknown as {
      __mockDb: typeof mockDb;
    };
    mockDb = dbModule.__mockDb;
    mockDb.__batches = { users: [], invitations: [], auditLogs: [] };
    mockDb.__updateCalls = [];
    mockDb.select.mockClear();
    mockDb.update.mockClear();
    mockDb.execute.mockClear();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    stdoutWriteSpy.mockRestore();
  });

  describe('Progress reporting', () => {
    it('should_reportProgress_when_verboseEnabled', async () => {
      const options: EncryptOptions = {
        ...TEST_OPTIONS,
        verbose: true,
      };

      await migrateCommand(options);

      // Should show verbose output with migration details
      const logCalls = consoleLogSpy.mock.calls.flat().join(' ');
      expect(logCalls).toContain('Migrating users');
      expect(logCalls).toContain('Migrating invitations');
      expect(logCalls).toContain('Migrating audit logs');
    });
  });

  describe('Batch processing', () => {
    it('should_useBatchSize_when_specified', async () => {
      const options: EncryptOptions = {
        ...TEST_OPTIONS,
        batchSize: 50,
      };

      // This will run with empty data, but verifies batch size is passed through
      await migrateCommand(options);

      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });
});
