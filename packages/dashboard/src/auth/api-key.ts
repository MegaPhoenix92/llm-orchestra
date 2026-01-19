/**
 * API Key Generation and Verification Utilities
 * Format: orch_ prefix + 32 character random string
 *
 * Security Note: The prefix is used for efficient database lookups before
 * verifying the full key hash. A longer prefix reduces collision probability.
 * With 16 chars (orch_ + 11 random from nanoid's 64-char alphabet):
 * - Possible prefixes: 64^11 = 73+ quadrillion
 * - Collision at 1 billion keys: ~0.0000007% chance
 */

import { nanoid } from 'nanoid';
import crypto from 'crypto';

const API_KEY_PREFIX = 'orch_';
const API_KEY_LENGTH = 32;
/**
 * Prefix length for database lookup optimization.
 * Using 16 chars provides sufficient entropy to virtually eliminate collisions
 * while keeping database indexes efficient.
 *
 * Format: "orch_" (5 chars) + 11 random chars = 16 total
 * Entropy: 64^11 possible combinations (~73 quadrillion)
 */
const LOOKUP_PREFIX_LENGTH = 16;

export interface GeneratedApiKey {
  /** Full API key to give to user (only shown once) */
  key: string;
  /** First 16 chars for database lookup (e.g., orch_xxxxxxxxxxx) */
  prefix: string;
  /** SHA-256 hash for secure storage in database */
  hashedKey: string;
}

/**
 * Generate a new API key with prefix, full key, and hashed version
 * @returns Object containing the full key (show once), prefix (for lookup), and hash (for storage)
 */
export function generateApiKey(): GeneratedApiKey {
  const randomPart = nanoid(API_KEY_LENGTH);
  const key = `${API_KEY_PREFIX}${randomPart}`;
  const prefix = key.substring(0, LOOKUP_PREFIX_LENGTH);
  const hashedKey = hashApiKey(key);

  return {
    key,
    prefix,
    hashedKey,
  };
}

/**
 * Hash an API key using SHA-256 for secure storage
 * @param key - The full API key to hash
 * @returns SHA-256 hash of the key in hex format
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Verify an API key against a stored hash
 * @param key - The full API key to verify
 * @param hashedKey - The stored SHA-256 hash to verify against
 * @returns true if the key matches the hash, false otherwise
 */
export function verifyApiKey(key: string, hashedKey: string): boolean {
  const computedHash = hashApiKey(key);
  // Use timing-safe comparison to prevent timing attacks
  return crypto.timingSafeEqual(Buffer.from(computedHash), Buffer.from(hashedKey));
}

/**
 * Extract the prefix from an API key for database lookup
 * @param key - The full API key
 * @returns The first 16 characters of the key (e.g., orch_xxxxxxxxxxx)
 */
export function getApiKeyPrefix(key: string): string {
  return key.substring(0, LOOKUP_PREFIX_LENGTH);
}

/**
 * Get the current lookup prefix length.
 * Useful for validation and testing.
 * @returns The number of characters used for prefix lookup
 */
export function getLookupPrefixLength(): number {
  return LOOKUP_PREFIX_LENGTH;
}
