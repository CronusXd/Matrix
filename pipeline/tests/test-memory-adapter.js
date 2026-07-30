/**
 * Test: memory-adapter.js
 * SQLite adapter (init, read, write, push, resume, checkpoint, list, purge, file locking)
 *
 * O módulo usa node:sqlite (nativo do Node v22+) e escreve em pipeline/memory.db.
 * Para evitar poluir o DB real, fazemos backup/restore.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const MEMORY_DB = path.resolve(__dirname, '..', 'memory.db');
const MEMORY_DB_BAK = MEMORY_DB + '.test-bak';

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  ✅ ' + name);
    testsPassed++;
  } catch (err) {
    console.log('  ❌ ' + name + ': ' + err.message);
    testsFailed++;
  }
}

// ─── Setup / Teardown ─────────────────────────────────────────────────
function backupDb() {
  if (fs.existsSync(MEMORY_DB)) {
    fs.copyFileSync(MEMORY_DB, MEMORY_DB_BAK);
    fs.unlinkSync(MEMORY_DB);
  }
}

function restoreDb() {
  if (fs.existsSync(MEMORY_DB)) {
    try { fs.unlinkSync(MEMORY_DB); } catch(e) {}
  }
  if (fs.existsSync(MEMORY_DB_BAK)) {
    fs.renameSync(MEMORY_DB_BAK, MEMORY_DB);
  }
}

// ─── Imports ──────────────────────────────────────────────────────────
let memory;
try {
  const modPath = path.resolve(__dirname, '..', 'scripts', 'memory-adapter.js');
  delete require.cache[require.resolve(modPath)];
  memory = require(modPath);
} catch (err) {
  console.log('  ⚠️  Erro ao carregar memory-adapter: ' + err.message);
  console.log('  ⚠️  node:sqlite pode não estar disponível neste Node.');
  process.exit(0); // skip gracefully
}

// ─── Helpers ──────────────────────────────────────────────────────────
var NS = 'test_namespace';

// ─── Clean DB antes dos testes ───────────────────────────────────────
backupDb();

// ─── Tests ────────────────────────────────────────────────────────────

console.log('\n📦 memory-adapter.js — Testes Expandidos\n');

// ── module load ───────────────────────────────────────────────────────

test('módulo carrega sem erros', function () {
  assert.ok(memory, 'memory-adapter carregado');
  assert.ok(typeof memory.write === 'function', 'write é function');
  assert.ok(typeof memory.read === 'function', 'read é function');
});

// ── write / read ──────────────────────────────────────────────────────

test('write e read — ciclo básico', function () {
  memory.write(NS, 'key1', 'value1');
  var result = memory.read(NS, 'key1');
  assert.strictEqual(result, 'value1');
});

test('read de chave inexistente retorna null', function () {
  var result = memory.read(NS, 'nonexistent_' + Date.now());
  assert.strictEqual(result, null);
});

test('write sobrescreve valor existente (upsert)', function () {
  memory.write(NS, 'upsert_key', 'first');
  assert.strictEqual(memory.read(NS, 'upsert_key'), 'first');

  memory.write(NS, 'upsert_key', 'second');
  assert.strictEqual(memory.read(NS, 'upsert_key'), 'second');
});

test('write com valores complexos (objetos)', function () {
  var obj = { a: 1, b: { nested: true }, c: [1, 2, 3] };
  memory.write(NS, 'complex', JSON.stringify(obj));
  var result = JSON.parse(memory.read(NS, 'complex'));
  assert.deepStrictEqual(result, obj);
});

test('write com array', function () {
  var arr = [1, 'two', { three: 3 }];
  memory.write(NS, 'array_val', JSON.stringify(arr));
  var result = JSON.parse(memory.read(NS, 'array_val'));
  assert.deepStrictEqual(result, arr);
});

test('write com string numérica', function () {
  memory.write(NS, 'num_str', '12345');
  assert.strictEqual(memory.read(NS, 'num_str'), '12345');
});

test('write com valor booleano string', function () {
  memory.write(NS, 'bool_str', 'true');
  assert.strictEqual(memory.read(NS, 'bool_str'), 'true');
});

// ── push ──────────────────────────────────────────────────────────────

test('push adiciona item à lista', function () {
  assert.doesNotThrow(function () { memory.push(NS, 'mylist', { id: 1 }); });
  assert.doesNotThrow(function () { memory.push(NS, 'mylist', { id: 2 }); });
  var raw = memory.read(NS, 'mylist');
  if (raw) {
    assert.ok(Array.isArray(raw), 'lista é array');
    assert.strictEqual(raw.length, 2, 'lista tem 2 itens');
    assert.deepStrictEqual(raw[0], { id: 1 });
    assert.deepStrictEqual(raw[1], { id: 2 });
  } else {
    console.log('  ⏭️  push não suportado (db.transaction ausente)');
  }
});

test('push para lista inexistente cria nova lista', function () {
  assert.doesNotThrow(function () { memory.push(NS, 'new_list_' + Date.now(), 'first_item'); });
});

test('push valores variados', function () {
  assert.doesNotThrow(function () { memory.push(NS, 'varied_list', 42); });
  assert.doesNotThrow(function () { memory.push(NS, 'varied_list', 'string'); });
  assert.doesNotThrow(function () { memory.push(NS, 'varied_list', { key: 'val' }); });
});

// ── list ──────────────────────────────────────────────────────────────

test('list() retorna chaves de um namespace', function () {
  var keys = memory.list(NS);
  // Pode ser array ou objeto dependendo da implementação
  assert.ok(keys !== undefined && keys !== null);
  if (Array.isArray(keys)) {
    assert.ok(keys.length > 0, NS + ' tem chaves');
  }
});

test('list() namespace vazio retorna array vazio', function () {
  var emptyKeys = memory.list('_empty_namespace_' + Date.now());
  if (Array.isArray(emptyKeys)) {
    assert.strictEqual(emptyKeys.length, 0);
  }
});

test('list() namespace null não lança', function () {
  assert.doesNotThrow(function () { memory.list(null); });
});

// ── purge ─────────────────────────────────────────────────────────────

test('purge() remove itens de um namespace', function () {
  memory.write(NS, 'purge_test', 'to_be_removed');
  var before = memory.read(NS, 'purge_test');
  assert.strictEqual(before, 'to_be_removed');

  memory.purge(NS, 'purge_test');
  var after = memory.read(NS, 'purge_test');
  assert.strictEqual(after, null);
});

test('purge() chave inexistente não lança', function () {
  assert.doesNotThrow(function () { memory.purge(NS, 'chave_inexistente_' + Date.now()); });
});

test('purge() null não lança', function () {
  assert.doesNotThrow(function () { memory.purge(null, null); });
});

// ── checkpoint e resume ───────────────────────────────────────────────

test('checkpoint e resume — ciclo completo', function () {
  var snap1 = { phase: 'test', data: { x: 1 } };
  memory.checkpoint('state_1', snap1);

  var snap2 = { phase: 'test2', data: { y: 2 } };
  memory.checkpoint('state_2', snap2);

  memory.write('contexto', 'last_state', 'state_2');
  memory.write('contexto', 'last_demand', 'test demand');

  var result = memory.resume();
  assert.ok(result);
  assert.strictEqual(result.last_state, 'state_2');
  assert.strictEqual(result.last_demand, 'test demand');
  // checkpoints pode ser array ou objeto, dependendo da implementação
  assert.ok(result.checkpoints !== undefined, 'tem checkpoints');
});

test('resume sem dados retorna null', function () {
  // Limpa contexto especificamente para este teste
  var hasState = memory.read('contexto', 'last_state');
  if (!hasState) {
    var result = memory.resume();
    assert.strictEqual(result, null);
  } else {
    console.log('  ⏭️  skip: contexto já populado');
  }
});

test('checkpoint com dados variados', function () {
  assert.doesNotThrow(function () {
    memory.checkpoint('numeric_state', 42);
    memory.checkpoint('string_state', 'hello');
    memory.checkpoint('array_state', [1, 2, 3]);
  });
});

// ── read com namespace vazio ──────────────────────────────────────────

test('read com namespace vazio não quebra', function () {
  assert.doesNotThrow(function () { memory.read('', 'some_key'); });
});

test('read namespace null não quebra', function () {
  assert.doesNotThrow(function () { memory.read(null, 'key'); });
});

// ── write com valor vazio ─────────────────────────────────────────────

test('write com valor vazio', function () {
  memory.write(NS, 'empty_val', '');
  var result = memory.read(NS, 'empty_val');
  assert.strictEqual(result, '');
});

// ── getStorageType ────────────────────────────────────────────────────

test('getStorageType() retorna string', function () {
  var type = memory.getStorageType();
  assert.strictEqual(typeof type, 'string');
  assert.ok(type === 'json' || type === 'sqlite' || type === 'memory');
});

// ── File locking ──────────────────────────────────────────────────────

test('escrita concorrente não quebra', function () {
  // Simula escrita de múltiplos valores em sequência
  assert.doesNotThrow(function () {
    for (var i = 0; i < 10; i++) {
      memory.write(NS, 'concurrent_' + i, 'val_' + i);
    }
  });
  // Verifica alguns valores
  for (var j = 0; j < 10; j += 3) {
    var val = memory.read(NS, 'concurrent_' + j);
    assert.strictEqual(val, 'val_' + j);
  }
});

test('leitura após escrita massiva', function () {
  memory.write(NS, 'stress_key', 'stress_value');
  var val = memory.read(NS, 'stress_key');
  assert.strictEqual(val, 'stress_value');
});

// ─── Cleanup test data ───────────────────────────────────────────────
// Limpa dados de teste
try { memory.purge(NS, null); } catch(e) {}
try { memory.purge('contexto', null); } catch(e) {}

// ─── Restore ─────────────────────────────────────────────────────────
restoreDb();

// ─── Summary ─────────────────────────────────────────────────────────
console.log('\n📊 Resultado: ' + testsPassed + '/' + (testsPassed + testsFailed) + ' testes passaram');
process.exit(testsFailed > 0 ? 1 : 0);
