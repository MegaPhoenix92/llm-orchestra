/**
 * Encrypted Fields Configuration and Utilities
 *
 * Defines which database fields contain sensitive data that should be encrypted at rest.
 * Provides helper functions to encrypt/decrypt records before storage/after retrieval.
 */

import crypto from 'crypto';
import {
  encrypt,
  decrypt,
  isEncrypted,
  encryptJson,
  decryptJson,
  type EncryptionConfig,
} from '../auth/encryption.js';
import type { User, NewUser, Invitation, NewInvitation, AuditLog, NewAuditLog } from './schema.js';

/**
 * Sensitive fields by table that require encryption
 */
export const SENSITIVE_FIELDS = {
  users: ['email', 'name', 'ssoId'] as const,
  invitations: ['email', 'token'] as const,
  auditLogs: ['ip', 'userAgent'] as const,
} as const;

/**
 * JSON fields that may contain sensitive data
 */
export const SENSITIVE_JSON_FIELDS = {
  auditLogs: ['metadata'] as const,
  traces: ['attributes'] as const,
  spans: ['attributes'] as const,
} as const;

// ============================================================================
// User Encryption/Decryption
// ============================================================================

/**
 * Encrypt sensitive user fields before storage
 */
export function encryptUser<T extends Partial<NewUser>>(user: T, config: EncryptionConfig): T {
  const result = { ...user };

  if (result.email) {
    result.email = encrypt(result.email, config);
  }
  if (result.name) {
    result.name = encrypt(result.name, config);
  }
  if (result.ssoId) {
    result.ssoId = encrypt(result.ssoId, config);
  }

  return result;
}

/**
 * Decrypt sensitive user fields after retrieval
 */
export function decryptUser<T extends Partial<User>>(user: T, config: EncryptionConfig): T {
  const result = { ...user };

  if (result.email && isEncrypted(result.email)) {
    result.email = decrypt(result.email, config);
  }
  if (result.name && isEncrypted(result.name)) {
    result.name = decrypt(result.name, config);
  }
  if (result.ssoId && isEncrypted(result.ssoId)) {
    result.ssoId = decrypt(result.ssoId, config);
  }

  return result;
}

/**
 * Decrypt an array of users
 */
export function decryptUsers<T extends Partial<User>>(users: T[], config: EncryptionConfig): T[] {
  return users.map((user) => decryptUser(user, config));
}

// ============================================================================
// Invitation Encryption/Decryption
// ============================================================================

/**
 * Encrypt sensitive invitation fields before storage
 */
export function encryptInvitation<T extends Partial<NewInvitation>>(
  invitation: T,
  config: EncryptionConfig
): T {
  const result = { ...invitation };

  if (result.email) {
    result.email = encrypt(result.email, config);
  }
  if (result.token) {
    result.token = encrypt(result.token, config);
  }

  return result;
}

/**
 * Decrypt sensitive invitation fields after retrieval
 */
export function decryptInvitation<T extends Partial<Invitation>>(
  invitation: T,
  config: EncryptionConfig
): T {
  const result = { ...invitation };

  if (result.email && isEncrypted(result.email)) {
    result.email = decrypt(result.email, config);
  }
  if (result.token && isEncrypted(result.token)) {
    result.token = decrypt(result.token, config);
  }

  return result;
}

/**
 * Decrypt an array of invitations
 */
export function decryptInvitations<T extends Partial<Invitation>>(
  invitations: T[],
  config: EncryptionConfig
): T[] {
  return invitations.map((inv) => decryptInvitation(inv, config));
}

// ============================================================================
// Audit Log Encryption/Decryption
// ============================================================================

/**
 * Encrypt sensitive audit log fields before storage
 */
export function encryptAuditLog<T extends Partial<NewAuditLog>>(
  log: T,
  config: EncryptionConfig
): T {
  const result = { ...log };

  if (result.ip) {
    result.ip = encrypt(result.ip, config);
  }
  if (result.userAgent) {
    result.userAgent = encrypt(result.userAgent, config);
  }
  if (result.metadata) {
    const encrypted = encryptJson(result.metadata as Record<string, unknown>, config);
    result.metadata = encrypted as T['metadata'];
  }

  return result;
}

/**
 * Decrypt sensitive audit log fields after retrieval
 */
export function decryptAuditLog<T extends Partial<AuditLog>>(log: T, config: EncryptionConfig): T {
  const result = { ...log };

  if (result.ip && isEncrypted(result.ip)) {
    result.ip = decrypt(result.ip, config);
  }
  if (result.userAgent && isEncrypted(result.userAgent)) {
    result.userAgent = decrypt(result.userAgent, config);
  }
  if (result.metadata && typeof result.metadata === 'string' && isEncrypted(result.metadata)) {
    result.metadata = decryptJson(result.metadata, config) as T['metadata'];
  }

  return result;
}

/**
 * Decrypt an array of audit logs
 */
export function decryptAuditLogs<T extends Partial<AuditLog>>(
  logs: T[],
  config: EncryptionConfig
): T[] {
  return logs.map((log) => decryptAuditLog(log, config));
}

// ============================================================================
// Generic Helpers
// ============================================================================

/**
 * Check if encryption is enabled in configuration
 */
export function isEncryptionEnabled(config?: Partial<EncryptionConfig>): boolean {
  return !!(config?.masterKey && config.masterKey.length >= 32);
}

/**
 * Create an encryption-aware wrapper for database operations
 */
export function createEncryptionContext(config?: EncryptionConfig) {
  const enabled = isEncryptionEnabled(config);

  return {
    enabled,

    // User operations
    encryptUser: <T extends Partial<NewUser>>(user: T): T =>
      enabled && config ? encryptUser(user, config) : user,
    decryptUser: <T extends Partial<User>>(user: T): T =>
      enabled && config ? decryptUser(user, config) : user,
    decryptUsers: <T extends Partial<User>>(users: T[]): T[] =>
      enabled && config ? decryptUsers(users, config) : users,

    // Invitation operations
    encryptInvitation: <T extends Partial<NewInvitation>>(invitation: T): T =>
      enabled && config ? encryptInvitation(invitation, config) : invitation,
    decryptInvitation: <T extends Partial<Invitation>>(invitation: T): T =>
      enabled && config ? decryptInvitation(invitation, config) : invitation,
    decryptInvitations: <T extends Partial<Invitation>>(invitations: T[]): T[] =>
      enabled && config ? decryptInvitations(invitations, config) : invitations,

    // Audit log operations
    encryptAuditLog: <T extends Partial<NewAuditLog>>(log: T): T =>
      enabled && config ? encryptAuditLog(log, config) : log,
    decryptAuditLog: <T extends Partial<AuditLog>>(log: T): T =>
      enabled && config ? decryptAuditLog(log, config) : log,
    decryptAuditLogs: <T extends Partial<AuditLog>>(logs: T[]): T[] =>
      enabled && config ? decryptAuditLogs(logs, config) : logs,
  };
}

/**
 * Email hash for lookups (deterministic, not for security)
 * Uses SHA-256 to create a searchable hash of the email
 */
export function hashEmailForLookup(email: string): string {
  return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex');
}
