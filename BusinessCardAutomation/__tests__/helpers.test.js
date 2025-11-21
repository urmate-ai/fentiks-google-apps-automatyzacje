const {
  isSupportedImageMime_,
  getOrCreateSubfolder_,
  getOrCreateSheetFromTemplate_,
  appendRowWithLp_,
} = require('../GoogleScript/06_helpers');

describe('isSupportedImageMime_', () => {
  beforeAll(() => {
    global.MimeType = {
      JPEG: 'image/jpeg',
      PNG: 'image/png',
      GIF: 'image/gif',
      TIFF: 'image/tiff'
    };
  });

  it('returns true for supported mime types', () => {
    expect(isSupportedImageMime_(MimeType.PNG)).toBe(true);
    expect(isSupportedImageMime_('image/heif')).toBe(true);
  });

  it('returns false for unsupported mime types', () => {
    expect(isSupportedImageMime_('application/pdf')).toBe(false);
  });
});

describe('getOrCreateSubfolder_', () => {
  it('returns existing folder when found', () => {
    const existing = {};
    const iterator = { hasNext: () => true, next: () => existing };
    const parent = {
      getFoldersByName: jest.fn(() => iterator),
      createFolder: jest.fn()
    };

    const result = getOrCreateSubfolder_(parent, 'sub');
    expect(parent.createFolder).not.toHaveBeenCalled();
    expect(result).toBe(existing);
  });

  it('creates folder when missing', () => {
    const created = {};
    const iterator = { hasNext: () => false, next: () => null };
    const parent = {
      getFoldersByName: jest.fn(() => iterator),
      createFolder: jest.fn(() => created)
    };

    const result = getOrCreateSubfolder_(parent, 'sub');
    expect(parent.createFolder).toHaveBeenCalledWith('sub');
    expect(result).toBe(created);
  });
});

describe('getOrCreateSheetFromTemplate_', () => {
  beforeEach(() => {
    global.MimeType = { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' };
    global.Utilities = { sleep: jest.fn() };
  });

  it('returns existing sheet when present', () => {
    const sheet = {};
    global.SpreadsheetApp = { openById: jest.fn(() => ({ getActiveSheet: () => sheet })) };
    global.Drive = { Files: { copy: jest.fn() } };
    const file = { getMimeType: () => MimeType.GOOGLE_SHEETS, getId: () => 'id1' };
    const iterator = { hasNext: () => true, next: () => file };
    const sub = { getFilesByName: () => iterator, getId: () => 'sub', getName: () => 'Sub' };
    const template = { getId: () => 'tpl', getMimeType: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

    const result = getOrCreateSheetFromTemplate_(template, sub);
    expect(result).toBe(sheet);
    expect(Drive.Files.copy).not.toHaveBeenCalled();
  });

  it('copies template when sheet missing', () => {
    const sheet = {};
    const file = { setName: jest.fn() };
    const root = { removeFile: jest.fn() };
    global.SpreadsheetApp = { openById: jest.fn(() => ({ getActiveSheet: () => sheet })) };
    const iterator = { hasNext: () => false, next: () => null };
    const sub = {
      getFilesByName: () => iterator,
      getId: () => 'sub',
      getName: () => 'Sub',
      addFile: jest.fn()
    };
    const template = { getId: () => 'tpl', getMimeType: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    global.Drive = { Files: { copy: jest.fn(() => ({ id: 'newId' })), get: jest.fn(() => ({ mimeType: MimeType.GOOGLE_SHEETS })) } };
    global.DriveApp = {
      getFileById: jest.fn(() => file),
      getRootFolder: jest.fn(() => root)
    };

    const result = getOrCreateSheetFromTemplate_(template, sub);
    expect(Drive.Files.copy).toHaveBeenCalledWith({ title: 'Sub', mimeType: MimeType.GOOGLE_SHEETS }, 'tpl', { convert: true });
    expect(file.setName).toHaveBeenCalledWith('Sub');
    expect(sub.addFile).toHaveBeenCalledWith(file);
    expect(root.removeFile).toHaveBeenCalledWith(file);
    expect(result).toBe(sheet);
  });
});

describe('appendRowWithLp_', () => {
  it('fills first empty row based on headers', () => {
    const data = [
      ['Nazwisko', 'L.p.', 'Imię'],
      ['A', 1, 'B'],
      ['', 2, ''],
      ['', 3, '']
    ];
    const sheet = {
      getLastRow: () => data.length,
      getLastColumn: () => data[0].length,
      getRange: (r, c, nr, nc) => ({
        getValues: () => data.slice(r - 1, r - 1 + nr).map(row => row.slice(c - 1, c - 1 + nc)),
        setValues: vals => {
          for (let i = 0; i < nr; i++) {
            for (let j = 0; j < nc; j++) {
              data[r - 1 + i][c - 1 + j] = vals[i][j];
            }
          }
        }
      }),
      appendRow: jest.fn(row => data.push(row))
    };

    const result = appendRowWithLp_(sheet, { imie: 'C', nazwisko: 'D' });

    expect(result).toBe(true);
    expect(data[2]).toEqual(['D', 2, 'C']);
    expect(sheet.appendRow).not.toHaveBeenCalled();
  });

  it('appends when no empty row', () => {
    const data = [
      ['Nazwisko', 'L.p.', 'Imię'],
      ['A', 1, 'B']
    ];
    const sheet = {
      getLastRow: () => data.length,
      getLastColumn: () => data[0].length,
      getRange: (r, c, nr, nc) => ({
        getValues: () => data.slice(r - 1, r - 1 + nr).map(row => row.slice(c - 1, c - 1 + nc)),
        setValues: vals => {
          for (let i = 0; i < nr; i++) {
            for (let j = 0; j < nc; j++) {
              data[r - 1 + i][c - 1 + j] = vals[i][j];
            }
          }
        }
      }),
      appendRow: jest.fn(row => data.push(row))
    };

    const result = appendRowWithLp_(sheet, { imie: 'C', nazwisko: 'D' });

    expect(result).toBe(true);
    expect(sheet.appendRow).toHaveBeenCalledWith(['D', 2, 'C']);
  });

  it('detects varied header formats', () => {
    const data = [
      ['LP', 'Imię', 'Nazwisko', 'E-mail kontaktowy', 'Nr domu', 'Miasto'],
      [1, 'A', 'B', 'old@mail', '1', 'Oldtown'],
      [2, '', '', '', '', '']
    ];
    const sheet = {
      getLastRow: () => data.length,
      getLastColumn: () => data[0].length,
      getRange: (r, c, nr, nc) => ({
        getValues: () => data.slice(r - 1, r - 1 + nr).map(row => row.slice(c - 1, c - 1 + nc)),
        setValues: vals => {
          for (let i = 0; i < nr; i++) {
            for (let j = 0; j < nc; j++) {
              data[r - 1 + i][c - 1 + j] = vals[i][j];
            }
          }
        }
      }),
      appendRow: jest.fn(row => data.push(row))
    };

    const result = appendRowWithLp_(sheet, {
      imie: 'C',
      nazwisko: 'D',
      email: 'c@d.com',
      nr_domu: '10',
      miasto: 'Town'
    });

    expect(result).toBe(true);
    expect(data[2]).toEqual([2, 'C', 'D', 'c@d.com', '10', 'Town']);
  });

  it('skips adding duplicate names', () => {
    const data = [
      ['Nazwisko', 'L.p.', 'Imię'],
      ['D', 1, 'C'],
      ['', 2, ''],
      ['', 3, '']
    ];
    const sheet = {
      getLastRow: () => data.length,
      getLastColumn: () => data[0].length,
      getRange: (r, c, nr, nc) => ({
        getValues: () => data.slice(r - 1, r - 1 + nr).map(row => row.slice(c - 1, c - 1 + nc)),
        setValues: vals => {
          for (let i = 0; i < nr; i++) {
            for (let j = 0; j < nc; j++) {
              data[r - 1 + i][c - 1 + j] = vals[i][j];
            }
          }
        }
      }),
      appendRow: jest.fn(row => data.push(row))
    };

    const result = appendRowWithLp_(sheet, { imie: 'C', nazwisko: 'D' });

    expect(result).toBe(false);
    expect(sheet.appendRow).not.toHaveBeenCalled();
    expect(data[1]).toEqual(['D', 1, 'C']);
    expect(data[2]).toEqual(['', 2, '']);
  });
});
