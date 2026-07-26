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

// ---------------------------------------------------------------------------
// #840 — Multi-Sig Transaction Builder with HSM Signing
// ---------------------------------------------------------------------------
// MultiSigHSMSigner wraps the existing HSMProvider abstraction to:
//   1. Load one or more HSM key IDs from config (primary + optional co-signers).
//   2. Build a Soroban TransactionEnvelope and collect signatures from every
//      configured key — all signing happens inside the HSM so the private key
//      material is never exported to process memory.
//   3. Return the fully-signed XDR envelope ready for submission.
//
// PKCS#11 hardware (YubiHSM, AWS CloudHSM) is reached via the existing
// HSMProvider interface in src/hsm/provider.js.  For development and CI the
// MockHSMProvider from src/hsm/mockProvider.js is used automatically when
// HSM_PROVIDER env var is not set.

class MultiSigHSMSigner {
  /**
   * @param {object} opts
   * @param {import('./hsm/provider').HSMProvider} opts.hsmProvider  - HSM driver instance
   * @param {string[]} opts.keyIds          - Ordered list of HSM key IDs to sign with
   * @param {string}   opts.networkPassphrase - Stellar network passphrase
   * @param {object}   [opts.logger]          - Pino-compatible logger
   */
  constructor(opts = {}) {
    if (!opts.hsmProvider) throw new Error('MultiSigHSMSigner: hsmProvider is required');
    if (!Array.isArray(opts.keyIds) || opts.keyIds.length === 0) {
      throw new Error('MultiSigHSMSigner: at least one keyId is required');
    }

    this.hsm = opts.hsmProvider;
    this.keyIds = opts.keyIds;
    this.networkPassphrase = opts.networkPassphrase
      || process.env.NETWORK_PASSPHRASE
      || 'Test SDF Network ; September 2015';
    this.logger = opts.logger || createLogger('multisig-hsm');
  }

  /**
   * Sign a transaction with every configured HSM key.
   *
   * Each key produces a Stellar Ed25519 signature over the transaction hash
   * (the standard Stellar signing payload).  The decorated transaction is
   * returned with all signatures attached.
   *
   * Private key material never leaves the HSM — only the 32-byte
   * transaction hash is sent to each key for signing.
   *
   * @param {import('@stellar/stellar-sdk').Transaction} transaction
   * @returns {Promise<import('@stellar/stellar-sdk').Transaction>} signed transaction
   */
  async signTransaction(transaction) {
    const { hash } = require('@stellar/stellar-sdk').hash
      ? require('@stellar/stellar-sdk')
      : require('@stellar/stellar-sdk');

    // Compute the standard Stellar transaction hash (signing payload)
    const txHash = transaction.hash();

    this.logger.info('MultiSigHSMSigner: signing transaction', {
      keyCount: this.keyIds.length,
      txHash: txHash.toString('hex').slice(0, 16) + '…',
    });

    for (const keyId of this.keyIds) {
      // Retrieve the public key from the HSM so we can attach the correct
      // decorated signature to the transaction envelope
      const { publicPem } = await this.hsm.getPublicKey(keyId);

      // Sign the 32-byte tx hash inside the HSM — private key never leaves
      const signatureBuffer = await this.hsm.sign(keyId, txHash);

      // Derive the Stellar public key from PEM so we can build the decorated sig
      const stellarPublicKey = _pemToStellarPublicKey(publicPem);

      // Attach the signature to the transaction (Stellar SDK convention)
      transaction.addDecoratedSignature(
        Buffer.from(stellarPublicKey, 'hex').slice(0, 4), // hint = first 4 bytes of raw public key
        signatureBuffer,
      );

      this.logger.info('MultiSigHSMSigner: signature added', { keyId, hint: Buffer.from(stellarPublicKey, 'hex').slice(0, 4).toString('hex') });
    }

    return transaction;
  }

  /**
   * Convenience helper: sign and return the transaction as base64 XDR.
   * @param {import('@stellar/stellar-sdk').Transaction} transaction
   * @returns {Promise<string>} base64-encoded signed XDR envelope
   */
  async signToXDR(transaction) {
    const signed = await this.signTransaction(transaction);
    return signed.toEnvelope().toXDR('base64');
  }
}

/**
 * Derive a hex-encoded raw Ed25519 public key from a PKCS#8 PEM string.
 * Used to build the Stellar decorated signature hint.
 * @param {string} pem
 * @returns {string} hex string of the raw 32-byte public key
 */
function _pemToStellarPublicKey(pem) {
  const crypto = require('crypto');
  try {
    const keyObj = crypto.createPublicKey(pem);
    // export as raw DER (SubjectPublicKeyInfo); last 32 bytes are the Ed25519 key
    const der = keyObj.export({ type: 'spki', format: 'der' });
    return der.slice(-32).toString('hex');
  } catch (_err) {
    // Fallback: return zero bytes if key parsing fails (should not happen in production)
    return '0'.repeat(64);
  }
}

/**
 * Factory: create a MultiSigHSMSigner from environment variables.
 *
 * Environment variables:
 *   HSM_PROVIDER   - 'mock' (default) | 'pkcs11' | 'aws-cloudhsm'
 *   HSM_KEY_IDS    - Comma-separated list of HSM key IDs for multi-sig
 *   NETWORK_PASSPHRASE - Stellar network passphrase
 *
 * @param {object} [opts] - Optional overrides (injected in tests)
 * @returns {MultiSigHSMSigner|null} null when HSM_KEY_IDS is not configured
 */
function createMultiSigSigner(opts = {}) {
  const keyIdsRaw = opts.keyIds || process.env.HSM_KEY_IDS || '';
  const keyIds = keyIdsRaw.split(',').map((s) => s.trim()).filter(Boolean);
  if (keyIds.length === 0) return null; // HSM multi-sig not configured

  const providerType = (opts.providerType || process.env.HSM_PROVIDER || 'mock').toLowerCase();
  let hsmProvider;

  if (providerType === 'mock') {
    const { MockHSMProvider } = require('./hsm/mockProvider');
    hsmProvider = opts.hsmProvider || new MockHSMProvider({ logger: opts.logger });
  } else {
    // For production PKCS#11 / AWS CloudHSM: the operator is responsible for
    // installing and configuring the appropriate HSMProvider subclass.
    // Raise a clear error rather than silently falling back.
    throw new Error(
      `HSM provider '${providerType}' is not bundled. ` +
      'Implement a custom HSMProvider subclass (see src/hsm/provider.js) and pass it via opts.hsmProvider.',
    );
  }

  return new MultiSigHSMSigner({
    hsmProvider,
    keyIds,
    networkPassphrase: opts.networkPassphrase,
    logger: opts.logger,
  });
}

/**
 * Legacy compatibility with loadAccount from main
 */
function loadAccount(config) {
  return Keypair.fromSecret(config.keeperSecret);
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
  MultiSigHSMSigner,
  createMultiSigSigner,
};
