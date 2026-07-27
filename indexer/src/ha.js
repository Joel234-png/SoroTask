const EventEmitter = require('events');

const ROLES = Object.freeze({
  PRIMARY: 'PRIMARY',
  STANDBY: 'STANDBY',
});

class HighAvailabilityManager extends EventEmitter {
  constructor(db, options = {}) {
    super();
    this.db = db;
    this.nodeId = options.nodeId || `node-${process.pid}-${Math.random().toString(36).substring(2, 7)}`;
    this.role = options.role === ROLES.PRIMARY ? ROLES.PRIMARY : ROLES.STANDBY;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 3000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs || 10000;
    this.isLeader = this.role === ROLES.PRIMARY;
    this.heartbeatTimer = null;
    this.failoverTimer = null;
    this.isRunning = false;
  }

  async initialize() {
    await this.runSql(`
      CREATE TABLE IF NOT EXISTS cluster_nodes (
        node_id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        last_heartbeat INTEGER NOT NULL,
        metadata_json TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.registerNode();
  }

  async registerNode() {
    const now = Date.now();
    await this.runSql(
      `INSERT OR REPLACE INTO cluster_nodes (node_id, role, last_heartbeat, metadata_json, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [this.nodeId, this.role, now, JSON.stringify({ startedAt: new Date().toISOString() })]
    );
  }

  async sendHeartbeat() {
    const now = Date.now();
    await this.runSql(
      `UPDATE cluster_nodes
       SET role = ?, last_heartbeat = ?, updated_at = CURRENT_TIMESTAMP
       WHERE node_id = ?`,
      [this.role, now, this.nodeId]
    );
    this.emit('heartbeat', { nodeId: this.nodeId, role: this.role, timestamp: now });
  }

  async checkFailover() {
    if (this.isLeader) {
      return;
    }

    const now = Date.now();
    const cutoff = now - this.heartbeatTimeoutMs;

    const activePrimaries = await this.allSql(
      `SELECT * FROM cluster_nodes WHERE role = ? AND last_heartbeat > ? AND node_id != ?`,
      [ROLES.PRIMARY, cutoff, this.nodeId]
    );

    if (activePrimaries.length === 0) {
      console.log(`[HA] Primary node failed or unreachable. Standby node ${this.nodeId} promoting to PRIMARY.`);
      await this.promote();
    }
  }

  async promote() {
    const previousRole = this.role;
    this.role = ROLES.PRIMARY;
    this.isLeader = true;
    const now = Date.now();

    await this.runSql(
      `UPDATE cluster_nodes
       SET role = ?, last_heartbeat = ?, updated_at = CURRENT_TIMESTAMP
       WHERE node_id = ?`,
      [ROLES.PRIMARY, now, this.nodeId]
    );

    this.emit('roleChange', {
      nodeId: this.nodeId,
      previousRole,
      newRole: ROLES.PRIMARY,
      isLeader: true,
      promotedAt: now,
    });
  }

  async demote() {
    const previousRole = this.role;
    this.role = ROLES.STANDBY;
    this.isLeader = false;
    const now = Date.now();

    await this.runSql(
      `UPDATE cluster_nodes
       SET role = ?, last_heartbeat = ?, updated_at = CURRENT_TIMESTAMP
       WHERE node_id = ?`,
      [ROLES.STANDBY, now, this.nodeId]
    );

    this.emit('roleChange', {
      nodeId: this.nodeId,
      previousRole,
      newRole: ROLES.STANDBY,
      isLeader: false,
      demotedAt: now,
    });
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    this.sendHeartbeat().catch((err) => console.error('[HA] Error sending heartbeat:', err));

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat().catch((err) => console.error('[HA] Error sending heartbeat:', err));
    }, this.heartbeatIntervalMs);

    this.failoverTimer = setInterval(() => {
      this.checkFailover().catch((err) => console.error('[HA] Error checking failover:', err));
    }, this.heartbeatIntervalMs);
  }

  stop() {
    this.isRunning = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.failoverTimer) clearInterval(this.failoverTimer);
    this.heartbeatTimer = null;
    this.failoverTimer = null;
  }

  async getClusterNodes() {
    return this.allSql(`SELECT * FROM cluster_nodes ORDER BY last_heartbeat DESC`);
  }

  runSql(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }

  allSql(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }
}

module.exports = {
  ROLES,
  HighAvailabilityManager,
};
