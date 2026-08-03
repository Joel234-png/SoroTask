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

  test('GET /health reports queue depth and threshold', async () => {
    const app = createApp(zkService, { queueDepthThreshold: 50 });
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.queueDepth).toBe(0);
    expect(response.body.queueDepthThreshold).toBe(50);
  });

  test('GET /health returns 503 overloaded when queue depth exceeds threshold', async () => {
    // A negative threshold forces the overload branch deterministically:
    // inFlight (0) > -1, exercising the 503 queue-depth safety path.
    const app = createApp(zkService, { queueDepthThreshold: -1 });
    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('overloaded');
  });

  test('GET /metrics exposes the ZK Prometheus metrics', async () => {
    const app = createApp(zkService);
    const response = await request(app).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toContain('zk_worker_pool_active');
    expect(response.text).toContain('zk_worker_pool_capacity');
    expect(response.text).toContain('zk_proof_duration_ms');
    expect(response.text).toContain('zk_queue_wait_ms');
    // Capacity gauge reflects the configured worker count (2).
    expect(response.text).toMatch(/zk_worker_pool_capacity\s+2/);
  });

  test('POST /generate-proof records proof duration in metrics', async () => {
    const metrics = require('./lib/metrics').createMetrics();
    const app = createApp(zkService, { metrics });

    const res = await request(app)
      .post('/generate-proof')
      .send({
        taskId: 1,
        circuitId: 'liquidity-threshold-v1',
        taskCondition: { type: 'liquidity-threshold', params: { minLiquidity: 10 } },
        clientData: { witness: { actualLiquidity: 100 } },
      });

    expect(res.status).toBe(200);
    const scrape = await metrics.registry.metrics();
    expect(scrape).toMatch(/zk_proof_duration_ms_count\s+1/);
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
      .set('Authorization', 'Bearer test-token')
      .send(payload);

    expect(asyncRes.status).toBe(202);
    expect(asyncRes.body.status).toBe('queued');
    expect(asyncRes.body.jobId).toBeDefined();

    const jobId = asyncRes.body.jobId;

    // Stream SSE events
    const streamRes = await request(app)
      .get(`/proofs/${jobId}/stream`)
      .set('Authorization', 'Bearer test-token');

    expect(streamRes.headers['content-type']).toContain('text/event-stream');
    expect(streamRes.text).toContain('event: status');
  });
});

describe('halo2 proof gateway (Issue #851)', () => {
  let zkService;

  beforeEach(() => {
    zkService = new ZKProofService(2);
    zkService.initialize();
  });

  afterEach(() => {
    zkService.shutdown();
  });

  const baseBody = {
    taskId: 7,
    circuitId: 'universal-setup-v1',
    taskCondition: { type: 'liquidity-threshold', params: { minLiquidity: 1000 } },
    clientData: { witness: { actualLiquidity: 5000 } },
  };

  test('POST /generate-proof/halo2 accepts a valid KZG request and returns a mock proof', async () => {
    const app = createApp(zkService, { disableOpenApiValidation: true });
    const res = await request(app)
      .post('/generate-proof/halo2')
      .send({ ...baseBody, scheme: 'kzg' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.scheme).toBe('kzg');
    expect(res.body.isMock).toBe(true);
    expect(res.body.proof.isMock).toBe(true);
    expect(res.body.proof.backend).toBe('mock-reference');
    expect(res.body.proof).toHaveProperty('commitment');
    expect(res.body.conditionHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test('POST /generate-proof/halo2 accepts a valid IPA request', async () => {
    const app = createApp(zkService, { disableOpenApiValidation: true });
    const res = await request(app)
      .post('/generate-proof/halo2')
      .send({ ...baseBody, scheme: 'ipa' });

    expect(res.status).toBe(200);
    expect(res.body.scheme).toBe('ipa');
    expect(res.body.proof.scheme).toBe('ipa');
  });

  test('POST /generate-proof/halo2 rejects an unsupported commitment scheme', async () => {
    const app = createApp(zkService, { disableOpenApiValidation: true });
    const res = await request(app)
      .post('/generate-proof/halo2')
      .send({ ...baseBody, scheme: 'groth16' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SCHEME');
    expect(res.body.error.message).toMatch(/kzg, ipa/);
  });

  test('POST /generate-proof/halo2 rejects a malformed circuit input', async () => {
    const app = createApp(zkService, { disableOpenApiValidation: true });
    const res = await request(app)
      .post('/generate-proof/halo2')
      .send({
        ...baseBody,
        scheme: 'kzg',
        clientData: { witness: { actualLiquidity: { nested: 'not-a-field-element' } } },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CIRCUIT_INPUT');
  });

  test('POST /verify-proof/halo2 verifies a proof produced by the gateway', async () => {
    const app = createApp(zkService, { disableOpenApiValidation: true });
    const gen = await request(app)
      .post('/generate-proof/halo2')
      .send({ ...baseBody, scheme: 'kzg' });

    const res = await request(app)
      .post('/verify-proof/halo2')
      .send({
        taskId: 7,
        circuitId: 'universal-setup-v1',
        scheme: 'kzg',
        taskCondition: baseBody.taskCondition,
        proof: gen.body.proof,
      });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.isMock).toBe(true);
  });

  test('POST /verify-proof/halo2 rejects a scheme mismatch between request and proof', async () => {
    const app = createApp(zkService, { disableOpenApiValidation: true });
    const gen = await request(app)
      .post('/generate-proof/halo2')
      .send({ ...baseBody, scheme: 'kzg' });

    const res = await request(app)
      .post('/verify-proof/halo2')
      .send({
        taskId: 7,
        circuitId: 'universal-setup-v1',
        scheme: 'ipa',
        taskCondition: baseBody.taskCondition,
        proof: gen.body.proof,
      });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.verificationDetails.reason).toMatch(/does not match/);
  });
});
