#!/usr/bin/env node
/**
 * Matrix Parallel Merger Tests v1.0
 * Testes formais para parallel-merger.js
 *
 * Cobre:
 *   1. Merge com resultados variados (success, failed, timedOut)
 *   2. Merge com input vazio → resultado vazio
 *   3. NON-BLOCKING: dados inválidos não quebram
 *
 * Uso: node test-parallel-merger.js
 * Exit code: 0 se todos os testes passarem, 1 se algum falhar
 */

var path = require('path');
var mergerPath = path.resolve(__dirname, '..', 'scripts', 'parallel-merger.js');
var merger = require(mergerPath);

// ─── Test Runner ──────────────────────────────────────────────────────────
var passed = 0;
var failed = 0;
var total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log('  ✅ ' + name);
  } catch (e) {
    failed++;
    console.log('  ❌ ' + name + ': ' + e.message);
  }
}

// ─── Test 1: Merge com resultados variados ───────────────────────────────
console.log('\n📋 Teste 1: Merge com resultados variados (success, failed, timedOut)');

test('Merge com 3 resultados variados retorna summary com contagens corretas', function () {
  var results = [
    { task: 'T1', result: 'OK', status: 'success' },
    { task: 'T2', error: 'Algo deu errado', status: 'failed' },
    { task: 'T3', error: 'timeout (excedeu 60000ms)', status: 'timeout' }
  ];
  var merged = merger.merge(results, { detectConflicts: false });
  if (!merged) throw new Error('merge() retornou null/undefined');
  if (merged.summary.total !== 3) throw new Error('Esperava total=3, obteve ' + merged.summary.total);
  if (merged.summary.success !== 1) throw new Error('Esperava success=1, obteve ' + merged.summary.success);
  if (merged.summary.failed !== 1) throw new Error('Esperava failed=1, obteve ' + merged.summary.failed);
  if (merged.summary.timedOut !== 1) throw new Error('Esperava timedOut=1, obteve ' + merged.summary.timedOut);
});

test('Merge com 5 resultados variados (success, failed, timedOut, delegated) → contagens corretas', function () {
  var results = [
    { task: 'T1', result: 'Sucesso', status: 'success' },
    { task: 'T2', result: 'Script executado', status: 'success' },
    { task: 'T3', error: 'Erro de conexão', status: 'failed' },
    { task: 'T4', error: 'timeout', status: 'timeout' },
    { task: 'T5', result: '{"delegated":true,"agent":"@backend-architect"}', status: 'delegated', agent: '@backend-architect' }
  ];
  var merged = merger.merge(results, { detectConflicts: false });
  if (merged.summary.total !== 5) throw new Error('Esperava total=5, obteve ' + merged.summary.total);
  if (merged.summary.success !== 2) throw new Error('Esperava success=2, obteve ' + merged.summary.success);
  if (merged.summary.failed !== 1) throw new Error('Esperava failed=1, obteve ' + merged.summary.failed);
  if (merged.summary.timedOut !== 1) throw new Error('Esperava timedOut=1, obteve ' + merged.summary.timedOut);
  if (merged.summary.delegated !== 1) throw new Error('Esperava delegated=1, obteve ' + merged.summary.delegated);
});

test('Merge com 5 resultados → success=false (porque tem failed)', function () {
  var results = [
    { task: 'T1', result: 'OK', status: 'success' },
    { task: 'T2', result: 'OK', status: 'success' },
    { task: 'T3', result: 'OK', status: 'success' },
    { task: 'T4', error: 'Erro', status: 'failed' },
    { task: 'T5', result: 'OK', status: 'success' }
  ];
  var merged = merger.merge(results, { detectConflicts: false });
  // Tem failed > 0 sem delegated → success = false
  if (merged.success !== false) throw new Error('Esperava success=false (tem failed sem delegated), obteve ' + merged.success);
});

test('Merge com delegated flow → success=true mesmo com failed', function () {
  // Fluxo delegado: se tem delegated > 0, failed é tolerado (NON-BLOCKING)
  var results = [
    { task: 'T1', result: '{"delegated":true}', status: 'delegated', agent: '@ArchitectUX' },
    { task: 'T2', error: 'Erro', status: 'failed' }
  ];
  var merged = merger.merge(results, { detectConflicts: false });
  // Fluxo delegado tolera falhas
  if (merged.success !== true) throw new Error('Esperava success=true (delegated flow tolera falhas), obteve ' + merged.success);
});

test('Merge com timedOut em tasks isoladas → timedOut contado corretamente', function () {
  var results = [
    { task: 'T1', result: 'Sucesso', status: 'success' },
    { task: 'T2', error: 'timeout (excedeu 60000ms)', status: 'timeout' }
  ];
  var merged = merger.merge(results, { detectConflicts: false });
  if (merged.summary.timedOut !== 1) throw new Error('Esperava timedOut=1, obteve ' + merged.summary.timedOut);
  // NON-BLOCKING: timeout com success presente → success=true (timeout não é hard failure)
  if (merged.success !== true) throw new Error('Esperava success=true (NON-BLOCKING: timeout não é hard failure), obteve ' + merged.success);
});

test('Details array tem entradas correspondentes a cada resultado', function () {
  var results = [
    { task: 'T1', result: 'OK', status: 'success' },
    { task: 'T2', error: 'Erro', status: 'failed' }
  ];
  var merged = merger.merge(results, { detectConflicts: false });
  if (!merged.details || merged.details.length !== 2) {
    throw new Error('Esperava 2 details, obteve ' + (merged.details ? merged.details.length : 0));
  }
  if (merged.details[0].status !== 'success') throw new Error('Detail[0] status deveria ser success');
  if (merged.details[1].status !== 'failed') throw new Error('Detail[1] status deveria ser failed');
});

test('Merge retorna mergeTime como string com ms', function () {
  var results = [
    { task: 'T1', result: 'OK', status: 'success' }
  ];
  var merged = merger.merge(results, { detectConflicts: false });
  if (typeof merged.mergeTime !== 'string') throw new Error('mergeTime deveria ser string');
  if (merged.mergeTime.indexOf('ms') === -1) throw new Error('mergeTime deveria conter "ms"');
});

// ─── Test 2: Input vazio ─────────────────────────────────────────────────
console.log('\n📋 Teste 2: Merge com input vazio');

test('Array vazio → summary com total=0', function () {
  var merged = merger.merge([], { detectConflicts: false });
  if (merged.summary.total !== 0) throw new Error('Esperava total=0, obteve ' + merged.summary.total);
});

test('Array vazio → success=true (sem hard failures)', function () {
  var merged = merger.merge([], { detectConflicts: false });
  // Array vazio: total=0, hasHardFailure=false → overallSuccess=true
  if (merged.success !== true) throw new Error('Esperava success=true (sem hard failures), obteve ' + merged.success);
});

test('Array vazio → details vazio', function () {
  var merged = merger.merge([], { detectConflicts: false });
  if (!merged.details || merged.details.length !== 0) {
    throw new Error('Esperava details vazio, obteve ' + (merged.details ? merged.details.length : 'null'));
  }
});

test('Array vazio → conflicts vazio', function () {
  var merged = merger.merge([], { detectConflicts: false });
  if (!merged.conflicts || merged.conflicts.length !== 0) {
    throw new Error('Esperava conflicts vazio, obteve ' + (merged.conflicts ? merged.conflicts.length : 'null'));
  }
});

// ─── Test 3: NON-BLOCKING — dados inválidos não quebram ─────────────────
console.log('\n📋 Teste 3: NON-BLOCKING: dados inválidos não quebram');

test('null → retorna resultado vazio (não lança)', function () {
  var merged = merger.merge(null);
  // Deve retornar resultado vazio, não lançar
  if (!merged) throw new Error('merge(null) retornou null/undefined');
  if (merged.summary.total !== 0) throw new Error('Esperava total=0 para null, obteve ' + merged.summary.total);
});

test('undefined → retorna resultado vazio (não lança)', function () {
  var merged = merger.merge(undefined);
  if (!merged) throw new Error('merge(undefined) retornou null/undefined');
  if (merged.summary.total !== 0) throw new Error('Esperava total=0 para undefined, obteve ' + merged.summary.total);
});

test('String → retorna resultado vazio (não lança)', function () {
  var merged = merger.merge('invalid');
  if (!merged) throw new Error('merge("invalid") retornou null/undefined');
  if (merged.summary.total !== 0) throw new Error('Esperava total=0 para string');
});

test('Número → retorna resultado vazio (não lança)', function () {
  var merged = merger.merge(42);
  if (!merged) throw new Error('merge(42) retornou null/undefined');
  if (merged.summary.total !== 0) throw new Error('Esperava total=0 para número');
});

test('Elemento null no meio do array não quebra o merge', function () {
  var results = [
    { task: 'T1', result: 'OK', status: 'success' },
    null,
    { task: 'T3', result: 'OK', status: 'success' }
  ];
  var merged = merger.merge(results, { detectConflicts: false });
  if (merged.summary.total !== 3) throw new Error('Esperava total=3 (elemento null conta como failed), obteve ' + merged.summary.total);
  // Elemento null conta como failed
  if (merged.summary.failed < 1) throw new Error('Elemento null deveria contar como failed, obteve failed=' + merged.summary.failed);
});

test('Status desconhecido é tratado sem lançar', function () {
  var results = [
    { task: 'T1', result: 'OK', status: 'unknown_status_xyz' }
  ];
  var merged = merger.merge(results, { detectConflicts: false });
  if (!merged) throw new Error('merge com status desconhecido retornou null');
  // Status desconhecido com result presente → success
  if (merged.summary.success !== 1) throw new Error('Status desconhecido com result deveria ser success');
});

test('Objeto sem task nem result nem error não quebra', function () {
  var results = [
    { foo: 'bar' }
  ];
  var merged = merger.merge(results, { detectConflicts: false });
  if (!merged) throw new Error('merge com objeto vazio retornou null');
  // Deve ter contado como sucesso (resultado vazio sem erro = sucesso)
  if (merged.summary.total !== 1) throw new Error('Esperava total=1');
});

test('DetectConflicts=false não executa git diff (não quebra em non-repo)', function () {
  var results = [
    { task: 'T1', result: 'OK', status: 'success' }
  ];
  // Com detectConflicts=false, não deve tentar git diff
  var merged = merger.merge(results, { detectConflicts: false });
  if (!merged) throw new Error('merge retornou null');
  // Conflicts deve estar vazio
  if (merged.conflicts.length !== 0) throw new Error('Com detectConflicts=false, conflicts deveria estar vazio');
});

test('Merge com 10 results não quebra (volume)', function () {
  var results = [];
  for (var i = 0; i < 10; i++) {
    results.push({
      task: 'T' + (i + 1),
      result: i % 2 === 0 ? 'OK' : null,
      error: i % 2 === 1 ? 'erro simulado' : null,
      status: i % 2 === 0 ? 'success' : 'failed'
    });
  }
  var merged = merger.merge(results, { detectConflicts: false });
  if (merged.summary.total !== 10) throw new Error('Esperava total=10, obteve ' + merged.summary.total);
  if (merged.summary.success !== 5) throw new Error('Esperava success=5, obteve ' + merged.summary.success);
  if (merged.summary.failed !== 5) throw new Error('Esperava failed=5, obteve ' + merged.summary.failed);
});

// ─── Summary ─────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════');
console.log('Resultados: ' + passed + '/' + total + ' testes passaram');
if (failed > 0) {
  console.log('❌ ' + failed + ' teste(s) falharam');
  process.exit(1);
} else {
  console.log('✅ Todos os testes passaram!');
  process.exit(0);
}
