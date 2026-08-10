const { DEFAULT_MAX_ATTEMPTS, computeBackoffDelayMs } = require("./backoff");
const { CircuitBreakerRegistry } = require("./circuitBreaker");
const { storeDeadLetter } = require("./deadLetterStore");

/**
 * @typedef {object} WebhookDeliveryRequest
 * @property {string} destinationId
 * @property {string} url
 * @property {object} body
 */

class WebhookDispatcher {
  /**
   * @param {object} [options]
   * @param {typeof fetch} [options.fetchImpl]
   * @param {CircuitBreakerRegistry} [options.circuitBreaker]
   * @param {number} [options.maxAttempts]
   * @param {(ms:number)=>Promise<void>} [options.sleep]
   */
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || global.fetch;
    this.circuitBreaker = options.circuitBreaker || new CircuitBreakerRegistry();
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async dispatch(request) {
    const { destinationId, url, body } = request;
    if (!destinationId || !url) {
      throw new Error("destinationId and url are required");
    }

    if (this.circuitBreaker.isOpen(destinationId)) {
      this.circuitBreaker.tryRecover(destinationId);
      if (this.circuitBreaker.isOpen(destinationId)) {
        const error = new Error(`Circuit open for destination ${destinationId}`);
        storeDeadLetter({
          destinationId,
          url,
          body,
          attempts: 0,
          error: error.message,
          reason: "circuit_open",
        });
        throw error;
      }
    }

    let lastError = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      if (attempt > 1) {
        await this.sleep(computeBackoffDelayMs(attempt - 1));
      }

      try {
        const response = await this.fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          throw new Error(`Webhook returned HTTP ${response.status}`);
        }
        this.circuitBreaker.recordSuccess(destinationId);
        return { success: true, attempts: attempt };
      } catch (err) {
        lastError = err;
        this.circuitBreaker.recordFailure(destinationId);
      }
    }

    storeDeadLetter({
      destinationId,
      url,
      body,
      attempts: this.maxAttempts,
      error: lastError?.message || "delivery failed",
      reason: "max_attempts_exceeded",
    });

    throw lastError || new Error("Webhook delivery failed");
  }
}

module.exports = { WebhookDispatcher };
