/**
 * Encryption at Rest Module for LLM Orchestra Dashboard
 *
 * Provides AES-256-GCM authenticated encryption for sensitive data at rest.
 * Uses PBKDF2 for key derivation from a master secret.
 *
 * Format: v1:<salt>:<iv>:<authTag>:<ciphertext> (all base64 encoded)
 */

import crypto from 'crypto';

/**
 * A single encryption key with its identifier
 */
export interface EncryptionKey {
  /** Unique identifier for this key */
  keyId: string;
  /** The actual encryption key (32+ characters) */
  masterKey: string;
}

/**
 * Encryption configuration with support for key rotation
 */
export interface EncryptionConfig {
  /** Master encryption key (32+ characters recommended) */
  masterKey: string;
  /** Key identifier for the current key (defaults to 'primary') */
  keyId?: string;
  /** Previous keys for decryption during key rotation (decrypt-only) */
  previousKeys?: EncryptionKey[];
}

/**
 * Encryption algorithm constants
 */
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits for GCM
const SALT_LENGTH = 16; // 128 bits
const PBKDF2_ITERATIONS = 100000;
const DEFAULT_KEY_ID = 'primary';

/**
 * Encryption format versions:
 * - v1: Original format without key ID (for backward compatibility)
 * - v2: Includes key ID for key rotation support
 */
const VERSION_V1 = 'v1';
const VERSION_V2 = 'v2';
const CURRENT_VERSION = VERSION_V2;

/**
 * Cached derived keys to avoid repeated PBKDF2 computation
 */
const keyCache = new Map<string, Buffer>();

/**
 * Derive an encryption key from master key and salt using PBKDF2
 */
function deriveKey(masterKey: string, salt: Buffer): Buffer {
  const cacheKey = `${masterKey}:${salt.toString('base64')}`;
  const cached = keyCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const derived = crypto.pbkdf2Sync(masterKey, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');

  // Cache with size limit to prevent memory issues
  if (keyCache.size > 1000) {
    const firstKey = keyCache.keys().next().value;
    if (firstKey) {
      keyCache.delete(firstKey);
    }
  }
  keyCache.set(cacheKey, derived);

  return derived;
}

/**
 * Encrypt a plaintext string using AES-256-GCM
 *
 * @param plaintext - The string to encrypt
 * @param config - Encryption configuration with master key
 * @returns Encrypted string in format: v2:<keyId>:<salt>:<iv>:<authTag>:<ciphertext>
 */
export function encrypt(plaintext: string, config: EncryptionConfig): string {
  if (!plaintext) {
    return plaintext;
  }

  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);

  // Derive key from master key and salt
  const key = deriveKey(config.masterKey, salt);

  // Create cipher and encrypt
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Use key ID from config or default
  const keyId = config.keyId || DEFAULT_KEY_ID;

  // Encode all components to base64 (v2 format includes keyId)
  const components = [
    CURRENT_VERSION,
    keyId,
    salt.toString('base64'),
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ];

  return components.join(':');
}

/**
 * Find the master key for a given key ID
 */
function findKeyById(keyId: string, config: EncryptionConfig): string | null {
  // Check if it matches the current key
  const currentKeyId = config.keyId || DEFAULT_KEY_ID;
  if (keyId === currentKeyId) {
    return config.masterKey;
  }

  // Check previous keys
  if (config.previousKeys) {
    const previousKey = config.previousKeys.find((k) => k.keyId === keyId);
    if (previousKey) {
      return previousKey.masterKey;
    }
  }

  return null;
}

/**
 * Decrypt an encrypted string
 *
 * Supports both v1 and v2 formats:
 * - v1: <salt>:<iv>:<authTag>:<ciphertext> (uses current key)
 * - v2: <keyId>:<salt>:<iv>:<authTag>:<ciphertext> (uses key by ID)
 *
 * @param ciphertext - The encrypted string
 * @param config - Encryption configuration with master key and optional previous keys
 * @returns Decrypted plaintext string
 * @throws Error if decryption fails or format is invalid
 */
export function decrypt(ciphertext: string, config: EncryptionConfig): string {
  if (!ciphertext) {
    return ciphertext;
  }

  // Check if data looks like encrypted format (starts with version prefix)
  const versionMatch = ciphertext.match(/^(v\d+):/);
  if (!versionMatch) {
    // Not encrypted data, return as-is for migration scenarios
    return ciphertext;
  }

  const version = versionMatch[1];
  const parts = ciphertext.split(':');

  let masterKey: string;
  let saltB64: string;
  let ivB64: string;
  let authTagB64: string;
  let encryptedB64: string;

  if (version === VERSION_V1) {
    // v1 format: v1:<salt>:<iv>:<authTag>:<ciphertext>
    if (parts.length !== 5) {
      throw new Error('Invalid encrypted data format (v1)');
    }
    [, saltB64, ivB64, authTagB64, encryptedB64] = parts;
    masterKey = config.masterKey;
  } else if (version === VERSION_V2) {
    // v2 format: v2:<keyId>:<salt>:<iv>:<authTag>:<ciphertext>
    if (parts.length !== 6) {
      throw new Error('Invalid encrypted data format (v2)');
    }
    const keyId = parts[1];
    [, , saltB64, ivB64, authTagB64, encryptedB64] = parts;

    // Find the key by ID
    const foundKey = findKeyById(keyId, config);
    if (!foundKey) {
      throw new Error(`Unknown encryption key ID: ${keyId}`);
    }
    masterKey = foundKey;
  } else {
    throw new Error(`Unsupported encryption version: ${version}`);
  }

  // Decode components
  const salt = Buffer.from(saltB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');

  // Derive key from master key and salt
  const key = deriveKey(masterKey, salt);

  // Create decipher and decrypt
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Check if a string is encrypted (v1 or v2 format)
 */
export function isEncrypted(value: string): boolean {
  if (!value) return false;
  const parts = value.split(':');
  // v1 format: 5 parts (v1:salt:iv:authTag:ciphertext)
  if (value.startsWith('v1:') && parts.length === 5) return true;
  // v2 format: 6 parts (v2:keyId:salt:iv:authTag:ciphertext)
  if (value.startsWith('v2:') && parts.length === 6) return true;
  return false;
}

/**
 * Get the key ID from an encrypted value (v2 only, returns null for v1)
 */
export function getEncryptedKeyId(value: string): string | null {
  if (!value || !isEncrypted(value)) return null;
  if (value.startsWith('v2:')) {
    return value.split(':')[1];
  }
  return null;
}

/**
 * Check if a value needs re-encryption (encrypted with a different key)
 */
export function needsReEncryption(value: string, currentKeyId: string): boolean {
  if (!isEncrypted(value)) return false;
  // v1 values always need re-encryption to add key ID
  if (value.startsWith('v1:')) return true;
  // v2 values need re-encryption if key ID differs
  const encryptedKeyId = getEncryptedKeyId(value);
  return encryptedKeyId !== currentKeyId;
}

/**
 * Encrypt a value if not already encrypted
 */
export function encryptIfNeeded(value: string, config: EncryptionConfig): string {
  if (!value || isEncrypted(value)) {
    return value;
  }
  return encrypt(value, config);
}

/**
 * Decrypt a value if encrypted, otherwise return as-is
 */
export function decryptIfNeeded(value: string, config: EncryptionConfig): string {
  if (!value || !isEncrypted(value)) {
    return value;
  }
  return decrypt(value, config);
}

/**
 * Encrypt JSON object fields
 */
export function encryptJson(
  obj: Record<string, unknown> | null,
  config: EncryptionConfig
): string | null {
  if (!obj) {
    return null;
  }
  const json = JSON.stringify(obj);
  return encrypt(json, config);
}

/**
 * Decrypt JSON object fields
 */
export function decryptJson(
  encrypted: string | null,
  config: EncryptionConfig
): Record<string, unknown> | null {
  if (!encrypted) {
    return null;
  }
  const json = decryptIfNeeded(encrypted, config);
  // If decryptIfNeeded returned the original (unencrypted JSON), parsing should succeed.
  // If it returned decrypted content from encryptJson, it should also be valid JSON.
  // An error here indicates data corruption or invalid format.
  return JSON.parse(json) as Record<string, unknown>;
}

/**
 * Encrypt sensitive fields in an object
 */
export function encryptFields<T extends Record<string, unknown>>(
  obj: T,
  fields: (keyof T)[],
  config: EncryptionConfig
): T {
  const result = { ...obj };
  for (const field of fields) {
    const value = result[field];
    if (typeof value === 'string') {
      result[field] = encryptIfNeeded(value, config) as T[keyof T];
    }
  }
  return result;
}

/**
 * Decrypt sensitive fields in an object
 */
export function decryptFields<T extends Record<string, unknown>>(
  obj: T,
  fields: (keyof T)[],
  config: EncryptionConfig
): T {
  const result = { ...obj };
  for (const field of fields) {
    const value = result[field];
    if (typeof value === 'string') {
      result[field] = decryptIfNeeded(value, config) as T[keyof T];
    }
  }
  return result;
}

/**
 * Validate encryption configuration
 */
export function validateEncryptionConfig(config?: Partial<EncryptionConfig>): boolean {
  return !!(config?.masterKey && config.masterKey.length >= 32);
}

/**
 * Generate a secure random encryption key
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('base64');
}

/**
 * Clear the key cache (useful for key rotation)
 */
export function clearKeyCache(): void {
  keyCache.clear();
}
