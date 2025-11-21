const LEVELS = {
  None: 0,
  Error: 1,
  Warning: 2,
  Information: 3,
  Debug: 4,
};

const levelName = typeof LOG_LEVEL !== 'undefined' ? LOG_LEVEL : 'Information';
const currentLevel = LEVELS[levelName] !== undefined ? LEVELS[levelName] : LEVELS.Information;

function log(method, level, args) {
  if (currentLevel >= level) {
    console[method](...args);
  }
}

const logger = {
  error: (...args) => log('error', LEVELS.Error, args),
  warn: (...args) => log('warn', LEVELS.Warning, args),
  info: (...args) => log('log', LEVELS.Information, args),
  debug: (...args) => log('log', LEVELS.Debug, args),
  LEVELS,
};

if (typeof module !== 'undefined') {
  module.exports = logger;
} else {
  this.logger = logger;
}
