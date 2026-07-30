/**
 * Matrix Context Builder Cache v1.0
 * Cache TTL para o Context Builder. Evita glob+grep repetitivo.
 * NON-BLOCKING: falha no cache não interrompe o pipeline.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const CACHE_DIR = path.resolve(__dirname, '..');
const CACHE_FILE = path.resolve(CACHE_DIR, 'context-cache.json');
const TTL_SECONDS = 60;

function getProjectHash() {
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel 2>nul', {
      encoding: 'utf-8',
      timeout: 5000
    }).trim();
    return crypto.createHash('md5').update(gitRoot).digest('hex').slice(0, 8);
  } catch {
    return 'local';
  }
}

function getCacheKey(keywords) {
  const sorted = [...keywords].sort().join(',');
  const hash = crypto.createHash('md5').update(sorted).digest('hex').slice(0, 16);
  return `cb:${getProjectHash()}:${hash}`;
}

function isCacheValid(cacheEntry) {
  if (!cacheEntry || !cacheEntry.timestamp) return false;
  const age = (Date.now() - new Date(cacheEntry.timestamp).getTime()) / 1000;
  if (age > TTL_SECONDS) return false;
  return true;
}

function get(key) {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    const entry = cache[key];
    if (!entry) return null;
    if (!isCacheValid(entry)) {
      delete cache[key];
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function set(key, data) {
  try {
    let cache = {};
    if (fs.existsSync(CACHE_FILE)) {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    }
    cache[key] = { data, timestamp: new Date().toISOString() };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error('⚠️  Erro ao escrever cache:', e.message);
  }
}

function clean() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return;
    const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    let changed = false;
    for (const [key, entry] of Object.entries(cache)) {
      if (!isCacheValid(entry)) {
        delete cache[key];
        changed = true;
      }
    }
    if (changed) fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {
    // NON-BLOCKING
  }
}

// Wrappers da interface pública (alinhada com a todolist)
function checkCache(keywords) {
  return get(getCacheKey(keywords));
}

function saveCache(keywords, context) {
  set(getCacheKey(keywords), context);
}

module.exports = { getCacheKey, get, set, clean, isCacheValid, checkCache, saveCache };
