const { WebhookDispatcher } = require("./dispatcher");

/**
 * Optional BullMQ adapter. When Redis is unavailable, callers can use WebhookDispatcher directly.
 * @param {object} options
 * @param {string} options.redisUrl
 * @param {import('bullmq').QueueOptions} [options.queueOptions]
 */
function createBullMqWebhookQueue(options = {}) {
  if (!options.redisUrl) {
    return null;
  }

  let Queue;
  let Worker;
  try {
    ({ Queue, Worker } = require("bullmq"));
  } catch (_err) {
    return null;
  }

  const queueName = options.queueName || "indexer-webhooks";
  const connection = { url: options.redisUrl };
  const queue = new Queue(queueName, { connection });
  const dispatcher = options.dispatcher || new WebhookDispatcher();

  const worker = new Worker(
    queueName,
    async (job) => dispatcher.dispatch(job.data),
  );

  async function enqueueWebhook(payload, jobOptions = {}) {
    return queue.add("deliver", payload, {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: false,
      ...jobOptions,
    });
  }

  async function close() {
    await worker.close();
    await queue.close();
  }

  return { queue, worker, enqueueWebhook, close };
}

module.exports = { createBullMqWebhookQueue };
