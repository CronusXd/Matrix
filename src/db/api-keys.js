/**
 * API Keys Data Access Layer
 *
 * CRUD and lookup operations for the api_keys table.
 * NEVER returns raw key_hash in query results.
 */

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./database');
const { NotFoundError } = require('../utils/errors');

/**
 * Store a new API key.
 *
 * @param {Object} params
 * @param {string} params.userId — Owner user ID
 * @param {string} params.keyHash — SHA-256 hash of the raw key
 * @param {string} params.keyPrefix — First 8 chars of raw key (for display)
 * @param {string} [params.name] — Human-readable label
 * @param {string} [params.expiresAt] — ISO date string
 * @returns {Object} The stored key record (without key_hash)
 */
function createApiKey({ userId, keyHash, keyPrefix, name = null, expiresAt = null }) {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, userId, keyHash, keyPrefix, name, now, expiresAt || null);

  return {
    id,
    user_id: userId,
    key_prefix: keyPrefix,
    name,
    created_at: now,
    expires_at: expiresAt || null,
    last_used_at: null,
    revoked: 0
  };
}

/**
 * Find an API key by its hash.
 * Used for validation during authentication.
 *
 * @param {string} keyHash — SHA-256 hash of the raw key
 * @returns {Object|null} The API key record or null
 */
function findKeyByHash(keyHash) {
  const db = getDb();
  return db.prepare(`
    SELECT k.*, u.email as user_email, u.name as user_name
    FROM api_keys k
    JOIN users u ON k.user_id = u.id
    WHERE k.key_hash = ?
  `).get(keyHash) || null;
}

/**
 * Update last_used_at timestamp for a key.
 *
 * @param {string} keyId — API key record ID
 */
function touchKey(keyId) {
  const db = getDb();
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?')
    .run(new Date().toISOString(), keyId);
}

/**
 * Revoke an API key.
 *
 * @param {string} keyId — API key record ID
 * @returns {boolean} True if revoked
 */
function revokeKey(keyId) {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE api_keys SET revoked = 1, revoked_at = ? WHERE id = ?
  `).run(now, keyId);
  return result.changes > 0;
}

/**
 * List all API keys for a user (excludes key_hash).
 *
 * @param {string} userId — User ID
 * @returns {Array<Object>} Array of key records
 */
function listKeysForUser(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT id, user_id, key_prefix, name, created_at, expires_at, last_used_at, revoked, revoked_at
    FROM api_keys
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId);
}

/**
 * Delete an API key.
 *
 * @param {string} keyId — API key record ID
 * @returns {boolean} True if deleted
 */
function deleteApiKey(keyId) {
  const db = getDb();
  const result = db.prepare('DELETE FROM api_keys WHERE id = ?').run(keyId);
  return result.changes > 0;
}

/**
 * Revoke all active keys for a user.
 *
 * @param {string} userId — User ID
 * @returns {number} Number of keys revoked
 */
function revokeAllKeysForUser(userId) {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE api_keys SET revoked = 1, revoked_at = ?
    WHERE user_id = ? AND revoked = 0
  `).run(now, userId);
  return result.changes;
}

module.exports = {
  createApiKey,
  findKeyByHash,
  touchKey,
  revokeKey,
  listKeysForUser,
  deleteApiKey,
  revokeAllKeysForUser
};
