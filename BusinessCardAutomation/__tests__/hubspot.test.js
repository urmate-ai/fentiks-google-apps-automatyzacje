const Hubspot = require('../GoogleScript/03_hubspot');

describe('Hubspot owner assignment', () => {
  beforeEach(() => {
    Hubspot.setLogger({ info: jest.fn(), warn: jest.fn() });
    global.PropertiesService = {
      getScriptProperties: () => ({ getProperty: () => 'token' })
    };
    const searchResp = {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ results: [] })
    };
    const ownerResp = {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ results: [{ id: '321' }] })
    };
    const createResp = {
      getResponseCode: () => 201,
      getContentText: () => '{}'
    };
    global.UrlFetchApp = {
      fetch: jest
        .fn()
        .mockReturnValueOnce(searchResp)
        .mockReturnValueOnce(ownerResp)
        .mockReturnValueOnce(createResp)
    };
  });

  it('adds hubspot_owner_id when owner found', () => {
    Hubspot.sendToHubspot_({ imie: 'I', nazwisko: 'N', uploader_email: 'owner@example.com' });
    expect(UrlFetchApp.fetch).toHaveBeenCalledTimes(3);
    expect(UrlFetchApp.fetch.mock.calls[1][0]).toContain('crm/v3/owners');
    const payload = JSON.parse(UrlFetchApp.fetch.mock.calls[2][1].payload);
    expect(payload.properties.hubspot_owner_id).toBe('321');
  });
});

describe('Hubspot message logging', () => {
  beforeEach(() => {
    Hubspot.setLogger({ info: jest.fn(), warn: jest.fn() });
    global.PropertiesService = {
      getScriptProperties: () => ({ getProperty: () => 'token' })
    };
    global.UrlFetchApp = {
      fetch: jest.fn(() => ({
        getResponseCode: () => 201,
        getContentText: () => '{}'
      }))
    };
  });

  it('creates note with escaped content', () => {
    Hubspot.logMessage_('123', {
      channel: 'email',
      to: 'test@example.com',
      subject: 'Hej',
      body: 'Linia 1 & <tag>\nLinia 2'
    });

    expect(UrlFetchApp.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = UrlFetchApp.fetch.mock.calls[0];
    expect(url).toContain('crm/v3/objects/notes');
    const payload = JSON.parse(options.payload);
    expect(payload.associations[0].to.id).toBe('123');
    expect(payload.properties.hs_note_body).toContain('Kopia wysłanego maila');
    expect(payload.properties.hs_note_body).toContain('Temat: Hej');
    expect(payload.properties.hs_note_body).toContain('Linia 1 &amp; &lt;tag&gt;');
    expect(payload.properties.hs_note_body).toContain('Linia 2');
    expect(payload.properties.hs_timestamp).toEqual(expect.any(String));
  });
});

