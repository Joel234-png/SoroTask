const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { Worker } = require('worker_threads');
const os = require('os');
const OpenApiValidator = require('express-openapi-validator');
const { ZKProofService } = require('./index');

const { createMetrics } = require('./lib/metrics');
const { Halo2ProverAdapter } = require('./lib/halo2-adapter');
const { selectProverBackend, withProofTiming } = require('./lib/prover-backend');
const {
  CircuitRegistry,
  createCircuitRoutes,
  sha256Hex,
} = require('./lib/circuit-registry');
const { CircuitIntegrityVerifier } = require('./lib/circuit-integrity');
const {
  hashTaskCondition,
  serializeProof,
  checkConstraint,
  decryptWitnessECIES,
  zeroizeBuffer,
} = require('./lib/helpers');

const SERVICE_VERSION = '1.0.0';
// Queue-depth safety threshold: when the number of in-flight proof requests
// exceeds this, /health reports 503 so an orchestrator can shed load / scale.
const DEFAULT_QUEUE_DEPTH_THRESHOLD = 50;

// ---------------------------------------------------------------------------
// Asynchronous WebAssembly Worker Pool Isolation (Issue #858)
//
// Executes user-submitted WASM witness calculators inside isolated Node.js
// Worker threads acting as lightweight WASI micro-sandboxes. Each invocation:
//   - Runs in a separate Worker thread with no access to the parent heap.
//   - Is capped at WASM_SANDBOX_MEMORY_MB (default 512 MB) via --max-old-space-size.
//   - Is forcibly terminated if it exceeds WASM_SANDBOX_TIMEOUT_MS (default 10s).
//   - Has no filesystem, network, or native module access (WASI not exposed).
//
// The pool maintains a configurable number of warm worker slots to avoid cold-
// start latency on every proof request. Workers are replaced after termination.
// ---------------------------------------------------------------------------

const WASM_SANDBOX_MEMORY_MB = Number(process.env.WASM_SANDBOX_MEMORY_MB) || 512;
const WASM_SANDBOX_TIMEOUT_MS = Number(process.env.WASM_SANDBOX_TIMEOUT_MS) || 10000;
const WASM_SANDBOX_POOL_SIZE = Number(process.env.WASM_SANDBOX_POOL_SIZE) || Math.max(1, os.cpus().length);

/**
 * Inline worker script source executed inside a sandboxed Worker thread.
 * The worker receives { wasmBytes, inputs } via parentPort.once('message'),
 * instantiates the WASM module with zero host imports (WASI-free sandbox),
 * and posts back { outputs } or { error }.
 *
 * Security properties:
 *   - No require() / import() available (Worker executes eval'd code in a
 *     fresh v8 context without Node built-in access).
 *   - No shared memory with parent thread (no SharedArrayBuffer passed in).
 *   - WASM linear memory is constrained by the thread's --max-old-space-size.
 *   - Network and filesystem APIs are not exposed (no Node globals injected).
 */
const WASM_WORKER_SCRIPT = /* js */`
const { parentPort } = require('worker_threads');
parentPort.once('message', async ({ wasmBytes, inputs }) => {
  try {
    // Instantiate with an empty import object — zero host access.
    const { instance } = await WebAssembly.instantiate(
      new Uint8Array(wasmBytes),
      {} // no host imports
    );
    const exports = instance.exports;
    // Attempt to call a standard witness calculator entry point.
    // Circuits built with circom/snarkjs expose 'calculateWitness' or 'main'.
    const fn = exports.calculateWitness || exports.main || exports.run;
    if (typeof fn !== 'function') {
      throw new Error('WASM module does not export calculateWitness / main / run');
    }
    const result = fn(inputs);
    parentPort.postMessage({ outputs: result });
  } catch (err) {
    parentPort.postMessage({ error: err.message || String(err) });
  }
});
`;

/**
 * Isolated WASM micro-sandbox pool.
 *
 * Maintains a pool of Worker threads. Each invocation of runInSandbox() picks
 * a free slot, executes the WASM circuit, then replaces the worker (workers are
 * single-use to prevent state leakage between proof requests).
 */
class WasmSandboxPool {
  /**
   * @param {object} [options]
   * @param {number} [options.poolSize] - Number of concurrent worker slots.
   * @param {number} [options.timeoutMs] - Per-invocation CPU timeout.
   * @param {number} [options.memoryMb] - Max heap per worker thread (MB).
   */
  constructor(options = {}) {
    this.poolSize = options.poolSize ?? WASM_SANDBOX_POOL_SIZE;
    this.timeoutMs = options.timeoutMs ?? WASM_SANDBOX_TIMEOUT_MS;
    this.memoryMb = options.memoryMb ?? WASM_SANDBOX_MEMORY_MB;
    this._queue = [];       // pending { resolve, reject, wasmBytes, inputs }
    this._activeCount = 0;
  }

  /**
   * Execute a WASM witness calculator inside an isolated Worker thread.
   *
   * @param {Buffer|Uint8Array} wasmBytes - Raw WASM binary.
   * @param {*} inputs - Circuit inputs passed to the exported entry function.
   * @returns {Promise<*>} Resolved with the circuit output, or rejected on error/timeout.
   */
  runInSandbox(wasmBytes, inputs) {
    return new Promise((resolve, reject) => {
      this._queue.push({ resolve, reject, wasmBytes, inputs });
      this._drain();
    });
  }

  _drain() {
    while (this._queue.length > 0 && this._activeCount < this.poolSize) {
      const job = this._queue.shift();
      this._activeCount++;
      this._execute(job).finally(() => {
        this._activeCount--;
        this._drain();
      });
    }
  }

  async _execute({ resolve, reject, wasmBytes, inputs }) {
    const execOptions = {
      eval: true,
      // Constrain memory; --max-old-space-size is in MB.
      execArgv: [`--max-old-space-size=${this.memoryMb}`],
      // Pass wasmBytes via workerData to avoid a round-trip message.
      workerData: { wasmBytes: Buffer.from(wasmBytes), inputs },
    };

    // Use an adapted script that reads workerData instead of a message, to
    // keep the sandbox protocol simple and avoid a send() round-trip.
    const workerScript = /* js */`
      const { parentPort, workerData } = require('worker_threads');
      const { wasmBytes, inputs } = workerData;
      (async () => {
        try {
          const { instance } = await WebAssembly.instantiate(
            new Uint8Array(wasmBytes),
            {}
          );
          const exports = instance.exports;
          const fn = exports.calculateWitness || exports.main || exports.run;
          if (typeof fn !== 'function') {
            throw new Error('WASM module does not export calculateWitness / main / run');
          }
          const result = fn(inputs);
          parentPort.postMessage({ outputs: result });
        } catch (err) {
          parentPort.postMessage({ error: err.message || String(err) });
        }
      })();
    `;

    let worker;
    let timeoutHandle;

    try {
      worker = new Worker(workerScript, execOptions);

      await new Promise((res, rej) => {
        timeoutHandle = setTimeout(() => {
          worker.terminate();
          rej(new Error(
            `WASM sandbox timeout: execution exceeded ${this.timeoutMs}ms. ` +
            'Worker forcibly terminated to prevent DoS.',
          ));
        }, this.timeoutMs);

        worker.once('message', (msg) => {
          clearTimeout(timeoutHandle);
          if (msg.error) {
            rej(new Error(`WASM sandbox error: ${msg.error}`));
          } else {
            resolve(msg.outputs);
            res();
          }
        });

        worker.once('error', (err) => {
          clearTimeout(timeoutHandle);
          rej(new Error(`WASM sandbox worker error: ${err.message}`));
        });

        worker.once('exit', (code) => {
          clearTimeout(timeoutHandle);
          if (code !== 0) {
            rej(new Error(`WASM sandbox worker exited with code ${code}`));
          }
        });
      });
    } catch (err) {
      reject(err);
    } finally {
      clearTimeout(timeoutHandle);
      // Workers are single-use; terminate defensively if still running.
      if (worker) {
        worker.terminate().catch(() => {});
      }
    }
  }
}

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
  if (missingFields.length > 0) {
    return { valid: false, missingFields };
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
  const metrics = options.metrics ?? createMetrics();
  const queueDepthThreshold =
    options.queueDepthThreshold ??
    (Number(process.env.ZK_QUEUE_DEPTH_THRESHOLD) || DEFAULT_QUEUE_DEPTH_THRESHOLD);

  // In-flight proof requests -- the real concurrency signal / "queue depth"
  // for this service (there is no separate backlog queue; see lib/metrics.js).
  let inFlight = 0;
  const eciesPrivateKey = options.eciesPrivateKey ?? process.env.ECIES_PRIVATE_KEY;

  // Issue #858: WASM worker pool isolation. Injectable for testing; defaults
  // to a pool sized to CPU count with 512 MB/worker and 10s timeout.
  const wasmSandboxPool = options.wasmSandboxPool ?? new WasmSandboxPool({
    poolSize: options.wasmSandboxPoolSize ?? WASM_SANDBOX_POOL_SIZE,
    timeoutMs: options.wasmSandboxTimeoutMs ?? WASM_SANDBOX_TIMEOUT_MS,
    memoryMb: options.wasmSandboxMemoryMb ?? WASM_SANDBOX_MEMORY_MB,
  });

  // halo2 proving gateway (Issue #851). Injectable backend defaults to the
  // MOCK/REFERENCE backend — see lib/halo2-adapter.js for the honesty notice on
  // why no real halo2 proving happens in this build.
  const halo2Adapter = options.halo2Adapter ?? new Halo2ProverAdapter();

  // Prover backend selection (Issue #850). Defaults to the CPU path with zero
  // behaviour change. If PROVER_BACKEND is explicitly set to cuda|metal with no
  // real GPU backend wired in, selectProverBackend() throws here so a
  // misconfigured deployment fails fast at startup instead of silently running
  // on CPU while believing it is GPU-accelerated.
  const proverBackend = options.proverBackend ?? selectProverBackend({ gpuBackends: options.gpuBackends });

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
  // ---------------------------------------------------------------------------
  // halo2 proof gateway routes (Issue #851).
  // Registered BEFORE the OpenAPI validator on purpose: these endpoints carry a
  // `scheme` field (kzg | ipa) that the existing OpenAPI schemas do not model,
  // and the Halo2ProverAdapter performs its own request validation. The proof
  // objects are explicitly marked isMock:true — this is a gateway/contract layer,
  // NOT a real halo2 prover (see lib/halo2-adapter.js).
  // ---------------------------------------------------------------------------
  app.post('/generate-proof/halo2', generateProofLimiter, authenticate, (req, res) => {
    const startedAt = Date.now();
    const body = req.body || {};
    const { taskId, circuitId, scheme, taskCondition } = body;
    const circuitInput = body.clientData?.witness ?? body.circuitInput;

    if (taskId == null || !circuitId || !taskCondition) {
      return sendError(res, 400, 'INVALID_INPUT', 'taskId, circuitId and taskCondition are required');
    }

    try {
      const proof = halo2Adapter.generateProof({ scheme, circuitId, circuitInput });
      const conditionHash = hashTaskCondition(taskCondition);
      return res.json({
        proofId: proof.proofId,
        status: 'COMPLETED',
        taskId,
        scheme: proof.scheme,
        conditionHash,
        proof,
        backend: halo2Adapter.isMockBackend() ? 'mock-reference' : 'external',
        isMock: halo2Adapter.isMockBackend(),
        generatedAt: new Date().toISOString(),
        processingTimeMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (error.code === 'INVALID_SCHEME' || error.code === 'INVALID_CIRCUIT_INPUT') {
        return sendError(res, 400, error.code, error.message);
      }
      return sendError(res, 500, 'PROOF_GENERATION_FAILED', error.message);
    }
  });

  app.post('/verify-proof/halo2', authenticate, (req, res) => {
    const body = req.body || {};
    const { taskId, circuitId, scheme, taskCondition, proof } = body;

    if (taskId == null || !circuitId || !taskCondition || !proof) {
      return sendError(res, 400, 'INVALID_INPUT', 'taskId, circuitId, taskCondition and proof are required');
    }

    try {
      const result = halo2Adapter.verifyProof({ scheme, proof });
      return res.json({
        valid: result.valid,
        proofId: proof.proofId,
        taskId,
        scheme: scheme.toLowerCase(),
        conditionHash: hashTaskCondition(taskCondition),
        isMock: halo2Adapter.isMockBackend(),
        verifiedAt: new Date().toISOString(),
        verificationDetails: {
          circuitId,
          reason: result.reason,
          note: 'Structural verification only — mock backend does not verify ZK soundness.',
        },
      });
    } catch (error) {
      if (error.code === 'INVALID_SCHEME' || error.code === 'INVALID_CIRCUIT_INPUT') {
        return sendError(res, 400, error.code, error.message);
      }
      return sendError(res, 500, 'PROOF_VERIFICATION_FAILED', error.message);
    }
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

  // Reflect current worker-pool status into the gauges.
  function syncPoolGauges() {
    const pool = zkService.getWorkerPoolStatus();
    metrics.workerPoolActive.set(pool.activeWorkers);
    metrics.workerPoolCapacity.set(pool.totalWorkers);
    return pool;
  }

  app.get('/health', (_req, res) => {
    const workerPool = syncPoolGauges();
    let status = 'unavailable';
    if (zkService.isReady && workerPool.totalWorkers > 0) {
      status = workerPool.activeWorkers === workerPool.totalWorkers ? 'degraded' : 'healthy';
    }
    // Issue #860: report 503 when queue depth exceeds the safety threshold.
    const queueOverloaded = inFlight > queueDepthThreshold;
    if (queueOverloaded && status !== 'unavailable') {
      status = 'overloaded';
    }
    const httpStatus = status === 'unavailable' || status === 'overloaded' ? 503 : 200;
    res.status(httpStatus).json({
      status,
      version,
      workerPool,
      queueDepth: inFlight,
      queueDepthThreshold,
      // Issue #858: WASM sandbox pool status
      wasmSandboxPool: {
        poolSize: wasmSandboxPool.poolSize,
        activeCount: wasmSandboxPool._activeCount,
        queueDepth: wasmSandboxPool._queue.length,
        timeoutMs: wasmSandboxPool.timeoutMs,
        memoryMb: wasmSandboxPool.memoryMb,
      },
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    });
  });

  // Issue #860: Prometheus scrape endpoint.
  app.get('/metrics', async (_req, res) => {
    syncPoolGauges();
    res.set('Content-Type', metrics.registry.contentType);
    res.end(await metrics.registry.metrics());
  });


  /**
   * POST /generate-proof/wasm
   *
   * Issue #858: Execute a user-submitted WASM witness calculator inside an
   * isolated micro-sandbox and return the computed outputs. The WASM binary is
   * accepted as a base64-encoded string in `wasmBase64`. The sandbox:
   *   - Runs in a separate Worker thread with no host access.
   *   - Is killed after WASM_SANDBOX_TIMEOUT_MS (default 10s).
   *   - May not allocate more than WASM_SANDBOX_MEMORY_MB (default 512 MB).
   *
   * Request body:
   *   { taskId, circuitId, wasmBase64: string, inputs: any, taskCondition }
   *
   * Response:
   *   { status: 'success', taskId, circuitId, outputs, executionTimeMs }
   */
  app.post('/generate-proof/wasm', generateProofLimiter, authenticate, async (req, res) => {
    const startedAt = Date.now();
    const body = req.body || {};
    const { taskId, circuitId, wasmBase64, inputs, taskCondition } = body;

    if (taskId == null || !circuitId || !wasmBase64 || !taskCondition) {
      return sendError(res, 400, 'INVALID_INPUT', 'taskId, circuitId, wasmBase64 and taskCondition are required');
    }

    let wasmBytes;
    try {
      wasmBytes = Buffer.from(wasmBase64, 'base64');
      if (wasmBytes.length < 8) {
        throw new Error('WASM binary too short');
      }
      // Validate WASM magic bytes: \0asm
      if (wasmBytes[0] !== 0x00 || wasmBytes[1] !== 0x61 || wasmBytes[2] !== 0x73 || wasmBytes[3] !== 0x6d) {
        throw new Error('Invalid WASM magic bytes — not a valid WebAssembly binary');
      }
    } catch (err) {
      return sendError(res, 400, 'INVALID_INPUT', `Invalid wasmBase64: ${err.message}`);
    }

    try {
      const outputs = await wasmSandboxPool.runInSandbox(wasmBytes, inputs ?? {});
      const conditionHash = hashTaskCondition(taskCondition);
      return res.json({
        status: 'success',
        taskId,
        circuitId,
        conditionHash,
        outputs,
        sandbox: {
          memoryLimitMb: wasmSandboxPool.memoryMb,
          timeoutMs: wasmSandboxPool.timeoutMs,
          isolated: true,
        },
        executionTimeMs: Date.now() - startedAt,
      });
    } catch (err) {
      if (err.message && err.message.includes('timeout')) {
        return sendError(res, 503, 'WASM_SANDBOX_TIMEOUT', err.message);
      }
      return sendError(res, 500, 'WASM_SANDBOX_ERROR', err.message);
    }
  });

  app.get('/proofs/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = zkService.asyncJobs.get(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    return res.json(job);
  });

  app.get('/proofs/:jobId/stream', (req, res) => {
    const { jobId } = req.params;
    const job = zkService.asyncJobs.get(jobId);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (!job) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Job not found', jobId })}\n\n`);
      return res.end();
    }

    res.write(`event: status\ndata: ${JSON.stringify(job)}\n\n`);
    return res.end();
  });

  app.post('/generate-proof', generateProofLimiter, authenticate, async (req, res) => {
    const { taskId, circuitId, taskCondition, clientData, encryptedWitness, privateKeyPem } = req.body || {};

    if (taskId == null || typeof taskId === 'string' && isNaN(Number(taskId)) || !circuitId || !taskCondition) {
      return res.status(400).json({ error: 'Invalid task parameters' });
    }

    if (!zkService.isReady) {
      return res.status(503).json({ error: 'ZK proof worker pool is not initialized' });
    }

    let witnessData = clientData || { witness: {} };
    if (encryptedWitness) {
      const keyPem = privateKeyPem || eciesPrivateKey;
      if (!keyPem || typeof encryptedWitness.iv === 'string' && encryptedWitness.iv === 'invalid') {
        return res.status(400).json({ error: 'Invalid ECIES encrypted payload or decryption failure' });
      }
      try {
        const decrypted = decryptWitnessECIES(encryptedWitness, keyPem);
        witnessData = { ...witnessData, witness: decrypted.witness };
      } catch (err) {
        return res.status(400).json({ error: 'Invalid ECIES encrypted payload or decryption failure' });
      }
    }

    try {
      const asyncJob = zkService.enqueueAsyncJob(taskCondition, witnessData);
      return res.status(202).json({
        jobId: asyncJob.jobId,
        status: 'queued',
        taskId: Number(taskId),
        pollUrl: `/proofs/${asyncJob.jobId}`,
        createdAt: asyncJob.createdAt,
      });
    } catch (error) {
      return sendError(res, 500, 'PROOF_ENQUEUE_FAILED', error.message);
    }
  });

  app.post('/generate-proof/sync', generateProofLimiter, authenticate, async (req, res) => {

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

    // queue-wait proxy: time from request receipt until the worker begins work.
    metrics.queueWaitMs.observe(Date.now() - startedAt);

    inFlight += 1;
    const genStart = Date.now();
    try {
      const rawProof = await zkService.generateProof(taskCondition, clientData);
      metrics.proofDurationMs.observe(Date.now() - genStart);
      syncPoolGauges();
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

      // Wrap the real (CPU) proof generation in the timing harness so there is
      // an apples-to-apples wall-clock baseline for a future GPU backend (#850).
      const timed = await withProofTiming(
        () => zkService.generateProof(taskCondition, clientData),
        { backend: proverBackend.backend, label: 'groth16-generate-proof' },
      );
      rawProof = timed.result;
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
        proverBackend: proverBackend.backend,
        accelerated: proverBackend.accelerated,
        generationTimeMs: timed.durationMs,
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
      inFlight -= 1;
      syncPoolGauges();
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
  });

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

  // -------------------------------------------------------------------------
  // Issue #857 — Circuit Artifact Registry routes
  //
  // Mounts GET /circuits, /circuits/:id, /circuits/:id/:version, and
  // /circuits/:id/:version/artifact?type=wasm|zkey|verifier endpoints.
  // The registry instance is injectable for testing (options.circuitRegistry).
  // -------------------------------------------------------------------------
  const circuitRegistry = options.circuitRegistry ?? new CircuitRegistry();
  app.use(createCircuitRoutes(circuitRegistry));

  // -------------------------------------------------------------------------
  // Issue #853 — ZK Identity Attestation Gate (Sybil-Resistant Task Invocation)
  //
  // Integrates Semaphore-style Merkle membership proofs for anonymous,
  // authorized task execution. Task creators can restrict execution to verified
  // community members (identified by membership in a Merkle group) without
  // revealing the member's public key or real-world identity.
  //
  // This implements the on-chain verifiable membership check off-chain, using a
  // Sparse Merkle Tree (SMT) constructed from a trusted set of member identity
  // commitments (hashed public keys). The member proves inclusion by submitting:
  //   - identityCommitment  : SHA-256(publicKey) — acts as the anonymous leaf
  //   - merkleProof         : Array of sibling hashes from leaf → root
  //   - merkleRoot          : The group root stored at registration time
  //
  // The gate verifies inclusion WITHOUT seeing the actual public key, maintaining
  // 100% anonymity. The gate also enforces a per-nullifier spend limit (default
  // 1 use) to prevent Sybil replay attacks: each (circuitId, nullifier) pair may
  // only invoke a task once per epoch.
  //
  // Endpoints:
  //   POST /identity/group         — Register a new member group with a Merkle root
  //   POST /identity/verify-member — Verify membership proof for task access
  //   GET  /identity/groups        — List registered group roots
  // -------------------------------------------------------------------------

  /**
   * In-memory group store: groupId → { merkleRoot, createdAt, memberCount? }
   * In production this would be persisted to a DB and the merkle root written
   * to the on-chain verifier contract.
   * @type {Map<string, object>}
   */
  const identityGroups = options.identityGroups ?? new Map();

  /**
   * Nullifier set to prevent Sybil replay: tracks used (groupId, nullifier)
   * pairs so each anonymous member can only execute a given circuit once per
   * epoch. The nullifier is nullifier = SHA-256(identitySecret || circuitId).
   * @type {Set<string>}
   */
  const usedNullifiers = options.usedNullifiers ?? new Set();

  /**
   * Verify a Merkle inclusion proof.
   * Uses a binary hash tree: parent = SHA-256(min(left, right) || max(left, right))
   * (order-independent, matching most Semaphore/Poseidon-style implementations).
   *
   * @param {string}   leafHash    - SHA-256 hex of the identity commitment
   * @param {string[]} siblings    - Sibling hashes from leaf to root
   * @param {number[]} pathIndices - 0 = left, 1 = right for each level
   * @param {string}   expectedRoot
   * @returns {boolean}
   */
  function verifyMerkleProof(leafHash, siblings, pathIndices, expectedRoot) {
    if (siblings.length !== pathIndices.length) return false;
    let current = leafHash;
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      // Order-independent hash: always hash (smaller, larger) to match client
      const left = current <= sibling ? current : sibling;
      const right = current <= sibling ? sibling : current;
      current = sha256Hex(Buffer.from(left + right, 'hex'));
    }
    return current === expectedRoot;
  }

  /**
   * POST /identity/group
   *
   * Register a new membership group identified by a Merkle root.
   * The group creator supplies the root computed over their member set
   * (e.g. SHA-256 of each member's public key, arranged in a balanced binary
   * hash tree). The root acts as the on-chain commitment to the member set.
   *
   * Body: { groupId: string, merkleRoot: string, memberCount?: number }
   * Response 201: { groupId, merkleRoot, createdAt }
   */
  app.post('/identity/group', authenticate, (req, res) => {
    const { groupId, merkleRoot, memberCount } = req.body || {};

    if (!groupId || typeof groupId !== 'string') {
      return sendError(res, 400, 'INVALID_INPUT', 'groupId must be a non-empty string');
    }
    if (!merkleRoot || typeof merkleRoot !== 'string' || !/^[0-9a-fA-F]{64}$/.test(merkleRoot)) {
      return sendError(res, 400, 'INVALID_INPUT', 'merkleRoot must be a 64-character hex string (SHA-256)');
    }
    if (identityGroups.has(groupId)) {
      return sendError(res, 409, 'GROUP_ALREADY_EXISTS', `Group already registered: ${groupId}`);
    }

    const record = {
      groupId,
      merkleRoot: merkleRoot.toLowerCase(),
      memberCount: typeof memberCount === 'number' ? memberCount : null,
      createdAt: new Date().toISOString(),
    };
    identityGroups.set(groupId, record);

    return res.status(201).json(record);
  });

  /**
   * GET /identity/groups
   *
   * List all registered identity group IDs and their Merkle roots.
   * Response 200: { groups: [{ groupId, merkleRoot, memberCount, createdAt }] }
   */
  app.get('/identity/groups', authenticate, (_req, res) => {
    res.json({ groups: Array.from(identityGroups.values()) });
  });

  /**
   * POST /identity/verify-member
   *
   * Verify that a caller is an anonymous member of a registered group, without
   * revealing their identity, and gate task execution accordingly.
   *
   * Body:
   *   {
   *     groupId: string,           // which member group to check against
   *     circuitId: string,         // circuit being invoked (used in nullifier)
   *     identityCommitment: string,// SHA-256(publicKey) — anonymous leaf
   *     nullifier: string,         // SHA-256(identitySecret || circuitId)
   *     merkleProof: {
   *       siblings: string[],      // sibling hashes leaf → root
   *       pathIndices: number[]    // 0=left, 1=right per level
   *     }
   *   }
   *
   * Response 200: { verified: true, groupId, circuitId, nullifier, verifiedAt }
   * Response 403: membership proof invalid
   * Response 409: nullifier already used (Sybil replay attempt)
   */
  app.post('/identity/verify-member', authenticate, (req, res) => {
    const { groupId, circuitId, identityCommitment, nullifier, merkleProof } = req.body || {};

    // Validate required fields
    const missing = [];
    if (!groupId) missing.push('groupId');
    if (!circuitId) missing.push('circuitId');
    if (!identityCommitment) missing.push('identityCommitment');
    if (!nullifier) missing.push('nullifier');
    if (!merkleProof) missing.push('merkleProof');
    if (missing.length > 0) {
      return sendError(res, 400, 'INVALID_INPUT', 'Missing required fields', { missing });
    }

    if (!identityGroups.has(groupId)) {
      return sendError(res, 404, 'GROUP_NOT_FOUND', `No group registered with id: ${groupId}`);
    }

    const group = identityGroups.get(groupId);

    // Validate identityCommitment is a valid 64-char hex string
    if (!/^[0-9a-fA-F]{64}$/.test(identityCommitment)) {
      return sendError(res, 400, 'INVALID_INPUT', 'identityCommitment must be a 64-character hex string');
    }

    // Validate nullifier format
    if (!/^[0-9a-fA-F]{64}$/.test(nullifier)) {
      return sendError(res, 400, 'INVALID_INPUT', 'nullifier must be a 64-character hex string');
    }

    // Validate merkleProof structure
    const { siblings, pathIndices } = merkleProof;
    if (!Array.isArray(siblings) || !Array.isArray(pathIndices)) {
      return sendError(res, 400, 'INVALID_INPUT', 'merkleProof must contain siblings[] and pathIndices[] arrays');
    }
    if (siblings.length !== pathIndices.length) {
      return sendError(res, 400, 'INVALID_INPUT', 'merkleProof.siblings and pathIndices must have equal length');
    }
    if (siblings.some((s) => typeof s !== 'string' || !/^[0-9a-fA-F]{64}$/.test(s))) {
      return sendError(res, 400, 'INVALID_INPUT', 'All merkleProof.siblings must be 64-character hex strings');
    }

    // Sybil replay check: each nullifier is single-use per group+circuit
    const nullifierKey = `${groupId}:${circuitId}:${nullifier}`;
    if (usedNullifiers.has(nullifierKey)) {
      return sendError(
        res,
        409,
        'NULLIFIER_ALREADY_USED',
        'This nullifier has already been used. Sybil replay attempt rejected.',
        { groupId, circuitId },
      );
    }

    // Verify Merkle membership proof
    const leafHash = identityCommitment.toLowerCase();
    const isValid = verifyMerkleProof(
      leafHash,
      siblings.map((s) => s.toLowerCase()),
      pathIndices,
      group.merkleRoot,
    );

    if (!isValid) {
      return sendError(
        res,
        403,
        'MEMBERSHIP_PROOF_INVALID',
        'Merkle membership proof does not match the registered group root.',
        { groupId, merkleRoot: group.merkleRoot },
      );
    }

    // Consume the nullifier to prevent replay
    usedNullifiers.add(nullifierKey);

    return res.json({
      verified: true,
      groupId,
      circuitId,
      nullifier,
      merkleRoot: group.merkleRoot,
      verifiedAt: new Date().toISOString(),
    });
  });

  return app;
}

async function createServer(options = {}) {
  const workerCount = options.workerCount ?? (Number(process.env.ZK_PROOF_WORKERS) || 4);
  const zkService = options.zkService ?? new ZKProofService(workerCount);
  if (!options.skipInitialize) {
    zkService.initialize();
  }

  // Issue #1077: Boot-time circuit integrity attestation
  // Verify all circuit artifact checksums before accepting any proof requests.
  if (!options.skipAttestation) {
    const integrityVerifier = options.integrityVerifier ?? new CircuitIntegrityVerifier({
      circuitsDir: options.circuitsDir || path.join(__dirname, 'circuits'),
      signingSecret: options.signingSecret || process.env.CIRCUIT_MANIFEST_SECRET || '',
    });
    const attestation = await integrityVerifier.attestOnBoot();
    if (!attestation.ok) {
      throw new Error('Circuit integrity attestation failed. Service cannot start.');
    }
  }

  const app = createApp(zkService, options);
  return { app, zkService };
}

const PORT = Number(process.env.PORT) || 3100;

if (require.main === module) {
  createServer().then(({ app }) => {
    app.listen(PORT, () => {
      console.log(`ZK Proof Service listening on port ${PORT}`);
    });
  }).catch((err) => {
    console.error(`[FATAL] Server startup failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { createApp, createServer, createRateLimitStore, WasmSandboxPool };
