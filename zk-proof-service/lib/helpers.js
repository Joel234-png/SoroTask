const crypto = require('crypto');

function hashTaskCondition(taskCondition) {
  const canonical = JSON.stringify(taskCondition, Object.keys(taskCondition).sort());
  return `0x${crypto.createHash('sha256').update(canonical).digest('hex')}`;
}

function serializeProof(proof) {
  const payload = JSON.stringify({
    pi_a: proof.pi_a,
    pi_b: proof.pi_b,
    pi_c: proof.pi_c,
    publicSignals: proof.publicSignals,
  });
  return `0x${Buffer.from(payload).toString('hex')}`;
}

function isHexField(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value);
}

function isValidZkProof(proof) {
  if (!proof || typeof proof !== 'object') return false;
  if (!Array.isArray(proof.pi_a) || proof.pi_a.length !== 2 || !proof.pi_a.every(isHexField)) {
    return false;
  }
  if (!Array.isArray(proof.pi_b) || proof.pi_b.length !== 2) return false;
  if (!proof.pi_b.every((row) => Array.isArray(row) && row.length === 2 && row.every(isHexField))) {
    return false;
  }
  if (!Array.isArray(proof.pi_c) || proof.pi_c.length !== 2 || !proof.pi_c.every(isHexField)) {
    return false;
  }
  if (!Array.isArray(proof.publicSignals) || !proof.publicSignals.every(isHexField)) {
    return false;
  }
  return true;
}

function checkConstraint(taskCondition, clientData, circuitId) {
  if (taskCondition?.type === 'liquidity-threshold') {
    const min = taskCondition.params?.minLiquidity;
    const actual = clientData?.witness?.actualLiquidity;
    if (typeof min === 'number' && typeof actual === 'number' && actual < min) {
      return {
        ok: false,
        details: {
          circuitId: circuitId || 'liquidity-threshold-v1',
          field: 'actualLiquidity',
          constraint: 'actualLiquidity >= minLiquidity',
        },
      };
    }
  }
  return { ok: true };
}

/**
 * ECIES (Elliptic Curve Integrated Encryption Scheme) on secp256k1
 */

function generateECIESKeyPair() {
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey('hex'),
    privateKey: ecdh.getPrivateKey('hex'),
  };
}

function encryptWitnessECIES(witness, recipientPublicKeyHex) {
  const ephemeralKey = crypto.createECDH('secp256k1');
  ephemeralKey.generateKeys();

  const sharedSecret = ephemeralKey.computeSecret(Buffer.from(recipientPublicKeyHex, 'hex'));
  const aesKey = crypto.createHash('sha256').update(sharedSecret).digest();
  const iv = crypto.randomBytes(12);

  const plaintext = Buffer.from(JSON.stringify(witness), 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ephemeralPublicKey: ephemeralKey.getPublicKey('hex'),
    iv: iv.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
    tag: tag.toString('hex'),
  };
}

function decryptWitnessECIES(encryptedPayload, recipientPrivateKeyHex) {
  const recipientKey = crypto.createECDH('secp256k1');
  recipientKey.setPrivateKey(Buffer.from(recipientPrivateKeyHex, 'hex'));

  const sharedSecret = recipientKey.computeSecret(Buffer.from(encryptedPayload.ephemeralPublicKey, 'hex'));
  const aesKey = crypto.createHash('sha256').update(sharedSecret).digest();
  const iv = Buffer.from(encryptedPayload.iv, 'hex');
  const tag = Buffer.from(encryptedPayload.tag, 'hex');
  const ciphertext = Buffer.from(encryptedPayload.ciphertext, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
  decipher.setAuthTag(tag);
  const decryptedBuffer = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  const witness = JSON.parse(decryptedBuffer.toString('utf8'));
  return { witness, decryptedBuffer };
}

/**
 * Zero-memory sanitization helper to scrub witness buffers post proof generation
 * @param {Buffer} buffer - Buffer containing sensitive witness memory
 */
function zeroizeBuffer(buffer) {
  if (Buffer.isBuffer(buffer)) {
    buffer.fill(0);
  }
}

module.exports = {
  hashTaskCondition,
  serializeProof,
  isValidZkProof,
  checkConstraint,
  generateECIESKeyPair,
  encryptWitnessECIES,
  decryptWitnessECIES,
  zeroizeBuffer,
};
