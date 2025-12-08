function logInfo(message) {
  Logger.log(`[INFO] ${message}`);
}

function logError(message, error) {
  const errorMsg = `[ERROR] ${message}${error ? ' -> ' + error : ''}`;
  Logger.log(errorMsg);
  sendSlackMessage(errorMsg);
}

function sendSlackMessage(text) {
  const { SLACK_WEBHOOK_URL } = getConfig();
  if (!SLACK_WEBHOOK_URL) return;
  
  try {
    UrlFetchApp.fetch(SLACK_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ text: String(text) }),
      muteHttpExceptions: true,
    });
  } catch (e) {
    Logger.log(`[SLACK_ERROR] ${e}`);
  }
}
