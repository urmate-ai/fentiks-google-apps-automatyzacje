const LOG_LEVEL_PRIORITIES = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Debug: 3,
  None: 4,
};

function shouldLog(messageLevel, currentLevel) {
  const messagePriority = LOG_LEVEL_PRIORITIES[normalizeLogLevel(messageLevel, 'None')];
  const currentPriority = LOG_LEVEL_PRIORITIES[normalizeLogLevel(currentLevel, 'None')];

  return messagePriority <= currentPriority && currentPriority !== LOG_LEVEL_PRIORITIES.None;
}

function logWithLevel(level, message) {
  const { logLevel } = getConfig();
  if (!shouldLog(level, logLevel)) {
    return;
  }

  const formatted = `[${level}] ${message}`;

  switch (level) {
    case 'Error':
      console.error(formatted);
      break;
    case 'Warning':
      console.warn ? console.warn(formatted) : console.log(formatted);
      break;
    case 'Debug':
      console.debug ? console.debug(formatted) : console.log(formatted);
      break;
    default:
      console.log(formatted);
  }
}

function logError(message) {
  logWithLevel('Error', message);
}

function logWarning(message) {
  logWithLevel('Warning', message);
}

function logInfo(message) {
  logWithLevel('Information', message);
}

function logDebug(message) {
  logWithLevel('Debug', message);
}

if (typeof module !== 'undefined') {
  module.exports = {
    shouldLog,
    logWithLevel,
    logError,
    logWarning,
    logInfo,
    logDebug,
  };
}
