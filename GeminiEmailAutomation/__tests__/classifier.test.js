const Gemini = require('../GoogleScripts/04_gemini');
const Gmail = require('../GoogleScripts/05_gmail');

let logger;
beforeEach(() => {
  Gemini.callGeminiChat_ = jest.fn();
  globalThis.Gemini = Gemini;
  globalThis.Utils = { extractJson_: (s) => s };
  globalThis.CFG = { SIGN: { PL: 'SigPL', EN: 'SigEN' } };
  logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  Gmail.setLogger(logger);
});

describe('classifyAndReply_', () => {
  test('returns parsed result', () => {
    Gemini.callGeminiChat_.mockReturnValue(JSON.stringify({
      classification: 'ready',
      lang: 'en',
      response: '<p>Hi</p>'
    }));
    const res = Gmail.classifyAndReply_('s', 'b', 'ctx');
    expect(res).toEqual({ classification: 'ready', lang: 'en', response: '<p>Hi</p>' });
  });

  test('handles invalid JSON with fallback', () => {
    Gemini.callGeminiChat_.mockReturnValue('not json');
    const res = Gmail.classifyAndReply_('s', 'b', 'ctx');
    expect(res).toEqual({ classification: 'ignored', lang: 'pl', response: null });
    expect(logger.warn).toHaveBeenCalled();
  });
});
