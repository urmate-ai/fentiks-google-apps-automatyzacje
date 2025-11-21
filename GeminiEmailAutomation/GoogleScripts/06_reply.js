// Reply post-processing helpers: sanitize model HTML output and inject signature.

const Reply = (() => {
  function postProcess_(raw, lang) {
    const signature = (lang && String(lang).toLowerCase().startsWith('en'))
      ? CFG.SIGN.EN
      : CFG.SIGN.PL;

    const cleaned = (raw || '')
      .trim()
      .replace(/^```(?:html)?\n?/i, '')
      .replace(/```$/i, '')
      .trim();

    const sanitized = cleaned.replace(/\[____[^\]]*\]/g, '[____]');

    const withSig = sanitized.includes(signature)
      ? sanitized
      : sanitized + (sanitized.endsWith('<br>') ? '' : '<br><br>') + signature;

    const withPlaceholders = withSig.replace(/\[____[^\]]*\]/g,
      '[<span style="background-color: rgb(0, 255, 255);">____</span>]');

    return withPlaceholders;
  }

  return { postProcess_ };
})();

if (typeof module !== 'undefined') {
  module.exports = Reply;
} else {
  this.Reply = Reply;
}
