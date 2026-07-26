const Redis = require('ioredis');
const { createLogger } = require('./logger');
const crypto = require('crypto');

const logger = createLogger('locker');

let redisClient = null;

function getRedisClient() {
  if (redisClient) return redisClient;

  const url = process.env.REDIS_URL;
  if (!url) {
    logger.warn('REDIS_URL not set — distributed locking disabled (local-only)');
    // create a local in-memory shim with minimal API
    const map = new Map();
    redisClient = {
      async set(key, value, mode, flag, ttlMs) {
        if (mode !== 'PX' || flag !== 'NX') throw new Error('Unsupported local set signature');
        if (map.has(key)) return null;
        map.set(key, { value, expireAt: Date.now() + ttlMs });
        return 'OK';
      },
      async eval(script, numKeys, key, token) {
        // simple compare-and-del
        const entry = map.get(key);
        if (entry && entry.value === token) {
          map.delete(key);
          return 1;
        }
        return 0;
      },
      async get(key) {
        const entry = map.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expireAt) {
          map.delete(key);
          return null;
        }
        return entry.value;
      },
      quit: async () => {},
    };
    return redisClient;
  }

  redisClient = new Redis(url);
  redisClient.on('error', (err) => logger.error('Redis error', { error: err.message }));
  return redisClient;
}

// Acquire a lock for a task. Returns a token string when acquired, or null.
async function acquireLock(taskId, ttlMs = 60000) {
  const key = `keeper:lock:task:${taskId}`;
  const token = crypto.randomBytes(16).toString('hex');
  const client = getRedisClient();

  try {
    const res = await client.set(key, token, 'PX', 'NX', ttlMs);
    if (res === 'OK') {
      logger.info('Lock acquired', { taskId, ttlMs });
      return token;
    }
    logger.debug('Lock contention', { taskId });
    return null;
  } catch (err) {
    logger.error('Failed to acquire lock', { taskId, error: err.message });
    return null;
  }
}

// Release lock only if token matches
async function releaseLock(taskId, token) {
  const key = `keeper:lock:task:${taskId}`;
  const client = getRedisClient();

  // Lua script: if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end
  const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
  try {
    const res = await client.eval(script, 1, key, token);
    if (res === 1) {
      logger.info('Lock released', { taskId });
      return true;
    }
    logger.warn('Failed to release lock — token mismatch or expired', { taskId });
    return false;
  } catch (err) {
    logger.error('Failed to release lock', { taskId, error: err.message });
    return false;
  }
}

// Extend lock TTL if token matches
async function extendLock(taskId, token, ttlMs = 60000) {
  const key = `keeper:lock:task:${taskId}`;
  const client = getRedisClient();

  // Use a Lua script to check token and PEXPIRE
  const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";
  try {
    const res = await client.eval(script, 1, key, token, ttlMs);
    if (res === 1) {
      logger.info('Lock extended', { taskId, ttlMs });
      return true;
    }
    logger.warn('Failed to extend lock — token mismatch or expired', { taskId });
    return false;
  } catch (err) {
    logger.error('Failed to extend lock', { taskId, error: err.message });
    return false;
  }
}

class RedlockManager {
  constructor(nodes = [], options = {}) {
    this.nodes = nodes;
    this.logger = options.logger || logger;
    this.clients = [];
    this._initClients();
  }

  _initClients() {
    if (this.nodes.length === 0) {
      const nodeStr = process.env.REDIS_NODES || process.env.REDIS_URL;
      if (nodeStr) {
        this.nodes = nodeStr.split(',').map((s) => s.trim());
      }
    }

    if (this.nodes.length === 0) {
      // In-memory mock nodes for 3-node quorum testing/fallback
      for (let i = 0; i < 3; i++) {
        const map = new Map();
        this.clients.push({
          async set(key, value, mode, flag, ttlMs) {
            if (mode !== 'PX' || flag !== 'NX') throw new Error('Unsupported set signature');
            if (map.has(key)) return null;
            map.set(key, { value, expireAt: Date.now() + ttlMs });
            return 'OK';
          },
          async eval(script, numKeys, key, token, ttlMs) {
            const entry = map.get(key);
            if (entry && entry.value === token) {
              if (script.includes('del')) {
                map.delete(key);
                return 1;
              }
              if (script.includes('pexpire')) {
                entry.expireAt = Date.now() + Number(ttlMs);
                return 1;
              }
            }
            return 0;
          },
          quit: async () => {},
        });
      }
    } else {
      this.clients = this.nodes.map((url) => {
        const client = new Redis(url);
        client.on('error', (err) => this.logger.error('Redlock Redis node error', { url, error: err.message }));
        return client;
      });
    }
  }

  async acquire(taskId, ttlMs = 60000) {
    const key = `keeper:lock:task:${taskId}`;
    const token = crypto.randomBytes(16).toString('hex');
    const quorum = Math.floor(this.clients.length / 2) + 1;
    let acquiredCount = 0;

    const results = await Promise.all(
      this.clients.map(async (client) => {
        try {
          const res = await client.set(key, token, 'PX', 'NX', ttlMs);
          return res === 'OK';
        } catch (err) {
          return false;
        }
      })
    );

    acquiredCount = results.filter(Boolean).length;

    if (acquiredCount >= quorum) {
      this.logger.info('Redlock acquired across quorum', { taskId, acquiredCount, totalNodes: this.clients.length });
      return token;
    }

    // Quorum not reached: release any acquired nodes
    await this.release(taskId, token);
    this.logger.debug('Redlock quorum not reached', { taskId, acquiredCount, quorum });
    return null;
  }

  async release(taskId, token) {
    const key = `keeper:lock:task:${taskId}`;
    const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
    const quorum = Math.floor(this.clients.length / 2) + 1;

    const results = await Promise.all(
      this.clients.map(async (client) => {
        try {
          const res = await client.eval(script, 1, key, token);
          return res === 1;
        } catch (err) {
          return false;
        }
      })
    );

    const releasedCount = results.filter(Boolean).length;
    this.logger.info('Redlock release attempted', { taskId, releasedCount });
    return releasedCount >= quorum || releasedCount > 0;
  }

  async extend(taskId, token, ttlMs = 60000) {
    const key = `keeper:lock:task:${taskId}`;
    const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";
    const quorum = Math.floor(this.clients.length / 2) + 1;

    const results = await Promise.all(
      this.clients.map(async (client) => {
        try {
          const res = await client.eval(script, 1, key, token, ttlMs);
          return res === 1;
        } catch (err) {
          return false;
        }
      })
    );

    const extendedCount = results.filter(Boolean).length;
    this.logger.info('Redlock extension attempted', { taskId, extendedCount });
    return extendedCount >= quorum;
  }
}

let defaultRedlockManager = null;

function getRedlockManager(nodes = []) {
  if (!defaultRedlockManager || nodes.length > 0) {
    defaultRedlockManager = new RedlockManager(nodes);
  }
  return defaultRedlockManager;
}

async function acquireRedlock(taskId, ttlMs = 60000, nodes = []) {
  const manager = getRedlockManager(nodes);
  return manager.acquire(taskId, ttlMs);
}

async function releaseRedlock(taskId, token, nodes = []) {
  const manager = getRedlockManager(nodes);
  return manager.release(taskId, token);
}

async function extendRedlock(taskId, token, ttlMs = 60000, nodes = []) {
  const manager = getRedlockManager(nodes);
  return manager.extend(taskId, token, ttlMs);
}

module.exports = { acquireLock, releaseLock, extendLock, getRedisClient, RedlockManager, getRedlockManager, acquireRedlock, releaseRedlock, extendRedlock };
