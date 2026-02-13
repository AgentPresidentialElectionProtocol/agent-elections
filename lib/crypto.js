const crypto = require('crypto');

function generateApiKey() {
  return 'apep_' + crypto.randomBytes(32).toString('hex');
}

function generateNonce() {
  return crypto.randomBytes(32).toString('hex');
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function verifyCommitment(voteData, nonce, expectedHash) {
  const computed = sha256(JSON.stringify(voteData) + nonce);
  return computed === expectedHash;
}

module.exports = { generateApiKey, generateNonce, sha256, verifyCommitment };
