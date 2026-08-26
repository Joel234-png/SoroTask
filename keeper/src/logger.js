/**
 * Structured Logging Module for SoroTask Keeper
 *
 * Uses pino for high-performance JSON logging with ECS & OpenTelemetry compliance:
 * - ECS & standard fields: service, service_name, environment, trace_id, task_id, ledger_sequence
 * - W3C TraceContext traceparent support
 * - Automatic redaction of sensitive fields
 * - NDJSON output in production conforming 100% to structured JSON schema
 */

const pino = require('pino');
const { extractOrCreateTraceContext, formatTraceParent } = require('../../scripts/traceContext');

const SENSITIVE_FIELDS = [
  'secret',
  'secretKey',
  'privateKey',
  'password',
  'token',
  'apiKey',
  'keeperSecret',
  'KEEPER_SECRET',
  'keypair',
];

const VALID_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

function normalizeLogLevel(level) {
  return VALID_LOG_LEVELS.includes(level) ? level : 'info';
}

function shouldUsePrettyTransport() {
  return process.env.LOG_FORMAT === 'pretty';
}

/**
 * Create base pino logger instance formatted for ECS / OpenTelemetry compatibility
 */
function createBaseLogger(overrides = {}, destination) {
  const loggerOptions = {
    level: normalizeLogLevel(process.env.LOG_LEVEL),
    base: {
      service: 'keeper',
      service_name: 'keeper',
      environment: process.env.NODE_ENV || 'production',
      pid: process.pid,
    },
    redact: {
      paths: SENSITIVE_FIELDS,
      remove: true,
    },
    formatters: {
      bindings(bindings) {
        return {
          service: 'keeper',
          service_name: 'keeper',
          environment: process.env.NODE_ENV || 'production',
          pid: bindings.pid,
          module: bindings.module,
        };
      },
      level(label) {
        return { level: label };
      },
      log(object) {
        const formatted = { ...object };
        if (formatted.traceId && !formatted.trace_id) {
          formatted.trace_id = formatted.traceId;
        }
        if (formatted.taskId && !formatted.task_id) {
          formatted.task_id = formatted.taskId;
        }
        if (formatted.ledgerSequence && !formatted.ledger_sequence) {
          formatted.ledger_sequence = formatted.ledgerSequence;
        }
        return formatted;
      },
    },
    messageKey: 'message',
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
    ...overrides,
  };

  if (shouldUsePrettyTransport()) {
    loggerOptions.transport = loggerOptions.transport || {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        messageFormat: '{module} - {msg}',
      },
    };
  }

  const logger = destination ? pino(loggerOptions, destination) : pino(loggerOptions);
  logger.logFormat = shouldUsePrettyTransport() ? 'pretty' : 'json';
  return logger;
}

let baseLogger = null;

function getBaseLogger() {
  if (!baseLogger) {
    baseLogger = createBaseLogger();
  }
  return baseLogger;
}

function createLogger(module) {
  const parent = getBaseLogger();
  const child = parent.child({ module });

  return {
    trace: (msg, meta = {}) => {
      child.trace(meta, msg);
    },
    debug: (msg, meta = {}) => {
      child.debug(meta, msg);
    },
    info: (msg, meta = {}) => {
      child.info(meta, msg);
    },
    warn: (msg, meta = {}) => {
      child.warn(meta, msg);
    },
    error: (msg, meta = {}) => {
      child.error(meta, msg);
    },
    fatal: (msg, meta = {}) => {
      child.fatal(meta, msg);
    },
    raw: child,
    childWithTrace: (correlationIdOrContext) => {
      let traceMeta = {};
      if (typeof correlationIdOrContext === 'string') {
        traceMeta = { correlationId: correlationIdOrContext, trace_id: correlationIdOrContext };
      } else if (correlationIdOrContext && typeof correlationIdOrContext === 'object') {
        traceMeta = correlationIdOrContext;
      }
      const traceChild = child.child(traceMeta);
      return createTracedLogger(traceChild, module);
    },
  };
}

function createTracedLogger(child, module) {
  return {
    trace: (msg, meta = {}) => {
      child.trace(meta, msg);
    },
    debug: (msg, meta = {}) => {
      child.debug(meta, msg);
    },
    info: (msg, meta = {}) => {
      child.info(meta, msg);
    },
    warn: (msg, meta = {}) => {
      child.warn(meta, msg);
    },
    error: (msg, meta = {}) => {
      child.error(meta, msg);
    },
    fatal: (msg, meta = {}) => {
      child.fatal(meta, msg);
    },
    raw: child,
    childWithTrace: (correlationIdOrContext) => {
      let traceMeta = {};
      if (typeof correlationIdOrContext === 'string') {
        traceMeta = { correlationId: correlationIdOrContext, trace_id: correlationIdOrContext };
      } else if (correlationIdOrContext && typeof correlationIdOrContext === 'object') {
        traceMeta = correlationIdOrContext;
      }
      const traceChild = child.child(traceMeta);
      return createTracedLogger(traceChild, module);
    },
  };
}

function createChildLogger(module) {
  return createLogger(module);
}

function reinitializeLogger(options = {}) {
  const { destination, ...loggerOptions } = options;
  baseLogger = createBaseLogger(loggerOptions, destination);
}

function getLogLevel() {
  return getBaseLogger().level;
}

function setLogLevel(level) {
  getBaseLogger().level = level;
}

function injectW3CTraceContext(context = {}, traceId) {
  const traceCtx = extractOrCreateTraceContext({ 'traceparent': context.traceparent || traceId });
  context.traceparent = traceCtx.traceparent;
  context.trace_id = traceCtx.traceId;
  return context;
}

module.exports = {
  createLogger,
  createChildLogger,
  getBaseLogger,
  reinitializeLogger,
  getLogLevel,
  setLogLevel,
  normalizeLogLevel,
  SENSITIVE_FIELDS,
  injectW3CTraceContext,
};
