function getConfig() {
  const scriptProperties = PropertiesService.getScriptProperties();
  
  return {
    URL_BASE: scriptProperties.getProperty('URL_BASE') || "",
    CONSUMER_KEY: scriptProperties.getProperty('CONSUMER_KEY') || "",
    CONSUMER_SECRET: scriptProperties.getProperty('CONSUMER_SECRET') || "",
    SLACK_WEBHOOK_URL: scriptProperties.getProperty('SLACK_WEBHOOK_URL') || "",
    DRIVE_FOLDER_ID: scriptProperties.getProperty('DRIVE_FOLDER_ID') || "",
    TUTOR_API_URL: scriptProperties.getProperty('TUTOR_API_URL') || "",
    TUTOR_API_KEY: scriptProperties.getProperty('TUTOR_API_KEY') || "",
    TUTOR_PRIVATE_API_KEY: scriptProperties.getProperty('TUTOR_PRIVATE_API_KEY') || "",
    PROXY_BASE_URL: scriptProperties.getProperty('PROXY_BASE_URL') || "",
    DOC_TEMPLATE_ID: scriptProperties.getProperty('DOC_TEMPLATE_ID') || ""
  };
}

