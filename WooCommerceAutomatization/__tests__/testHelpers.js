export const getConfig = () => {
  return {
    URL_BASE: 'https://test.com/wp-json/wc/v3/customers',
    CONSUMER_KEY: 'test_key',
    CONSUMER_SECRET: 'test_secret'
  };
};

export const getAuthHeader = () => {
  const config = getConfig();
  return "Basic " + Utilities.base64Encode(config.CONSUMER_KEY + ":" + config.CONSUMER_SECRET);
};

export const logInfo = (message) => {
  Logger.log(`[INFO] ${message}`);
};

export const logError = (message, error) => {
  Logger.log(`[ERROR] ${message} -> ${error}`);
};

export const showAlert = (message) => {
  SpreadsheetApp.getUi().alert(message);
};

export const getSheetData = () => {
  return SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().getDataRange().getValues();
};

export const createCustomMenu = () => {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu("Automatyzacja");
  menu.addItem("Dodaj nowe kontakty do WooCommerce", "dodajKontaktyDoWooCommerce");
  menu.addToUi();
};

export const checkIfCustomerExists = (email, urlBase, authHeader) => {
  const checkUrl = urlBase + "?email=" + encodeURIComponent(email);
  const checkOptions = {
    method: "get",
    headers: { Authorization: authHeader },
    muteHttpExceptions: true,
  };

  try {
    const checkResponse = UrlFetchApp.fetch(checkUrl, checkOptions);
    const existing = JSON.parse(checkResponse.getContentText());
    return existing.length > 0;
  } catch (e) {
    logError(`Błąd sprawdzania klienta: ${email}`, e);
    return true;
  }
};

export const createCustomerPayload = (firstName, lastName, email, postcode, city) => ({
  email,
  first_name: firstName,
  last_name: lastName,
  username: firstName + " " + lastName,
  billing: {
    first_name: firstName,
    last_name: lastName,
    company: "",
    address_1: "",
    address_2: "",
    city,
    postcode,
    country: "",
    state: "PL",
    email,
    phone: "",
  },
  shipping: {
    first_name: "",
    last_name: "",
    company: "",
    address_1: "",
    address_2: "",
    city: "",
    postcode: "",
    country: "",
    state: "",
    phone: "",
  },
});

export const addCustomerToWooCommerce = (customer, urlBase, authHeader) => {
  const postOptions = {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: authHeader },
    payload: JSON.stringify(customer),
    muteHttpExceptions: true,
  };

  try {
    const response = UrlFetchApp.fetch(urlBase, postOptions);
    logInfo(`Dodano: ${customer.email} -> ${response.getContentText()}`);
    return true;
  } catch (e) {
    logError(`Błąd dodawania klienta: ${customer.email}`, e);
    return false;
  }
};

export const onOpen = (e) => {
  createCustomMenu();
};

export const dodajKontaktyDoWooCommerce = () => {
  const data = getSheetData();
  const config = getConfig();
  const authHeader = getAuthHeader();
  const contactsToAdd = [];

  for (let i = 3; i < data.length; i++) {
    const row = data[i];
    const firstName = (row[1] || "").toString().trim();
    const lastName = (row[2] || "").toString().trim();
    const email = (row[34] || "").toString().trim();
    const postcode = (row[40] || "").toString().trim();
    const city = (row[41] || "").toString().trim();

    if (!email || !firstName || !lastName) continue;

    if (checkIfCustomerExists(email, config.URL_BASE, authHeader)) {
      logInfo(`Pominięto (już istnieje): ${email}`);
      continue;
    }

    const customerData = createCustomerPayload(firstName, lastName, email, postcode, city);
    contactsToAdd.push(customerData);
  }

  if (contactsToAdd.length === 0) {
    showAlert("Brak nowych klientów do dodania.");
    return;
  }

  let successCount = 0;
  contactsToAdd.forEach((contact) => {
    if (addCustomerToWooCommerce(contact, config.URL_BASE, authHeader)) {
      successCount++;
    }
  });

  showAlert(`Zakończono!\nDodano ${successCount} nowych klientów.`);
};