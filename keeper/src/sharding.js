const crypto = require('crypto');

const DEFAULT_VIRTUAL_NODE_COUNT = 150;

function normalizeShardConfig(config = {}) {
  const shardCount = Number.isFinite(config.shardCount) && config.shardCount > 0
    ? config.shardCount
    : 1;
  const shardIndex = Number.isFinite(config.shardIndex) && config.shardIndex >= 0
    ? config.shardIndex
    : 0;

  return {
    shardCount,
    shardIndex: Math.min(shardIndex, Math.max(shardCount - 1, 0)),
    shardLabel: config.shardLabel || `shard-${Math.min(shardIndex, Math.max(shardCount - 1, 0))}`,
  };
}

function getTaskShard(taskId, shardCount) {
  if (!Number.isFinite(shardCount) || shardCount <= 1) {
    return 0;
  }
  const normalizedId = Math.abs(Number(taskId) || 0);
  return normalizedId % shardCount;
}

function isTaskOwnedByShard(taskId, shardConfig) {
  const normalized = normalizeShardConfig(shardConfig);
  return getTaskShard(taskId, normalized.shardCount) === normalized.shardIndex;
}

function filterTasksForShard(taskIds, shardConfig) {
  const normalized = normalizeShardConfig(shardConfig);
  const owned = [];
  const skipped = [];

  for (const taskId of taskIds || []) {
    if (isTaskOwnedByShard(taskId, normalized)) {
      owned.push(taskId);
    } else {
      skipped.push(taskId);
    }
  }

  return {
    ...normalized,
    ownedTaskIds: owned,
    skippedTaskIds: skipped,
  };
}

class ConsistentHashRing {
  constructor(options = {}) {
    this.nodes = new Set();
    this.ring = [];
    this.virtualNodeCount = Number.isFinite(options.virtualNodeCount)
      ? options.virtualNodeCount
      : DEFAULT_VIRTUAL_NODE_COUNT;
    this._dirty = false;
  }

  _hash(value) {
    const digest = crypto.createHash('sha256').update(String(value)).digest();
    return digest.readUInt32BE(0);
  }

  addNode(nodeId, vnodeCount) {
    if (!nodeId || this.nodes.has(nodeId)) return false;
    this.nodes.add(nodeId);
    const count = vnodeCount || this.virtualNodeCount;
    for (let i = 0; i < count; i++) {
      this.ring.push({ hash: this._hash(`${nodeId}:vnode:${i}`), nodeId });
    }
    this._dirty = true;
    return true;
  }

  removeNode(nodeId) {
    if (!nodeId || !this.nodes.has(nodeId)) return false;
    this.nodes.delete(nodeId);
    const before = this.ring.length;
    this.ring = this.ring.filter((e) => e.nodeId !== nodeId);
    return this.ring.length < before;
  }

  clear() {
    this.nodes.clear();
    this.ring = [];
    this._dirty = false;
  }

  _sort() {
    if (this._dirty && this.ring.length > 0) {
      this.ring.sort((a, b) => a.hash - b.hash);
      this._dirty = false;
    }
  }

  getNode(key) {
    if (this.ring.length === 0) return null;
    this._sort();
    const hash = this._hash(String(key));
    let lo = 0;
    let hi = this.ring.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ring[mid].hash < hash) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    if (this.ring[lo].hash < hash) return this.ring[0].nodeId;
    return this.ring[lo].nodeId;
  }

  getNodes() {
    return Array.from(this.nodes);
  }

  getNodeCount() {
    return this.nodes.size;
  }

  rebuildFromNodeIds(nodeIds) {
    this.clear();
    for (const nodeId of nodeIds) {
      this.nodes.add(nodeId);
      const count = this.virtualNodeCount;
      for (let i = 0; i < count; i++) {
        this.ring.push({ hash: this._hash(`${nodeId}:vnode:${i}`), nodeId });
      }
    }
    if (this.ring.length > 0) {
      this.ring.sort((a, b) => a.hash - b.hash);
    }
    this._dirty = false;
  }
}

function filterTasksByHashRing(taskIds, ring, selfNodeId) {
  const owned = [];
  const skipped = [];
  const owners = {};

  for (const taskId of taskIds || []) {
    const owner = ring.getNode(taskId);
    owners[String(taskId)] = owner;
    if (owner === selfNodeId) {
      owned.push(taskId);
    } else {
      skipped.push(taskId);
    }
  }

  const nodeCount = ring.getNodeCount();
  return {
    ownedTaskIds: owned,
    skippedTaskIds: skipped,
    owners,
    nodes: ring.getNodes(),
    nodeCount,
    shardIndex: 0,
    shardCount: Math.max(nodeCount, 1),
    shardLabel: selfNodeId ? `hashring:${selfNodeId}` : 'hashring:standalone',
  };
}

module.exports = {
  normalizeShardConfig,
  getTaskShard,
  isTaskOwnedByShard,
  filterTasksForShard,
  ConsistentHashRing,
  filterTasksByHashRing,
};
