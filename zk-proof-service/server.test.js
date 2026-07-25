const request = require('supertest');
const { ZKProofService } = require('./index');
const { createApp } = require('./server');
const { generateECIESKeyPair, encryptWitnessECIES } = require('./lib/helpers');

describe('server', () => {
  let zkService;
  let eciesKeys;

  beforeEach(() => {
    zkService = new ZKProofService(2);
    zkService.initialize();
    eciesKeys = generateECIESKeyPair();
  });

  afterEach(() => {
    zkService.shutdown();
  });

  test('GET /health returns healthy status when worker pool is ready', async () => {
    const app = createApp(zkService, { disableOpenApiValidation: true });
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
    const app = createApp(zkService, { disableOpenApiValidation: true });
    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('unavailable');
  });

  test('POST /generate-proof validates input and processes valid payload', async () => {
    const app = createApp(zkService, { disableOpenApiValidation: true });
    const payload = {
      taskId: 42,
      circuitId: 'liquidity-threshold-v1',
      taskCondition: { type: 'liquidity-threshold', params: { minLiquidity: 1000 } },
      clientData: { witness: { actualLiquidity: 5000 } },
    };

    const res = await request(app).post('/generate-proof').send(payload);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.taskId).toBe(42);
  });

  test('POST /generate-proof returns 400 Bad Request on missing fields', async () => {
    const app = createApp(zkService, { disableOpenApiValidation: true });
    const invalidPayload = { taskId: 42 };

    const res = await request(app).post('/generate-proof').send(invalidPayload);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  test('POST /generate-proof handles ECIES encrypted witness transport and decrypts successfully', async () => {
    const app = createApp(zkService, {
      eciesPrivateKey: eciesKeys.privateKey,
      disableOpenApiValidation: true,
    });

    const secretWitness = { actualLiquidity: 50000 };
    const encryptedWitness = encryptWitnessECIES(secretWitness, eciesKeys.publicKey);

    const payload = {
      taskId: 99,
      circuitId: 'liquidity-threshold-v1',
      taskCondition: { type: 'liquidity-threshold', params: { minLiquidity: 10000 } },
      clientData: { encryptedWitness },
    };

    const res = await request(app).post('/generate-proof').send(payload);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.taskId).toBe(99);
  });

  test('OpenAPI v3 schema validation middleware rejects malformed request bodies', async () => {
    const app = createApp(zkService, { apiToken: '', disableOpenApiValidation: false });

    // Send payload missing required circuitId and taskCondition
    const res = await request(app)
      .post('/generate-proof')
      .set('Authorization', 'Bearer valid-token')
      .send({ invalidProperty: 123 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('INVALID_INPUT');
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
