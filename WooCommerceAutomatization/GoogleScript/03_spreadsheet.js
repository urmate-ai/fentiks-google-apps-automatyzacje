function getSheetData() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const values = sheet.getDataRange().getValues();

  if (!values || values.length === 0) return [];

  const header = values.slice(0, 3);
  const rest = values.slice(3);
  
  const filtered = rest.filter(row => {
    for (let i = 0; i < row.length; i++) {
      let v = row[i];
      if (v === 0) return true;
      if (v != null && String(v).trim() !== '') return true;
    }
    return false;
  });

  let result = header.concat(filtered);

  try {
    Logger.log('[SHEET] rows total=' + values.length + ' filtered=' + filtered.length + ' sent=' + result.length);
  } catch (e) {}
  return result;
}