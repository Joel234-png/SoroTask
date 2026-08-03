const client = require('prom-client');

// Initialize Registry
const register = new client.Registry();

// Add default metrics (CPU, memory, etc.)
client.collectDefaultMetrics({ register, prefix: 'indexer_' });

// Define custom metrics as per Issue #926
const indexerLedgerHead = new client.Gauge({
  name: 'indexer_ledger_head',
  help: 'Current ledger sequence processed by the indexer',
});

const networkLedgerHead = new client.Gauge({
  name: 'network_ledger_head',
  help: 'Latest ledger sequence on the Stellar network head',
});

const indexerLagLedgers = new client.Gauge({
  name: 'indexer_lag_ledgers',
  help: 'Number of ledgers the indexer is lagging behind the network head',
});

const eventsIndexedTotal = new client.Counter({
  name: 'events_indexed_total',
  help: 'Total number of contract events indexed',
  labelNames: ['event_name'],
});

// Register metrics
register.registerMetric(indexerLedgerHead);
register.registerMetric(networkLedgerHead);
register.registerMetric(indexerLagLedgers);
register.registerMetric(eventsIndexedTotal);

/**
 * Updates ledger head metrics and computes current indexer lag.
 * @param {number} indexerHead - Current indexer ledger sequence
 * @param {number} networkHead - Latest network ledger sequence
 */
function updateLedgerMetrics(indexerHead, networkHead) {
  if (typeof indexerHead === 'number') {
    indexerLedgerHead.set(indexerHead);
  }
  if (typeof networkHead === 'number') {
    networkLedgerHead.set(networkHead);
  }
  if (typeof indexerHead === 'number' && typeof networkHead === 'number') {
    const lag = Math.max(0, networkHead - indexerHead);
    indexerLagLedgers.set(lag);
  }
}

/**
 * Increments the indexed events counter.
 * @param {string} eventName - Name of the event processed
 * @param {number} [count=1] - Count to increment
 */
function recordEventIndexed(eventName = 'unknown', count = 1) {
  eventsIndexedTotal.inc({ event_name: eventName }, count);
}

/**
 * Express middleware handler for scraping Prometheus metrics.
 */
async function metricsHandler(req, res) {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
}

module.exports = {
  register,
  indexerLedgerHead,
  networkLedgerHead,
  indexerLagLedgers,
  eventsIndexedTotal,
  updateLedgerMetrics,
  recordEventIndexed,
  metricsHandler,
};
