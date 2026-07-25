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

  test('POST /proofs/async enqueues job and GET /proofs/:job_id/stream streams SSE updates', async () => {
    const app = createApp(zkService);
    const payload = {
      taskId: 101,
      circuitId: 'soro_task_v1',
      taskCondition: {
        type: 'min_balance',
        params: { amount: '100' },
      },
      clientData: {
        witness: { balance: '200' },
      },
    };

    const asyncRes = await request(app)
      .post('/proofs/async')
      .send(payload);

    expect(asyncRes.status).toBe(202);
    expect(asyncRes.body.status).toBe('queued');
    expect(asyncRes.body.jobId).toBeDefined();

    const jobId = asyncRes.body.jobId;

    // Stream SSE events
    const streamRes = await request(app)
      .get(`/proofs/${jobId}/stream`);

    expect(streamRes.headers['content-type']).toContain('text/event-stream');
    expect(streamRes.text).toContain('event: status');
  });
});
