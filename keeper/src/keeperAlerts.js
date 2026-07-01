'use strict';

/**
 * keeperAlerts.js - Webhook alerting for persistent keeper failures
 *
 * Triggers Slack or Discord alerts when:
 * - X consecutive task executions fail
 * - RPC connection is down for more than 5 minutes
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const { createLogger } = require('./logger');

const logger = createLogger('keeper-alerts');

const DEFAULT_CONSECUTIVE_FAILURE_THRESHOLD = parseInt(
  process.env.ALERT_CONSECUTIVE_FAILURE_THRESHOLD || '3',
  10,
);
const DEFAULT_RPC_DOWN_THRESHOLD_MS = parseInt(
  process.env.ALERT_RPC_DOWN_THRESHOLD_MS || String(5 * 60 * 1000),
  10,
);

function buildSlackPayload(message, details = {}) {
  return JSON.stringify({
    text: `*SoroTask Keeper Alert*\n${message}`,
    attachments: Object.keys(details).length
      ? [
          {
            color: '#ff0000',
            fields: Object.entries(details).map(([k, v]) => ({
              title: k,
              value: String(v),
              short: true,
            })),
          },
        ]
      : undefined,
  });
}

function buildDiscordPayload(message, details = {}) {
  const fields = Object.entries(details).map(([name, value]) => ({
    name,
    value: String(value),
    inline: true,
  }));
  return JSON.stringify({
    embeds: [
      {
        title: 'SoroTask Keeper Alert',
        description: message,
        color: 0xff0000,
        fields: fields.length ? fields : undefined,
        timestamp: new Date().toISOString(),
      },
    ],
  });
}

function postWebhook(webhookUrl, body) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(webhookUrl);
    } catch {
      return reject(new Error(`Invalid webhook URL: ${webhookUrl}`));
    }

    const protocol = parsed.protocol === 'https:' ? https : http;
    const data = Buffer.from(body, 'utf8');
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
      },
    };

    const req = protocol.request(options, (res) => {
      res.resume();
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve();
      } else {
        reject(new Error(`Webhook responded with status ${res.statusCode}`));
      }
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error('Webhook request timed out'));
    });
    req.write(data);
    req.end();
  });
}

function isDiscordUrl(url) {
  return url.includes('discord.com/api/webhooks') || url.includes('discordapp.com/api/webhooks');
}

async function sendAlert(webhookUrl, message, details = {}) {
  if (!webhookUrl) return;
  const body = isDiscordUrl(webhookUrl)
    ? buildDiscordPayload(message, details)
    : buildSlackPayload(message, details);
  try {
    await postWebhook(webhookUrl, body);
    logger.info('Alert sent', { message });
  } catch (err) {
    logger.error('Failed to send alert', { error: err.message, webhookUrl });
  }
}

class KeeperAlertManager {
  constructor(options = {}) {
    this.webhookUrl =
      options.webhookUrl ||
      process.env.ALERT_WEBHOOK_URL ||
      process.env.SLACK_WEBHOOK_URL ||
      process.env.DISCORD_WEBHOOK_URL ||
      null;

    this.consecutiveFailureThreshold =
      options.consecutiveFailureThreshold ?? DEFAULT_CONSECUTIVE_FAILURE_THRESHOLD;

    this.rpcDownThresholdMs =
      options.rpcDownThresholdMs ?? DEFAULT_RPC_DOWN_THRESHOLD_MS;

    this._consecutiveFailures = 0;
    this._rpcDownSince = null;
    this._rpcAlertSent = false;
    this._rpcCheckInterval = null;
  }

  recordSuccess() {
    this._consecutiveFailures = 0;
  }

  async recordFailure(details = {}) {
    this._consecutiveFailures += 1;
    logger.warn('Task execution failure recorded', {
      consecutiveFailures: this._consecutiveFailures,
      threshold: this.consecutiveFailureThreshold,
    });

    if (this._consecutiveFailures >= this.consecutiveFailureThreshold) {
      await sendAlert(
        this.webhookUrl,
        `${this._consecutiveFailures} consecutive task execution failures detected.`,
        { consecutiveFailures: this._consecutiveFailures, ...details },
      );
    }
  }

  recordRpcUp() {
    if (this._rpcDownSince !== null) {
      logger.info('RPC connection restored');
    }
    this._rpcDownSince = null;
    this._rpcAlertSent = false;
  }

  async recordRpcDown() {
    if (this._rpcDownSince === null) {
      this._rpcDownSince = Date.now();
      logger.warn('RPC connection down, monitoring for alert threshold', {
        thresholdMs: this.rpcDownThresholdMs,
      });
    }

    const downMs = Date.now() - this._rpcDownSince;
    if (!this._rpcAlertSent && downMs >= this.rpcDownThresholdMs) {
      this._rpcAlertSent = true;
      await sendAlert(
        this.webhookUrl,
        `RPC connection has been down for ${Math.round(downMs / 1000)}s (threshold: ${Math.round(this.rpcDownThresholdMs / 1000)}s).`,
        { downSeconds: Math.round(downMs / 1000) },
      );
    }
  }

  startRpcMonitor(rpcCheckFn, intervalMs = 30000) {
    this._rpcCheckInterval = setInterval(async () => {
      try {
        await rpcCheckFn();
        this.recordRpcUp();
      } catch {
        await this.recordRpcDown();
      }
    }, intervalMs);
  }

  stopRpcMonitor() {
    if (this._rpcCheckInterval) {
      clearInterval(this._rpcCheckInterval);
      this._rpcCheckInterval = null;
    }
  }
}

module.exports = { KeeperAlertManager, sendAlert };
