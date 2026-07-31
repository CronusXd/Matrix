/**
 * Matrix Gateway — Application Configuration
 *
 * All settings are configurable via environment variables.
 * Sensible defaults are provided for local development.
 */

const path = require('path');

module.exports = {
  /** HTTP server port */
  port: parseInt(process.env.MATRIX_PORT, 10) || 3000,

  /** Server listen address */
  host: process.env.MATRIX_HOST || '127.0.0.1',

  /** Path to SQLite database file */
  dbPath: process.env.MATRIX_DB_PATH || path.join(__dirname, '..', 'data', 'matrix.db'),

  /** Logging level (silent, error, warn, info, debug) */
  logLevel: process.env.MATRIX_LOG_LEVEL || 'info',

  /** Rate limiting configuration */
  rateLimit: {
    /** Time window in milliseconds */
    windowMs: parseInt(process.env.MATRIX_RATE_WINDOW_MS, 10) || 60000,
    /** Maximum requests per window */
    max: parseInt(process.env.MATRIX_RATE_MAX, 10) || 60
  },

  /**
   * Encryption key for storing provider API keys at rest.
   * MUST be 32 bytes (64 hex characters) for AES-256-GCM.
   * If not set, a warning is emitted and a temporary key is derived
   * (NOT suitable for production — keys will be lost on restart).
   */
  encryptionKey: process.env.MATRIX_ENCRYPTION_KEY || null,

  /** Matrix API key prefix for identification */
  apiKeyPrefix: 'mx_',

  /** Request timeout for provider API calls (milliseconds) */
  providerTimeout: parseInt(process.env.MATRIX_PROVIDER_TIMEOUT, 10) || 30000,

  /** Maximum number of retries for provider API calls */
  providerMaxRetries: parseInt(process.env.MATRIX_PROVIDER_MAX_RETRIES, 10) || 2,

  /** CORS allowed origins (comma-separated, * for all) */
  corsOrigin: process.env.MATRIX_CORS_ORIGIN || '*',

  /** Node environment */
  nodeEnv: process.env.NODE_ENV || 'development'
};
