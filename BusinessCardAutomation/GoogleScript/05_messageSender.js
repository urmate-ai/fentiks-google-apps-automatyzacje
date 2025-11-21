const MessageSender = (() => {
  let logger = this.logger || (typeof require !== 'undefined' && require('./02_logger'));
  const Hubspot = globalThis.Hubspot || (typeof require !== 'undefined' ? require('./03_hubspot') : this.Hubspot);

  const EMAIL_SUBJECT = 'Dziękuję za rozmowę';
  const TEMPLATE = '{IMIE}, dziękuję za rozmowę na Energetab. Nasze spojrzenie na branżę i kierunki rozwoju jest bardzo zbieżne. Widzę kilka obszarów, w których możemy połączyć siły i wspólnie coś zbudować. Jak wygląda Twój czas za tydzień/dwa? Chętnie przygotuję się do rozmowy i omówimy konkretne możliwości współpracy.\nPozdrawiam,\n{UPLOADER} | FENTIKS';

  function setLogger(l) { logger = l; }

  function formatTemplate_(contact) {
    const uploader = contact && contact.uploader_name ? contact.uploader_name : '';
    const imie = contact && contact.imie ? contact.imie : '';
    return TEMPLATE.replace('{UPLOADER}', uploader).replace('{IMIE}', imie);
  }

  function sendEmail(contact) {
    if (typeof EMAIL_SENDING_ENABLED !== 'undefined' && !EMAIL_SENDING_ENABLED) {
      logger.info('Email sending disabled, skipping email send');
      return;
    }
    if (!contact.email) {
      logger.warn('No email provided, skipping email send');
      return;
    }
    const body = formatTemplate_(contact);
    try {
      GmailApp.sendEmail(contact.email, EMAIL_SUBJECT, body);
      logger.info('Sent email to', contact.email);
      if (contact.hubspotId) {
        Hubspot && Hubspot.logMessage_ && Hubspot.logMessage_(contact.hubspotId, {
          channel: 'email',
          to: contact.email,
          subject: EMAIL_SUBJECT,
          body,
        });
      }
    } catch (e) {
      logger.error('Failed to send email to', contact.email, e);
    }
  }

  function normalizePhoneNumber_(value) {
    if (value === null || value === undefined) return '';

    const trimmed = String(value).trim();
    if (!trimmed) return '';

    const collapsed = trimmed.replace(/\s+/g, '');
    if (!collapsed) return '';
    if (collapsed.startsWith('+')) return collapsed;

    const digits = collapsed.replace(/\D/g, '');
    if (digits.length === 9) return '+48' + digits;
    if (digits.length === 11 && digits.startsWith('48')) return '+' + digits;

    return digits.length ? digits : collapsed;
  }

function sendSms(contact) {
  if (typeof SMS_SENDING_ENABLED !== 'undefined' && !SMS_SENDING_ENABLED) {
    logger && logger.info && logger.info('SMS sending disabled, skipping SMS send');
    return;
  }
  if (!contact || !contact.telefon) {
    logger && logger.warn && logger.warn('No phone provided, skipping SMS send');
    return;
  }

  const props = PropertiesService.getScriptProperties();
  const login = (props.getProperty('SMS_API_LOGIN') || '').trim();
  const password = (props.getProperty('SMS_API_PASSWORD') || '').trim();
  const serviceId = (props.getProperty('SMS_API_SERVICE_ID') || '').trim();

  if (!login || !password || !serviceId) {
    logger && logger.warn && logger.warn('SMS_API_LOGIN, SMS_API_PASSWORD or SMS_API_SERVICE_ID not set, skipping SMS send');
    return;
  }

  const phone = normalizePhoneNumber_(contact.telefon);
  if (!phone) {
    logger && logger.warn && logger.warn('Phone normalization failed, skipping SMS send');
    return;
  }

  const digitsOnly = phone.replace(/\D/g, '');
  const dest = digitsOnly.length === 11 && digitsOnly.startsWith('48') ? digitsOnly.slice(-9) : digitsOnly;
  if (!dest) {
    logger && logger.warn && logger.warn('Destination phone empty after normalization, skipping SMS send');
    return;
  }

  const text = formatTemplate_(contact);

  const params = {
    login,
    password,
    serviceId,
    dest,
    text,
  };

  const query = Object.keys(params)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
    .join('&');

  const url = `https://snazzy-daffodil-fa4ad5.netlify.app/api/send-sms?${query}`;

  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, validateHttpsCertificates: true });
    logger && logger.info && logger.info(
      'Sent SMS to',
      dest,
      'status',
      response && response.getResponseCode ? response.getResponseCode() : 'unknown',
      'resp',
      response && response.getContentText ? response.getContentText() : ''
    );
    if (contact && contact.hubspotId) {
      Hubspot && Hubspot.logMessage_ && Hubspot.logMessage_(contact.hubspotId, {
        channel: 'sms',
        to: phone,
        body: text,
      });
    }
  } catch (e) {
    logger && logger.error && logger.error('SMS send failed to', dest, e && e.message ? e.message : e);
  }
}


  function sendMessage(contact) {
    if (typeof EMAIL_SENDING_ENABLED === 'undefined' || EMAIL_SENDING_ENABLED) {
      sendEmail(contact);
    }
    if (typeof SMS_SENDING_ENABLED === 'undefined' || SMS_SENDING_ENABLED) {
      sendSms(contact);
    }
  }

  return { setLogger, sendEmail, sendSms, sendMessage, EMAIL_SUBJECT, TEMPLATE };
})();

if (typeof module !== 'undefined') {
  module.exports = MessageSender;
} else {
  this.MessageSender = MessageSender;
}
