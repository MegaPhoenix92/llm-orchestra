/**
 * Encryption at Rest Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  encrypt,
  decrypt,
  isEncrypted,
  encryptIfNeeded,
  decryptIfNeeded,
  encryptJson,
  decryptJson,
  encryptFields,
  decryptFields,
  validateEncryptionConfig,
  generateEncryptionKey,
  clearKeyCache,
  type EncryptionConfig,
} from '../src/auth/encryption.js';
import {
  encryptUser,
  decryptUser,
  decryptUsers,
  encryptInvitation,
  decryptInvitation,
  encryptAuditLog,
  decryptAuditLog,
  createEncryptionContext,
  isEncryptionEnabled,
  hashEmailForLookup,
} from '../src/db/encrypted-fields.js';

const TEST_CONFIG: EncryptionConfig = {
  masterKey: 'test-master-key-that-is-at-least-32-characters-long',
};

describe('Encryption Core', () => {
  beforeEach(() => {
    clearKeyCache();
  });

  describe('encrypt and decrypt', () => {
    it('should_encryptAndDecrypt_when_validPlaintext', () => {
      const plaintext = 'Hello, World!';
      const encrypted = encrypt(plaintext, TEST_CONFIG);
      const decrypted = decrypt(encrypted, TEST_CONFIG);

      expect(decrypted).toBe(plaintext);
      expect(encrypted).not.toBe(plaintext);
    });

    it('should_produceUniqueOutput_when_encryptingSamePlaintextTwice', () => {
      const plaintext = 'Same message';
      const encrypted1 = encrypt(plaintext, TEST_CONFIG);
      const encrypted2 = encrypt(plaintext, TEST_CONFIG);

      // Each encryption should have different salt/IV
      expect(encrypted1).not.toBe(encrypted2);

      // Both should decrypt to the same value
      expect(decrypt(encrypted1, TEST_CONFIG)).toBe(plaintext);
      expect(decrypt(encrypted2, TEST_CONFIG)).toBe(plaintext);
    });

    it('should_returnEmpty_when_plaintextIsEmpty', () => {
      expect(encrypt('', TEST_CONFIG)).toBe('');
      expect(decrypt('', TEST_CONFIG)).toBe('');
    });

    it('should_handleUnicode_when_encryptingInternationalCharacters', () => {
      const plaintext = '你好世界 🌍 مرحبا';
      const encrypted = encrypt(plaintext, TEST_CONFIG);
      const decrypted = decrypt(encrypted, TEST_CONFIG);

      expect(decrypted).toBe(plaintext);
    });

    it('should_handleLongText_when_encryptingLargePayload', () => {
      const plaintext = 'x'.repeat(10000);
      const encrypted = encrypt(plaintext, TEST_CONFIG);
      const decrypted = decrypt(encrypted, TEST_CONFIG);

      expect(decrypted).toBe(plaintext);
    });

    it('should_returnUnencrypted_when_decryptingNonV1Format', () => {
      const plaintext = 'not encrypted';
      const result = decrypt(plaintext, TEST_CONFIG);

      expect(result).toBe(plaintext);
    });

    it('should_throw_when_invalidEncryptedFormat', () => {
      expect(() => decrypt('v1:invalid', TEST_CONFIG)).toThrow('Invalid encrypted data format');
    });

    it('should_throw_when_unsupportedVersion', () => {
      const parts = encrypt('test', TEST_CONFIG).split(':');
      parts[0] = 'v2';
      expect(() => decrypt(parts.join(':'), TEST_CONFIG)).toThrow('Unsupported encryption version');
    });

    it('should_throw_when_wrongMasterKey', () => {
      const encrypted = encrypt('secret', TEST_CONFIG);
      const wrongConfig: EncryptionConfig = {
        masterKey: 'different-master-key-that-is-at-least-32-characters-long',
      };

      expect(() => decrypt(encrypted, wrongConfig)).toThrow();
    });
  });

  describe('isEncrypted', () => {
    it('should_returnTrue_when_validEncryptedFormat', () => {
      const encrypted = encrypt('test', TEST_CONFIG);
      expect(isEncrypted(encrypted)).toBe(true);
    });

    it('should_returnFalse_when_plaintext', () => {
      expect(isEncrypted('plain text')).toBe(false);
      expect(isEncrypted('v1:not:enough:parts')).toBe(false);
      expect(isEncrypted('')).toBe(false);
    });
  });

  describe('encryptIfNeeded and decryptIfNeeded', () => {
    it('should_encrypt_when_notAlreadyEncrypted', () => {
      const plaintext = 'test';
      const encrypted = encryptIfNeeded(plaintext, TEST_CONFIG);

      expect(isEncrypted(encrypted)).toBe(true);
      expect(decrypt(encrypted, TEST_CONFIG)).toBe(plaintext);
    });

    it('should_notReencrypt_when_alreadyEncrypted', () => {
      const plaintext = 'test';
      const encrypted1 = encrypt(plaintext, TEST_CONFIG);
      const encrypted2 = encryptIfNeeded(encrypted1, TEST_CONFIG);

      expect(encrypted1).toBe(encrypted2);
    });

    it('should_decrypt_when_encrypted', () => {
      const plaintext = 'test';
      const encrypted = encrypt(plaintext, TEST_CONFIG);
      const decrypted = decryptIfNeeded(encrypted, TEST_CONFIG);

      expect(decrypted).toBe(plaintext);
    });

    it('should_returnAsIs_when_notEncrypted', () => {
      const plaintext = 'not encrypted';
      const result = decryptIfNeeded(plaintext, TEST_CONFIG);

      expect(result).toBe(plaintext);
    });
  });

  describe('encryptJson and decryptJson', () => {
    it('should_encryptAndDecryptJsonObject', () => {
      const obj = { key: 'value', nested: { num: 42 } };
      const encrypted = encryptJson(obj, TEST_CONFIG);
      const decrypted = decryptJson(encrypted, TEST_CONFIG);

      expect(decrypted).toEqual(obj);
    });

    it('should_handleNull', () => {
      expect(encryptJson(null, TEST_CONFIG)).toBeNull();
      expect(decryptJson(null, TEST_CONFIG)).toBeNull();
    });

    it('should_handleUnencryptedJson', () => {
      const obj = { key: 'value' };
      const json = JSON.stringify(obj);
      const result = decryptJson(json, TEST_CONFIG);

      expect(result).toEqual(obj);
    });
  });

  describe('encryptFields and decryptFields', () => {
    it('should_encryptSpecifiedFields', () => {
      const obj = { name: 'John', email: 'john@example.com', public: 'visible' };
      const encrypted = encryptFields(obj, ['name', 'email'], TEST_CONFIG);

      expect(isEncrypted(encrypted.name as string)).toBe(true);
      expect(isEncrypted(encrypted.email as string)).toBe(true);
      expect(encrypted.public).toBe('visible');
    });

    it('should_decryptSpecifiedFields', () => {
      const obj = { name: 'John', email: 'john@example.com', public: 'visible' };
      const encrypted = encryptFields(obj, ['name', 'email'], TEST_CONFIG);
      const decrypted = decryptFields(encrypted, ['name', 'email'], TEST_CONFIG);

      expect(decrypted.name).toBe('John');
      expect(decrypted.email).toBe('john@example.com');
      expect(decrypted.public).toBe('visible');
    });
  });

  describe('validateEncryptionConfig', () => {
    it('should_returnTrue_when_validConfig', () => {
      expect(validateEncryptionConfig(TEST_CONFIG)).toBe(true);
    });

    it('should_returnFalse_when_shortMasterKey', () => {
      expect(validateEncryptionConfig({ masterKey: 'too-short' })).toBe(false);
    });

    it('should_returnFalse_when_undefined', () => {
      expect(validateEncryptionConfig(undefined)).toBe(false);
    });

    it('should_returnFalse_when_emptyConfig', () => {
      expect(validateEncryptionConfig({})).toBe(false);
    });
  });

  describe('generateEncryptionKey', () => {
    it('should_generateUniqueKeys', () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();

      expect(key1).not.toBe(key2);
      expect(key1.length).toBeGreaterThan(32);
    });
  });
});

describe('Encrypted Fields', () => {
  describe('User encryption', () => {
    it('should_encryptUserFields', () => {
      const user = {
        id: 'usr_123',
        email: 'test@example.com',
        name: 'Test User',
        ssoId: 'azure-id-123',
        passwordHash: 'hashed',
      };

      const encrypted = encryptUser(user, TEST_CONFIG);

      expect(isEncrypted(encrypted.email!)).toBe(true);
      expect(isEncrypted(encrypted.name!)).toBe(true);
      expect(isEncrypted(encrypted.ssoId!)).toBe(true);
      expect(encrypted.passwordHash).toBe('hashed'); // Not encrypted
    });

    it('should_decryptUserFields', () => {
      const user = {
        id: 'usr_123',
        email: 'test@example.com',
        name: 'Test User',
        ssoId: 'azure-id-123',
      };

      const encrypted = encryptUser(user, TEST_CONFIG);
      const decrypted = decryptUser(encrypted, TEST_CONFIG);

      expect(decrypted.email).toBe('test@example.com');
      expect(decrypted.name).toBe('Test User');
      expect(decrypted.ssoId).toBe('azure-id-123');
    });

    it('should_decryptMultipleUsers', () => {
      const users = [
        { id: 'usr_1', email: 'user1@example.com', name: 'User 1' },
        { id: 'usr_2', email: 'user2@example.com', name: 'User 2' },
      ];

      const encrypted = users.map((u) => encryptUser(u, TEST_CONFIG));
      const decrypted = decryptUsers(encrypted, TEST_CONFIG);

      expect(decrypted[0].email).toBe('user1@example.com');
      expect(decrypted[1].email).toBe('user2@example.com');
    });

    it('should_handlePartialUser', () => {
      const user = { email: 'test@example.com' };
      const encrypted = encryptUser(user, TEST_CONFIG);
      const decrypted = decryptUser(encrypted, TEST_CONFIG);

      expect(decrypted.email).toBe('test@example.com');
    });
  });

  describe('Invitation encryption', () => {
    it('should_encryptInvitationFields', () => {
      const invitation = {
        id: 'inv_123',
        email: 'invited@example.com',
        token: 'secret-token',
        role: 'member' as const,
      };

      const encrypted = encryptInvitation(invitation, TEST_CONFIG);

      expect(isEncrypted(encrypted.email!)).toBe(true);
      expect(isEncrypted(encrypted.token!)).toBe(true);
      expect(encrypted.role).toBe('member');
    });

    it('should_decryptInvitationFields', () => {
      const invitation = {
        email: 'invited@example.com',
        token: 'secret-token',
      };

      const encrypted = encryptInvitation(invitation, TEST_CONFIG);
      const decrypted = decryptInvitation(encrypted, TEST_CONFIG);

      expect(decrypted.email).toBe('invited@example.com');
      expect(decrypted.token).toBe('secret-token');
    });
  });

  describe('Audit log encryption', () => {
    it('should_encryptAuditLogFields', () => {
      const log = {
        id: 'aud_123',
        ip: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        action: 'auth.login',
        actorType: 'user' as const,
        actorId: 'usr_123',
      };

      const encrypted = encryptAuditLog(log, TEST_CONFIG);

      expect(isEncrypted(encrypted.ip!)).toBe(true);
      expect(isEncrypted(encrypted.userAgent!)).toBe(true);
      expect(encrypted.action).toBe('auth.login');
    });

    it('should_decryptAuditLogFields', () => {
      const log = {
        ip: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      };

      const encrypted = encryptAuditLog(log, TEST_CONFIG);
      const decrypted = decryptAuditLog(encrypted, TEST_CONFIG);

      expect(decrypted.ip).toBe('192.168.1.1');
      expect(decrypted.userAgent).toBe('Mozilla/5.0');
    });

    it('should_encryptMetadataJson', () => {
      const log = {
        id: 'aud_123',
        actorType: 'user' as const,
        actorId: 'usr_123',
        action: 'test',
        metadata: { email: 'test@example.com', sensitive: 'data' },
      };

      const encrypted = encryptAuditLog(log, TEST_CONFIG);

      // Metadata should be encrypted as a string
      expect(typeof encrypted.metadata).toBe('string');
      expect(isEncrypted(encrypted.metadata as string)).toBe(true);
    });
  });

  describe('Encryption context', () => {
    it('should_createEnabledContext_when_validConfig', () => {
      const ctx = createEncryptionContext(TEST_CONFIG);

      expect(ctx.enabled).toBe(true);
    });

    it('should_createDisabledContext_when_noConfig', () => {
      const ctx = createEncryptionContext(undefined);

      expect(ctx.enabled).toBe(false);
    });

    it('should_passthrough_when_disabled', () => {
      const ctx = createEncryptionContext(undefined);
      const user = { email: 'test@example.com', name: 'Test' };

      const result = ctx.encryptUser(user);

      expect(result.email).toBe('test@example.com');
      expect(isEncrypted(result.email!)).toBe(false);
    });

    it('should_encrypt_when_enabled', () => {
      const ctx = createEncryptionContext(TEST_CONFIG);
      const user = { email: 'test@example.com', name: 'Test' };

      const encrypted = ctx.encryptUser(user);
      const decrypted = ctx.decryptUser(encrypted);

      expect(isEncrypted(encrypted.email!)).toBe(true);
      expect(decrypted.email).toBe('test@example.com');
    });
  });

  describe('isEncryptionEnabled', () => {
    it('should_returnTrue_when_validMasterKey', () => {
      expect(isEncryptionEnabled(TEST_CONFIG)).toBe(true);
    });

    it('should_returnFalse_when_shortKey', () => {
      expect(isEncryptionEnabled({ masterKey: 'short' })).toBe(false);
    });

    it('should_returnFalse_when_undefined', () => {
      expect(isEncryptionEnabled(undefined)).toBe(false);
    });
  });

  describe('hashEmailForLookup', () => {
    it('should_produceDeterministicHash', () => {
      const hash1 = hashEmailForLookup('test@example.com');
      const hash2 = hashEmailForLookup('test@example.com');

      expect(hash1).toBe(hash2);
    });

    it('should_beCaseInsensitive', () => {
      const hash1 = hashEmailForLookup('Test@Example.COM');
      const hash2 = hashEmailForLookup('test@example.com');

      expect(hash1).toBe(hash2);
    });

    it('should_produceUniqueHashes', () => {
      const hash1 = hashEmailForLookup('user1@example.com');
      const hash2 = hashEmailForLookup('user2@example.com');

      expect(hash1).not.toBe(hash2);
    });
  });
});

describe('Security', () => {
  it('should_notLeakPlaintext_when_inspectingEncrypted', () => {
    const sensitive = 'my-secret-password-123';
    const encrypted = encrypt(sensitive, TEST_CONFIG);

    expect(encrypted).not.toContain(sensitive);
    expect(encrypted).not.toContain('password');
    expect(encrypted).not.toContain('secret');
  });

  it('should_useAuthenticatedEncryption_when_tamperedWith', () => {
    const encrypted = encrypt('test', TEST_CONFIG);
    const parts = encrypted.split(':');

    // Tamper with the ciphertext
    const ciphertext = Buffer.from(parts[4], 'base64');
    ciphertext[0] = ciphertext[0] ^ 0xff;
    parts[4] = ciphertext.toString('base64');

    const tampered = parts.join(':');

    expect(() => decrypt(tampered, TEST_CONFIG)).toThrow();
  });

  it('should_useAuthenticatedEncryption_when_authTagTampered', () => {
    const encrypted = encrypt('test', TEST_CONFIG);
    const parts = encrypted.split(':');

    // Tamper with the auth tag
    const authTag = Buffer.from(parts[3], 'base64');
    authTag[0] = authTag[0] ^ 0xff;
    parts[3] = authTag.toString('base64');

    const tampered = parts.join(':');

    expect(() => decrypt(tampered, TEST_CONFIG)).toThrow();
  });
});
