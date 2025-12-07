// Gmail-related functions: search, process, labeling.

const Gmail = (() => {
  const getUtils = () => globalThis.Utils || (typeof require !== 'undefined' ? require('./07_utils') : undefined);
  const getGemini = () => globalThis.Gemini || (typeof require !== 'undefined' ? require('./04_gemini') : undefined);
  const getReply = () => globalThis.Reply || (typeof require !== 'undefined' ? require('./06_reply') : undefined);

  let Log = globalThis.Log || (typeof require !== 'undefined' ? require('./02_logger') : console);

  function setLogger(l) {
    Log = l || console;
  }

  const PERSONAL_QUERY_PARTS = [
    '-category:promotions',
    '-category:social',
    '-category:updates',
    '-category:forums',
    '-label:spam',
    '-label:trash',
    '-is:chat',
    '-from:mailer-daemon'
  ];

  function buildContext_(_subject, _body) {
    return [
      'Rules:',
      '- Retrieve the necessary knowledge from the configured Vertex AI RAG corpus.',
      '- If the retrieval does not provide enough data, leave missing fields as [____] to be completed by a human.'
    ].join('\n');
  }

  function classifyAndReply_(subject, body, context) {
    const system = [
      CFG.GEMINI && CFG.GEMINI.CONTEXT,
      'Use only the provided context and the documents retrieved via Vertex AI RAG tools.',
      'Return ONLY valid JSON with keys {"classification":"ready|template|ignored","lang":"pl|en|other","response":string|null}.',
      'If classification="ignored" then response must be null.',
      'If "ready" create a full HTML reply in detected language.',
      'If "template" create a brief HTML reply skeleton with [____] placeholders.',
      'Do not use signature in the response. Signature is added by the script after the response is generated.',
      'Always end the message politely with a closing phrase, such as "Z poważaniem," (for Polish) or "Best regards," (for English), but without any name or signature after it.',
      'Use <br> for new lines. Placeholders must be exactly four underscores inside square brackets.'
    ].filter(Boolean).join(' ');

    const user = [
      'CONTEXT:',
      context,
      '',
      'EMAIL SUBJECT:',
      subject || '(no subject)',
      '',
      'EMAIL BODY:',
      body || '(empty body)'
    ].join('\n');

    const gem = getGemini();
    const utils = getUtils();
    const content = gem.callGeminiChat_(system, user, null, 'application/json');

    try {
      const json = JSON.parse(utils.extractJson_(content));
      return {
        classification: (json.classification || 'ignored').toString(),
        lang: (json.lang || 'pl').toString(),
        response: json.response ? String(json.response) : null
      };
    } catch (e) {
      Log.warn('Combined JSON parse error:', e, 'raw:', content);
      return { classification: 'ignored', lang: 'pl', response: null };
    }
  }

  function threadHasDraft_(thread) {
    try {
      const msgs = thread.getMessages();
      return msgs.some(m => typeof m.isDraft === 'function' ? m.isDraft() : !!m.isDraft);
    } catch (e) {
      return false;
    }
  }

  function fetchCandidateThreads_(limit) {
    const max = limit || 5;
    const q = [
      'in:inbox',
      'is:unread',
      ...PERSONAL_QUERY_PARTS,
      `-label:${CFG.LABELS.READY}`,
      `-label:${CFG.LABELS.TEMPLATE}`,
      `-label:${CFG.LABELS.FAILED}`,
      CFG.LABELS.IGNORED ? `-label:${CFG.LABELS.IGNORED}` : '',
      'newer_than:14d'
    ].filter(Boolean).join(' ');

    let threads = GmailApp.search(q, 0, max).filter(t => !threadHasDraft_(t));
    if (threads.length >= max) return threads;

    const remaining = max - threads.length;
    const labels = [CFG.LABELS.READY, CFG.LABELS.TEMPLATE]
      .filter(Boolean)
      .map(l => `label:${l}`);
    if (!labels.length) return threads;

    const q2 = [
      'in:inbox',
      'is:unread',
      ...PERSONAL_QUERY_PARTS,
      `(${labels.join(' OR ')})`,
      `-label:${CFG.LABELS.FAILED}`,
      CFG.LABELS.IGNORED ? `-label:${CFG.LABELS.IGNORED}` : '',
      'newer_than:14d'
    ].filter(Boolean).join(' ');

    const labeled = GmailApp.search(q2, 0, remaining);
    const withoutDraft = labeled.filter(t => !threadHasDraft_(t));
    return threads.concat(withoutDraft).slice(0, max);
  }

  function fetchFailedThreads_(limit) {
    const q = [
      `label:${CFG.LABELS.FAILED}`,
      'is:unread',
      ...PERSONAL_QUERY_PARTS,
      `-label:${CFG.LABELS.READY}`,
      `-label:${CFG.LABELS.TEMPLATE}`,
      CFG.LABELS.IGNORED ? `-label:${CFG.LABELS.IGNORED}` : '',
      'newer_than:14d'
    ].filter(Boolean).join(' ');

    const threads = GmailApp.search(q, 0, limit || 2);
    return threads.filter(t => !threadHasDraft_(t));
  }

  function processThreadSafely_(thread) {
    try {
      const utils = getUtils();
      utils.retryWithBackoff_(() => processThread_(thread));
      const failLbl = GmailApp.getUserLabelByName(CFG.LABELS.FAILED);
      if (failLbl) failLbl.removeFromThread(thread);
    } catch (err) {
      Log.error("Processing error:", err);
      const lbl = GmailApp.getUserLabelByName(CFG.LABELS.FAILED) || GmailApp.createLabel(CFG.LABELS.FAILED);
      lbl.addToThread(thread);
      thread.markUnread();
    }
  }

  function processThread_(thread) {
    const utils = getUtils();
    const reply = getReply();

    const messages = thread.getMessages();
    const msg = messages[messages.length - 1]; // latest
    const subject = msg.getSubject() || "(no subject)";
    const sender = (msg.getFrom() || "").toLowerCase();

    // Ignore notifications/no-reply mails
    if (/no[-]?reply|do[-]?not[-]?reply|donotreply/.test(sender) || /(alert|notification)/i.test(subject)) {
      const lbl = GmailApp.getUserLabelByName(CFG.LABELS.IGNORED) || GmailApp.createLabel(CFG.LABELS.IGNORED);
      lbl.addToThread(thread);
      thread.markUnread();
      return;
    }

    const bodyText = utils.stripHtml_(msg.getBody());

    // 1) Build context
    const context = buildContext_(subject, bodyText);

    // 2) Combined classify + reply
    const result = classifyAndReply_(subject, bodyText, context);
    Log.info('Combined:', JSON.stringify(result));

    if (result.classification === 'ignored' || !result.response) {
      const lbl = GmailApp.getUserLabelByName(CFG.LABELS.IGNORED) || GmailApp.createLabel(CFG.LABELS.IGNORED);
      lbl.addToThread(thread);
      thread.markUnread();
      return;
    }

    // Post-process HTML
    const html = reply.postProcess_(result.response, result.lang || 'pl');

    const hasPlaceholders = /\[<span[^>]*>____<\/span>\]/.test(html);
    const needHuman = result.classification !== 'ready' || hasPlaceholders;

    // Create reply draft
    thread.createDraftReply('', { htmlBody: html });

    // Housekeeping
    if (needHuman) {
      const tmplLbl = GmailApp.getUserLabelByName(CFG.LABELS.TEMPLATE) || GmailApp.createLabel(CFG.LABELS.TEMPLATE);
      tmplLbl.addToThread(thread);
      const readyLbl = GmailApp.getUserLabelByName(CFG.LABELS.READY);
      if (readyLbl) readyLbl.removeFromThread(thread);
    } else {
      const readyLbl = GmailApp.getUserLabelByName(CFG.LABELS.READY) || GmailApp.createLabel(CFG.LABELS.READY);
      readyLbl.addToThread(thread);
      const tmplLbl = GmailApp.getUserLabelByName(CFG.LABELS.TEMPLATE);
      if (tmplLbl) tmplLbl.removeFromThread(thread);
    }
    thread.markUnread();
    // Optional: archive → thread.moveToArchive();
  }

  return { get logger() { return Log; }, setLogger, fetchCandidateThreads_, fetchFailedThreads_, processThreadSafely_, processThread_, buildContext_, classifyAndReply_ };
})();

if (typeof module !== 'undefined') {
  module.exports = Gmail;
} else {
  this.Gmail = Gmail;
}
