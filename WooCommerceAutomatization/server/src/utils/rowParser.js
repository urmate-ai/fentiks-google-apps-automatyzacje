const emailRegex = /.+@.+\..+/;
const postcodeRegex = /\b\d{2}-\d{3}\b/;

export function parseRow(row) {
  let firstName = '';
  let lastName = '';
  let email = '';
  let postcode = '';
  let city = '';

  if (Array.isArray(row)) {
    firstName = String(row[1] || '').trim();
    lastName = String(row[2] || '').trim();
    email = String(row[34] || '').trim();
    
    if (!email || !emailRegex.test(email)) {
      const foundEmail = (row.find(v => typeof v === 'string' && emailRegex.test(v)) || '').trim();
      email = foundEmail;
    }
    
    postcode = String(row[40] || '').trim();
    if (!postcode || !postcodeRegex.test(postcode)) {
      const foundPost = (row.find(v => typeof v === 'string' && postcodeRegex.test(v)) || '').trim();
      postcode = foundPost;
    }
    
    city = String(row[41] || '').trim();
    if (!city) {
      const postIdx = row.findIndex(v => typeof v === 'string' && postcodeRegex.test(v));
      if (postIdx >= 0 && typeof row[postIdx + 1] === 'string') {
        city = row[postIdx + 1].trim();
      }
      if (!city) {
        for (let k = row.length - 1; k >= 0; k--) {
          const val = (typeof row[k] === 'string') ? row[k].trim() : '';
          if (!val) continue;
          if (emailRegex.test(val) || postcodeRegex.test(val)) continue;
          city = val;
          break;
        }
      }
    }
  } else if (row && typeof row === 'object') {
    const getAny = (obj, keys) => {
      for (const k of keys) {
        if (obj[k] != null && String(obj[k]).trim() !== '') return String(obj[k]).trim();
      }
      return '';
    };
    firstName = getAny(row, ['firstName','first_name','imie','Imię','name']);
    lastName = getAny(row, ['lastName','last_name','nazwisko','Nazwisko','surname']);
    email = getAny(row, ['email','Email','e-mail']);
    postcode = getAny(row, ['postcode','postal_code','Kod pocztowy','kod_pocztowy']);
    city = getAny(row, ['city','City','Miasto']);
    if (!email || !emailRegex.test(email)) email = '';
  }

  return { firstName, lastName, email, postcode, city };
}

