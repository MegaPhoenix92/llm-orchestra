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
 * Encryption configuration
 */
export interface EncryptionConfig {
  /** Master encryption key (32+ characters recommended) */
  masterKey: string;
  /** Optional key identifier for key rotation support */
  keyId?: string;
}

/**
 * Encryption algorithm constants
 */
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits for GCM
const SALT_LENGTH = 16; // 128 bits
const PBKDF2_ITERATIONS = 100000;
const CURRENT_VERSION = 'v1';

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
 * @returns Encrypted string in format: v1:<salt>:<iv>:<authTag>:<ciphertext>
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

  // Encode all components to base64
  const components = [
    CURRENT_VERSION,
    salt.toString('base64'),
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ];

  return components.join(':');
}

/**
 * Decrypt an encrypted string
 *
 * @param ciphertext - The encrypted string in format: v1:<salt>:<iv>:<authTag>:<ciphertext>
 * @param config - Encryption configuration with master key
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
  if (version !== CURRENT_VERSION) {
    throw new Error(`Unsupported encryption version: ${version}`);
  }

  const parts = ciphertext.split(':');
  if (parts.length !== 5) {
    throw new Error('Invalid encrypted data format');
  }

  const [, saltB64, ivB64, authTagB64, encryptedB64] = parts;

  // Decode components
  const salt = Buffer.from(saltB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');

  // Derive key from master key and salt
  const key = deriveKey(config.masterKey, salt);

  // Create decipher and decrypt
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Check if a string is encrypted
 */
export function isEncrypted(value: string): boolean {
  return value?.startsWith('v1:') && value.split(':').length === 5;
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
