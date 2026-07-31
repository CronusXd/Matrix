/**
 * Users Data Access Layer
 *
 * CRUD operations for the users table.
 */

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./database');
const { NotFoundError } = require('../utils/errors');

/**
 * Create a new user.
 *
 * @param {Object} params
 * @param {string} params.email — User email (unique)
 * @param {string} [params.name] — Display name
 * @returns {Object} The created user
 */
function createUser({ email, name = null }) {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO users (id, email, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(id, email, name, now, now);

  return { id, email, name, created_at: now, updated_at: now };
}

/**
 * Find a user by ID.
 *
 * @param {string} id — User ID
 * @returns {Object|null} The user or null
 */
function getUserById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

/**
 * Find a user by email.
 *
 * @param {string} email — User email
 * @returns {Object|null} The user or null
 */
function getUserByEmail(email) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) || null;
}

/**
 * List all users.
 *
 * @returns {Array<Object>} Array of users
 */
function listUsers() {
  const db = getDb();
  return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
}

/**
 * Update a user.
 *
 * @param {string} id — User ID
 * @param {Object} updates — Fields to update (email, name)
 * @returns {Object} The updated user
 */
function updateUser(id, updates) {
  const db = getDb();
  const user = getUserById(id);
  if (!user) throw new NotFoundError('User not found');

  const fields = [];
  const values = [];

  if (updates.email !== undefined) {
    fields.push('email = ?');
    values.push(updates.email);
  }
  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }

  if (fields.length === 0) return user;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  return getUserById(id);
}

/**
 * Delete a user and all associated data (cascades to api_keys, user_configs).
 *
 * @param {string} id — User ID
 * @returns {boolean} True if deleted
 */
function deleteUser(id) {
  const db = getDb();
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return result.changes > 0;
}

module.exports = {
  createUser,
  getUserById,
  getUserByEmail,
  listUsers,
  updateUser,
  deleteUser
};
