const Helpers = require('../GoogleScript/06_helpers');
const Gemini = require('../GoogleScript/04_gemini');
const { createUtilitiesMock } = require('../testUtils');

beforeEach(() => {
  Helpers.getOrCreateSubfolder_ = jest.fn();
  Helpers.isInSubfolder_ = jest.fn(() => false);
  Helpers.isSupportedImageMime_ = jest.fn(mime => mime === 'image/png');
  Gemini.extractWithGeminiFromImage_ = jest.fn(() => ({
    imie: '  jAN ', nazwisko: 'kOWALSKI', email: 'E', stanowisko: 'S',
    pesel: 'P', telefon: '48509-891-745', firma: 'F', ulica: 'U',
    nr_domu: '1', kod_pocztowy: '00-000', miasto: 'M'
  }));
  Helpers.appendRowWithLp_ = jest.fn(() => true);
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
    getContentText: () => JSON.stringify({ id: '456' })
  };
  const noteResp = {
    getResponseCode: () => 201,
    getContentText: () => '{}'
  };
  const smsResp = {
    getResponseCode: () => 200,
    getContentText: () => 'OK'
  };
  global.UrlFetchApp = {
    fetch: jest.fn((url, options = {}) => {
      if (url.includes('crm/v3/objects/notes')) return noteResp;
      if (url.includes('crm/v3/objects/contacts/search')) return searchResp;
      if (url.includes('crm/v3/owners')) return ownerResp;
      if (url.includes('crm/v3/objects/contacts')) return createResp;
      if (url.includes('send-sms')) return smsResp;
      throw new Error('Unexpected URL ' + url + ' with options ' + JSON.stringify(options));
    })
  };
  global.GmailApp = { sendEmail: jest.fn() };
  global.PropertiesService = {
    getScriptProperties: () => ({ getProperty: () => 'test' })
  };
  global.Utilities = createUtilitiesMock();
  global.MimeType = { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' };
});

describe('processFolder_', () => {
  it('processes images and moves them', () => {
    const processed = { addFile: jest.fn() };
    const failed = { addFile: jest.fn(), removeFile: jest.fn() };
    Helpers.getOrCreateSubfolder_.mockImplementation((_, name) => {
      if (name === 'Przepisane Wizytówki') return processed;
      if (name === 'Błędne wizytówki') return failed;
      return null;
    });

      const file1 = {
        isTrashed: () => false,
        getMimeType: () => 'image/png',
        getName: () => 'card1',
        getId: () => '1',
        getOwner: () => ({ getEmail: () => 'owner@example.com' }),
        moveTo: jest.fn()
      };
    const file2 = {
      isTrashed: () => false,
      getMimeType: () => MimeType.GOOGLE_SHEETS,
      getName: () => 'sheet',
      getId: () => '2'
    };
    const iterator = {
      list: [file1, file2],
      index: 0,
      hasNext() { return this.index < this.list.length; },
      next() { return this.list[this.index++]; }
    };
    const folder = {
      getFiles: () => iterator,
      removeFile: jest.fn(),
      getName: () => 'Sub',
      getFoldersByName: () => ({ hasNext: () => false })
    };
    const sheet = {};

    const { processFolder_ } = require('../GoogleScript/07_main');
    processFolder_(folder, sheet);

    expect(Helpers.appendRowWithLp_).toHaveBeenCalledWith(sheet, expect.objectContaining({
      imie: 'Jan',
      nazwisko: 'Kowalski',
      email: 'E',
      stanowisko: 'S',
      pesel: 'P',
      telefon: '+48 509 891 745',
      firma: 'F',
      ulica: 'U',
      nr_domu: '1',
      kod_pocztowy: '00-000',
      miasto: 'M',
      filename: 'card1',
      fileid: '1',
      timestamp: expect.any(Date),
    }));
    const hubspotCreateCall = UrlFetchApp.fetch.mock.calls.find(([url]) =>
      url.includes('crm/v3/objects/contacts') && !url.includes('/search')
    );
    expect(hubspotCreateCall).toBeTruthy();
    const [, options] = hubspotCreateCall;
    const payload = JSON.parse(options.payload);
    expect(payload.properties.firstname).toBe('Jan');
    expect(payload.properties.lastname).toBe('Kowalski');
    expect(payload.properties.phone).toBe('+48 509 891 745');
    expect(file1.moveTo).toHaveBeenCalledWith(processed);
    expect(processed.addFile).not.toHaveBeenCalled();
    expect(folder.removeFile).not.toHaveBeenCalled();
    expect(failed.addFile).not.toHaveBeenCalled();
    expect(Helpers.appendRowWithLp_).toHaveBeenCalledTimes(1);
    expect(UrlFetchApp.fetch).toHaveBeenCalledTimes(6);
    expect(UrlFetchApp.fetch.mock.calls[0][0]).toContain('crm/v3/objects/contacts/search');
    expect(UrlFetchApp.fetch.mock.calls[1][0]).toContain('crm/v3/owners');
    expect(UrlFetchApp.fetch.mock.calls[2][0]).toContain('crm/v3/objects/contacts');
    const noteCalls = UrlFetchApp.fetch.mock.calls.filter(([url]) => url.includes('crm/v3/objects/notes'));
    expect(noteCalls).toHaveLength(2);
    const emailPayload = JSON.parse(noteCalls[0][1].payload);
    expect(emailPayload.properties.hs_note_body).toContain('Kopia wysłanego maila');
    expect(emailPayload.properties.hs_note_body).toContain('Dziękuję za rozmowę');
    expect(emailPayload.properties.hs_note_body).toContain('Temat: Dziękuję za rozmowę');
    expect(emailPayload.associations[0].to.id).toBe('456');
    const smsPayload = JSON.parse(noteCalls[1][1].payload);
    expect(smsPayload.properties.hs_note_body).toContain('Kopia wysłanego SMS-a');
    expect(smsPayload.properties.hs_note_body).toContain('dziękuję za rozmowę');
    expect(UrlFetchApp.fetch.mock.calls[4][0]).toContain('send-sms');
    expect(Helpers.getOrCreateSubfolder_).toHaveBeenCalledWith(folder, 'Przepisane Wizytówki');
  });

  it('falls back to legacy flow when moveTo fails', () => {
    const processed = { addFile: jest.fn(), removeFile: jest.fn() };
    Helpers.getOrCreateSubfolder_.mockImplementation((_, name) => {
      if (name === 'Przepisane Wizytówki') return processed;
      return null;
    });

    const file = {
      isTrashed: () => false,
      getMimeType: () => 'image/png',
      getName: () => 'card1',
      getId: () => '1',
      getOwner: () => ({ getEmail: () => 'owner@example.com' }),
      moveTo: jest.fn(() => {
        throw new Error('boom');
      })
    };
    const iterator = {
      list: [file],
      index: 0,
      hasNext() {
        return this.index < this.list.length;
      },
      next() {
        return this.list[this.index++];
      },
    };
    const folder = {
      getFiles: () => iterator,
      removeFile: jest.fn(),
      getName: () => 'Sub',
      getFoldersByName: () => ({ hasNext: () => false }),
    };
    const sheet = {};

    const { processFolder_ } = require('../GoogleScript/07_main');
    processFolder_(folder, sheet);

    expect(file.moveTo).toHaveBeenCalledWith(processed);
    expect(processed.addFile).toHaveBeenCalledWith(file);
    expect(folder.removeFile).toHaveBeenCalledWith(file);
  });

  it('skips files with unsupported mime types', () => {
    const processed = { addFile: jest.fn() };
    const failed = { addFile: jest.fn(), removeFile: jest.fn() };
    Helpers.getOrCreateSubfolder_.mockImplementation((_, name) => {
      if (name === 'Przepisane Wizytówki') return processed;
      if (name === 'Błędne wizytówki') return failed;
      return null;
    });

    Helpers.isSupportedImageMime_.mockReturnValue(false);
    const file = {
      isTrashed: () => false,
      getMimeType: () => 'image/gif',
      getName: () => 'card1',
      getId: () => '1',
      moveTo: jest.fn()
    };
    const iterator = {
      list: [file],
      index: 0,
      hasNext() { return this.index < this.list.length; },
      next() { return this.list[this.index++]; }
    };
    const folder = {
      getFiles: () => iterator,
      removeFile: jest.fn(),
      getName: () => 'Sub',
      getFoldersByName: () => ({ hasNext: () => false })
    };
    const sheet = {};

    const { processFolder_ } = require('../GoogleScript/07_main');
    processFolder_(folder, sheet);

    expect(Helpers.appendRowWithLp_).not.toHaveBeenCalled();
    expect(UrlFetchApp.fetch).not.toHaveBeenCalled();
    expect(processed.addFile).not.toHaveBeenCalled();
    expect(folder.removeFile).not.toHaveBeenCalled();
    expect(failed.addFile).not.toHaveBeenCalled();
    expect(file.moveTo).toHaveBeenCalledWith(failed);
    expect(Helpers.getOrCreateSubfolder_).toHaveBeenCalledWith(folder, 'Błędne wizytówki');
  });

  it('moves file even when extraction fails', () => {
    const processed = { addFile: jest.fn() };
    const failed = { addFile: jest.fn(), removeFile: jest.fn() };
    Helpers.getOrCreateSubfolder_.mockImplementation((_, name) => {
      if (name === 'Przepisane Wizytówki') return processed;
      if (name === 'Błędne wizytówki') return failed;
      return null;
    });

    Gemini.extractWithGeminiFromImage_.mockImplementation(() => { throw new Error('fail'); });
    const file = {
      isTrashed: () => false,
      getMimeType: () => 'image/png',
      getName: () => 'card1',
      getId: () => '1',
      moveTo: jest.fn()
    };
    const iterator = {
      list: [file],
      index: 0,
      hasNext() { return this.index < this.list.length; },
      next() { return this.list[this.index++]; }
    };
    const folder = {
      getFiles: () => iterator,
      removeFile: jest.fn(),
      getName: () => 'Sub',
      getFoldersByName: () => ({ hasNext: () => false })
    };
    const sheet = {};

    const { processFolder_ } = require('../GoogleScript/07_main');
    processFolder_(folder, sheet);

    expect(Helpers.appendRowWithLp_).not.toHaveBeenCalled();
    expect(UrlFetchApp.fetch).not.toHaveBeenCalled();
    expect(processed.addFile).not.toHaveBeenCalled();
    expect(folder.removeFile).not.toHaveBeenCalled();
    expect(failed.addFile).not.toHaveBeenCalled();
    expect(file.moveTo).toHaveBeenCalledWith(failed);
    expect(Helpers.getOrCreateSubfolder_).toHaveBeenCalledWith(folder, 'Błędne wizytówki');
  });

  it('still calls HubSpot when duplicate found', () => {
    const processed = { addFile: jest.fn() };
    Helpers.getOrCreateSubfolder_.mockReturnValue(processed);

    Helpers.appendRowWithLp_.mockReturnValue(false);
    const file = {
      isTrashed: () => false,
      getMimeType: () => 'image/png',
      getName: () => 'card1',
      getId: () => '1',
      getOwner: () => ({ getEmail: () => 'owner@example.com' }),
      moveTo: jest.fn()
    };
    const iterator = {
      list: [file],
      index: 0,
      hasNext() { return this.index < this.list.length; },
      next() { return this.list[this.index++]; }
    };
    const folder = {
      getFiles: () => iterator,
      removeFile: jest.fn(),
      getName: () => 'Sub',
      getFoldersByName: () => ({ hasNext: () => false })
    };
    const sheet = {};

    const { processFolder_ } = require('../GoogleScript/07_main');
    processFolder_(folder, sheet);

    expect(UrlFetchApp.fetch).toHaveBeenCalledTimes(3);
    expect(GmailApp.sendEmail).not.toHaveBeenCalled();
    expect(file.moveTo).toHaveBeenCalledWith(processed);
    expect(processed.addFile).not.toHaveBeenCalled();
    expect(Helpers.getOrCreateSubfolder_).toHaveBeenCalledTimes(1);
  });

  it('moves files without names to failed subfolder', () => {
    const processed = { addFile: jest.fn() };
    const failed = { addFile: jest.fn(), removeFile: jest.fn() };
    Helpers.getOrCreateSubfolder_.mockImplementation((_, name) => {
      if (name === 'Przepisane Wizytówki') return processed;
      if (name === 'Błędne wizytówki') return failed;
      return null;
    });

    Gemini.extractWithGeminiFromImage_.mockReturnValue({ imie: '', nazwisko: 'N' });
    const file = {
      isTrashed: () => false,
      getMimeType: () => 'image/png',
      getName: () => 'card1',
      getId: () => '1',
      moveTo: jest.fn()
    };
    const iterator = {
      list: [file],
      index: 0,
      hasNext() { return this.index < this.list.length; },
      next() { return this.list[this.index++]; }
    };
    const folder = {
      getFiles: () => iterator,
      removeFile: jest.fn(),
      getName: () => 'Sub',
      getFoldersByName: () => ({ hasNext: () => false })
    };
    const sheet = {};

    const { processFolder_ } = require('../GoogleScript/07_main');
    processFolder_(folder, sheet);

    expect(Helpers.appendRowWithLp_).not.toHaveBeenCalled();
    expect(UrlFetchApp.fetch).not.toHaveBeenCalled();
    expect(failed.addFile).not.toHaveBeenCalled();
    expect(folder.removeFile).not.toHaveBeenCalled();
    expect(file.moveTo).toHaveBeenCalledWith(failed);
    expect(Helpers.getOrCreateSubfolder_).toHaveBeenCalledWith(folder, 'Błędne wizytówki');
  });
});

describe('processBusinessCardsGemini', () => {
  it('creates sheets in subfolders and processes them', () => {
    const template = { getId: () => 'tpl' };
    const subfolder = name => ({
      getName: () => name,
      getFiles: () => ({ hasNext: () => false }),
      getFoldersByName: () => ({ hasNext: () => false })
    });
    const root = {
      getFilesByName: () => ({ hasNext: () => true, next: () => template }),
      getFolders: () => ({
        list: [
          subfolder('Sub1'),
          subfolder('Przepisane Wizytówki'),
          subfolder('Sub2')
        ],
        index: 0,
        hasNext() { return this.index < this.list.length; },
        next() { return this.list[this.index++]; }
      })
    };
    global.DriveApp = { getFolderById: () => root };

    global.FOLDER_ID = 'rootId';
    global.TEMPLATE_NAME = 'wzorzec.xlsx';
    global.SHEET_HEADERS = ['Lp'];

    const sheet = {};
    Helpers.getOrCreateSheetFromTemplate_ = jest.fn(() => sheet);
    global.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: jest.fn() }) };

    const main = require('../GoogleScript/07_main');
    main.processBusinessCardsGemini();

    expect(Helpers.getOrCreateSheetFromTemplate_).toHaveBeenCalledTimes(2);
    expect(Helpers.getOrCreateSubfolder_).not.toHaveBeenCalled();
  });
});
