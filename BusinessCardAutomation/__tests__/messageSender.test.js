const MessageSender = require('../GoogleScript/05_messageSender');
const { createUtilitiesMock } = require('../testUtils');

describe('MessageSender', () => {
  beforeEach(() => {
    MessageSender.setLogger({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
    global.GmailApp = { sendEmail: jest.fn() };
    global.UrlFetchApp = {
      fetch: jest.fn(() => ({
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ results: [] }),
      })),
    };
    global.PropertiesService = {
      getScriptProperties: () => ({
        getProperty: (n) =>
          ({ SMS_API_LOGIN: 'login', SMS_API_PASSWORD: 'password', SMS_API_SERVICE_ID: 'service' })[n],
      }),
    };
    global.Utilities = createUtilitiesMock();
  });

  it('sends email and sms when data provided', () => {
    const contact = { email: 'a@b.com', telefon: '123456789', uploader_name: 'Jan Kowalski', imie: 'Piotr' };
    MessageSender.sendMessage(contact);
    const body = MessageSender.TEMPLATE.replace('{UPLOADER}', 'Jan Kowalski').replace('{IMIE}', 'Piotr');
    expect(GmailApp.sendEmail).toHaveBeenCalledWith('a@b.com', MessageSender.EMAIL_SUBJECT, expect.stringContaining('Jan Kowalski'));
    expect(GmailApp.sendEmail).toHaveBeenCalledWith('a@b.com', MessageSender.EMAIL_SUBJECT, expect.stringContaining('Piotr'));
    const [url] = UrlFetchApp.fetch.mock.calls[0];
    expect(url).toContain('https://snazzy-daffodil-fa4ad5.netlify.app/api/send-sms');
    expect(url).toContain(`login=${encodeURIComponent('login')}`);
    expect(url).toContain(`password=${encodeURIComponent('password')}`);
    expect(url).toContain(`serviceId=${encodeURIComponent('service')}`);
    expect(url).toContain(`dest=${encodeURIComponent('123456789')}`);
    expect(url).toContain(`text=${encodeURIComponent(body)}`);
  });

  it('skips when no contact data', () => {
    MessageSender.sendMessage({});
    expect(GmailApp.sendEmail).not.toHaveBeenCalled();
    expect(UrlFetchApp.fetch).not.toHaveBeenCalled();
  });
});
