const { rpc } = require('@stellar/stellar-sdk');
const { createLogger } = require('./logger');

const DEFAULT_WRAPPED_METHODS = [
  'getNetwork',
  'getLatestLedger',
  'getAccount',
  'simulateTransaction',
  'sendTransaction',
  'getTransaction',
  'getEvents',
  'getLedgerEntries',
  'getHealth',
];

function toInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeEndpoint(input, index) {
  if (!input || !String(input).trim()) {
    return null;
  }

  const url = String(input).trim();
  let region = `region-${index}`;
  try {
    const parsed = new URL(url);
    region = parsed.hostname;
  } catch (_err) {
    region = `region-${index}`;
  }

  return {
    index,
    url,
    region,
    score: 100,
    consecutiveFailures: 0,
    totalFailures: 0,
    totalSuccesses: 0,
    lastFailureAt: null,
    lastSuccessAt: null,
    cooldownUntil: null,
    unavailable: false,
    latencyMs: 0,
    latencySamples: [],
    avgLatencyMs: 0,
    errorRate: 0,
  };
}

function isEndpointReady(endpoint, now = Date.now()) {
  if (!endpoint.unavailable) {
    return true;
  }
  if (!endpoint.cooldownUntil) {
    return false;
  }
  return now >= endpoint.cooldownUntil;
}

class MultiRegionRPCClient {
  constructor(endpointUrls, options = {}) {
    const list = Array.isArray(endpointUrls) ? endpointUrls : [endpointUrls];
    this.endpoints = list
      .map((value, index) => normalizeEndpoint(value, index))
      .filter(Boolean);

    if (this.endpoints.length === 0) {
      throw new Error('At least one RPC endpoint is required for failover client');
    }

    this.logger = options.logger || createLogger('dr-failover');
    this.metrics = options.metrics || null;
    this.failureThreshold = toInt(options.failureThreshold, 3);
    this.cooldownMs = toInt(options.cooldownMs, 30000);
    this.healthCheckIntervalMs = toInt(options.healthCheckIntervalMs, 15000);
    this.healthCheckMethod = options.healthCheckMethod || 'getHealth';
    this.serverFactory = options.serverFactory || ((url) => new rpc.Server(url));
    this.servers = this.endpoints.map((entry) => this.serverFactory(entry.url));
    this.activeIndex = 0;
    this.healthTimer = null;
  }

  start() {
    if (this.healthTimer) {
      return;
    }

    this.healthTimer = setInterval(() => {
      this.runHealthCheck().catch((error) => {
        this.logger.warn('Background failover health check failed', {
          error: error.message,
        });
      });
    }, this.healthCheckIntervalMs);
  }

  stop() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  getActiveEndpoint() {
    return this.endpoints[this.activeIndex];
  }

  getStateSnapshot() {
    return {
      activeIndex: this.activeIndex,
      activeRegion: this.getActiveEndpoint().region,
      activeUrl: this.getActiveEndpoint().url,
      healthyEndpoints: this.endpoints.filter((endpoint) => !endpoint.unavailable).length,
      totalEndpoints: this.endpoints.length,
      endpoints: this.endpoints.map((endpoint) => ({
        index: endpoint.index,
        region: endpoint.region,
        url: endpoint.url,
        score: endpoint.score,
        unavailable: endpoint.unavailable,
        consecutiveFailures: endpoint.consecutiveFailures,
        lastFailureAt: endpoint.lastFailureAt,
        lastSuccessAt: endpoint.lastSuccessAt,
      })),
    };
  }

  getServerFacade() {
    const wrapped = {};

    DEFAULT_WRAPPED_METHODS.forEach((method) => {
      wrapped[method] = (...args) => this.execute(method, ...args);
    });

    return new Proxy(wrapped, {
      get: (target, prop) => {
        if (prop in target) {
          return target[prop];
        }

        if (prop === 'serverURL') {
          return this.servers[this.activeIndex].serverURL;
        }

        if (prop === 'getFailoverState') {
          return () => this.getStateSnapshot();
        }

        if (prop === 'getLatencyHeatmap') {
          return () => this.getLatencyHeatmap();
        }

        if (prop === 'getActiveRegion') {
          return () => this.getActiveEndpoint().region;
        }

        const activeServer = this.servers[this.activeIndex];
        const value = activeServer[prop];

        if (typeof value === 'function') {
          return value.bind(activeServer);
        }

        return value;
      },
    });
  }

  getLatencyHeatmap() {
    return this.endpoints.map((ep) => ({
      index: ep.index,
      region: ep.region,
      url: ep.url,
      avgLatencyMs: ep.avgLatencyMs,
      latestLatencyMs: ep.latencyMs,
      errorRatePercent: Math.round((ep.errorRate || 0) * 100) / 100,
      consecutiveFailures: ep.consecutiveFailures,
      score: ep.score,
      status: ep.unavailable ? 'DEGRADED' : ep.avgLatencyMs > 500 ? 'HIGH_LATENCY' : 'HEALTHY',
    }));
  }

  markSuccess(index, latencyMs = 0) {
    const endpoint = this.endpoints[index];
    endpoint.score = Math.min(100, endpoint.score + 5);
    endpoint.consecutiveFailures = 0;
    endpoint.unavailable = false;
    endpoint.cooldownUntil = null;
    endpoint.totalSuccesses += 1;
    endpoint.lastSuccessAt = new Date().toISOString();

    if (latencyMs > 0) {
      endpoint.latencySamples.push(latencyMs);
      if (endpoint.latencySamples.length > 20) {
        endpoint.latencySamples.shift();
      }
      endpoint.latencyMs = latencyMs;
      endpoint.avgLatencyMs = Math.round(
        endpoint.latencySamples.reduce((a, b) => a + b, 0) / endpoint.latencySamples.length,
      );
    }
    const totalCalls = endpoint.totalSuccesses + endpoint.totalFailures;
    endpoint.errorRate = totalCalls > 0 ? (endpoint.totalFailures / totalCalls) * 100 : 0;
  }

  markFailure(index, error) {
    const endpoint = this.endpoints[index];
    endpoint.consecutiveFailures += 1;
    endpoint.totalFailures += 1;
    endpoint.score = Math.max(0, endpoint.score - 30);
    endpoint.lastFailureAt = new Date().toISOString();

    const totalCalls = endpoint.totalSuccesses + endpoint.totalFailures;
    endpoint.errorRate = totalCalls > 0 ? (endpoint.totalFailures / totalCalls) * 100 : 0;

    if (endpoint.consecutiveFailures >= this.failureThreshold) {
      endpoint.unavailable = true;
      endpoint.cooldownUntil = Date.now() + this.cooldownMs;
      this.logger.warn('Endpoint marked unavailable due to repeated failures', {
        region: endpoint.region,
        url: endpoint.url,
        consecutiveFailures: endpoint.consecutiveFailures,
        error: error && error.message ? error.message : String(error),
      });
    }

    if (this.metrics) {
      this.metrics.increment('failoverEventsTotal', 1);
    }
  }

  maybeSwitchActiveEndpoint(nextIndex, reason) {
    if (nextIndex === this.activeIndex) {
      return;
    }

    const previous = this.endpoints[this.activeIndex];
    this.activeIndex = nextIndex;
    const current = this.endpoints[this.activeIndex];

    this.logger.warn('Switched active RPC endpoint', {
      fromRegion: previous.region,
      toRegion: current.region,
      reason,
    });

    if (this.metrics) {
      this.metrics.increment('failoverSwitchesTotal', 1);
    }
  }

  getCandidateIndexes() {
    const now = Date.now();
    const scored = this.endpoints
      .map((endpoint, index) => ({ endpoint, index }))
      .filter(({ endpoint }) => isEndpointReady(endpoint, now))
      .sort((left, right) => {
        if (right.endpoint.score !== left.endpoint.score) {
          return right.endpoint.score - left.endpoint.score;
        }
        if (left.endpoint.errorRate !== right.endpoint.errorRate) {
          return left.endpoint.errorRate - right.endpoint.errorRate;
        }
        return (left.endpoint.avgLatencyMs || 0) - (right.endpoint.avgLatencyMs || 0);
      });

    if (scored.length === 0) {
      return this.endpoints.map((_entry, index) => index);
    }

    const indexes = scored.map((entry) => entry.index);
    const activePos = indexes.indexOf(this.activeIndex);
    if (activePos > 0) {
      indexes.splice(activePos, 1);
      indexes.unshift(this.activeIndex);
    }
    return indexes;
  }

  async execute(method, ...args) {
    const candidates = this.getCandidateIndexes();
    const errors = [];

    for (let position = 0; position < candidates.length; position += 1) {
      const index = candidates[position];
      const endpoint = this.endpoints[index];
      const server = this.servers[index];
      const fn = server && server[method];

      if (typeof fn !== 'function') {
        continue;
      }

      try {
        const start = Date.now();
        const result = await fn.apply(server, args);
        const latencyMs = Date.now() - start;
        this.markSuccess(index, latencyMs);

        if (position > 0) {
          this.maybeSwitchActiveEndpoint(index, 'failover_success');
        }

        return result;
      } catch (error) {
        errors.push({
          region: endpoint.region,
          url: endpoint.url,
          message: error && error.message ? error.message : String(error),
        });
        this.markFailure(index, error);
      }
    }

    const error = new Error(
      `All RPC endpoints failed for method "${method}". Last error: ${errors[errors.length - 1] ? errors[errors.length - 1].message : 'unknown'}`,
    );
    error.code = 'RPC_MULTI_REGION_FAILOVER_EXHAUSTED';
    error.context = {
      method,
      attempts: errors,
      activeRegion: this.getActiveEndpoint().region,
    };

    throw error;
  }

  async runHealthCheck() {
    const checks = this.endpoints.map(async (_entry, index) => {
      const server = this.servers[index];
      const endpoint = this.endpoints[index];
      const fn = server && server[this.healthCheckMethod];

      if (typeof fn !== 'function') {
        return;
      }

      try {
        const start = Date.now();
        await fn.apply(server, []);
        const latencyMs = Date.now() - start;
        this.markSuccess(index, latencyMs);
      } catch (error) {
        this.markFailure(index, error);
      }

      if (!endpoint.unavailable && endpoint.score >= 80 && index !== this.activeIndex) {
        const active = this.endpoints[this.activeIndex];
        if (active.unavailable || active.score < endpoint.score) {
          this.maybeSwitchActiveEndpoint(index, 'health_check_rebalance');
        }
      }
    });

    await Promise.allSettled(checks);

    if (this.metrics && typeof this.metrics.updateFailoverState === 'function') {
      this.metrics.updateFailoverState(this.getStateSnapshot());
    }
  }
}

module.exports = {
  MultiRegionRPCClient,
};