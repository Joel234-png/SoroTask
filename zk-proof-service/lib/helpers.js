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

module.exports = {
  hashTaskCondition,
  serializeProof,
  isValidZkProof,
  checkConstraint,
};
