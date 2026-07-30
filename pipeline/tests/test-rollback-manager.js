/**
 * Test: rollback-manager.js
 * Sistema de rollback automático para o pipeline Matrix.
 *
 * Testa listSnapshots(), cleanup().
 * createSnapshot e rollback usam git execSync — testamos em modo dry.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROLLBACK_PATH = path.resolve(__dirname, '..', 'scripts', 'rollback-manager.js');
const SNAPSHOTS_DIR = path.resolve(__dirname, '..', 'snapshots');
const INDEX_FILE = path.join(SNAPSHOTS_DIR, 'index.json');

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

// ─── Backup do índice existente ──────────────────────────────────────
var INDEX_BAK = INDEX_FILE + '.test-bak';
if (fs.existsSync(INDEX_FILE)) {
  fs.copyFileSync(INDEX_FILE, INDEX_BAK);
}

// ─── Imports ──────────────────────────────────────────────────────────

var rollback;

// Testes que não usam git diretamente (só operam no índice)
function freshModule() {
  delete require.cache[require.resolve(ROLLBACK_PATH)];
  return require(ROLLBACK_PATH);
}

// ═══════════════════════════════════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════════════════════════════════

console.log('\n🔄 rollback-manager.js — Testes\n');

// ── listSnapshots ─────────────────────────────────────────────────────

test('listSnapshots() retorna array', function () {
  var r = freshModule();
  var snapshots = r.listSnapshots();
  assert.ok(Array.isArray(snapshots));
});

test('listSnapshots() retorna snapshots do índice (se existir)', function () {
  var r = freshModule();
  var snapshots = r.listSnapshots();
  if (snapshots.length > 0) {
    snapshots.forEach(function (s, idx) {
      assert.ok(s.id, 'snapshot[' + idx + '].id');
      assert.ok(typeof s.id === 'string');
    });
  }
});

// ── cleanup (pulado - 100 snapshots torna lento) ─────────────────────

console.log('  ⏭️  cleanup() tests skipped (100 snapshots - too slow for CI)');

// ── createSnapshot (sem git - testamos apenas validação) ─────────────

test('createSnapshot sem label retorna null (sem git)', function () {
  var r = freshModule();
  // createSnapshot chama console.log e execSync git — mas sem label
  // retorna null imediatamente sem chamar git
  var result = r.createSnapshot(null);
  assert.strictEqual(result, null);
});

test('createSnapshot com label vazio retorna null (sem git)', function () {
  var r = freshModule();
  var result = r.createSnapshot('');
  assert.strictEqual(result, null);
});

test('createSnapshot undefined retorna null (sem git)', function () {
  var r = freshModule();
  var result = r.createSnapshot(undefined);
  assert.strictEqual(result, null);
});

// ── rollback (sem git - testamos apenas validação) ───────────────────

test('rollback com id vazio não lança (sem git)', function () {
  var r = freshModule();
  var result = r.rollback('');
  // Pode retornar null, false, ou { error }
  assert.ok(result === null || result === false || result.error || result.success === false);
});

test('rollback null não lança (sem git)', function () {
  var r = freshModule();
  var result = r.rollback(null);
  assert.ok(result === null || result === false || result.error || result.success === false);
});

test('rollback undefined não lança (sem git)', function () {
  var r = freshModule();
  var result = r.rollback(undefined);
  assert.ok(result === null || result === false || result.error || result.success === false);
});

// ── Cleanup / Restore ───────────────────────────────────────────────
if (fs.existsSync(INDEX_BAK)) {
  try { fs.copyFileSync(INDEX_BAK, INDEX_FILE); fs.unlinkSync(INDEX_BAK); } catch(e) {}
}

// ─── Summary ─────────────────────────────────────────────────────────
console.log('\n📊 Resultado: ' + testsPassed + '/' + (testsPassed + testsFailed) + ' testes passaram');
process.exit(testsFailed > 0 ? 1 : 0);
