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

  test('POST /generate-proof enqueues job and returns 202 with jobId', async () => {
    const app = createApp(zkService, { disableOpenApiValidation: true });
    const response = await request(app)
      .post('/generate-proof')
      .send({
        taskId: 1,
        circuitId: 'circuit-1',
        taskCondition: 'condition-1',
      });

    expect(response.status).toBe(202);
    expect(response.body.jobId).toBeDefined();
    expect(response.body.status).toBe('queued');
    expect(response.body.pollUrl).toBe(`/proofs/${response.body.jobId}`);
  });

  test('GET /proofs/:jobId returns job status', async () => {
    const app = createApp(zkService, { disableOpenApiValidation: true });
    const postRes = await request(app)
      .post('/generate-proof')
      .send({
        taskId: 2,
        circuitId: 'circuit-2',
        taskCondition: 'condition-2',
      });

    const jobId = postRes.body.jobId;
    const getRes = await request(app).get(`/proofs/${jobId}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.jobId).toBe(jobId);
    expect(['queued', 'processing', 'completed', 'failed']).toContain(getRes.body.status);
  });

  test('GET /proofs/:jobId returns 404 for unknown job', async () => {
    const app = createApp(zkService, { disableOpenApiValidation: true });
    const response = await request(app).get('/proofs/non-existent-job-id');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Job not found');
  });

  test('POST /generate-proof rejects invalid input', async () => {
    const app = createApp(zkService, { disableOpenApiValidation: true });
    const response = await request(app)
      .post('/generate-proof')
      .send({
        taskId: 'not-a-number',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid task parameters');
  });

  test('POST /generate-proof with ECIES encrypted payload decrypts successfully', async () => {
    const app = createApp(zkService, { disableOpenApiValidation: true });
    const sampleWitness = { secretValue: 42, signature: '0xabc' };
    const encrypted = encryptWitnessECIES(sampleWitness, eciesKeys.publicKey);

    const response = await request(app)
      .post('/generate-proof')
      .send({
        taskId: 3,
        circuitId: 'circuit-ecies',
        taskCondition: 'condition-ecies',
        encryptedWitness: encrypted,
        privateKeyPem: eciesKeys.privateKey,
      });

    expect(response.status).toBe(202);
    expect(response.body.jobId).toBeDefined();
    expect(response.body.status).toBe('queued');
  });

  test('POST /generate-proof rejects invalid ECIES payload', async () => {
    const app = createApp(zkService, { disableOpenApiValidation: true });
    const response = await request(app)
      .post('/generate-proof')
      .send({
        taskId: 4,
        circuitId: 'circuit-ecies',
        taskCondition: 'condition-ecies',
        encryptedWitness: { iv: 'invalid', ephemeralPublicKey: 'invalid', ciphertext: 'invalid', mac: 'invalid' },
        privateKeyPem: eciesKeys.privateKeyPem,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid ECIES encrypted payload or decryption failure');
  });

  test('GET /proofs/:jobId/stream returns SSE stream for proof progress', async () => {
    const app = createApp(zkService, { disableOpenApiValidation: true, adminApiToken: 'test-token' });
    const postRes = await request(app)
      .post('/generate-proof')
      .send({
        taskId: 5,
        circuitId: 'circuit-sse',
        taskCondition: 'condition-sse',
      });

    const jobId = postRes.body.jobId;

    const streamRes = await request(app)
      .get(`/proofs/${jobId}/stream`)
      .set('Authorization', 'Bearer test-token');

    expect(streamRes.headers['content-type']).toContain('text/event-stream');
    expect(streamRes.text).toContain('event: status');
  });
});

describe('halo2 proof gateway (Issue #851)', () => {
  let zkService;
  const baseBody = {
    taskId: 7,
    circuitId: 'universal-setup-v1',
    taskCondition: 'solvency-gt-100',
    clientData: { witness: { actualLiquidity: 500 } },
  };

  beforeEach(() => {
    zkService = new ZKProofService(2);
    zkService.initialize();
  });

  afterEach(() => {
    zkService.shutdown();
  });

  test('POST /generate-proof/halo2 accepts valid request and returns proof metadata', async () => {
    const app = createApp(zkService, { disableOpenApiValidation: true });
    const res = await request(app)
      .post('/generate-proof/halo2')
      .send({ ...baseBody, scheme: 'kzg' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.scheme).toBe('kzg');
    expect(res.body.proof).toBeDefined();
  });

  test('POST /generate-proof/halo2 rejects invalid circuit inputs', async () => {
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
