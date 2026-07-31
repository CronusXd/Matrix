/**
 * User Configurations Data Access Layer
 *
 * CRUD operations for user_configs table.
 * Handles encryption/decryption of provider API keys.
 */

const crypto = require('crypto');
const config = require('../config');
const { getDb } = require('./database');
const { NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');

// Derive a 32-byte encryption key from the configured key or generate a warning
function getEncryptionKey() {
  if (config.encryptionKey) {
    // Accept hex-encoded key (64 chars = 32 bytes) or raw string
    if (config.encryptionKey.length === 64) {
      return Buffer.from(config.encryptionKey, 'hex');
    }
    // Derive key from passphrase using SHA-256
    return crypto.createHash('sha256').update(config.encryptionKey).digest();
  }

  // No encryption key configured — use a static warning key
  logger.warn('MATRIX_ENCRYPTION_KEY not set — provider API keys will NOT survive restarts. ' +
    'Set a 32-byte hex key for production use.');
  return crypto.createHash('sha256').update('matrix-default-encryption-key').digest();
}

const ENCRYPTION_KEY = getEncryptionKey();
const ALGORITHM = 'aes-256-gcm';

/**
 * Encrypt a plaintext provider API key.
 *
 * @param {string} plaintext — The provider API key to encrypt
 * @returns {string} Base64-encoded ciphertext (iv + authTag + encrypted)
 */
function encrypt(plaintext) {
  if (!plaintext) return null;

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all base64)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypt an encrypted provider API key.
 *
 * @param {string} encrypted — Base64-encoded encrypted data
 * @returns {string|null} The decrypted plaintext
 */
function decrypt(encrypted) {
  if (!encrypted) return null;

  try {
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
      logger.error('Invalid encrypted data format — expected iv:authTag:ciphertext');
      return null;
    }

    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const ciphertext = parts[2];

    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    logger.errorObj(err, { context: 'decrypt provider key' });
    return null;
  }
}

/**
 * Get or create default config for a user.
 *
 * @param {string} userId — User ID
 * @returns {Object} The user config record
 */
function getConfig(userId) {
  const db = getDb();
  let cfg = db.prepare('SELECT * FROM user_configs WHERE user_id = ?').get(userId);

  if (!cfg) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO user_configs (user_id, created_at, updated_at) VALUES (?, ?, ?)
    `).run(userId, now, now);

    cfg = {
      user_id: userId,
      provider: 'deepseek',
      model: 'deepseek-chat',
      api_key_encrypted: null,
      max_tokens: 4096,
      temperature: 0.7,
      created_at: now,
      updated_at: now
    };
  }

  return cfg;
}

/**
 * Update user configuration fields.
 *
 * @param {string} userId — User ID
 * @param {Object} updates — { provider?, model?, api_key?, max_tokens?, temperature? }
 * @returns {Object} The updated config
 */
function updateConfig(userId, updates) {
  const db = getDb();
  const current = getConfig(userId);
  const fields = [];
  const values = [];
  const now = new Date().toISOString();

  if (updates.provider !== undefined) {
    fields.push('provider = ?');
    values.push(updates.provider);
  }
  if (updates.model !== undefined) {
    fields.push('model = ?');
    values.push(updates.model);
  }
  if (updates.api_key !== undefined) {
    fields.push('api_key_encrypted = ?');
    values.push(encrypt(updates.api_key));
  }
  if (updates.max_tokens !== undefined) {
    fields.push('max_tokens = ?');
    values.push(updates.max_tokens);
  }
  if (updates.temperature !== undefined) {
    fields.push('temperature = ?');
    values.push(updates.temperature);
  }

  if (fields.length === 0) return current;

  fields.push('updated_at = ?');
  values.push(now);
  values.push(userId);

  db.prepare(`UPDATE user_configs SET ${fields.join(', ')} WHERE user_id = ?`).run(...values);

  return getConfig(userId);
}

/**
 * Get the decrypted provider API key for a user.
 *
 * @param {string} userId — User ID
 * @returns {string|null} Decrypted provider API key or null
 */
function getProviderApiKey(userId) {
  const cfg = getConfig(userId);
  if (!cfg.api_key_encrypted) return null;
  return decrypt(cfg.api_key_encrypted);
}

/**
 * Delete a user's configuration.
 *
 * @param {string} userId — User ID
 */
function deleteConfig(userId) {
  const db = getDb();
  db.prepare('DELETE FROM user_configs WHERE user_id = ?').run(userId);
}

module.exports = {
  getConfig,
  updateConfig,
  getProviderApiKey,
  deleteConfig
};
