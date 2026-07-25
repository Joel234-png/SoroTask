const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createExpressApp } = require('../src/api');
const { JWT_SECRET, ROLES } = require('../src/graphql/auth');
const { updateLedgerMetrics, recordEventIndexed } = require('../src/metrics');
const { registerApiKey, clearBuckets } = require('../src/rateLimiter');

describe('Indexer REST API, Auth, Rate Limiting & Metrics', () => {
  let app;

  beforeEach(() => {
    clearBuckets();
    app = createExpressApp();
  });

  test('GET /metrics returns Prometheus scraped format', async () => {
    updateLedgerMetrics(100, 105);
    recordEventIndexed('TaskRegistered');

    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('indexer_ledger_head 100');
    expect(res.text).toContain('network_ledger_head 105');
    expect(res.text).toContain('indexer_lag_ledgers 5');
    expect(res.text).toContain('events_indexed_total');
  });

  test('GET /api/health returns status ok with anonymous user role by default', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.user.role).toBe(ROLES.ANONYMOUS);
  });

  test('GET /api/health with valid JWT authenticates user', async () => {
    const token = jwt.sign({ id: 1, role: ROLES.USER, address: 'G123456789' }, JWT_SECRET);
    const res = await request(app)
      .get('/api/health')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe(ROLES.USER);
    expect(res.body.user.address).toBe('G123456789');
  });

  test('GET /api/protected blocks unauthenticated/ANONYMOUS requests with 403', async () => {
    const res = await request(app).get('/api/protected');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  test('GET /api/protected succeeds for authenticated USER', async () => {
    const token = jwt.sign({ id: 2, role: ROLES.USER }, JWT_SECRET);
    const res = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('Access granted');
  });

  test('Rate Limiter Engine blocks excess requests with 429', async () => {
    // Register API key with limit 2 for quick testing
    const apiKey = 'test-limited-key';
    registerApiKey(apiKey, 2, 60);

    const req1 = await request(app).get('/api/health').set('x-api-key', apiKey);
    expect(req1.status).toBe(200);
    expect(req1.headers['x-ratelimit-remaining']).toBe('1');

    const req2 = await request(app).get('/api/health').set('x-api-key', apiKey);
    expect(req2.status).toBe(200);
    expect(req2.headers['x-ratelimit-remaining']).toBe('0');

    const req3 = await request(app).get('/api/health').set('x-api-key', apiKey);
    expect(req3.status).toBe(429);
    expect(req3.body.error).toBe('Too Many Requests');
  });
});
