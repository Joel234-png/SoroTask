const { FraudDetectionService } = require('../src/fraudDetection');

jest.mock('../src/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
  }),
}));

describe('FraudDetectionService', () => {
  let clock;
  let metricsServer;
  let historyManager;
  let currentTime;

  beforeEach(() => {
    currentTime = 0;
    clock = {
      now: jest.fn(() => currentTime),
      set: (value) => {
        currentTime = value;
      },
    };
    metricsServer = {
      increment: jest.fn(),
      updateFraudState: jest.fn(),
      record: jest.fn(),
    };
    historyManager = {
      record: jest.fn(),
      getDriftSnapshot: jest.fn().mockReturnValue([]),
    };
    global.fetch = undefined;
  });

  afterEach(() => {
    delete global.fetch;
  });

  function createService(options = {}) {
    return new FraudDetectionService({
      clock,
      metricsServer,
      historyManager,
      ...options,
    });
  }

  it('records a normal execution without raising an alert', async () => {
    const service = createService();

    const result = service.observeExecution({
      taskId: 1,
      feePaid: 5,
      status: 'SUCCESS',
    });

    await service.flushPendingAlerts();

    expect(result.score).toBe(0);
    expect(result.shouldAlert).toBe(false);
    expect(metricsServer.increment).toHaveBeenCalledWith('fraudObservationsTotal', 1);
    expect(historyManager.record).not.toHaveBeenCalled();
  });

  it('detects a rapid fund drain pattern and emits a local alert', async () => {
    const service = createService({
      alertThreshold: 4,
      minDrainFee: 50,
      drainMultiplier: 2,
      burstWindowMs: 300000,
      failureWindowMs: 300000,
      taskBurstThreshold: 10,
      failureBurstThreshold: 10,
      crossTaskThreshold: 99,
    });

    clock.set(0);
    service.observeExecution({ taskId: 1, feePaid: 10, status: 'SUCCESS' });
    clock.set(1000);
    service.observeExecution({ taskId: 2, feePaid: 10, status: 'SUCCESS' });

    clock.set(360000);
    const result = service.observeExecution({ taskId: 3, feePaid: 90, status: 'SUCCESS' });
    await service.flushPendingAlerts();

    expect(result.shouldAlert).toBe(true);
    expect(result.reasons).toContain('rapid_fund_drain');
    expect(service.getState().stats.alertsSent).toBe(1);
    expect(metricsServer.increment).toHaveBeenCalledWith('fraudAlertsQueuedTotal', 1);
    expect(metricsServer.increment).toHaveBeenCalledWith('fraudAlertsSentTotal', 1);
    expect(historyManager.record).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'fraud_alert',
      taskId: '3',
    }));
  });

  it('sends alerts to a configured webhook', async () => {
    const service = createService({
      alertWebhookUrl: 'https://alerts.example.com/fraud',
      alertThreshold: 2,
      minDrainFee: 1,
      drainMultiplier: 1,
      burstWindowMs: 300000,
      failureWindowMs: 300000,
      taskBurstThreshold: 1,
      failureBurstThreshold: 10,
      crossTaskThreshold: 99,
      maxAlertAttempts: 1,
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    clock.set(0);
    service.observeExecution({ taskId: 10, feePaid: 25, status: 'SUCCESS' });
    await service.flushPendingAlerts();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://alerts.example.com/fraud');
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.event).toBe('fraud_alert');
    expect(body.taskId).toBe('10');
    expect(metricsServer.increment).toHaveBeenCalledWith('fraudAlertsSentTotal', 1);
  });

  it('keeps operating when alert delivery fails', async () => {
    const service = createService({
      alertWebhookUrl: 'https://alerts.example.com/fraud',
      alertThreshold: 2,
      minDrainFee: 1,
      drainMultiplier: 1,
      burstWindowMs: 300000,
      failureWindowMs: 300000,
      taskBurstThreshold: 1,
      failureBurstThreshold: 10,
      crossTaskThreshold: 99,
      maxAlertAttempts: 1,
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });

    clock.set(0);
    service.observeExecution({ taskId: 99, feePaid: 25, status: 'SUCCESS' });
    await service.flushPendingAlerts();

    expect(service.getState().stats.alertsFailed).toBe(1);
    expect(metricsServer.increment).toHaveBeenCalledWith('fraudAlertsFailedTotal', 1);
    expect(service.getState().recentErrors.length).toBeGreaterThan(0);
  });

  it('suppresses duplicate alerts inside the debounce window', async () => {
    const service = createService({
      alertThreshold: 2,
      minDrainFee: 1,
      drainMultiplier: 1,
      burstWindowMs: 300000,
      failureWindowMs: 300000,
      taskBurstThreshold: 1,
      failureBurstThreshold: 10,
      crossTaskThreshold: 99,
      alertDebounceMs: 600000,
    });

    clock.set(0);
    service.observeExecution({ taskId: 5, feePaid: 25, status: 'SUCCESS' });
    await service.flushPendingAlerts();

    clock.set(1000);
    service.observeExecution({ taskId: 5, feePaid: 25, status: 'SUCCESS' });
    await service.flushPendingAlerts();

    expect(service.getState().stats.alertsSuppressed).toBeGreaterThan(0);
    expect(metricsServer.increment).toHaveBeenCalledWith('fraudAlertsSuppressedTotal', 1);
  });

  it('detects repeated failures as a suspicious pattern', async () => {
    const service = createService({
      alertThreshold: 2,
      failureBurstThreshold: 2,
      taskBurstThreshold: 10,
      crossTaskThreshold: 99,
      minDrainFee: 9999,
      burstWindowMs: 300000,
      failureWindowMs: 300000,
    });

    clock.set(0);
    service.observeFailure({ taskId: 44, status: 'FAILED', errorClassification: 'retryable' });
    clock.set(1000);
    const result = service.observeFailure({ taskId: 44, status: 'FAILED', errorClassification: 'retryable' });

    await service.flushPendingAlerts();

    expect(result.reasons).toContain('failure_burst');
    expect(result.shouldAlert).toBe(true);
  });
});
