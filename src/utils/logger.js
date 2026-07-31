/**
 * Structured Logger
 *
 * Provides consistent, structured logging across the application.
 * Never logs full API keys — only key_prefix (first 8 chars).
 *
 * Log levels (in order of verbosity):
 *   silent — nothing
 *   error — only errors
 *   warn  — errors + warnings
 *   info  — errors + warnings + info
 *   debug — everything
 */

const config = require('../config');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const currentLevel = LEVELS[config.logLevel] !== undefined
  ? LEVELS[config.logLevel]
  : LEVELS.info;

/**
 * Sanitize an object to remove sensitive fields before logging.
 * Redacts: apiKey, api_key, key, secret, token, password, authorization
 */
function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);

  const sensitive = ['apikey', 'api_key', 'key', 'secret', 'token', 'password', 'authorization', 'bearer'];
  const result = {};

  for (const [k, v] of Object.entries(obj)) {
    const keyLower = k.toLowerCase();
    if (sensitive.some(s => keyLower.includes(s))) {
      if (typeof v === 'string' && v.length > 8) {
        result[k] = v.substring(0, 8) + '...[REDACTED]';
      } else {
        result[k] = '[REDACTED]';
      }
    } else if (typeof v === 'object' && v !== null) {
      result[k] = sanitize(v);
    } else {
      result[k] = v;
    }
  }

  return result;
}

function formatMessage(level, message, meta) {
  const timestamp = new Date().toISOString();
  const base = { time: timestamp, level };

  if (typeof message === 'string') {
    base.msg = message;
  } else {
    Object.assign(base, sanitize(message));
  }

  if (meta !== undefined) {
    base.meta = sanitize(meta);
  }

  return JSON.stringify(base);
}

function log(level, message, meta) {
  if (LEVELS[level] > currentLevel) return;

  const formatted = formatMessage(level, message, meta);

  if (level === 'error') {
    process.stderr.write(formatted + '\n');
  } else {
    process.stdout.write(formatted + '\n');
  }
}

const logger = {
  error: (message, meta) => log('error', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  info: (message, meta) => log('info', message, meta),
  debug: (message, meta) => log('debug', message, meta),

  /** Log an error object with stack trace */
  errorObj: (err, context) => {
    log('error', {
      msg: err.message || 'Unknown error',
      stack: err.stack,
      context: context || undefined
    });
  }
};

module.exports = logger;
