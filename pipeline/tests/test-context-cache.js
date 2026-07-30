/**
 * Test: context-cache.js
 * Cache TTL, get/set/clean, invalidation.
 *
 * O módulo exporta diretamente — podemos usar require().
 * Usa context-cache.json no pipeline dir — fazemos backup/restore.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const CACHE_FILE = path.resolve(__dirname, '..', 'context-cache.json');
const CACHE_BAK = CACHE_FILE + '.test-bak';

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    testsPassed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    testsFailed++;
  }
}

// ─── Setup / Teardown ─────────────────────────────────────────────────
function backupCache() {
  if (fs.existsSync(CACHE_FILE)) {
    fs.copyFileSync(CACHE_FILE, CACHE_BAK);
    fs.unlinkSync(CACHE_FILE);
  }
}

function restoreCache() {
  if (fs.existsSync(CACHE_FILE)) {
    fs.unlinkSync(CACHE_FILE);
  }
  if (fs.existsSync(CACHE_BAK)) {
    fs.renameSync(CACHE_BAK, CACHE_FILE);
  }
}

// ─── Imports ──────────────────────────────────────────────────────────
const modPath = path.resolve(__dirname, '..', 'scripts', 'context-cache.js');
delete require.cache[require.resolve(modPath)];
const cache = require(modPath);

// ─── Helpers ──────────────────────────────────────────────────────────
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Tests: getCacheKey ──────────────────────────────────────────────

console.log('\n🗃️  context-cache.js — getCacheKey\n');

test('getCacheKey: mesmas keywords → mesma chave', () => {
  const key1 = cache.getCacheKey(['hello', 'world']);
  const key2 = cache.getCacheKey(['hello', 'world']);
  assert.strictEqual(key1, key2);
});

test('getCacheKey: ordem diferente → mesma chave (sorted)', () => {
  const key1 = cache.getCacheKey(['world', 'hello']);
  const key2 = cache.getCacheKey(['hello', 'world']);
  assert.strictEqual(key1, key2);
});

test('getCacheKey: keywords diferentes → chaves diferentes', () => {
  const key1 = cache.getCacheKey(['hello']);
  const key2 = cache.getCacheKey(['world']);
  assert.notStrictEqual(key1, key2);
});

test('getCacheKey: array vazio não quebra', () => {
  const key = cache.getCacheKey([]);
  assert.ok(typeof key === 'string' && key.length > 0);
});

test('getCacheKey: prefixo "cb:"', () => {
  const key = cache.getCacheKey(['test']);
  assert.ok(key.startsWith('cb:'));
});

// ─── Tests: isCacheValid ─────────────────────────────────────────────

console.log('\n🗃️  context-cache.js — isCacheValid\n');

test('isCacheValid: entrada válida (recente)', () => {
  const entry = { data: 'x', timestamp: new Date().toISOString() };
  assert.strictEqual(cache.isCacheValid(entry), true);
});

test('isCacheValid: entrada expirada', () => {
  const past = new Date(Date.now() - 120 * 1000); // 2 minutos atrás
  const entry = { data: 'x', timestamp: past.toISOString() };
  assert.strictEqual(cache.isCacheValid(entry), false);
});

test('isCacheValid: entrada nula → false', () => {
  assert.strictEqual(cache.isCacheValid(null), false);
});

test('isCacheValid: undefined → false', () => {
  assert.strictEqual(cache.isCacheValid(undefined), false);
});

test('isCacheValid: sem timestamp → false', () => {
  assert.strictEqual(cache.isCacheValid({ data: 'x' }), false);
});

// ─── Tests: set / get / clean ────────────────────────────────────────

console.log('\n🗃️  context-cache.js — set / get / clean\n');

test('set e get: ciclo básico', () => {
  const key = 'test:basic:' + Date.now();
  cache.set(key, { hello: 'world' });
  const result = cache.get(key);
  assert.deepStrictEqual(result, { hello: 'world' });
});

test('get: chave inexistente → null', () => {
  const result = cache.get('nonexistent:' + Date.now());
  assert.strictEqual(result, null);
});

test('set e get: valor primitivo', () => {
  const key = 'test:primitive:' + Date.now();
  cache.set(key, 42);
  assert.strictEqual(cache.get(key), 42);
});

test('set e get: string', () => {
  const key = 'test:string:' + Date.now();
  cache.set(key, 'hello world');
  assert.strictEqual(cache.get(key), 'hello world');
});

test('set sobrescreve valor existente', () => {
  const key = 'test:overwrite:' + Date.now();
  cache.set(key, 'first');
  cache.set(key, 'second');
  assert.strictEqual(cache.get(key), 'second');
});

test('get: entrada expirada retorna null', () => {
  const key = 'test:expired:' + Date.now();
  // Criar entrada manualmente com timestamp antigo
  const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
  const data = JSON.parse(raw);
  data[key] = { data: 'old', timestamp: new Date(Date.now() - 120000).toISOString() };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  assert.strictEqual(cache.get(key), null);
});

test('clean: remove entradas expiradas', () => {
  // Inserir algumas entradas expiradas manualmente
  const validKey = 'test:valid:' + Date.now();
  const expiredKey = 'test:expired2:' + Date.now();

  cache.set(validKey, 'fresh');

  const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
  const data = JSON.parse(raw);
  data[expiredKey] = { data: 'stale', timestamp: new Date(Date.now() - 120000).toISOString() };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));

  cache.clean();

  const after = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  assert.ok(after[validKey] !== undefined);
  assert.ok(after[expiredKey] === undefined);
});

test('clean: sem arquivo não quebra', () => {
  const tmpPath = CACHE_FILE + '.tmp';
  // Renomear para simular ausência
  if (fs.existsSync(CACHE_FILE)) {
    fs.renameSync(CACHE_FILE, tmpPath);
  }
  assert.doesNotThrow(() => cache.clean());
  if (fs.existsSync(tmpPath)) {
    fs.renameSync(tmpPath, CACHE_FILE);
  }
});

// ─── Tests: checkCache / saveCache (wrappers) ────────────────────────

console.log('\n🗃️  context-cache.js — checkCache / saveCache\n');

test('saveCache e checkCache: ciclo completo', () => {
  const keywords = ['test', 'cycle'];
  const context = { files: ['a.js', 'b.js'], score: 0.95 };

  cache.saveCache(keywords, context);
  const result = cache.checkCache(keywords);
  assert.deepStrictEqual(result, context);
});

test('checkCache: keywords diferentes → null', () => {
  const result = cache.checkCache(['nonexistent', 'query']);
  assert.strictEqual(result, null);
});

// ─── Cleanup ─────────────────────────────────────────────────────────
restoreCache();

// ─── Summary ─────────────────────────────────────────────────────────
console.log(`\n📊 Resultado: ${testsPassed}/${testsPassed + testsFailed} testes passaram`);
process.exit(testsFailed > 0 ? 1 : 0);
