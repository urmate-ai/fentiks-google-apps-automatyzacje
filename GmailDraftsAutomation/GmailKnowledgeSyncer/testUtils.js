const { TextDecoder } = require('util');

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (Array.isArray(value)) return Buffer.from(value);
  if (value === null || value === undefined) return Buffer.from('');
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  return Buffer.from(String(value), 'utf8');
}

function createUtilitiesMock() {
  const decoder = new TextDecoder('utf-8');
  return {
    base64DecodeWebSafe: (value) => {
      const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
      return Buffer.from(normalized, 'base64');
    },
    base64Decode: (value) => {
      const normalized = String(value || '');
      return Buffer.from(normalized, 'base64');
    },
    newBlob: (data) => {
      const buffer = toBuffer(data);
      return {
        getDataAsString: () => decoder.decode(buffer),
      };
    },
  };
}

module.exports = { createUtilitiesMock };
