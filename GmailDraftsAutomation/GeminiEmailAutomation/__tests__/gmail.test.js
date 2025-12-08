globalThis.CFG = {
  LABELS: { READY: 'Ready', TEMPLATE: 'Template', FAILED: 'Failed', IGNORED: 'Ignored' },
  SIGN: { PL: 'SigPL', EN: 'SigEN' }
};

globalThis.Utils = {
  stripHtml_: (s) => s,
  extractJson_: (s) => s,
  retryWithBackoff_: (fn) => fn()
};
globalThis.Reply = { postProcess_: (html) => html.replace('[____]', '[<span style="background-color: rgb(0, 255, 255);">____</span>]') };
globalThis.Gemini = { callGeminiChat_: () => JSON.stringify({ classification: 'ready', lang: 'pl', response: 'Odpowiedź [____]' }) };

const added = {};
const removed = {};
const labelObj = (name) => ({
  addToThread: () => { added[name] = (added[name] || 0) + 1; },
  removeFromThread: () => { removed[name] = (removed[name] || 0) + 1; }
});
const GmailApp = {
  getUserLabelByName: (name) => labelObj(name),
  createLabel: (name) => labelObj(name),
  search: jest.fn(() => [])
};
globalThis.GmailApp = GmailApp;

const Gmail = require('../GoogleScripts/05_gmail');

beforeEach(() => {
  for (const key in added) delete added[key];
  for (const key in removed) delete removed[key];
  globalThis.Gemini.callGeminiChat_ = () => JSON.stringify({ classification: 'ready', lang: 'pl', response: 'Odpowiedź [____]' });
  globalThis.Reply.postProcess_ = (html) => html.replace('[____]', '[<span style="background-color: rgb(0, 255, 255);">____</span>]');
});

test('threads with placeholders are labeled Template and Ready removed', () => {
  const thread = {
    getMessages: () => [{ getSubject: () => 's', getFrom: () => 'a@b.com', getBody: () => 'body' }],
    createDraftReply: () => {},
    markUnread: () => {}
  };
  Gmail.processThread_(thread);
  expect(added.Template).toBeTruthy();
  expect(removed.Ready).toBeTruthy();
});

test('threads without placeholders are labeled Ready and Template removed', () => {
  globalThis.Gemini.callGeminiChat_ = () => JSON.stringify({ classification: 'ready', lang: 'pl', response: 'Bez placeholder' });
  globalThis.Reply.postProcess_ = (html) => html;
  const thread = {
    getMessages: () => [{ getSubject: () => 's', getFrom: () => 'a@b.com', getBody: () => 'body' }],
    createDraftReply: () => {},
    markUnread: () => {}
  };
  Gmail.processThread_(thread);
  expect(added.Ready).toBeTruthy();
  expect(removed.Template).toBeTruthy();
});

test('no-reply threads are labeled Ignored and remain unread', () => {
  const markUnread = jest.fn();
  const thread = {
    getMessages: () => [{ getSubject: () => 'Alert', getFrom: () => 'no-reply@example.com' }],
    markUnread
  };
  Gmail.processThread_(thread);
  expect(added.Ignored).toBeTruthy();
  expect(markUnread).toHaveBeenCalled();
});

test('failed threads are labeled Failed and remain unread', () => {
  const markUnread = jest.fn();
  const thread = { markUnread };
  const original = globalThis.Utils.retryWithBackoff_;
  globalThis.Utils.retryWithBackoff_ = () => { throw new Error('boom'); };
  Gmail.processThreadSafely_(thread);
  globalThis.Utils.retryWithBackoff_ = original;
  expect(added.Failed).toBeTruthy();
  expect(markUnread).toHaveBeenCalled();
});

test('fetchCandidateThreads_ excludes threads with drafts', () => {
  const unlabeledDraft = { getMessages: () => [{ isDraft: () => true }] };
  const unlabeledNoDraft = { getMessages: () => [{ isDraft: () => false }] };
  const labeledWithDraft = { getMessages: () => [{ isDraft: () => true }] };
  const labeledNoDraft = { getMessages: () => [{ isDraft: () => false }] };
  GmailApp.search.mockReset();
  GmailApp.search
    .mockReturnValueOnce([unlabeledDraft, unlabeledNoDraft])
    .mockReturnValueOnce([labeledWithDraft, labeledNoDraft]);
  const threads = Gmail.fetchCandidateThreads_(5);
  expect(threads).toEqual([unlabeledNoDraft, labeledNoDraft]);
});

test('fetchFailedThreads_ skips threads with drafts', () => {
  const withDraft = { getMessages: () => [{ isDraft: () => true }] };
  const noDraft = { getMessages: () => [{ isDraft: () => false }] };
  GmailApp.search.mockReset();
  GmailApp.search.mockReturnValueOnce([withDraft, noDraft]);
  const threads = Gmail.fetchFailedThreads_(5);
  expect(threads).toEqual([noDraft]);
});
