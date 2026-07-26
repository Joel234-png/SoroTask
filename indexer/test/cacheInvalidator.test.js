const assert = require('node:assert/strict');
const test = require('node:test');
const { CacheInvalidationEngine } = require('../src/cacheInvalidator');

test('CacheInvalidationEngine - cache set, get, and latency', () => {
  const engine = new CacheInvalidationEngine();
  engine.set('task:1', { task_id: 1, creator: 'G_ALICE' });

  const val = engine.get('task:1');
  assert.deepEqual(val, { task_id: 1, creator: 'G_ALICE' });

  engine.clear();
});

test('CacheInvalidationEngine - event-driven cache invalidation', () => {
  const engine = new CacheInvalidationEngine();
  engine.set('task:42', { task_id: 42 });
  engine.set('creator:G_ALICE', [{ task_id: 42 }]);
  engine.set('tasks:all', [{ task_id: 42 }]);

  const purged = engine.invalidateForEvent('TaskRegistered', 42, { creator: 'G_ALICE' });

  assert.equal(engine.get('task:42'), null);
  assert.equal(engine.get('creator:G_ALICE'), null);
  assert.equal(engine.get('tasks:all'), null);
  assert.ok(purged.includes('task:42'));
  assert.ok(purged.includes('creator:G_ALICE'));
});

test('CacheInvalidationEngine - pub/sub event broadcasting and remote invalidation', () => {
  let publishedMessage = null;
  const mockRedis = {
    publish(channel, message) {
      publishedMessage = message;
    },
    subscribe(channel, cb) {
      this.cb = cb;
    },
  };

  const engine = new CacheInvalidationEngine({ redisClient: mockRedis });
  engine.set('task:99', { task_id: 99 });

  engine.invalidateKeys(['task:99']);
  assert.ok(publishedMessage != null);

  // Simulate remote instance receiving message
  const remoteEngine = new CacheInvalidationEngine();
  remoteEngine.set('task:99', { task_id: 99 });
  remoteEngine.handlePubSubMessage(publishedMessage);

  assert.equal(remoteEngine.get('task:99'), null);
});
