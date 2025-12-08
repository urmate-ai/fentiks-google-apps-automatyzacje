const Reply = require('../GoogleScripts/06_reply');

describe('postProcess_ placeholder cleanup', () => {
  beforeEach(() => {
    global.CFG = { SIGN: { PL: 'SigPL', EN: 'SigEN' } };
  });

  test.each(['[____ data]', '[____ link do terminarza]'])('sanitizes %s', (variant) => {
    const res = Reply.postProcess_(variant, 'pl');
    const placeholder = /\[<span style="background-color: rgb\(0, 255, 255\);">____<\/span>\]/g;
    const matches = res.match(placeholder) || [];
    expect(matches).toHaveLength(1);
    expect(res).not.toContain(variant);
    expect(res).not.toMatch(/\[<span style="background-color: rgb\(0, 255, 255\);">____<\/span>[^\]]+\]/);
  });
});

