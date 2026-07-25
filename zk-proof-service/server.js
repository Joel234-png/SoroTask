const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('path');
const OpenApiValidator = require('express-openapi-validator');
const { ZKProofService } = require('./index');
const {
  hashTaskCondition,
  serializeProof,
  checkConstraint,
  decryptWitnessECIES,
  zeroizeBuffer,
} = require('./lib/helpers');

const SERVICE_VERSION = '1.0.0';

function sendError(res, status, code, message, details) {
  const payload = { error: { code, message } };
  if (details !== undefined) payload.error.details = details;
  res.status(status).json(payload);
}

function validateGenerateRequest(body) {
  const missingFields = [];
  if (body.taskId == null) missingFields.push('taskId');
  if (!body.circuitId) missingFields.push('circuitId');
  if (!body.taskCondition) missingFields.push('taskCondition');
  if (!body.clientData) missingFields.push('clientData');
  if (missingFields.length > 0) {
    return { valid: false, missingFields };
  }
  if (!body.taskCondition.type || body.taskCondition.params == null) {
    return { valid: false, message: 'taskCondition must include type and params' };
  }
  if (!body.clientData.witness && !body.clientData.encryptedWitness) {
    return { valid: false, message: 'clientData.witness or clientData.encryptedWitness is required' };
  }
  return { valid: true };
}

function validateVerifyRequest(body) {
  const missingFields = [];
  if (body.taskId == null) missingFields.push('taskId');
  if (!body.circuitId) missingFields.push('circuitId');
  if (!body.taskCondition) missingFields.push('taskCondition');
  if (!body.proof) missingFields.push('proof');
  if (missingFields.length > 0) {
    return { valid: false, missingFields };
  }
  if (!body.proof.proofId) {
    return { valid: false, message: 'proof.proofId is required' };
  }
  return { valid: true };
}

/**
 * @param {ZKProofService} zkService
 * @param {{ apiToken?: string, version?: string, startTime?: number, eciesPrivateKey?: string, disableOpenApiValidation?: boolean }} [options]
 */
/**
 * Creates an express-rate-limit store instance.
 * By default uses the built-in MemoryStore.  In production, replace with a
 * Redis-backed store (e.g. rate-limit-redis) to share state across replicas:
 *
 *   const RedisStore = require('rate-limit-redis');
 *   const store = new RedisStore({ client: redisClient });
 *   createApp(zkService, { rateLimitStore: store });
 *
 * @param {object} [store] - Optional rate-limit store instance.
 * @returns {import('express-rate-limit').Store}
 */
function createRateLimitStore(store) {
  return store ?? undefined; // undefined lets express-rate-limit use MemoryStore
}

function createApp(zkService, options = {}) {
  const app = express();
  const apiToken = options.apiToken ?? process.env.ZK_PROOF_API_TOKEN;
  const version = options.version ?? SERVICE_VERSION;
  const startTime = options.startTime ?? Date.now();
  const eciesPrivateKey = options.eciesPrivateKey ?? process.env.ECIES_PRIVATE_KEY;

  app.use(express.json({ limit: '1mb' }));

  // ---------------------------------------------------------------------------
  // Rate limiting – /generate-proof: 15 requests per minute per IP address.
  // On breach: HTTP 429 Too Many Requests + Retry-After header.
  // ---------------------------------------------------------------------------
  const generateProofLimiter = rateLimit({
    windowMs: 60 * 1000, // 1-minute sliding window
    max: 15,             // 15 proof requests per window per IP
    standardHeaders: true,  // Emit RateLimit-* headers (draft-6)
    legacyHeaders: false,
    store: createRateLimitStore(options.rateLimitStore),
    keyGenerator: (req) => req.ip,
    handler: (_req, res) => {
      const retryAfter = Math.ceil(60); // seconds until window resets
      res.setHeader('Retry-After', retryAfter);
      sendError(
        res,
        429,
        'RATE_LIMIT_EXCEEDED',
        'Too many proof requests. Please retry after ' + retryAfter + ' seconds.',
      );
    },
  });
  // OpenAPI v3 Schema Validation Middleware
  if (!options.disableOpenApiValidation) {
    const apiSpec = path.join(__dirname, 'openapi.yaml');
    app.use(
      OpenApiValidator.middleware({
        apiSpec,
        validateRequests: true,
        validateResponses: false,
        ignorePaths: (pathStr) => pathStr === '/health',
      }),
    );
  }

  function authenticate(req, res, next) {
    if (!apiToken) return next();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ') || header.slice(7) !== apiToken) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Invalid or missing bearer token');
    }
    return next();
  }

  app.get('/health', (_req, res) => {
    const workerPool = zkService.getWorkerPoolStatus();
    let status = 'unavailable';
    if (zkService.isReady && workerPool.totalWorkers > 0) {
      status = workerPool.activeWorkers === workerPool.totalWorkers ? 'degraded' : 'healthy';
    }
    const httpStatus = status === 'unavailable' ? 503 : 200;
    res.status(httpStatus).json({
      status,
      version,
      workerPool,
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    });
  });

  app.post('/generate-proof', generateProofLimiter, authenticate, async (req, res) => {
    const startedAt = Date.now();
    const validation = validateGenerateRequest(req.body || {});
    if (!validation.valid) {
      if (validation.missingFields) {
        return sendError(res, 400, 'INVALID_INPUT', 'taskCondition and clientData are required', {
          missingFields: validation.missingFields,
        });
      }
      return sendError(res, 400, 'INVALID_INPUT', validation.message);
    }

    if (!zkService.isReady) {
      return sendError(res, 503, 'SERVICE_NOT_READY', 'ZK proof worker pool is not initialized');
    }

    let { taskId, circuitId, taskCondition, clientData } = req.body;
    let witnessBuffer = null;

    // Handle ECIES Encrypted Witness Transport if encryptedWitness is provided
    if (clientData.encryptedWitness) {
      if (!eciesPrivateKey) {
        return sendError(res, 400, 'INVALID_INPUT', 'ECIES private key not configured on server');
      }
      try {
        const decrypted = decryptWitnessECIES(clientData.encryptedWitness, eciesPrivateKey);
        clientData = { ...clientData, witness: decrypted.witness };
        witnessBuffer = decrypted.decryptedBuffer;
      } catch (err) {
        return sendError(res, 400, 'INVALID_INPUT', `ECIES witness decryption failed: ${err.message}`);
      }
    }

    try {
      const constraint = checkConstraint(taskCondition, clientData, circuitId);
      if (!constraint.ok) {
        return sendError(
          res,
          422,
          'CONSTRAINT_UNSATISFIED',
          'Client witness does not satisfy task condition constraints',
          constraint.details,
        );
      }

      const rawProof = await zkService.generateProof(taskCondition, clientData);
      const conditionHash = hashTaskCondition(taskCondition);
      const proof = {
        pi_a: rawProof.pi_a,
        pi_b: rawProof.pi_b,
        pi_c: rawProof.pi_c,
        publicSignals: rawProof.publicSignals,
      };

      return res.json({
        proofId: rawProof.proofId,
        status: 'success',
        taskId,
        conditionHash,
        proof,
        serializedProof: serializeProof(proof),
        generatedAt: new Date().toISOString(),
        processingTimeMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (error.message === 'Worker pool at capacity') {
        return sendError(res, 503, 'SERVICE_NOT_READY', error.message);
      }
      if (error.message === 'Invalid input data') {
        return sendError(res, 400, 'INVALID_INPUT', error.message);
      }
      return sendError(res, 500, 'PROOF_GENERATION_FAILED', error.message);
    } finally {
      // Zero out decrypted witness buffer immediately after proof generation
      if (witnessBuffer) {
        zeroizeBuffer(witnessBuffer);
      }
    }
  });

  app.post('/verify-proof', authenticate, async (req, res) => {
    const validation = validateVerifyRequest(req.body || {});
    if (!validation.valid) {
      if (validation.missingFields) {
        return sendError(res, 400, 'INVALID_INPUT', 'Invalid verify-proof request', {
          missingFields: validation.missingFields,
        });
      }
      return sendError(res, 400, 'INVALID_INPUT', validation.message);
    }

    if (!zkService.isReady) {
      return sendError(res, 503, 'SERVICE_NOT_READY', 'ZK proof worker pool is not initialized');
    }

    const { taskId, circuitId, taskCondition, conditionHash, proof } = req.body;

    try {
      const result = await zkService.verifyProof({
        taskCondition,
        proof,
        conditionHash,
        circuitId,
      });

      return res.json({
        valid: result.valid,
        proofId: result.proofId,
        taskId,
        conditionHash: result.conditionHash,
        verifiedAt: new Date().toISOString(),
        verificationDetails: result.verificationDetails,
      });
    } catch (error) {
      if (error.message === 'Invalid input data') {
        return sendError(res, 400, 'INVALID_INPUT', error.message);
      }
      return sendError(res, 500, 'PROOF_VERIFICATION_FAILED', error.message);
    }
  });

  // OpenAPI Validation Error Handler
  app.use((err, _req, res, next) => {
    if (err.status || err.errors) {
      return sendError(
        res,
        err.status || 400,
        'INVALID_INPUT',
        err.message || 'Validation error',
        err.errors || [],
      );
    }
    next(err);
  app.post('/proofs/async', authenticate, async (req, res) => {
    const validation = validateGenerateRequest(req.body || {});
    if (!validation.valid) {
      if (validation.missingFields) {
        return sendError(res, 400, 'INVALID_INPUT', 'taskCondition and clientData are required', {
          missingFields: validation.missingFields,
        });
      }
      return sendError(res, 400, 'INVALID_INPUT', validation.message);
    }

    if (!zkService.isReady) {
      return sendError(res, 503, 'SERVICE_NOT_READY', 'ZK proof worker pool is not initialized');
    }

    const { taskId, circuitId, taskCondition, clientData } = req.body;
    const constraint = checkConstraint(taskCondition, clientData, circuitId);
    if (!constraint.ok) {
      return sendError(
        res,
        422,
        'CONSTRAINT_UNSATISFIED',
        'Client witness does not satisfy task condition constraints',
        constraint.details,
      );
    }

    try {
      const asyncJob = zkService.enqueueAsyncJob(taskCondition, clientData);
      return res.status(202).json({
        jobId: asyncJob.jobId,
        status: asyncJob.status,
        taskId,
        createdAt: asyncJob.createdAt,
      });
    } catch (error) {
      return sendError(res, 500, 'PROOF_ASYNC_ENQUEUE_FAILED', error.message);
    }
  });

  app.get('/proofs/:job_id/stream', (req, res) => {
    const { job_id: jobId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const job = zkService.getAsyncJob(jobId);
    if (!job) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Job not found', jobId })}\n\n`);
      return res.end();
    }

    res.write(`event: status\ndata: ${JSON.stringify({ jobId: job.jobId, status: job.status, progress: job.progress })}\n\n`);

    if (job.status === 'completed') {
      res.write(`event: complete\ndata: ${JSON.stringify(job.result)}\n\n`);
      return res.end();
    }

    if (job.status === 'failed') {
      res.write(`event: error\ndata: ${JSON.stringify({ jobId: job.jobId, error: job.error })}\n\n`);
      return res.end();
    }

    const onProgress = (data) => {
      if (data.jobId === jobId) {
        res.write(`event: progress\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    const onComplete = (completedJob) => {
      if (completedJob.jobId === jobId) {
        res.write(`event: complete\ndata: ${JSON.stringify(completedJob.result)}\n\n`);
        cleanup();
        res.end();
      }
    };

    const onError = (failedJob) => {
      if (failedJob.jobId === jobId) {
        res.write(`event: error\ndata: ${JSON.stringify({ jobId, error: failedJob.error })}\n\n`);
        cleanup();
        res.end();
      }
    };

    const cleanup = () => {
      zkService.removeListener('jobProgress', onProgress);
      zkService.removeListener('jobComplete', onComplete);
      zkService.removeListener('jobError', onError);
    };

    zkService.on('jobProgress', onProgress);
    zkService.on('jobComplete', onComplete);
    zkService.on('jobError', onError);

    req.on('close', () => {
      cleanup();
    });
  });

  return app;
}

function createServer(options = {}) {
  const workerCount = options.workerCount ?? (Number(process.env.ZK_PROOF_WORKERS) || 4);
  const zkService = options.zkService ?? new ZKProofService(workerCount);
  if (!options.skipInitialize) {
    zkService.initialize();
  }
  const app = createApp(zkService, options);
  return { app, zkService };
}

const PORT = Number(process.env.PORT) || 3100;

if (require.main === module) {
  const { app } = createServer();
  app.listen(PORT, () => {
    console.log(`ZK Proof Service listening on port ${PORT}`);
  });
}

module.exports = { createApp, createServer, createRateLimitStore };
