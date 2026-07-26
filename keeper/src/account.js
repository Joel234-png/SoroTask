const { Keypair, rpc, Account } = require('@stellar/stellar-sdk');
const { Server } = rpc;
const { createLogger } = require('./logger');

// Create logger for account module
const logger = createLogger('account');

/**
 * Loads the keeper's keypair and validates its on-chain state.
 *
 * We use Soroban RPC's getAccount endpoint because the keeper is primarily
 * interacting with Soroban contracts, and the RPC server provides the necessary
 * account state (sequence number, balances) required for transaction building.
 *
 * @returns {Promise<{ keypair: Keypair, accountResponse: any }>}
 */
let loadedSecretRef = null;

/**
 * Zero out sensitive memory references (buffer/string cleanup)
 */
function zeroOutMemory(ref) {
  if (typeof ref === 'string') {
    try {
      const buf = Buffer.from(ref);
      buf.fill(0);
    } catch (_err) {
      // ignore
    }
  }
}

function clearSecretMemory() {
  if (loadedSecretRef) {
    zeroOutMemory(loadedSecretRef);
    loadedSecretRef = null;
    logger.info('Secret key memory references zeroed out.');
  }
}

process.on('exit', () => {
  clearSecretMemory();
});

/**
 * Fetch secret key from HashiCorp Vault HTTP API
 */
async function fetchSecretFromVault(vaultAddr, vaultToken, secretPath = 'v1/secret/data/keeper') {
  try {
    const fetchFn = globalThis.fetch || require('node-fetch');
    const res = await fetchFn(`${vaultAddr.replace(/\/$/, '')}/${secretPath}`, {
      headers: { 'X-Vault-Token': vaultToken },
    });
    if (!res.ok) {
      throw new Error(`Vault returned HTTP status ${res.status}`);
    }
    const json = await res.json();
    const secret = json?.data?.data?.KEEPER_SECRET || json?.data?.KEEPER_SECRET;
    if (!secret) {
      throw new Error('KEEPER_SECRET key not found in Vault response');
    }
    return secret;
  } catch (err) {
    throw new Error(`Failed to fetch secret from HashiCorp Vault: ${err.message}`);
  }
}

/**
 * Fetch secret key from AWS Secrets Manager
 */
async function fetchSecretFromAWS(secretId, region = process.env.AWS_REGION || 'us-east-1') {
  try {
    const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
    const client = new SecretsManagerClient({ region });
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (response.SecretString) {
      try {
        const parsed = JSON.parse(response.SecretString);
        return parsed.KEEPER_SECRET || response.SecretString;
      } catch (_e) {
        return response.SecretString;
      }
    }
    throw new Error('SecretString empty in AWS Secrets Manager response');
  } catch (err) {
    throw new Error(`Failed to fetch secret from AWS Secrets Manager: ${err.message}`);
  }
}

/**
 * Loads secret key from configured secret provider (Vault, AWS, or env)
 */
async function loadSecretKey() {
  const provider = (process.env.KEY_PROVIDER || '').toLowerCase();
  let secret = null;

  if (provider === 'vault' || (process.env.VAULT_ADDR && process.env.VAULT_TOKEN)) {
    logger.info('Fetching keeper secret from HashiCorp Vault...');
    secret = await fetchSecretFromVault(
      process.env.VAULT_ADDR,
      process.env.VAULT_TOKEN,
      process.env.VAULT_SECRET_PATH || 'v1/secret/data/keeper',
    );
  } else if (provider === 'aws' || process.env.AWS_SECRET_ID) {
    logger.info('Fetching keeper secret from AWS Secrets Manager...');
    secret = await fetchSecretFromAWS(process.env.AWS_SECRET_ID);
  } else {
    secret = process.env.KEEPER_SECRET;
  }

  if (!secret) {
    throw new Error('KEEPER_SECRET environment variable is not defined');
  }

  loadedSecretRef = secret;
  return secret;
}

/**
 * Loads the keeper's keypair and validates its on-chain state.
 *
 * We use Soroban RPC's getAccount endpoint because the keeper is primarily
 * interacting with Soroban contracts, and the RPC server provides the necessary
 * account state (sequence number, balances) required for transaction building.
 *
 * @returns {Promise<{ keypair: Keypair, accountResponse: any }>}
 */
async function initializeKeeperAccount() {
  const secret = await loadSecretKey();

  let keypair;
  try {
    keypair = Keypair.fromSecret(secret);
  } catch (_err) {
    throw new Error('Failed to derive keypair from KEEPER_SECRET. Ensure it is a valid Stellar secret key.');
  } finally {
    zeroOutMemory(secret);
  }

  const publicKey = keypair.publicKey();
  logger.info('Keeper initialized', { publicKey });

  const rpcUrl = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
  const server = new Server(rpcUrl);

  let accountResponse;
  try {
    // Fetch account from network
    accountResponse = await server.getAccount(publicKey);
  } catch (err) {
    // Specific handling for account not found
    if (err.response && err.response.status === 404) {
      throw new Error(
        `Keeper account ${publicKey} not found on-chain. ` +
                'Please fund this account with at least 1-2 XLM to enable transaction submission.',
      );
    }
    throw new Error(`Failed to fetch keeper account from RPC: ${err.message}`);
  }

  return { keypair, accountResponse };
}

/**
 * Build a transition keyring for zero-downtime key rotation (Issue #848).
 *
 * The keeper normally runs with a single signing keypair. During a rotation
 * window an operator sets KEEPER_ROTATION_NEXT_SECRET to the incoming key (after
 * running beginRotation so it's an on-chain co-signer). This helper lets the
 * polling/signing logic accept EITHER key as valid during that window, without
 * changing its single-keypair assumption elsewhere — it just asks the keyring.
 *
 * When KEEPER_ROTATION_NEXT_SECRET is unset, the keyring wraps only the primary
 * key and behaves exactly as before (fully backward compatible).
 *
 * @param {Keypair} primaryKeypair - the keeper's current keypair
 * @returns {ReturnType<import('./keyRotation').createTransitionKeyring>}
 */
function buildTransitionKeyring(primaryKeypair) {
  const { createTransitionKeyring } = require('./keyRotation');
  let incoming = null;
  const nextSecret = process.env.KEEPER_ROTATION_NEXT_SECRET;
  if (nextSecret) {
    try {
      incoming = Keypair.fromSecret(nextSecret);
      logger.info('Key rotation window active — accepting both signing keys', {
        primary: primaryKeypair.publicKey(),
        incoming: incoming.publicKey(),
      });
    } catch (_err) {
      logger.warn('KEEPER_ROTATION_NEXT_SECRET is set but invalid — ignoring');
      incoming = null;
    }
  }
  return createTransitionKeyring(primaryKeypair, incoming);
}

/**
 * Returns a fresh Account object for transaction building.
 * @param {any} accountResponse The response from server.getAccount()
 * @returns {Account}
 */
function getKeeperAccount(accountResponse) {
  return new Account(accountResponse.accountId(), accountResponse.sequenceNumber());
}

/**
 * Legacy compatibility with loadAccount from main
 */
function loadAccount(config) {
  return Keypair.fromSecret(config.keeperSecret);
}

// ---------------------------------------------------------------------------
// XLM Reserve Auto-Balance via Stellar SEP-24 Anchor (Issue #846)
//
// Monitors the keeper's native XLM balance and triggers an automated deposit
// via a SEP-24 compliant Stellar Anchor when the reserve drops below the
// configured threshold. This prevents keeper nodes from going permanently
// offline due to insufficient XLM while the operator is unavailable.
//
// Configuration environment variables:
//   XLM_RESERVE_MIN_BALANCE   - Minimum XLM balance threshold (default: 5)
//   XLM_RESERVE_TARGET_BALANCE - Target XLM balance after top-up (default: 20)
//   ANCHOR_HOME_DOMAIN         - Stellar Anchor home domain (e.g. 'anchor.example.com')
//   ANCHOR_ASSET_CODE          - Fiat asset code at the anchor (default: 'USDC')
//   ANCHOR_ASSET_ISSUER        - Issuer account of the anchor asset
//   ANCHOR_ACCOUNT_ID          - Anchor-side account/customer identifier
//   ANCHOR_JWT_TOKEN           - Pre-obtained JWT for SEP-24 interactive deposit
// ---------------------------------------------------------------------------

const XLM_RESERVE_MIN_BALANCE = parseFloat(process.env.XLM_RESERVE_MIN_BALANCE || '5');
const XLM_RESERVE_TARGET_BALANCE = parseFloat(process.env.XLM_RESERVE_TARGET_BALANCE || '20');

/**
 * Fetch the current native XLM balance for a Stellar account.
 *
 * @param {string} publicKey
 * @param {import('@stellar/stellar-sdk').rpc.Server} server
 * @returns {Promise<number>} XLM balance as a float
 */
async function getNativeXlmBalance(publicKey, server) {
  const accountResponse = await server.getAccount(publicKey);
  const balances = accountResponse.balances || [];
  const nativeBalance = balances.find((b) => b.asset_type === 'native');
  return nativeBalance ? parseFloat(nativeBalance.balance) : 0;
}

/**
 * Resolve the SEP-24 transfer server URL from a Stellar anchor's stellar.toml.
 *
 * @param {string} homeDomain - e.g. 'anchor.example.com'
 * @returns {Promise<string>} Transfer server base URL
 */
async function resolveAnchorTransferServer(homeDomain) {
  const fetchFn = globalThis.fetch || require('node-fetch');
  const tomlUrl = `https://${homeDomain}/.well-known/stellar.toml`;
  const res = await fetchFn(tomlUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch stellar.toml from ${homeDomain}: HTTP ${res.status}`);
  }
  const text = await res.text();
  const match = text.match(/TRANSFER_SERVER_SEP0024\s*=\s*["']?([^"'\s]+)["']?/);
  if (!match) {
    throw new Error(`TRANSFER_SERVER_SEP0024 not found in ${homeDomain}/.well-known/stellar.toml`);
  }
  return match[1].replace(/\/$/, '');
}

/**
 * Initiate a SEP-24 interactive deposit to top up the keeper's XLM balance.
 *
 * The function initiates the SEP-24 /transactions/deposit/interactive endpoint.
 * The returned URL should be opened by an operator or automated browser session
 * to complete the fiat → XLM deposit flow through the anchor's UI.
 *
 * @param {object} options
 * @param {string} options.transferServer - SEP-24 transfer server base URL
 * @param {string} options.jwtToken - JWT obtained via SEP-10 auth
 * @param {string} options.assetCode - Asset code (e.g. 'USDC', 'USD')
 * @param {string} options.assetIssuer - Asset issuer public key
 * @param {string} options.account - Destination Stellar account (keeper public key)
 * @param {number} options.amount - Amount of fiat asset to deposit (approximate)
 * @returns {Promise<{ id: string, url: string, type: string }>}
 */
async function initiateAnchorDeposit({ transferServer, jwtToken, assetCode, assetIssuer, account, amount }) {
  const fetchFn = globalThis.fetch || require('node-fetch');
  const endpoint = `${transferServer}/transactions/deposit/interactive`;

  const body = new URLSearchParams({
    asset_code: assetCode,
    asset_issuer: assetIssuer,
    account,
    amount: String(amount),
  });

  const res = await fetchFn(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwtToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '(no body)');
    throw new Error(`SEP-24 deposit initiation failed: HTTP ${res.status} — ${text}`);
  }

  const json = await res.json();
  if (!json.id || !json.url) {
    throw new Error(`SEP-24 deposit response missing id or url: ${JSON.stringify(json)}`);
  }

  return { id: json.id, url: json.url, type: json.type || 'interactive' };
}

/**
 * Check the keeper's XLM balance and trigger an automated anchor deposit if it
 * falls below XLM_RESERVE_MIN_BALANCE.
 *
 * This is the main entry point for the automated reserve management loop. Call
 * it periodically (e.g. on each polling cycle) to keep the keeper funded.
 *
 * @param {object} options
 * @param {string} options.publicKey - Keeper's Stellar public key
 * @param {import('@stellar/stellar-sdk').rpc.Server} options.server - Soroban RPC server
 * @param {object} [options.overrides] - Optional overrides for env-sourced config (testing)
 * @returns {Promise<{ checked: true, balance: number, sufficient: boolean, deposit?: object }>}
 */
async function checkAndTopUpXlmReserve(options) {
  const { publicKey, server } = options;
  const overrides = options.overrides || {};

  const minBalance = overrides.minBalance ?? XLM_RESERVE_MIN_BALANCE;
  const targetBalance = overrides.targetBalance ?? XLM_RESERVE_TARGET_BALANCE;
  const homeDomain = overrides.anchorHomeDomain ?? process.env.ANCHOR_HOME_DOMAIN;
  const assetCode = overrides.assetCode ?? process.env.ANCHOR_ASSET_CODE ?? 'USDC';
  const assetIssuer = overrides.assetIssuer ?? process.env.ANCHOR_ASSET_ISSUER ?? '';
  const jwtToken = overrides.jwtToken ?? process.env.ANCHOR_JWT_TOKEN;

  const balance = await getNativeXlmBalance(publicKey, server);

  if (balance >= minBalance) {
    logger.debug('XLM reserve sufficient', { balance, minBalance });
    return { checked: true, balance, sufficient: true };
  }

  logger.warn('XLM reserve below minimum — initiating anchor top-up', {
    balance,
    minBalance,
    targetBalance,
  });

  if (!homeDomain) {
    logger.error('ANCHOR_HOME_DOMAIN not configured — cannot auto-top-up XLM reserve');
    return { checked: true, balance, sufficient: false, error: 'anchor_not_configured' };
  }

  if (!jwtToken) {
    logger.error('ANCHOR_JWT_TOKEN not configured — cannot authenticate with anchor');
    return { checked: true, balance, sufficient: false, error: 'anchor_jwt_missing' };
  }

  try {
    const transferServer = overrides.transferServer
      || await resolveAnchorTransferServer(homeDomain);

    const depositAmount = targetBalance - balance;
    const deposit = await initiateAnchorDeposit({
      transferServer,
      jwtToken,
      assetCode,
      assetIssuer,
      account: publicKey,
      amount: Math.ceil(depositAmount),
    });

    logger.info('SEP-24 anchor deposit initiated', {
      depositId: deposit.id,
      depositUrl: deposit.url,
      assetCode,
      estimatedAmount: depositAmount,
    });

    return { checked: true, balance, sufficient: false, deposit };
  } catch (err) {
    logger.error('Failed to initiate anchor top-up', { error: err.message });
    return { checked: true, balance, sufficient: false, error: err.message };
  }
}

module.exports = {
  initializeKeeperAccount,
  buildTransitionKeyring,
  getKeeperAccount,
  loadAccount,
  loadSecretKey,
  fetchSecretFromVault,
  fetchSecretFromAWS,
  clearSecretMemory,
  // Issue #846 — XLM reserve auto-balance
  getNativeXlmBalance,
  resolveAnchorTransferServer,
  initiateAnchorDeposit,
  checkAndTopUpXlmReserve,
};
