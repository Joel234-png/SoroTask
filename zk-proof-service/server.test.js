const request = require('supertest');
const { createServer } = require('./server');

describe('strict OpenAPI request validation', () => {
  test('rejects unknown request properties with RFC 7807', async () => {
    const { app } = createServer();
    const response = await request(app).post('/generate-proof').send({
      taskId: 1,
      circuitId: 'circuit',
      taskCondition: { type: 'threshold', params: {} },
      clientData: { witness: { value: 1 } },
      unexpected: true,
    });

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(response.body).toEqual(expect.objectContaining({
      type: expect.stringMatching(/^https:\/\//),
      title: expect.any(String),
      status: 400,
      detail: expect.any(String),
    }));
  });

  test('rejects malformed types before reaching the handler', async () => {
    const { app } = createServer();
    const response = await request(app).post('/verify-proof').send({
      taskId: 'not-an-integer',
      circuitId: 'circuit',
      taskCondition: { type: 'threshold', params: {} },
      proof: { proofId: 'bad', pi_a: [], pi_b: [], pi_c: [], publicSignals: [] },
    });

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
  });

  test('POST /generate-proof enforces 10 req/min rate limit per IP and returns HTTP 429 with Retry-After header', async () => {
    const app = createApp(zkService, { disableOpenApiValidation: true });
    const payload = {
      taskId: 1,
      circuitId: 'liquidity-threshold-v1',
      taskCondition: { type: 'liquidity-threshold', params: { minLiquidity: 100 } },
      clientData: { witness: { actualLiquidity: 500 } },
    };

    // Send 10 valid requests
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post('/generate-proof').send(payload);
      expect(res.status).toBe(200);
    }

    // 11th request must be rate limited with 429 Too Many Requests
    const rateLimitedRes = await request(app).post('/generate-proof').send(payload);
    expect(rateLimitedRes.status).toBe(429);
    expect(rateLimitedRes.headers['retry-after']).toBeDefined();
    expect(rateLimitedRes.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});
