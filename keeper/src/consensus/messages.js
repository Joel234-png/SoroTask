/**
 * Consensus protocol message schemas and helpers
 * Defines the structure for all inter-keeper consensus messages
 */

const crypto = require('crypto');

/**
 * Message types in the consensus protocol
 */
const MESSAGE_TYPES = {
  // Task proposal: proposer announces a task is due
  PROPOSE: 'propose',
  // Vote: keeper votes on whether task is due
  VOTE: 'vote',
  // Commit: quorum reached, task is approved for execution
  COMMIT: 'commit',
  // Execute: single keeper executes the task
  EXECUTE: 'execute',
  // Result: execution result broadcast to all keepers
  RESULT: 'result',
  // Nack: reject a proposal (used for conflict resolution)
  NACK: 'nack',
};

/**
 * Consensus message format
 * @typedef {Object} ConsensusMessage
 * @property {string} type - MESSAGE_TYPES value
 * @property {string} id - Unique message ID (UUID)
 * @property {number} epoch - Consensus epoch number
 * @property {string} taskId - Task being voted on
 * @property {string} proposerId - Keeper ID of proposer
 * @property {string} voterId - Keeper ID casting vote (vote messages only)
 * @property {boolean} vote - true/false for vote messages
 * @property {number} timestamp - When message was created
 * @property {string} signature - HMAC-SHA256 signature
 * @property {Object} metadata - Protocol-specific metadata
 */

/**
 * Create a consensus message
 * @param {string} type - Message type
 * @param {Object} data - Message data
 * @param {string} keeperId - ID of keeper creating message
 * @param {string} secret - HMAC secret for signing
 * @returns {Object} Signed consensus message
 */
function createMessage(type, data, keeperId, secret) {
  const id = crypto.randomUUID();
  const timestamp = Date.now();

  const message = {
    type,
    id,
    epoch: data.epoch || 0,
    taskId: data.taskId,
    proposerId: data.proposerId || keeperId,
    voterId: data.voterId || null,
    vote: data.vote !== undefined ? data.vote : null,
    timestamp,
    executorId: data.executorId || null,
    result: data.result || null,
    metadata: data.metadata || {},
  };

  // Sign message
  message.signature = signMessage(message, secret);

  return message;
}

/**
 * Sign a message using HMAC-SHA256
 * @param {Object} message - Message to sign (without signature field)
 * @param {string} secret - Signing secret
 * @returns {string} HMAC signature
 */
function signMessage(message, secret) {
  // Remove signature field for signing
  const { _signature, ...unsigned } = message;
  const payload = JSON.stringify(unsigned);
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verify message signature
 * @param {Object} message - Message to verify
 * @param {string} secret - Verification secret
 * @returns {boolean} True if signature is valid
 */
function verifySignature(message, secret) {
  const { signature, ...unsigned } = message;
  const expectedSig = signMessage(unsigned, secret);
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig));
}

/**
 * Propose message: announces task is due for execution
 * @param {string} taskId - Task to propose
 * @param {number} epoch - Current epoch
 * @param {string} keeperId - Keeper proposing
 * @param {string} secret - HMAC secret
 * @returns {Object} Signed propose message
 */
function createProposalMessage(taskId, epoch, keeperId, secret) {
  return createMessage(
    MESSAGE_TYPES.PROPOSE,
    { taskId, epoch },
    keeperId,
    secret,
  );
}

/**
 * Vote message: keeper votes on task proposal
 * @param {string} taskId - Task being voted on
 * @param {number} epoch - Epoch of proposal
 * @param {boolean} approve - true to approve, false to reject
 * @param {string} voterId - Keeper voting
 * @param {string} proposerId - Original proposer ID
 * @param {string} secret - HMAC secret
 * @returns {Object} Signed vote message
 */
function createVoteMessage(taskId, epoch, approve, voterId, proposerId, secret) {
  return createMessage(
    MESSAGE_TYPES.VOTE,
    { taskId, epoch, vote: approve, voterId, proposerId },
    voterId,
    secret,
  );
}

/**
 * Commit message: quorum reached for task execution
 * @param {string} taskId - Task approved
 * @param {number} epoch - Epoch of approval
 * @param {string} executorId - Keeper assigned to execute
 * @param {string} proposerId - Original proposer
 * @param {string} secret - HMAC secret
 * @returns {Object} Signed commit message
 */
function createCommitMessage(taskId, epoch, executorId, proposerId, secret) {
  return createMessage(
    MESSAGE_TYPES.COMMIT,
    { taskId, epoch, executorId, proposerId },
    proposerId,
    secret,
  );
}

/**
 * Result message: execution result broadcast
 * @param {string} taskId - Executed task
 * @param {string} executorId - Keeper that executed
 * @param {boolean} success - Execution success status
 * @param {Object} metadata - Result metadata
 * @param {string} secret - HMAC secret
 * @returns {Object} Signed result message
 */
function createResultMessage(taskId, executorId, success, metadata, secret) {
  return createMessage(
    MESSAGE_TYPES.RESULT,
    { taskId, executorId, result: { success, metadata } },
    executorId,
    secret,
  );
}

module.exports = {
  MESSAGE_TYPES,
  createMessage,
  signMessage,
  verifySignature,
  createProposalMessage,
  createVoteMessage,
  createCommitMessage,
  createResultMessage,
};
