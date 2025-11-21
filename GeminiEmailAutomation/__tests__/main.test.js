globalThis.CFG = { LABELS: { READY: 'Ready', TEMPLATE: 'Template', FAILED: 'Failed', IGNORED: 'Ignored' } };

globalThis.Gmail = {
  fetchCandidateThreads_: jest.fn(() => ['c1', 'c2']),
  fetchFailedThreads_: jest.fn((limit) => ['f1', 'f2', 'f3'].slice(0, limit)),
  processThreadSafely_: jest.fn(),
  setLogger: () => {}
};

globalThis.Log = { info: () => {}, warn: () => {} };

globalThis.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };

globalThis.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) };

globalThis.GmailApp = { getUserLabelByName: () => null, createLabel: () => ({}) };

globalThis.GmailAdvanced = {};

test('main processes up to 2 failed threads', () => {
  const Main = require('../GoogleScripts/09_main');
  Main.main();
  expect(globalThis.Gmail.fetchFailedThreads_).toHaveBeenCalledWith(2);
  const calls = globalThis.Gmail.processThreadSafely_.mock.calls.map(c => c[0]);
  expect(calls).toEqual(['c1', 'c2', 'f1', 'f2']);
});
