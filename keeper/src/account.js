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

module.exports = {
  initializeKeeperAccount,
  getKeeperAccount,
  loadAccount,
  loadSecretKey,
  fetchSecretFromVault,
  fetchSecretFromAWS,
  clearSecretMemory,
};
