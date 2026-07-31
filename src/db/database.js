/**
 * SQLite Database Setup & Migrations
 *
 * Uses sql.js (pure JavaScript SQLite, no native addons required).
 * Provides a better-sqlite3-compatible synchronous API after async init.
 *
 * IMPORTANT: Call initDb() before using getDb(). The server startup handles this.
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../utils/logger');

let db = null;
let sqlModule = null;
let _initialized = false;

/**
 * Ensure the database directory exists.
 */
function ensureDbDir() {
  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Persist the in-memory database to disk.
 */
function persistToDisk(database) {
  ensureDbDir();
  const data = database.export();
  fs.writeFileSync(config.dbPath, Buffer.from(data));
}

/**
 * Flatten nested parameter arrays for sql.js bind.
 */
function flattenParams(params) {
  if (params.length === 0) return [];
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

/**
 * Create the compat layer that wraps sql.js native API into
 * better-sqlite3 style: db.prepare(sql).run/get/all(params)
 */
function wrapDatabase(database) {
  // Store native prepare
  const nativePrepare = database.prepare.bind(database);

  // Create new prepare that returns { run, get, all }
  database.prepare = function (sql) {
    const stmt = nativePrepare(sql);

    return {
      run(...params) {
        const flat = flattenParams(params);
        stmt.bind(flat);
        stmt.step();
        stmt.free();
        const changes = database.getRowsModified();
        return { changes: changes || (flat.length > 0 ? 1 : 0) };
      },

      get(...params) {
        const flat = flattenParams(params);
        stmt.bind(flat);
        let row = null;
        if (stmt.step()) {
          row = stmt.getAsObject();
        }
        stmt.free();
        return row;
      },

      all(...params) {
        const flat = flattenParams(params);
        stmt.bind(flat);
        const rows = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
      }
    };
  };

  // Add exec method for raw SQL
  database.exec = function (sql) {
    nativePrepare(sql).step();
  };

  // Add pragma support
  database.pragma = function (pragmaSql) {
    nativePrepare(`PRAGMA ${pragmaSql}`).step();
  };

  // Add run wrapper directly on db
  database.run = function (sql, params) {
    const stmt = nativePrepare(sql);
    if (params) {
      stmt.bind(Array.isArray(params) ? params : [params]);
    }
    stmt.step();
    stmt.free();
  };

  return database;
}

/**
 * Load database from disk, or create a new one.
 * Must be called once at startup.
 */
async function initDb() {
  if (_initialized) return db;

  // Load sql.js module (needs async for WASM)
  sqlModule = await initSqlJs();

  if (fs.existsSync(config.dbPath)) {
    logger.info({ msg: 'Loading existing database', path: config.dbPath });
    const fileBuffer = fs.readFileSync(config.dbPath);
    db = new sqlModule.Database(fileBuffer);
  } else {
    logger.info({ msg: 'Creating new database', path: config.dbPath });
    db = new sqlModule.Database();
  }

  // Run migrations BEFORE wrapping (uses native prepare)
  runMigrationsNative(db);

  // Wrap with compat layer
  db = wrapDatabase(db);

  // Persist initial state
  persistToDisk(db);

  _initialized = true;
  logger.info('Database initialized and migrations complete');
  return db;
}

/**
 * Run database migrations using native sql.js prepare.
 * Called BEFORE wrapDatabase() to avoid compat layer issues.
 */
function runMigrationsNative(database) {
  // Use raw exec-like approach for DDL
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      key_hash TEXT UNIQUE NOT NULL,
      key_prefix TEXT NOT NULL,
      name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      last_used_at TEXT,
      revoked INTEGER NOT NULL DEFAULT 0,
      revoked_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix)`,
    `CREATE TABLE IF NOT EXISTS user_configs (
      user_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'deepseek',
      model TEXT NOT NULL DEFAULT 'deepseek-chat',
      api_key_encrypted TEXT,
      max_tokens INTEGER NOT NULL DEFAULT 4096,
      temperature REAL NOT NULL DEFAULT 0.7,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  ];

  for (const sql of stmts) {
    const stmt = database.prepare(sql);
    stmt.step();
    stmt.free();
  }

  logger.info('Database migrations complete');
}

/**
 * Get the database instance (synchronous after initDb() has been called).
 * Throws if the database is not initialized yet.
 *
 * @returns {Object} The sql.js database instance with compat layer
 */
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first during server startup.');
  }
  return db;
}

/**
 * Persist the current database state to disk.
 */
function saveDb() {
  if (db) {
    persistToDisk(db);
  }
}

/**
 * Close the database connection gracefully.
 */
function closeDb() {
  if (db) {
    logger.info('Closing database connection');
    persistToDisk(db);
    db.close();
    db = null;
    _initialized = false;
  }
}

module.exports = { initDb, getDb, closeDb, saveDb };
