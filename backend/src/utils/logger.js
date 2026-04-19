// src/utils/logger.js
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

class Logger {
  constructor(module) {
    this.module = module;
    this.level = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] ?? 1;
  }

  _format(level, msg, meta) {
    const ts = new Date().toISOString();
    const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
    return `[${ts}] [${level.toUpperCase()}] [${this.module}] ${msg}${metaStr}`;
  }

  debug(msg, meta) {
    if (this.level <= 0) console.debug(this._format('debug', msg, meta));
  }

  info(msg, meta) {
    if (this.level <= 1) console.info(this._format('info', msg, meta));
  }

  warn(msg, meta) {
    if (this.level <= 2) console.warn(this._format('warn', msg, meta));
  }

  error(msg, meta) {
    if (this.level <= 3) console.error(this._format('error', msg, meta));
  }
}

function createLogger(module) {
  return new Logger(module);
}

module.exports = { createLogger };
