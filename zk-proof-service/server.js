const express = require('express');
const path = require('path');
const { middleware } = require('express-openapi-validator');
const { ZKProofService } = require('./index');

const SERVICE_VERSION = '1.0.0';
const problem = (res, status, title, detail, errors) => res.status(status).type('application/problem+json').json({
  type: `https://sorotask.com/problems/${status}`,
  title,
  status,
  detail,
  ...(errors ? { errors } : {}),
});

function createApp(zkService, options = {}) {
  const app = express();
  const apiToken = options.apiToken ?? process.env.ZK_PROOF_API_TOKEN;
  app.use(express.json({ limit: '1mb', strict: true }));
  app.use(middleware({
    apiSpec: options.apiSpec || path.join(__dirname, 'openapi.yaml'),
    validateRequests: true,
    validateResponses: false,
    unknownFormats: ['int64'],
  }));

  app.use((req, res, next) => {
    if (!apiToken || req.path === '/health') return next();
    const header = req.headers.authorization || '';
    if (header !== `Bearer ${apiToken}`) return problem(res, 401, 'Unauthorized', 'A valid bearer token is required.');
    next();
  });

  app.get('/health', (_req, res) => {
    const workerPool = zkService.getWorkerPoolStatus();
    const ready = zkService.isReady && workerPool.totalWorkers > 0;
    res.status(ready ? 200 : 503).json({ status: ready ? 'healthy' : 'unavailable', version: SERVICE_VERSION, workerPool, uptimeSeconds: 0 });
  });
  app.post('/generate-proof', async (req, res, next) => {
    try {
      const proof = await zkService.generateProof(req.body.taskCondition, req.body.clientData);
      res.json({ proofId: proof.proofId, status: 'success', taskId: req.body.taskId, conditionHash: JSON.stringify(req.body.taskCondition), proof, serializedProof: JSON.stringify(proof), generatedAt: new Date().toISOString(), processingTimeMs: 0 });
    } catch (error) { next(error); }
  });
  app.post('/verify-proof', async (req, res, next) => {
    try {
      const result = await zkService.verifyProof(req.body);
      res.json({ ...result, taskId: req.body.taskId, verifiedAt: new Date().toISOString() });
    } catch (error) { next(error); }
  });

  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    const status = error.status || (error.message === 'Worker pool at capacity' ? 503 : 500);
    problem(res, status, status === 503 ? 'Service Unavailable' : 'Request Failed', error.message || 'Unexpected service error', error.errors);
  });
  return app;
}

function createServer(options = {}) {
  const zkService = options.zkService || new ZKProofService(options.workerCount || 4);
  if (!options.skipInitialize) zkService.initialize();
  return { app: createApp(zkService, options), zkService };
}

if (require.main === module) {
  const { app } = createServer();
  app.listen(Number(process.env.PORT) || 3100, () => console.log('ZK Proof Service listening'));
}

module.exports = { createApp, createServer };
