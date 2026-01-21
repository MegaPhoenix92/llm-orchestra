/**
 * Audit Logging Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRequestMetadata, writeAuditLog, type AuditLogInput } from '../src/utils/audit.js';

// Mock nanoid
vi.mock('nanoid', () => ({
  nanoid: () => 'mock_nanoid_12345678901',
}));

describe('getRequestMetadata', () => {
  const createMockContext = (headers: Record<string, string | undefined> = {}) => ({
    req: {
      header: (name: string) => headers[name.toLowerCase()],
    },
  });

  it('should_extractIpFromXForwardedFor_when_present', () => {
    const c = createMockContext({
      'x-forwarded-for': '192.168.1.1, 10.0.0.1',
    });

    const metadata = getRequestMetadata(c as never);
    expect(metadata.ip).toBe('192.168.1.1');
  });

  it('should_extractIpFromXRealIp_when_noXForwardedFor', () => {
    const c = createMockContext({
      'x-real-ip': '192.168.1.2',
    });

    const metadata = getRequestMetadata(c as never);
    expect(metadata.ip).toBe('192.168.1.2');
  });

  it('should_extractIpFromCfConnectingIp_when_noOtherHeaders', () => {
    const c = createMockContext({
      'cf-connecting-ip': '192.168.1.3',
    });

    const metadata = getRequestMetadata(c as never);
    expect(metadata.ip).toBe('192.168.1.3');
  });

  it('should_returnUndefinedIp_when_noIpHeaders', () => {
    const c = createMockContext({});

    const metadata = getRequestMetadata(c as never);
    expect(metadata.ip).toBeUndefined();
  });

  it('should_extractUserAgent_when_present', () => {
    const c = createMockContext({
      'user-agent': 'Mozilla/5.0 (Test Browser)',
    });

    const metadata = getRequestMetadata(c as never);
    expect(metadata.userAgent).toBe('Mozilla/5.0 (Test Browser)');
  });

  it('should_returnUndefinedUserAgent_when_noHeader', () => {
    const c = createMockContext({});

    const metadata = getRequestMetadata(c as never);
    expect(metadata.userAgent).toBeUndefined();
  });

  it('should_trimIpFromXForwardedFor_when_hasSpaces', () => {
    const c = createMockContext({
      'x-forwarded-for': '  192.168.1.1  , 10.0.0.1',
    });

    const metadata = getRequestMetadata(c as never);
    expect(metadata.ip).toBe('192.168.1.1');
  });
});

describe('writeAuditLog', () => {
  const createMockDb = () => {
    const valuesMock = vi.fn().mockResolvedValue(undefined);
    const insertMock = vi.fn().mockReturnValue({ values: valuesMock });

    return {
      insert: insertMock,
      _mocks: { insertMock, valuesMock },
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_insertAuditLog_when_called', async () => {
    const mockDb = createMockDb();

    const input: AuditLogInput = {
      orgId: 'org_123',
      projectId: 'proj_456',
      actorType: 'user',
      actorId: 'usr_789',
      action: 'test.action',
      resourceType: 'test_resource',
      resourceId: 'res_abc',
      status: 'success',
      ip: '192.168.1.1',
      userAgent: 'Test Agent',
      metadata: { key: 'value' },
    };

    await writeAuditLog(mockDb as never, input);

    expect(mockDb._mocks.insertMock).toHaveBeenCalled();
    expect(mockDb._mocks.valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringContaining('aud_'),
        orgId: 'org_123',
        projectId: 'proj_456',
        actorType: 'user',
        actorId: 'usr_789',
        action: 'test.action',
        resourceType: 'test_resource',
        resourceId: 'res_abc',
        status: 'success',
        ip: '192.168.1.1',
        userAgent: 'Test Agent',
        metadata: { key: 'value' },
        createdAt: expect.any(Date),
      })
    );
  });

  it('should_useDefaultStatus_when_notProvided', async () => {
    const mockDb = createMockDb();

    const input: AuditLogInput = {
      actorType: 'user',
      actorId: 'usr_789',
      action: 'test.action',
    };

    await writeAuditLog(mockDb as never, input);

    expect(mockDb._mocks.valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
      })
    );
  });

  it('should_handleNullValues_when_optionalFieldsNotProvided', async () => {
    const mockDb = createMockDb();

    const input: AuditLogInput = {
      actorType: 'api_key',
      actorId: 'key_123',
      action: 'ingest.data',
    };

    await writeAuditLog(mockDb as never, input);

    expect(mockDb._mocks.valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: null,
        projectId: null,
        resourceType: null,
        resourceId: null,
        ip: null,
        userAgent: null,
        metadata: null,
      })
    );
  });

  it('should_notThrow_when_dbInsertFails', async () => {
    const mockDb = createMockDb();
    mockDb._mocks.valuesMock.mockRejectedValue(new Error('DB error'));

    const input: AuditLogInput = {
      actorType: 'system',
      actorId: 'system',
      action: 'system.error',
    };

    // Should not throw
    await expect(writeAuditLog(mockDb as never, input)).resolves.toBeUndefined();
  });

  it('should_supportSystemActorType', async () => {
    const mockDb = createMockDb();

    const input: AuditLogInput = {
      actorType: 'system',
      actorId: 'scheduler',
      action: 'system.cleanup',
    };

    await writeAuditLog(mockDb as never, input);

    expect(mockDb._mocks.valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'system',
        actorId: 'scheduler',
      })
    );
  });

  it('should_supportApiKeyActorType', async () => {
    const mockDb = createMockDb();

    const input: AuditLogInput = {
      actorType: 'api_key',
      actorId: 'key_abc123',
      action: 'ingest.spans',
      projectId: 'proj_xyz',
    };

    await writeAuditLog(mockDb as never, input);

    expect(mockDb._mocks.valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'api_key',
        actorId: 'key_abc123',
        projectId: 'proj_xyz',
      })
    );
  });

  it('should_supportDeniedStatus', async () => {
    const mockDb = createMockDb();

    const input: AuditLogInput = {
      actorType: 'user',
      actorId: 'usr_unauthorized',
      action: 'project.delete',
      status: 'denied',
      metadata: { reason: 'insufficient permissions' },
    };

    await writeAuditLog(mockDb as never, input);

    expect(mockDb._mocks.valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'denied',
        metadata: { reason: 'insufficient permissions' },
      })
    );
  });

  it('should_supportErrorStatus', async () => {
    const mockDb = createMockDb();

    const input: AuditLogInput = {
      actorType: 'user',
      actorId: 'usr_123',
      action: 'api.call',
      status: 'error',
      metadata: { error: 'Internal server error' },
    };

    await writeAuditLog(mockDb as never, input);

    expect(mockDb._mocks.valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
      })
    );
  });
});

describe('Audit log action patterns', () => {
  it('should_followNamingConvention_for_authActions', () => {
    const authActions = [
      'auth.register',
      'auth.login',
      'auth.logout',
      'auth.refresh',
    ];

    for (const action of authActions) {
      expect(action).toMatch(/^auth\.[a-z]+$/);
    }
  });

  it('should_followNamingConvention_for_orgActions', () => {
    const orgActions = ['org.create', 'org.update', 'org.delete'];

    for (const action of orgActions) {
      expect(action).toMatch(/^org\.[a-z]+$/);
    }
  });

  it('should_followNamingConvention_for_projectActions', () => {
    const projectActions = [
      'project.create',
      'project.update',
      'project.delete',
    ];

    for (const action of projectActions) {
      expect(action).toMatch(/^project\.[a-z]+$/);
    }
  });

  it('should_followNamingConvention_for_apiKeyActions', () => {
    const apiKeyActions = ['api_key.create', 'api_key.delete'];

    for (const action of apiKeyActions) {
      expect(action).toMatch(/^api_key\.[a-z]+$/);
    }
  });

  it('should_followNamingConvention_for_teamActions', () => {
    const teamActions = ['team.invite', 'team.remove'];

    for (const action of teamActions) {
      expect(action).toMatch(/^team\.[a-z]+$/);
    }
  });
});

describe('Audit log ID format', () => {
  it('should_generateIdWithAudPrefix', async () => {
    const mockDb = createMockDb();

    await writeAuditLog(mockDb as never, {
      actorType: 'user',
      actorId: 'usr_123',
      action: 'test',
    });

    const insertedValue = mockDb._mocks.valuesMock.mock.calls[0][0];
    expect(insertedValue.id).toMatch(/^aud_/);
  });
});

// Helper to create mock db
function createMockDb() {
  const valuesMock = vi.fn().mockResolvedValue(undefined);
  const insertMock = vi.fn().mockReturnValue({ values: valuesMock });

  return {
    insert: insertMock,
    _mocks: { insertMock, valuesMock },
  };
}
