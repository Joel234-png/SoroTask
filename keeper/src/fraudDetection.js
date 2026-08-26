const { EventEmitter } = require('events');
const { createLogger } = require('./logger');

const DEFAULT_RECENT_LIMIT = 250;
const DEFAULT_ALERT_QUEUE_LIMIT = 100;
const DEFAULT_ALERT_DEBOUNCE_MS = 10 * 60 * 1000;
const DEFAULT_BURST_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_FAILURE_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_ALERT_THRESHOLD = 4;
const DEFAULT_FEE_SPIKE_MULTIPLIER = 4;
const DEFAULT_MIN_FEE_SPIKE = 10;
const DEFAULT_DRAIN_MULTIPLIER = 3;
const DEFAULT_MIN_DRAIN_FEE = 50;
const DEFAULT_TASK_BURST_THRESHOLD = 5;
const DEFAULT_FAILURE_BURST_THRESHOLD = 3;
const DEFAULT_CROSS_TASK_THRESHOLD = 8;
const DEFAULT_CROSS_TASK_FEE_THRESHOLD = 100;
const DEFAULT_WEBHOOK_TIMEOUT_MS = 5000;
const DEFAULT_MAX_ALERT_ATTEMPTS = 3;

function parseInteger(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNonNegative(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function median(values) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function safeString(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}

class FraudDetectionService extends EventEmitter {
  constructor(options = {}) {
    super();

    this.logger = options.logger || createLogger('fraud-detection');
    this.metricsServer = options.metricsServer || null;
    this.historyManager = options.historyManager || null;
    this.clock = options.clock || { now: () => Date.now() };

    this.alertWebhookUrl =
      options.alertWebhookUrl ?? process.env.FRAUD_ALERT_WEBHOOK_URL ?? null;
    this.alertDebounceMs =
      options.alertDebounceMs ??
      parseInteger(process.env.FRAUD_ALERT_DEBOUNCE_MS, DEFAULT_ALERT_DEBOUNCE_MS);
    this.burstWindowMs =
      options.burstWindowMs ??
      parseInteger(process.env.FRAUD_BURST_WINDOW_MS, DEFAULT_BURST_WINDOW_MS);
    this.failureWindowMs =
      options.failureWindowMs ??
      parseInteger(process.env.FRAUD_FAILURE_WINDOW_MS, DEFAULT_FAILURE_WINDOW_MS);
    this.alertThreshold =
      options.alertThreshold ??
      parseInteger(process.env.FRAUD_ALERT_THRESHOLD, DEFAULT_ALERT_THRESHOLD);
    this.feeSpikeMultiplier =
      options.feeSpikeMultiplier ??
      Number(process.env.FRAUD_FEE_SPIKE_MULTIPLIER || DEFAULT_FEE_SPIKE_MULTIPLIER);
    this.minFeeSpike =
      options.minFeeSpike ??
      parseInteger(process.env.FRAUD_MIN_FEE_SPIKE, DEFAULT_MIN_FEE_SPIKE);
    this.drainMultiplier =
      options.drainMultiplier ??
      Number(process.env.FRAUD_DRAIN_MULTIPLIER || DEFAULT_DRAIN_MULTIPLIER);
    this.minDrainFee =
      options.minDrainFee ??
      parseInteger(process.env.FRAUD_MIN_DRAIN_FEE, DEFAULT_MIN_DRAIN_FEE);
    this.taskBurstThreshold =
      options.taskBurstThreshold ??
      parseInteger(process.env.FRAUD_TASK_BURST_THRESHOLD, DEFAULT_TASK_BURST_THRESHOLD);
    this.failureBurstThreshold =
      options.failureBurstThreshold ??
      parseInteger(process.env.FRAUD_FAILURE_BURST_THRESHOLD, DEFAULT_FAILURE_BURST_THRESHOLD);
    this.crossTaskThreshold =
      options.crossTaskThreshold ??
      parseInteger(process.env.FRAUD_CROSS_TASK_THRESHOLD, DEFAULT_CROSS_TASK_THRESHOLD);
    this.crossTaskFeeThreshold =
      options.crossTaskFeeThreshold ??
      parseInteger(process.env.FRAUD_CROSS_TASK_FEE_THRESHOLD, DEFAULT_CROSS_TASK_FEE_THRESHOLD);
    this.webhookTimeoutMs =
      options.webhookTimeoutMs ??
      parseInteger(process.env.FRAUD_ALERT_WEBHOOK_TIMEOUT_MS, DEFAULT_WEBHOOK_TIMEOUT_MS);
    this.maxAlertAttempts =
      options.maxAlertAttempts ??
      parseInteger(process.env.FRAUD_ALERT_MAX_ATTEMPTS, DEFAULT_MAX_ALERT_ATTEMPTS);
    this.recentLimit =
      options.recentLimit ??
      parseInteger(process.env.FRAUD_RECENT_LIMIT, DEFAULT_RECENT_LIMIT);
    this.alertQueueLimit =
      options.alertQueueLimit ??
      parseInteger(process.env.FRAUD_ALERT_QUEUE_LIMIT, DEFAULT_ALERT_QUEUE_LIMIT);

    this.recentObservations = [];
    this.pendingAlerts = [];
    this.alertHistory = [];
    this.pipelineErrors = [];
    this.lastAlertBySignature = new Map();
    this.dispatchPromise = null;

    this.stats = {
      observations: 0,
      alertsQueued: 0,
      alertsSent: 0,
      alertsSuppressed: 0,
      alertsFailed: 0,
      pipelineErrors: 0,
      lastRiskScore: 0,
      lastAlertAt: null,
      lastAlertReason: null,
    };
  }

  now() {
    try {
      const value = this.clock?.now ? this.clock.now() : Date.now();
      return Number.isFinite(value) ? value : Date.now();
    } catch (_) {
      return Date.now();
    }
  }

  observeExecution(observation = {}) {
    return this._recordObservation({
      ...observation,
      kind: observation.kind || 'execution',
      status: observation.status || 'SUCCESS',
    });
  }

  observeFailure(observation = {}) {
    return this._recordObservation({
      ...observation,
      kind: observation.kind || 'failure',
      status: observation.status || 'FAILED',
    });
  }

  getState() {
    const recentAlerts = this.alertHistory.slice(-10).reverse();
    const recentErrors = this.pipelineErrors.slice(-10).reverse();

    return {
      config: {
        alertWebhookEnabled: Boolean(this.alertWebhookUrl),
        alertDebounceMs: this.alertDebounceMs,
        burstWindowMs: this.burstWindowMs,
        failureWindowMs: this.failureWindowMs,
        alertThreshold: this.alertThreshold,
        feeSpikeMultiplier: this.feeSpikeMultiplier,
        minFeeSpike: this.minFeeSpike,
        drainMultiplier: this.drainMultiplier,
        minDrainFee: this.minDrainFee,
        taskBurstThreshold: this.taskBurstThreshold,
        failureBurstThreshold: this.failureBurstThreshold,
        crossTaskThreshold: this.crossTaskThreshold,
        crossTaskFeeThreshold: this.crossTaskFeeThreshold,
        webhookTimeoutMs: this.webhookTimeoutMs,
        maxAlertAttempts: this.maxAlertAttempts,
      },
      stats: { ...this.stats },
      pendingAlerts: this.pendingAlerts.length,
      recentObservations: this.recentObservations.length,
      recentAlerts,
      recentErrors,
    };
  }

  async flushPendingAlerts() {
    if (this.dispatchPromise) {
      return this.dispatchPromise;
    }

    this.dispatchPromise = this._flushPendingAlertsInternal();
    try {
      return await this.dispatchPromise;
    } finally {
      this.dispatchPromise = null;
    }
  }

  async _flushPendingAlertsInternal() {
    if (!this.pendingAlerts.length) {
      return;
    }

    while (this.pendingAlerts.length) {
      const now = this.now();
      const readyAlerts = [];
      const delayedAlerts = [];

      for (const alert of this.pendingAlerts) {
        if ((alert.nextAttemptAt || now) <= now) {
          readyAlerts.push(alert);
        } else {
          delayedAlerts.push(alert);
        }
      }

      this.pendingAlerts = delayedAlerts;

      if (!readyAlerts.length) {
        break;
      }

      for (const alert of readyAlerts) {
        try {
          await this._dispatchAlert(alert);
        } catch (error) {
          this._recordPipelineError(error, {
            stage: 'dispatch',
            alertKind: alert.kind,
            taskId: alert.taskId,
          });

          alert.attempts += 1;
          if (alert.attempts < this.maxAlertAttempts) {
            alert.nextAttemptAt = this.now() + this._retryDelay(alert.attempts);
            this.pendingAlerts.push(alert);
          } else {
            this.stats.alertsFailed += 1;
            if (this.metricsServer && typeof this.metricsServer.increment === 'function') {
              this.metricsServer.increment('fraudAlertsFailedTotal', 1);
            }
            this.emit('alert:failed', {
              alert,
              error: error.message || String(error),
            });
            this.logger.error('Fraud alert delivery failed', {
              taskId: alert.taskId,
              kind: alert.kind,
              error: error.message || String(error),
            });
          }
        }
      }
    }
  }

  _retryDelay(attempt) {
    return Math.min(this.alertDebounceMs, 1000 * Math.pow(2, Math.max(attempt - 1, 0)));
  }

  _recordObservation(input) {
    try {
      const observation = this._normalizeObservation(input);
      this._appendObservation(observation);
      this.stats.observations += 1;
      if (this.metricsServer && typeof this.metricsServer.increment === 'function') {
        this.metricsServer.increment('fraudObservationsTotal', 1);
      }

      const analysis = this._analyzeObservation(observation);
      this.stats.lastRiskScore = analysis.score;

      if (analysis.shouldAlert) {
        const alert = this._buildAlert(observation, analysis);
        this._queueAlert(alert);
        this.stats.lastAlertReason = alert.reason;
        this.stats.lastAlertAt = new Date(observation.timestamp).toISOString();
      }

      this._syncMetrics();
      if (analysis.shouldAlert || this.pendingAlerts.length > 0) {
        void this.flushPendingAlerts().catch((error) => {
          this._recordPipelineError(error, {
            stage: 'flush',
            taskId: observation.taskId,
          });
        });
      }

      return analysis;
    } catch (error) {
      this._recordPipelineError(error, {
        stage: 'observe',
        inputTaskId: input?.taskId,
      });
      return {
        score: 0,
        severity: 'none',
        shouldAlert: false,
        reasons: [],
        observation: null,
      };
    }
  }

  _normalizeObservation(input) {
    const now = this.now();
    const taskId = input?.taskId === undefined || input?.taskId === null
      ? null
      : String(input.taskId);
    const feePaid = clampNonNegative(Number(input?.feePaid ?? 0), 0);
    const timestamp = Number.isFinite(Number(input?.timestamp))
      ? Number(input.timestamp)
      : now;

    return {
      taskId,
      kind: input?.kind || 'execution',
      status: String(input?.status || 'SUCCESS').toUpperCase(),
      feePaid,
      timestamp,
      correlationId: safeString(input?.correlationId),
      attemptId: safeString(input?.attemptId),
      txHash: safeString(input?.txHash),
      errorCode: safeString(input?.errorCode),
      errorClassification: safeString(input?.errorClassification),
      metadata: input?.metadata && typeof input.metadata === 'object'
        ? this._sanitizeMetadata(input.metadata)
        : {},
    };
  }

  _sanitizeMetadata(metadata) {
    const allowed = {};
    const safeKeys = [
      'source',
      'actor',
      'route',
      'window',
      'severity',
      'keeper',
      'shardLabel',
    ];

    for (const key of safeKeys) {
      if (metadata[key] !== undefined && metadata[key] !== null) {
        allowed[key] = metadata[key];
      }
    }

    return allowed;
  }

  _appendObservation(observation) {
    this.recentObservations.push(observation);
    const cutoff = this.now() - Math.max(this.burstWindowMs, this.failureWindowMs);
    while (this.recentObservations.length > this.recentLimit) {
      this.recentObservations.shift();
    }
    while (this.recentObservations.length > 0 && this.recentObservations[0].timestamp < cutoff) {
      this.recentObservations.shift();
    }

  }

  _analyzeObservation(observation) {
    const now = observation.timestamp;
    const burstStart = now - this.burstWindowMs;
    const failureStart = now - this.failureWindowMs;

    const burstWindow = this.recentObservations.filter(
      (item) => item.timestamp >= burstStart,
    );
    const failureWindow = this.recentObservations.filter(
      (item) => item.timestamp >= failureStart,
    );

    const taskWindow = burstWindow.filter((item) => item.taskId === observation.taskId);
    const taskSuccessWindow = taskWindow.filter((item) => item.status === 'SUCCESS');
    const taskFailureWindow = failureWindow.filter((item) => item.taskId === observation.taskId && item.status !== 'SUCCESS');
    const taskFees = taskSuccessWindow.map((item) => item.feePaid).filter((value) => Number.isFinite(value));
    const currentTaskFees = taskWindow.map((item) => item.feePaid).filter((value) => Number.isFinite(value));
    const windowFees = burstWindow.map((item) => item.feePaid).filter((value) => Number.isFinite(value));
    const previousWindowStart = burstStart - this.burstWindowMs;
    const previousWindow = this.recentObservations.filter(
      (item) => item.timestamp >= previousWindowStart && item.timestamp < burstStart,
    );

    const previousWindowFees = previousWindow
      .map((item) => item.feePaid)
      .filter((value) => Number.isFinite(value));

    const distinctTaskIds = new Set(
      burstWindow
        .map((item) => item.taskId)
        .filter((value) => value !== null),
    );

    const reasons = [];
    let score = 0;
    let severity = 'low';

    if (taskWindow.length >= this.taskBurstThreshold) {
      score += 2;
      reasons.push('rapid_task_execution_burst');
    }

    if (taskFailureWindow.length >= this.failureBurstThreshold) {
      score += 2;
      reasons.push('failure_burst');
    }

    const medianTaskFee = median(taskFees.filter((value) => value > 0));
    if (
      observation.status === 'SUCCESS' &&
      observation.feePaid >= Math.max(this.minFeeSpike, medianTaskFee * this.feeSpikeMultiplier)
    ) {
      score += 2;
      reasons.push('fee_spike');
    }

    const currentWindowFee = windowFees.reduce((sum, value) => sum + value, 0);
    const previousWindowFee = previousWindowFees.reduce((sum, value) => sum + value, 0);
    if (
      currentWindowFee >= this.minDrainFee &&
      currentWindowFee >= Math.max(this.minDrainFee, previousWindowFee * this.drainMultiplier)
    ) {
      score += 3;
      reasons.push('rapid_fund_drain');
    }

    if (
      distinctTaskIds.size >= this.crossTaskThreshold &&
      currentWindowFee >= this.crossTaskFeeThreshold
    ) {
      score += 1;
      reasons.push('cross_task_velocity');
    }

    if (taskSuccessWindow.length >= 2 && median(currentTaskFees) > 0) {
      const risingFees = observation.feePaid >= median(currentTaskFees) * this.feeSpikeMultiplier;
      if (risingFees) {
        score += 1;
        reasons.push('fee_acceleration');
      }
    }

    if (score >= this.alertThreshold || reasons.includes('rapid_fund_drain')) {
      severity = score >= this.alertThreshold + 2 || reasons.includes('rapid_fund_drain')
        ? 'critical'
        : 'high';
    } else if (score >= Math.max(2, this.alertThreshold - 1)) {
      severity = 'medium';
    }

    return {
      score,
      severity,
      shouldAlert: score >= this.alertThreshold || reasons.includes('rapid_fund_drain'),
      reasons,
      window: {
        burstCount: burstWindow.length,
        taskBurstCount: taskWindow.length,
        failureBurstCount: taskFailureWindow.length,
        currentWindowFee,
        previousWindowFee,
        distinctTaskCount: distinctTaskIds.size,
      },
    };
  }

  _buildAlert(observation, analysis) {
    const signature = [
      observation.taskId || 'global',
      analysis.reasons.join('|'),
      Math.floor(observation.timestamp / this.alertDebounceMs),
    ].join(':');

    return {
      id: `${observation.taskId || 'global'}-${observation.timestamp}`,
      signature,
      kind: observation.kind,
      taskId: observation.taskId,
      status: observation.status,
      score: analysis.score,
      severity: analysis.severity,
      reason: analysis.reasons[0] || 'anomaly_detected',
      reasons: analysis.reasons,
      timestamp: new Date(observation.timestamp).toISOString(),
      correlationId: observation.correlationId,
      attemptId: observation.attemptId,
      txHash: observation.txHash,
      feePaid: observation.feePaid,
      window: analysis.window,
      metadata: observation.metadata,
    };
  }

  _queueAlert(alert) {
    const now = this.now();
    const lastAlertAt = this.lastAlertBySignature.get(alert.signature);
    if (lastAlertAt !== undefined && now - lastAlertAt < this.alertDebounceMs) {
      this.stats.alertsSuppressed += 1;
      if (this.metricsServer && typeof this.metricsServer.increment === 'function') {
        this.metricsServer.increment('fraudAlertsSuppressedTotal', 1);
      }
      this.logger.warn('Fraud alert suppressed by debounce window', {
        taskId: alert.taskId,
        severity: alert.severity,
        reason: alert.reason,
      });
      return { queued: false, suppressed: true };
    }

    if (this.pendingAlerts.length >= this.alertQueueLimit) {
      this.pendingAlerts.shift();
      this.logger.warn('Fraud alert queue trimmed due to capacity limit', {
        limit: this.alertQueueLimit,
      });
    }

    this.pendingAlerts.push({
      ...alert,
      attempts: 0,
      nextAttemptAt: now,
      queuedAt: new Date(now).toISOString(),
    });
    this.lastAlertBySignature.set(alert.signature, now);
    this.alertHistory.push({
      ...alert,
      queuedAt: new Date(now).toISOString(),
    });
    while (this.alertHistory.length > this.recentLimit) {
      this.alertHistory.shift();
    }
    this.stats.alertsQueued += 1;
    if (this.metricsServer && typeof this.metricsServer.increment === 'function') {
      this.metricsServer.increment('fraudAlertsQueuedTotal', 1);
    }
    if (this.historyManager && typeof this.historyManager.record === 'function') {
      this.historyManager.record({
        kind: 'fraud_alert',
        taskId: alert.taskId,
        status: alert.status,
        severity: alert.severity,
        reason: alert.reason,
        score: alert.score,
        correlationId: alert.correlationId,
        attemptId: alert.attemptId,
        txHash: alert.txHash,
      });
    }
    this.emit('alert:queued', alert);
    this._syncMetrics();
    return { queued: true, suppressed: false };
  }

  async _dispatchAlert(alert) {
    const payload = {
      source: 'keeper.fraud-detection',
      event: 'fraud_alert',
      ...alert,
    };

    if (!this.alertWebhookUrl) {
      this.logger.warn('Fraud alert generated without webhook target', {
        taskId: alert.taskId,
        severity: alert.severity,
        reason: alert.reason,
      });
      this.stats.alertsSent += 1;
      if (this.metricsServer && typeof this.metricsServer.increment === 'function') {
        this.metricsServer.increment('fraudAlertsSentTotal', 1);
      }
      this.emit('alert:local', payload);
      return { delivered: false, fallback: 'local' };
    }

    const controller = typeof AbortController !== 'undefined'
      ? new AbortController()
      : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(), this.webhookTimeoutMs)
      : null;

    try {
      const response = await globalThis.fetch(this.alertWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Keeper-Alert': 'fraud-detection',
        },
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined,
      });

      if (!response.ok) {
        throw new Error(`Fraud alert webhook returned ${response.status}`);
      }

      this.stats.alertsSent += 1;
      if (this.metricsServer && typeof this.metricsServer.increment === 'function') {
        this.metricsServer.increment('fraudAlertsSentTotal', 1);
      }
      this.stats.lastAlertAt = payload.timestamp;
      this.stats.lastAlertReason = alert.reason;
      this.emit('alert:sent', payload);
      this.logger.info('Fraud alert delivered', {
        taskId: alert.taskId,
        severity: alert.severity,
        reason: alert.reason,
      });
      this._syncMetrics();
      return { delivered: true };
    } catch (error) {
      this.emit('alert:error', {
        alert: payload,
        error: error.message || String(error),
      });
      throw error;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  _recordPipelineError(error, context = {}) {
    const entry = {
      timestamp: new Date(this.now()).toISOString(),
      message: error?.message || String(error),
      stage: context.stage || 'unknown',
      taskId: context.taskId ?? context.inputTaskId ?? null,
      alertKind: context.alertKind || null,
    };

    this.pipelineErrors.push(entry);
    while (this.pipelineErrors.length > this.recentLimit) {
      this.pipelineErrors.shift();
    }

    this.stats.pipelineErrors += 1;
    if (this.metricsServer && typeof this.metricsServer.increment === 'function') {
      this.metricsServer.increment('fraudPipelineErrorsTotal', 1);
    }

    this.logger.error('Fraud detection pipeline error', {
      stage: entry.stage,
      taskId: entry.taskId,
      error: entry.message,
    });
    if (this.historyManager && typeof this.historyManager.record === 'function') {
      this.historyManager.record({
        kind: 'fraud_error',
        taskId: entry.taskId,
        status: 'ERROR',
        stage: entry.stage,
        message: entry.message,
      });
    }
    this.emit('pipeline:error', entry);
    this._syncMetrics();
  }

  _syncMetrics() {
    if (!this.metricsServer) {
      return;
    }

    if (typeof this.metricsServer.updateFraudState === 'function') {
      this.metricsServer.updateFraudState({
        ...this.stats,
        pendingAlerts: this.pendingAlerts.length,
        recentObservations: this.recentObservations.length,
      });
    }

    if (typeof this.metricsServer.record === 'function') {
      this.metricsServer.record('fraudRiskScore', this.stats.lastRiskScore);
    }
  }
}

module.exports = { FraudDetectionService };
