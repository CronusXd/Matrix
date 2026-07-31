/**
 * API Key Manager
 *
 * Handles generation, validation, revocation, and rotation of Matrix API keys.
 *
 * Key format: mx_ + 32 random hex characters (e.g., mx_a1b2c3d4e5f6...)
 * Storage: SHA-256 hash stored in database, raw key returned only on creation.
 */

const crypto = require('crypto');
const config = require('../config');
const apiKeysDb = require('../db/api-keys');
const logger = require('../utils/logger');
const { UnauthorizedError, NotFoundError } = require('../utils/errors');

/**
 * Generate a new Matrix API key.
 *
 * Creates a random key, hashes it, stores the hash,
 * and returns the raw key to the caller (one-time visibility).
 *
 * @param {Object} params
 * @param {string} params.userId — Owner user ID
 * @param {string} [params.name] — Human-readable label (e.g., "CLI client")
 * @param {number} [params.expiresInDays] — Days until expiration (null = never)
 * @returns {{ rawKey: string, record: Object }} The raw key and stored record
 */
function generateKey({ userId, name = null, expiresInDays = null }) {
  // Generate 32 random bytes → 64 hex characters
  const randomBytes = crypto.randomBytes(32);
  const rawHex = randomBytes.toString('hex');
  const rawKey = `${config.apiKeyPrefix}${rawHex}`;

  // Hash with SHA-256 for storage
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.substring(0, 8);

  // Calculate expiration date
  let expiresAt = null;
  if (expiresInDays && expiresInDays > 0) {
    const exp = new Date();
    exp.setDate(exp.getDate() + expiresInDays);
    expiresAt = exp.toISOString();
  }

  const record = apiKeysDb.createApiKey({
    userId,
    keyHash,
    keyPrefix,
    name,
    expiresAt
  });

  logger.info({
    msg: 'API key generated',
    user_id: userId,
    key_id: record.id,
    key_prefix: keyPrefix
  });

  return { rawKey, record };
}

/**
 * Validate an API key.
 *
 * Looks up the key by its SHA-256 hash, verifies it is active,
 * not expired, and not revoked.
 *
 * @param {string} rawKey — The raw API key to validate
 * @returns {Object} The user and key details if valid
 * @throws {UnauthorizedError} If the key is invalid
 */
function validateKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') {
    throw new UnauthorizedError('API key is required');
  }

  if (!rawKey.startsWith(config.apiKeyPrefix)) {
    throw new UnauthorizedError('Invalid API key format');
  }

  const keyHash = hashKey(rawKey);
  const record = apiKeysDb.findKeyByHash(keyHash);

  if (!record) {
    logger.warn({ msg: 'Unknown API key', key_prefix: rawKey.substring(0, 8) });
    throw new UnauthorizedError('Invalid API key');
  }

  // Check if revoked
  if (record.revoked === 1) {
    logger.warn({
      msg: 'Revoked API key used',
      key_id: record.id,
      key_prefix: record.key_prefix,
      user_id: record.user_id
    });
    throw new UnauthorizedError('This API key has been revoked');
  }

  // Check if expired
  if (record.expires_at && new Date(record.expires_at) < new Date()) {
    logger.warn({
      msg: 'Expired API key used',
      key_id: record.id,
      key_prefix: record.key_prefix,
      user_id: record.user_id
    });
    throw new UnauthorizedError('This API key has expired');
  }

  // Update last_used_at
  apiKeysDb.touchKey(record.id);

  return {
    userId: record.user_id,
    keyId: record.id,
    keyName: record.name,
    userEmail: record.user_email,
    userName: record.user_name
  };
}

/**
 * Revoke an API key by its record ID.
 *
 * @param {string} keyId — The API key record ID
 * @returns {boolean} True if revoked successfully
 */
function revokeKey(keyId) {
  const result = apiKeysDb.revokeKey(keyId);
  if (!result) {
    throw new NotFoundError('API key not found');
  }
  logger.info({ msg: 'API key revoked', key_id: keyId });
  return true;
}

/**
 * Rotate API keys for a user — revoke all existing keys
 * and generate a new one.
 *
 * @param {Object} params
 * @param {string} params.userId — User ID
 * @param {string} [params.name] — Label for the new key
 * @param {number} [params.expiresInDays] — Days until expiration
 * @returns {{ rawKey: string, record: Object, revokedCount: number }}
 */
function rotateKeys({ userId, name = 'Rotated key', expiresInDays = null }) {
  const revokedCount = apiKeysDb.revokeAllKeysForUser(userId);

  logger.info({
    msg: 'Rotating API keys',
    user_id: userId,
    revoked_count: revokedCount
  });

  const { rawKey, record } = generateKey({ userId, name, expiresInDays });

  return { rawKey, record, revokedCount };
}

/**
 * List all API keys for a user (without hashes).
 *
 * @param {string} userId — User ID
 * @returns {Array<Object>} Array of key records
 */
function listKeys(userId) {
  return apiKeysDb.listKeysForUser(userId);
}

/**
 * Hash a raw API key with SHA-256.
 *
 * @param {string} rawKey — The raw key
 * @returns {string} Hex-encoded SHA-256 hash
 */
function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

module.exports = {
  generateKey,
  validateKey,
  revokeKey,
  rotateKeys,
  listKeys,
  hashKey
};
