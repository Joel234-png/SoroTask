const request = require('supertest');
const { ZKProofService } = require('./index');
const { createApp } = require('./server');

describe('server', () => {
  let zkService;

  beforeEach(() => {
    zkService = new ZKProofService(2);
    zkService.initialize();
  });

  afterEach(() => {
    zkService.shutdown();
  });

  test('GET /health returns healthy status when worker pool is ready', async () => {
    const app = createApp(zkService);
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
    expect(response.body.version).toBe('1.0.0');
    expect(response.body.workerPool).toEqual({
      totalWorkers: 2,
      idleWorkers: 2,
      activeWorkers: 0,
    });
    expect(typeof response.body.uptimeSeconds).toBe('number');
  });

  test('GET /health returns unavailable when service is not initialized', async () => {
    zkService.shutdown();
    const app = createApp(zkService);
    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('unavailable');
  });
});
