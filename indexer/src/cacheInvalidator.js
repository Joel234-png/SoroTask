const EventEmitter = require('events');

class CacheInvalidationEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.cache = new Map();
    this.redisClient = options.redisClient || null;
    this.pubSubChannel = options.channel || 'cache:invalidate';
    this.subscribers = new Set();

    if (this.redisClient && typeof this.redisClient.subscribe === 'function') {
      this.redisClient.subscribe(this.pubSubChannel, (message) => {
        this.handlePubSubMessage(message);
      });
    }
  }

  get(key) {
    const startTime = Date.now();
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    const latency = Date.now() - startTime;
    this.emit('hit', { key, latencyMs: latency });
    return entry.value;
  }

  set(key, value, ttlMs = 300000) {
    const expiresAt = ttlMs ? Date.now() + ttlMs : null;
    this.cache.set(key, { value, expiresAt });
  }

  invalidateKeys(keys = []) {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    const purged = [];

    for (const key of keyArray) {
      if (this.cache.has(key)) {
        this.cache.delete(key);
        purged.push(key);
      }
    }

    const payload = JSON.stringify({
      event: 'CACHE_INVALIDATION',
      keys: keyArray,
      timestamp: Date.now(),
    });

    if (this.redisClient && typeof this.redisClient.publish === 'function') {
      this.redisClient.publish(this.pubSubChannel, payload);
    }

    this.emit('invalidate', { keys: keyArray, purged });
    return purged;
  }

  invalidateForEvent(eventName, taskId, data = {}) {
    const keysToInvalidate = [];

    if (taskId != null) {
      keysToInvalidate.push(`task:${taskId}`);
    }

    if (data.creator) {
      keysToInvalidate.push(`creator:${data.creator}`);
    }

    if (data.address) {
      keysToInvalidate.push(`address:${data.address}`);
    }

    // Always invalidate high-level task lists
    keysToInvalidate.push('tasks:all');
    keysToInvalidate.push('tasks:active');

    return this.invalidateKeys(keysToInvalidate);
  }

  handlePubSubMessage(message) {
    try {
      const parsed = typeof message === 'string' ? JSON.parse(message) : message;
      if (parsed && Array.isArray(parsed.keys)) {
        for (const key of parsed.keys) {
          this.cache.delete(key);
        }
        this.emit('remoteInvalidate', { keys: parsed.keys });
      }
    } catch (err) {
      console.error('[CacheInvalidationEngine] Failed to parse pub/sub message:', err.message);
    }
  }

  clear() {
    this.cache.clear();
  }
}

module.exports = {
  CacheInvalidationEngine,
};
