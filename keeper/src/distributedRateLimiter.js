/**
 * Distributed (cluster-wide) rate limiter for keeper RPC calls.
 *
 * ── Why this exists (Issue #849) ────────────────────────────────────────────
 * `src/concurrency.js` (`createRateLimiter`) enforces concurrency + RPS limits,
 * but purely *in-process*. When several keeper worker processes each run their
 * own local limiter, they collectively exceed the real Stellar RPC rate limit
 * because none of them can see the others' traffic.
 *
 * This module implements a Redis-backed sliding-window token bucket that every
 * keeper process shares, so a single GLOBAL request budget (e.g. 100 req/sec
 * across the whole cluster) is enforced no matter how many processes there are.
 *
 * ── Atomicity ───────────────────────────────────────────────────────────────
 * A naive "GET the counter, decide in Node, then SET it" has a race: two
 * processes can both read the same value and both decide they're under budget,
 * double-spending the budget. To avoid this we run a small Lua script on the
 * Redis server via `defineCommand`. Redis executes the script atomically, so
 * the check-and-increment is a single indivisible operation — concurrent
 * processes never double-spend.
 *
 * ── Sliding window ──────────────────────────────────────────────────────────
 * The window is keyed by `floor(now / windowMs)`, giving a fresh counter key
 * per window with a TTL slightly longer than the window. When the window rolls
 * over the counter naturally resets (old key expires). This is a fixed-window
 * counter (the classic, cheap distributed pattern); it is intentionally simple
 * and pairs with the per-process limiter which smooths bursts within a window.
 *
 * ── Fallback / no-op mode (dev & single-instance) ───────────────────────────
 * If REDIS_URL is not configured, this limiter becomes a NO-OP passthrough:
 * every `acquire()` resolves as allowed immediately. This means single-instance
 * or local-dev deployments are NOT forced to run Redis — they simply rely on
 * the existing per-process `createRateLimiter`. The no-op mode is also used if
 * a Redis command errors at runtime ("fail open"), so a Redis outage degrades
 * to per-process limiting rather than halting the keeper.
 */

// The Lua script atomically implements a fixed-window counter.
// KEYS[1] = window counter key
// ARGV[1] = limit (max requests allowed in the window)
// ARGV[2] = ttl in milliseconds (window length + small slack)
// Returns: 1 if the request is allowed (counter incremented), 0 if over budget.
const CONSUME_SCRIPT = `
local current = tonumber(redis.call('get', KEYS[1]) or '0')
if current < tonumber(ARGV[1]) then
  local updated = redis.call('incr', KEYS[1])
  if updated == 1 then
    redis.call('pexpire', KEYS[1], tonumber(ARGV[2]))
  end
  return 1
else
  return 0
end
`;

class DistributedRateLimiter {
  /**
   * @param {Object} options
   * @param {import('ioredis').Redis} [options.redis] - A pre-built ioredis client
   *   (or ioredis-mock). If omitted and redisUrl is set, one is created lazily.
   * @param {string} [options.redisUrl=process.env.REDIS_URL] - Redis connection URL.
   *   When falsy AND no redis client is supplied, the limiter is a no-op passthrough.
   * @param {number} [options.limit=process.env.RPC_GLOBAL_RATE_LIMIT] - Max requests
   *   allowed cluster-wide per window.
   * @param {number} [options.windowMs=1000] - Sliding-window length in milliseconds.
   * @param {string} [options.keyPrefix='keeper:rpc:rate'] - Redis key namespace.
   * @param {Object} [options.logger]
   */
  constructor(options = {}) {
    const {
      redis = null,
      redisUrl = process.env.REDIS_URL,
      limit = parseInt(process.env.RPC_GLOBAL_RATE_LIMIT || '100', 10),
      windowMs = 1000,
      keyPrefix = 'keeper:rpc:rate',
      logger = null,
    } = options;

    this.logger = logger;
    this.limit = limit;
    this.windowMs = windowMs;
    this.keyPrefix = keyPrefix;
    this.ownsClient = false;

    if (redis) {
      // Caller supplied a client (real ioredis or ioredis-mock in tests).
      this.redis = redis;
      this.enabled = true;
    } else if (redisUrl) {
      // Lazily construct a real ioredis client from the URL.
      const Redis = require('ioredis');
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 2,
        enableOfflineQueue: true,
        lazyConnect: false,
      });
      this.ownsClient = true;
      this.enabled = true;
      this.redis.on('error', (err) => {
        if (this.logger) {
          this.logger.warn('Distributed rate limiter Redis error (failing open)', {
            error: err.message,
          });
        }
      });
    } else {
      // No Redis configured → no-op passthrough. Per-process limiter still applies.
      this.redis = null;
      this.enabled = false;
      if (this.logger) {
        this.logger.info(
          'REDIS_URL not set — distributed RPC rate limiter disabled (no-op passthrough). '
          + 'Cluster-wide RPC limiting is inactive; per-process limiting still applies.',
        );
      }
    }

    if (this.enabled && typeof this.redis.consumeRateToken !== 'function') {
      // Register the atomic Lua command on the client.
      this.redis.defineCommand('consumeRateToken', {
        numberOfKeys: 1,
        lua: CONSUME_SCRIPT,
      });
    }
  }

  /**
   * Whether this limiter is actually enforcing a global limit (false = no-op).
   */
  isEnabled() {
    return this.enabled;
  }

  _currentKey(now = Date.now()) {
    const windowId = Math.floor(now / this.windowMs);
    return `${this.keyPrefix}:${windowId}`;
  }

  /**
   * Attempt to consume one token from the cluster-wide budget for the current
   * window. Returns true if allowed, false if the global budget is exhausted.
   *
   * On any Redis error this "fails open" (returns true) so a Redis outage
   * degrades to per-process limiting rather than halting all RPC reads.
   *
   * @returns {Promise<boolean>}
   */
  async tryAcquire() {
    if (!this.enabled) {
      return true; // no-op passthrough
    }
    try {
      const key = this._currentKey();
      const ttl = this.windowMs + 1000; // small slack so the key outlives the window
      const allowed = await this.redis.consumeRateToken(key, this.limit, ttl);
      return Number(allowed) === 1;
    } catch (err) {
      if (this.logger) {
        this.logger.warn('Distributed rate limiter check failed — failing open', {
          error: err.message,
        });
      }
      return true;
    }
  }

  /**
   * Block until a token is available (or maxWaitMs elapses), then proceed.
   * Polls the current window; because windows are short (default 1s) the wait
   * is bounded and cheap. Intended to gate an RPC call so the cluster never
   * exceeds the global budget.
   *
   * @param {Object} [opts]
   * @param {number} [opts.maxWaitMs=5000] - Give up waiting after this long and
   *   proceed anyway (fail open) to avoid deadlocking the poll cycle.
   * @param {number} [opts.pollMs=25] - Retry interval while over budget.
   * @returns {Promise<boolean>} true if a token was acquired, false if it
   *   proceeded via fail-open after maxWaitMs.
   */
  async acquire(opts = {}) {
    if (!this.enabled) {
      return true;
    }
    const { maxWaitMs = 5000, pollMs = 25 } = opts;
    const deadline = Date.now() + maxWaitMs;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (await this.tryAcquire()) {
        return true;
      }
      if (Date.now() >= deadline) {
        if (this.logger) {
          this.logger.warn('Distributed rate limiter wait exceeded maxWaitMs — proceeding (fail open)', {
            maxWaitMs,
          });
        }
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  /**
   * Wrap a function so it only runs after acquiring a global token. Designed to
   * compose with the per-process `createRateLimiter` from concurrency.js:
   *   readLimit(() => distributed.schedule(() => server.getX()))
   *
   * @param {Function} fn
   * @param {Object} [opts] - forwarded to acquire()
   * @returns {Promise<*>}
   */
  async schedule(fn, opts = {}) {
    await this.acquire(opts);
    return fn();
  }

  /**
   * Close the Redis connection if this limiter created it.
   */
  async close() {
    if (this.ownsClient && this.redis) {
      try {
        await this.redis.quit();
      } catch (_e) {
        // ignore
      }
    }
  }
}

/**
 * Convenience factory mirroring createRateLimiter's style.
 * @param {Object} options - see DistributedRateLimiter constructor
 * @returns {DistributedRateLimiter}
 */
function createDistributedRateLimiter(options = {}) {
  return new DistributedRateLimiter(options);
}

module.exports = { DistributedRateLimiter, createDistributedRateLimiter };
