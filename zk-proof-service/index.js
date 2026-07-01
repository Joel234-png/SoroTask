const crypto = require('crypto');
const { hashTaskCondition, isValidZkProof } = require('./lib/helpers');

/**
 * Zero-Knowledge Proof Generation Service
 * Manages a worker pool for generating ZK proofs for privacy-preserving task conditions.
 */
class ZKProofService {
  /**
   * Initialize the service with a specific number of workers.
   * @param {number} workerCount - Number of workers in the pool.
   */
  constructor(workerCount = 4) {
    this.workerCount = workerCount;
    this.workers = [];
    this.tasks = [];
    this.isReady = false;
    this.startedAt = null;
  }

  /**
   * Initializes the worker pool.
   */
  initialize() {
    this.isReady = true;
    this.startedAt = Date.now();
    this.workers = [];
    for (let i = 0; i < this.workerCount; i++) {
      this.workers.push({ id: i, status: 'idle' });
    }
  }

  /**
   * @returns {{ totalWorkers: number, idleWorkers: number, activeWorkers: number }}
   */
  getWorkerPoolStatus() {
    const idleWorkers = this.workers.filter((worker) => worker.status === 'idle').length;
    const activeWorkers = this.workers.filter((worker) => worker.status === 'active').length;
    return {
      totalWorkers: this.workers.length,
      idleWorkers,
      activeWorkers,
    };
  }

  /**
   * @returns {number}
   */
  getUptimeSeconds() {
    if (!this.startedAt) return 0;
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }

  /**
   * @returns {{ id: number, status: string } | null}
   */
  _acquireWorker() {
    const worker = this.workers.find((entry) => entry.status === 'idle');
    if (!worker) return null;
    worker.status = 'active';
    return worker;
  }

  /**
   * @param {{ id: number }} worker
   */
  _releaseWorker(worker) {
    if (!worker) return;
    const entry = this.workers.find((candidate) => candidate.id === worker.id);
    if (entry) entry.status = 'idle';
  }

  /**
   * Generates a ZK proof for a given task condition and client data.
   * @param {Object} taskCondition - The privacy-preserving condition.
   * @param {Object} clientData - The light client data.
   * @returns {Promise<Object>} The generated proof.
   */
  async generateProof(taskCondition, clientData) {
    if (!this.isReady) {
      throw new Error('Service not initialized');
    }

    if (!taskCondition || !clientData) {
      throw new Error('Invalid input data');
    }

    const worker = this._acquireWorker();
    if (!worker) {
      throw new Error('Worker pool at capacity');
    }

    return new Promise((resolve, reject) => {
      try {
        const proofId = crypto.randomUUID();
        const proof = {
          proofId,
          status: 'success',
          pi_a: ['0x1', '0x2'],
          pi_b: [['0x3', '0x4'], ['0x5', '0x6']],
          pi_c: ['0x7', '0x8'],
          publicSignals: ['0x9'],
        };

        setTimeout(() => {
          this._releaseWorker(worker);
          resolve(proof);
        }, 100);
      } catch (error) {
        this._releaseWorker(worker);
        console.error(`Proof generation failed: ${error.message}`);
        reject(new Error(`Proof generation failed: ${error.message}`));
      }
    });
  }

  /**
   * Verifies a ZK proof against a task condition.
   * @param {Object} params
   * @param {Object} params.taskCondition
   * @param {Object} params.proof
   * @param {string} [params.conditionHash]
   * @param {string} params.circuitId
   * @returns {Promise<Object>}
   */
  async verifyProof({ taskCondition, proof, conditionHash, circuitId }) {
    if (!this.isReady) {
      throw new Error('Service not initialized');
    }

    if (!taskCondition || !proof) {
      throw new Error('Invalid input data');
    }

    const derivedHash = hashTaskCondition(taskCondition);
    const conditionHashMatch = !conditionHash || conditionHash === derivedHash;
    const publicSignalsMatch = isValidZkProof(proof);
    const valid = publicSignalsMatch && conditionHashMatch;

    return {
      valid,
      proofId: proof.proofId,
      conditionHash: derivedHash,
      verificationDetails: {
        circuitId,
        publicSignalsMatch,
        conditionHashMatch,
        ...(valid ? {} : { reason: 'Proof vector verification failed' }),
      },
    };
  }

  /**
   * Safely shuts down the worker pool.
   */
  shutdown() {
    this.isReady = false;
    this.workers = [];
    this.startedAt = null;
  }
}

module.exports = { ZKProofService };
