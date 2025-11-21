const crypto = require('crypto');

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return Buffer.from(value);
  if (value === null || value === undefined) return Buffer.from('');
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  return Buffer.from(String(value), 'utf8');
}

function createUtilitiesMock() {
  return {
    DigestAlgorithm: { MD5: 'md5' },
    MacAlgorithm: { HMAC_SHA_1: 'sha1' },
    computeDigest: (algorithm, value) => {
      const algo = (algorithm || '').toString().toLowerCase();
      return Array.from(crypto.createHash(algo).update(toBuffer(value)).digest());
    },
    computeHmacSignature: (algorithm, value, key) => {
      const algo = (algorithm || '').toString().toLowerCase();
      return Array.from(crypto.createHmac(algo, toBuffer(key)).update(toBuffer(value)).digest());
    },
    newBlob: (data) => ({
      getBytes: () => Array.from(toBuffer(data)),
    }),
    base64Encode: (data) => Buffer.from(Array.isArray(data) ? data : toBuffer(data)).toString('base64'),
  };
}

module.exports = { createUtilitiesMock };
