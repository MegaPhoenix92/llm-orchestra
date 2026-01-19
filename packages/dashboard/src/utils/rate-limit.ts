/**
 * Rate Limiting Utilities
 */

export interface RateLimitConfig {
  /** Time window in milliseconds */
  windowMs: number;
  /** Maximum requests per window */
  maxRequests: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimiter {
  /** Check if a request is allowed for the given key */
  check(key: string): RateLimitResult;
  /** Get remaining requests for the given key */
  getRemaining(key: string): number;
  /** Cleanup expired entries */
  cleanup(): void;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

/**
 * Create a rate limiter with the given configuration
 * @param config - Rate limiting configuration
 * @returns RateLimiter instance
 */
export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  const store = new Map<string, RateLimitEntry>();
  const { windowMs, maxRequests } = config;

  // Set up automatic cleanup
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (now - entry.windowStart > windowMs * 2) {
        store.delete(key);
      }
    }
  }, windowMs);

  // Prevent the interval from keeping the process alive
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return {
    check(key: string): RateLimitResult {
      const now = Date.now();
      const entry = store.get(key);

      if (!entry || now - entry.windowStart > windowMs) {
        // New window
        store.set(key, { count: 1, windowStart: now });
        return {
          allowed: true,
          remaining: maxRequests - 1,
          resetAt: now + windowMs,
        };
      }

      if (entry.count >= maxRequests) {
        const resetAt = entry.windowStart + windowMs;
        return {
          allowed: false,
          remaining: 0,
          resetAt,
        };
      }

      entry.count += 1;
      return {
        allowed: true,
        remaining: Math.max(0, maxRequests - entry.count),
        resetAt: entry.windowStart + windowMs,
      };
    },

    getRemaining(key: string): number {
      const entry = store.get(key);
      if (!entry || Date.now() - entry.windowStart > windowMs) {
        return maxRequests;
      }
      return Math.max(0, maxRequests - entry.count);
    },

    cleanup(): void {
      clearInterval(cleanupInterval);
      store.clear();
    },
  };
}
