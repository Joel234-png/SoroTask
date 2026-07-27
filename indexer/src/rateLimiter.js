/**
 * Token Bucket Rate Limiting Engine for Indexer REST API endpoints.
 * Supports configurable per-key / per-IP rate limits with in-memory token bucket
 * and extensible Redis backend support.
 */

class TokenBucket {
  constructor(capacity = 100, refillRate = 100 / 60) { // Default: 100 requests per minute
    this.capacity = capacity;
    this.refillRate = refillRate; // Tokens added per second
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  refill() {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillRate);
    this.lastRefill = now;
  }

  consume(count = 1) {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  getRemaining() {
    this.refill();
    return Math.floor(this.tokens);
  }

  getResetTime() {
    const missing = this.capacity - this.tokens;
    if (missing <= 0) return 0;
    return Math.ceil(missing / this.refillRate); // seconds until fully refilled
  }
}

// Memory store for token buckets per key/IP
const buckets = new Map();

// Registry for developer API keys with custom limits
const apiKeyStore = new Map();

/**
 * Registers or updates a developer API key with custom rate limit settings.
 * @param {string} apiKey - The API key string
 * @param {number} limit - Maximum requests allowed per window
 * @param {number} windowSeconds - Window duration in seconds (default 60s)
 */
function registerApiKey(apiKey, limit = 100, windowSeconds = 60) {
  apiKeyStore.set(apiKey, {
    limit,
    windowSeconds,
    refillRate: limit / windowSeconds,
  });
}

/**
 * Creates rate limiting middleware for REST routes.
 * @param {Object} options
 * @param {number} [options.defaultLimit=100] - Default requests allowed per window
 * @param {number} [options.windowSeconds=60] - Window duration in seconds
 */
function createRateLimiter(options = {}) {
  const defaultLimit = options.defaultLimit || 100;
  const defaultWindow = options.windowSeconds || 60;
  const defaultRefillRate = defaultLimit / defaultWindow;

  return (req, res, next) => {
    // Determine rate limit key: x-api-key header > jwt user id/address > IP address
    const apiKey = req.headers['x-api-key'];
    let key;
    let limit = defaultLimit;
    let windowSec = defaultWindow;
    let refillRate = defaultRefillRate;

    if (apiKey && apiKeyStore.has(apiKey)) {
      const config = apiKeyStore.get(apiKey);
      key = `key:${apiKey}`;
      limit = config.limit;
      windowSec = config.windowSeconds;
      refillRate = config.refillRate;
    } else if (apiKey) {
      key = `key:${apiKey}`;
    } else if (req.user && (req.user.id || req.user.address)) {
      key = `user:${req.user.id || req.user.address}`;
    } else {
      key = `ip:${req.ip || req.socket.remoteAddress || '127.0.0.1'}`;
    }

    if (!buckets.has(key)) {
      buckets.set(key, new TokenBucket(limit, refillRate));
    }

    const bucket = buckets.get(key);
    const allowed = bucket.consume(1);
    const remaining = bucket.getRemaining();
    const resetTime = bucket.getResetTime();

    res.set({
      'X-RateLimit-Limit': limit,
      'X-RateLimit-Remaining': remaining,
      'X-RateLimit-Reset': resetTime,
    });

    if (!allowed) {
      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded for API key or IP address',
        rateLimit: {
          limit,
          remaining: 0,
          resetSeconds: resetTime,
        },
      });
    }

    next();
  };
}

/**
 * Clears expired rate limit buckets (housekeeping)
 */
function clearBuckets() {
  buckets.clear();
}

module.exports = {
  TokenBucket,
  registerApiKey,
  createRateLimiter,
  clearBuckets,
  apiKeyStore,
};
