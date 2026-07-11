const EventEmitter = require("events");
const { createRateLimiter } = require("./concurrency");
const { createLogger } = require("./logger");
const { acquireLock, releaseLock } = require("./lock");
const { RetryScheduler } = require("./retryScheduler");


const DEFAULT_CONCURRENCY = 3;
const DEFAULT_WRITES_PER_SECOND = 5;
const DEFAULT_PRIORITY = 0;
const PRIORITY_LABELS = {
  low: -1,
  medium: 0,
  high: 1,
  critical: 2,
};

function normalizePriority(priority) {
  if (typeof priority === 'string') {
    const normalized = priority.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(PRIORITY_LABELS, normalized)) {
      return PRIORITY_LABELS[normalized];
    }
    const parsed = Number(priority);
    return Number.isFinite(parsed) ? parsed : DEFAULT_PRIORITY;
  }

  if (typeof priority === 'number' && Number.isFinite(priority)) {
    return priority;
  }

  return DEFAULT_PRIORITY;
}

function getMicrosecondTimestamp() {
  return Number(process.hrtime.bigint() / 1000n);
}

function defaultTaskComparator(a, b) {
  if (a.priority !== b.priority) {
    return b.priority - a.priority;
  }

  if (a.dueAt !== b.dueAt) {
    return a.dueAt - b.dueAt;
  }

  if (a.queuedAt !== b.queuedAt) {
    return a.queuedAt < b.queuedAt ? -1 : 1;
  }

  return 0;
}

function buildTaskItem(task) {
  if (typeof task === 'object' && task !== null) {
    return {
      taskId: task.taskId,
      context: task.context || {},
      priority: normalizePriority(task.priority),
      dueAt: typeof task.dueAt === 'number' ? task.dueAt : Date.now(),
      queuedAt: getMicrosecondTimestamp(),
      payload: task.payload || null,
      meta: task.meta || {},
      dueLedger: task.dueLedger,
      originalTask: task,
    };
  }

  return {
    taskId: task,
    context: {},
    priority: DEFAULT_PRIORITY,
    dueAt: Date.now(),
    queuedAt: getMicrosecondTimestamp(),
    payload: null,
    meta: {},
    dueLedger: undefined,
    originalTask: task,
  };
}

class ExecutionQueue extends EventEmitter {
  constructor(limit, metricsServer, arg = {}, options = {}) {
    super();

    // Support legacy signature: (limit, metricsServer, retryScheduler)
    const isLegacy = arg && typeof arg.scheduleRetry === 'function';
    const opts = isLegacy ? options : arg;

    this.logger = opts.logger || createLogger('queue');
    this.metricsServer = metricsServer;
    
    this.idempotencyGuard = opts.idempotencyGuard || null;
    this.retryScheduler = isLegacy ? arg : (opts.retryScheduler || new RetryScheduler(opts.retryScheduler));

    this.concurrencyLimit = parseInt(
      limit || process.env.MAX_CONCURRENT_EXECUTIONS || DEFAULT_CONCURRENCY,
      10,
    );

    const mwps = opts.maxWritesPerSecond || process.env.MAX_WRITES_PER_SECOND || DEFAULT_WRITES_PER_SECOND;
    this.maxWritesPerSecond = parseInt(mwps, 10);

    this.limit = createRateLimiter({
      concurrency: this.concurrencyLimit,
      rps: this.maxWritesPerSecond,
      logger: this.logger,
      name: 'execution-writes',
      onThrottle: (event) => {
        if (this.metricsServer) {
          this.metricsServer.increment('throttledRequestsTotal', { name: event.name });
        }
      },
      compare: opts.taskComparator || defaultTaskComparator,
    });

    this.distributedLockEnabled = opts.distributedLockEnabled !== false;

    this.depth = 0;
    this.inFlight = 0;
    this.completed = 0;
    this.failedCount = 0;

    this.activePromises = [];
    this.failedTasks = new Set();
    this.retryTaskIds = new Set();
    this.shuttingDown = false;
    this.taskDueInfo = new Map();
  }

  async initialize() {
    if (this.retryScheduler && typeof this.retryScheduler.initialize === 'function') {
      await this.retryScheduler.initialize();
    }
  }

  getReadyRetries(limit = parseInt(process.env.MAX_RETRIES_PER_CYCLE || '2', 10)) {
    if (!this.retryScheduler || typeof this.retryScheduler.getReadyRetries !== 'function') {
      return [];
    }

    const ready = this.retryScheduler.getReadyRetries();
    const limited = ready.slice(0, Math.max(limit, 0));
    limited.forEach((retry) => this.retryTaskIds.add(retry.taskId));
    return limited;
  }

  _shouldSkipTask(taskId) {
    if (this.failedTasks.has(taskId) || this.retryTaskIds.has(taskId)) {
      return true;
    }

    if (this.retryScheduler && typeof this.retryScheduler.getRetryMetadata === 'function') {
      return !!this.retryScheduler.getRetryMetadata(taskId);
    }

    return false;
  }

  _updateRetryQueueSize() {
    if (this.metricsServer) {
      const stats = this.retryScheduler.getStatistics();
      this.metricsServer.setRetryQueueSize(stats.total);
    }
  }

  _buildTaskMeta(taskItem) {
    return {
      priority: taskItem.priority,
      dueAt: taskItem.dueAt,
      queuedAt: taskItem.queuedAt,
      taskId: taskItem.taskId,
    };
  }

  async enqueue(tasksToEnqueue, executorFn, taskConfigMap = {}) {
    if (this.shuttingDown) {
      this.logger.warn('Queue is shutting down, rejecting new execution batch', {
        taskCount: Array.isArray(tasksToEnqueue) ? tasksToEnqueue.length : 0,
      });
      return;
    }

    const taskItems = (tasksToEnqueue || [])
      .map(buildTaskItem)
      .filter((taskItem) => taskItem.taskId !== undefined && !this._shouldSkipTask(taskItem.taskId))
      .sort((a, b) => b.priority - a.priority);

    this.depth = taskItems.length;

    if (this.metricsServer) {
      this.metricsServer.increment('tasksDueTotal', taskItems.length);
    }

    const cycleStartTime = Date.now();
    const cyclePromises = taskItems.map((taskItem) => {
      return this.limit(async () => {
        if (this.shuttingDown) {
          return;
        }

        const taskId = taskItem.taskId;
        const initialContext = taskItem.context || {};
        let attemptContext = { ...initialContext };
        let distributedLockToken = null;

        if (this.idempotencyGuard) {
          const lockResult = this.idempotencyGuard.acquire(taskId);
          attemptContext.attemptId = lockResult.attemptId;

          if (!lockResult.acquired) {
            if (this.metricsServer) {
              this.metricsServer.increment('tasksSkippedIdempotencyTotal', 1);
            }
            this.emit('task:skipped', taskId, {
              reason: 'idempotency_lock',
              attemptId: lockResult.attemptId,
              pollCorrelationId: attemptContext.pollCorrelationId,
            });
            return;
          }
        }

        this.inFlight++;
        this.depth = Math.max(this.depth - 1, 0);

        const hasContext = Object.keys(attemptContext).length > 0;
        this.emitTaskEvent('task:started', taskId, hasContext ? attemptContext : null);

        const _taskConfig = taskConfigMap[taskId] || null;

        // Store due ledger for SLO tracking
        if (taskItem.dueLedger !== undefined) {
          this.taskDueInfo.set(taskId, taskItem.dueLedger);
        }

        try {
          if (this.distributedLockEnabled) {
            const lockTtl = parseInt(process.env.LOCK_TTL_MS || '60000', 10);
            distributedLockToken = await acquireLock(taskId, lockTtl);
            if (!distributedLockToken) {
              this.logger.info('Skipping task due to distributed lock contention', { taskId });
              this.emit('task:skipped', taskId, { reason: 'distributed_lock' });
              return;
            }
          }

          const result = await executorFn(taskId, attemptContext);

          this.completed++;

          if (this.retryScheduler && typeof this.retryScheduler.completeRetry === 'function') {
            await this.retryScheduler.completeRetry(taskId, true);
          }
          this._updateRetryQueueSize();

          if (this.metricsServer) {
            this.metricsServer.increment('tasksExecutedTotal', 1);

            // Record execution lateness if due info available
            const dueLedger = this.taskDueInfo.get(taskId);
            if (dueLedger !== undefined && result) {
              const execLedger = result.ledger !== undefined ? result.ledger : (result.executionLedger ?? null);
              if (execLedger !== null) {
                this.metricsServer.recordTaskExecution({
                  taskId,
                  actualExecutionLedger: execLedger,
                  scheduledDueLedger: dueLedger,
                  success: true,
                });
              }
            }
            // Clean up due info after processing
            this.taskDueInfo.delete(taskId);
          } else {
            // Clean up due info after processing
            this.taskDueInfo.delete(taskId);
          }

          if (this.idempotencyGuard) {
            this.idempotencyGuard.markCompleted(taskId, {
              attemptId: attemptContext.attemptId,
            });
          }

          this.emitTaskEvent('task:success', taskId, attemptContext);
        } catch (error) {
          this.failedCount++;
          this.failedTasks.add(taskId);

          const retryMetadata = (this.retryScheduler && typeof this.retryScheduler.getRetryMetadata === 'function')
            ? this.retryScheduler.getRetryMetadata(taskId)
            : null;
          const currentAttempt = retryMetadata?.currentAttempt || 0;

          let scheduleResult = null;
          if (this.retryScheduler && typeof this.retryScheduler.scheduleRetry === 'function') {
            scheduleResult = await this.retryScheduler.scheduleRetry({
              taskId,
              error,
              currentAttempt,
              taskConfig: _taskConfig,
            });
          }

          if (this.metricsServer) {
            this.metricsServer.increment('tasksFailedTotal', 1);
            if (scheduleResult && scheduleResult.scheduled && scheduleResult.nextAttemptTime) {
              const delayMs = scheduleResult.nextAttemptTime - Date.now();
              this.metricsServer.recordRetryDelay(delayMs);
            }
            this._updateRetryQueueSize();
          }

          // If retry not scheduled (max retries exceeded), clean up due info
          if (scheduleResult && !scheduleResult.scheduled) {
            this.taskDueInfo.delete(taskId);
          }

          if (this.idempotencyGuard) {
            this.idempotencyGuard.markFailed(taskId, {
              attemptId: attemptContext.attemptId,
              lastError: error.message || String(error),
            });
          }
          
          this.emit('task:failed', taskId, error, attemptContext);
        } finally {
          if (distributedLockToken) {
            try {
              await releaseLock(taskId, distributedLockToken);
            } catch (err) {
              this.logger.error('Error releasing lock', { taskId, error: err.message });
            }
          }
          this.inFlight--;
        }
      }, this._buildTaskMeta(taskItem));
    });

    this.activePromises.push(...cyclePromises);

    try {
      await Promise.all(cyclePromises);
    } catch (error) {
      this.logger.debug('Execution cycle completed with some task-level failures', {
        error: error.message,
      });
    } finally {
      const cycleDuration = Date.now() - cycleStartTime;
      if (this.metricsServer && typeof this.metricsServer.record === 'function') {
        this.metricsServer.record('lastCycleDurationMs', cycleDuration);
      }

      this.emit('cycle:complete', {
        depth: this.depth,
        inFlight: this.inFlight,
        completed: this.completed,
        failed: this.failedCount,
      });

      this.activePromises = [];
      this.completed = 0;
      this.failedCount = 0;
      this.retryTaskIds.clear();
      this.failedTasks.clear();
    }
  }

  async enqueueRetries(retryTasks, executorFn, taskConfigMap = {}) {
    if (this.shuttingDown) {
      this.logger.warn('Queue is shutting down, rejecting retry execution batch', {
        taskCount: Array.isArray(retryTasks) ? retryTasks.length : 0,
      });
      return;
    }

    if (!Array.isArray(retryTasks) || retryTasks.length === 0) {
      return;
    }

    this.failedTasks.clear();

    const retryItems = retryTasks
      .filter((task) => task && task.taskId !== undefined)
      .map((task) => ({
        taskId: task.taskId,
        context: task.context || {},
        priority: normalizePriority(task.priority ?? 'high'),
        dueAt: typeof task.nextAttemptTime === 'number' ? task.nextAttemptTime : Date.now(),
        queuedAt: getMicrosecondTimestamp(),
        dueLedger: task.dueLedger,
        retryMetadata: task,
      }))
      .filter((taskItem) => !this._shouldSkipTask(taskItem.taskId))
      .sort((a, b) => b.priority - a.priority);

    this.depth = retryItems.length;

    if (this.metricsServer) {
      this.metricsServer.increment('tasksRetriedTotal', retryItems.length);
    }

    const cycleStartTime = Date.now();
    const cyclePromises = retryItems.map((taskItem) => {
      return this.limit(async () => {
        if (this.shuttingDown) {
          return;
        }

        const taskId = taskItem.taskId;
        const initialContext = taskItem.context || {};
        let attemptContext = { ...initialContext };
        let distributedLockToken = null;

        this.retryTaskIds.add(taskId);
        this.emit('retry:started', taskId, taskItem.retryMetadata);

        if (this.idempotencyGuard) {
          const lockResult = this.idempotencyGuard.acquire(taskId);
          attemptContext.attemptId = lockResult.attemptId;

          if (!lockResult.acquired) {
            if (this.metricsServer) {
              this.metricsServer.increment('tasksSkippedIdempotencyTotal', 1);
            }
            this.emit('task:skipped', taskId, {
              reason: 'idempotency_lock',
              attemptId: lockResult.attemptId,
            });
            return;
          }
        }

        this.inFlight++;
        this.depth = Math.max(this.depth - 1, 0);

        this.emit('task:started', taskId, attemptContext);

        const _taskConfig = taskConfigMap[taskId] || null;

        // Store due ledger for SLO tracking
        if (taskItem.dueLedger !== undefined) {
          this.taskDueInfo.set(taskId, taskItem.dueLedger);
        }

        try {
          if (this.distributedLockEnabled) {
            const lockTtl = parseInt(process.env.LOCK_TTL_MS || '60000', 10);
            distributedLockToken = await acquireLock(taskId, lockTtl);
            if (!distributedLockToken) {
              this.logger.info('Skipping retry task due to distributed lock contention', { taskId });
              this.emit('task:skipped', taskId, { reason: 'distributed_lock' });
              return;
            }
          }

          const result = await executorFn(taskId, attemptContext);

          this.completed++;

          if (this.retryScheduler && typeof this.retryScheduler.completeRetry === 'function') {
            await this.retryScheduler.completeRetry(taskId, true);
          }
          this._updateRetryQueueSize();

          if (this.metricsServer) {
            this.metricsServer.increment('tasksExecutedTotal', 1);
            this.metricsServer.increment('retriesExecutedTotal', 1);
            this.metricsServer.recordRetryAttempt('success');

            const dueLedger = this.taskDueInfo.get(taskId);
            if (dueLedger !== undefined && result) {
              const execLedger = result.ledger !== undefined ? result.ledger : (result.executionLedger ?? null);
              if (execLedger !== null) {
                this.metricsServer.recordTaskExecution({
                  taskId,
                  actualExecutionLedger: execLedger,
                  scheduledDueLedger: dueLedger,
                  success: true,
                });
              }
            }
            this.taskDueInfo.delete(taskId);
          } else {
            this.taskDueInfo.delete(taskId);
          }

          this.emit('retry:success', taskId, taskItem.retryMetadata);
        } catch (error) {
          this.failedCount++;
          this.failedTasks.add(taskId);

          let completeResult = {};
          if (this.retryScheduler && typeof this.retryScheduler.completeRetry === 'function') {
            completeResult = await this.retryScheduler.completeRetry(taskId, false);
          }
          this._updateRetryQueueSize();

          if (this.metricsServer) {
            this.metricsServer.increment('tasksFailedTotal', 1);
            this.metricsServer.increment('retriesFailedTotal', 1);
            this.metricsServer.recordRetryAttempt('failure');
          }

          if (completeResult && completeResult.removed) {
            this.taskDueInfo.delete(taskId);
          }

          this.emit('retry:failed', taskId, error, taskItem.retryMetadata, attemptContext);
        } finally {
          if (distributedLockToken) {
            try {
              await releaseLock(taskId, distributedLockToken);
            } catch (err) {
              this.logger.error('Error releasing lock', { taskId, error: err.message });
            }
          }
          this.inFlight--;
          this.retryTaskIds.delete(taskId);
        }
      }, this._buildTaskMeta(taskItem));
    });

    this.activePromises.push(...cyclePromises);

    try {
      await Promise.all(cyclePromises);
    } catch (error) {
      this.logger.debug('Retry cycle completed with some task-level failures', {
        error: error.message,
      });
    } finally {
      const cycleDuration = Date.now() - cycleStartTime;
      if (this.metricsServer && typeof this.metricsServer.record === 'function') {
        this.metricsServer.record('lastCycleDurationMs', cycleDuration);
      }

      this.emit('retry:cycle:complete', {
        depth: this.depth,
        inFlight: this.inFlight,
        completed: this.completed,
        failed: this.failedCount,
      });

      this.activePromises = this.activePromises.filter(
        (promise) => !cyclePromises.includes(promise),
      );
      this.completed = 0;
      this.failedCount = 0;
    }
  }

  emitTaskEvent(eventName, taskId, context) {
    if (context) {
      this.emit(eventName, taskId, context);
      return;
    }
    this.emit(eventName, taskId);
  }

  async drain(options = {}) {
    return this.gracefulShutdown(options);
  }

  async gracefulShutdown(options = {}) {
    const drainTimeoutMs = parseInt(
      options.drainTimeoutMs || process.env.SHUTDOWN_DRAIN_TIMEOUT_MS || 30000,
      10
    );
    const onProgress = options.onProgress || (() => {});

    const startTime = Date.now();
    const initialInFlight = this.inFlight;

    this.logger.info('Starting graceful queue shutdown', {
      drainTimeoutMs,
      inFlightTasks: initialInFlight,
      queuedTasks: this.depth,
    });

    this.shuttingDown = true;
    this.limit.clearQueue();
    this.depth = 0;

    onProgress({ phase: 'clearing-queue', remaining: this.inFlight });

    const drained = await Promise.race([
      (async () => {
        if (this.activePromises.length > 0) {
          await Promise.allSettled(this.activePromises);
        }
        while (this.inFlight > 0) {
          await new Promise((r) => setTimeout(r, 50));
          onProgress({ phase: 'draining', remaining: this.inFlight });
        }
        return true;
      })(),
      new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          this.logger.warn('Graceful shutdown drain timeout', {
            remainingInFlight: this.inFlight,
            durationMs: Date.now() - startTime,
          });
          resolve(false);
        }, drainTimeoutMs);

        this.once('drain:complete', () => clearTimeout(timeoutId));
      }),
    ]);

    const durationMs = Date.now() - startTime;
    const summary = {
      drained,
      initialInFlight,
      remaining: this.inFlight,
      durationMs,
      completedCount: this.completed,
      failedCount: this.failedCount,
    };

    if (drained) {
      this.logger.info('Queue gracefully drained', summary);
    } else {
      this.logger.warn('Queue drain timeout, forcing shutdown', summary);
    }

    this.emit('drain:complete', summary);
    return summary;
  }

  getInFlightStatus() {
    return {
      inFlight: this.inFlight,
      activePromises: this.activePromises.length,
      depth: this.depth,
      completed: this.completed,
      failed: this.failedCount,
      failedTaskIds: Array.from(this.failedTasks),
      queueDepth: this.limit?.getStats?.().queueDepth || 0,
    };
  }

  async shutdown() {
    this.shuttingDown = true;
    this.logger.info('Shutting down execution queue');

    await this.gracefulShutdown();

    if (this.retryScheduler && typeof this.retryScheduler.shutdown === 'function') {
      await this.retryScheduler.shutdown();
    }

    this.logger.info('Execution queue shutdown complete');
  }

  getRetryStatistics() {
    return (this.retryScheduler && typeof this.retryScheduler.getStatistics === 'function')
      ? this.retryScheduler.getStatistics()
      : { total: 0, pending: 0, overdue: 0 };
  }
}

module.exports = { ExecutionQueue };
