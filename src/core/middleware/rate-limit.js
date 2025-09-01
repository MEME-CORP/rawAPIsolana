import { ApiError } from '../errors/api-error.js';

/**
 * Simple in-memory fixed-window rate limiter per category label.
 * Decides limits based on SOLANA_RPC_URL env: free (mainnet-beta default) vs premium (any other URL).
 *
 * Tiers:
 * - premium:
 *   - advanced with pre-balance: 10 req/s
 *   - advanced without pre-balance: 13 req/s
 *   - regular: 40 req/s
 * - free (mainnet-beta public):
 *   - advanced (with or without pre-balance): 1 req/s
 *   - regular: 4 req/s
 */

/** @typedef {{ count: number, windowStartMs: number, limit: number }} Bucket */

const buckets = new Map(); // label => Bucket

function isFreeTier() {
  const url = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  return url.includes('api.mainnet-beta.solana.com');
}

/**
 * Build the numeric limits for current tier.
 */
function currentLimits() {
  const free = isFreeTier();
  return {
    advancedWithPre: free ? 1 : 10,
    advancedWithoutPre: free ? 1 : 13,
    regular: free ? 4 : 40,
    tier: free ? 'free' : 'premium',
  };
}

/**
 * Create an Express middleware enforcing N requests per second per process for this label.
 * @param {number} limitPerSec
 * @param {string} label
 */
function makeRateLimiter(limitPerSec, label) {
  return function rateLimiter(req, _res, next) {
    const now = Date.now();
    /** @type {Bucket} */
    let b = buckets.get(label);
    if (!b) {
      b = { count: 0, windowStartMs: now, limit: limitPerSec };
      buckets.set(label, b);
    }
    // New window each 1000ms
    if (now - b.windowStartMs >= 1000) {
      b.windowStartMs = now;
      b.count = 0;
    }
    if (b.count >= b.limit) {
      throw new ApiError('RATE_LIMIT_EXCEEDED', `Rate limit exceeded for ${label}: max ${b.limit} req/s`, 400);
    }
    b.count += 1;
    next();
  };
}

/**
 * Construct the three limiters for the active tier: advancedWithPre, advancedWithoutPre, regular.
 */
export function buildRateLimiters() {
  const lim = currentLimits();
  return {
    advancedWithPre: makeRateLimiter(lim.advancedWithPre, `advanced-with-pre:${lim.tier}`),
    advancedWithoutPre: makeRateLimiter(lim.advancedWithoutPre, `advanced-without-pre:${lim.tier}`),
    regular: makeRateLimiter(lim.regular, `regular:${lim.tier}`),
  };
}

export { makeRateLimiter };
