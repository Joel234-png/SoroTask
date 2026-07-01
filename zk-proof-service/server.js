const express = require('express');
const { ZKProofService } = require('./index');
const { hashTaskCondition, serializeProof, checkConstraint } = require('./lib/helpers');

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
  if (!body.clientData.witness) {
    return { valid: false, message: 'clientData.witness is required' };
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
 * @param {{ apiToken?: string, version?: string, startTime?: number }} [options]
 */
function createApp(zkService, options = {}) {
  const app = express();
  const apiToken = options.apiToken ?? process.env.ZK_PROOF_API_TOKEN;
  const version = options.version ?? SERVICE_VERSION;
  const startTime = options.startTime ?? Date.now();

  app.use(express.json({ limit: '1mb' }));

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

  app.post('/generate-proof', authenticate, async (req, res) => {
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

module.exports = { createApp, createServer };
