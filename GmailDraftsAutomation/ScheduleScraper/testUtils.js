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
    formatDate: (date, timeZone, format) => {
      // Simple mock - in real implementation would use timezone
      const d = new Date(date);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const seconds = String(d.getSeconds()).padStart(2, '0');
      
      if (format === 'yyyy-MM-dd_HH-mm-ss') {
        return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
      }
      return `${year}-${month}-${day}`;
    },
    newBlob: (data, mimeType, name) => {
      const buffer = toBuffer(data);
      return {
        getDataAsString: () => decoder.decode(buffer),
        mimeType: mimeType || 'application/octet-stream',
        name: name || 'file',
      };
    },
  };
}

module.exports = { createUtilitiesMock };
