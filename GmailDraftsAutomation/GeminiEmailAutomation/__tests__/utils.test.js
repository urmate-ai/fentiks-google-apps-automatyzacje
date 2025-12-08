const { stripHtml_, extractJson_ } = require('../GoogleScripts/07_utils');

describe('stripHtml_', () => {
  test('removes tags and decodes entities', () => {
    const html = '<p>Hello&nbsp;<strong>World</strong></p><script>ignore</script>';
    expect(stripHtml_(html)).toBe('Hello World');
  });
});

describe('extractJson_', () => {
  test('extracts JSON block from text', () => {
    const txt = 'prefix {"a":1} suffix';
    expect(extractJson_(txt)).toBe('{"a":1}');
  });

  test('returns original string when no JSON found', () => {
    expect(extractJson_('no json')).toBe('no json');
  });
});
