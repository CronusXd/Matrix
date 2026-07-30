#!/usr/bin/env node
/**
 * Matrix NON-BLOCKING Tests v1.0
 * Teste específico de NON-BLOCKING para o executor paralelo.
 *
 * Cobre:
 *   1. 5 tasks onde 1 lança erro → as outras 4 completam
 *   2. Pool não quebra após erro
 *
 * Uso: node test-non-blocking.js
 * Exit code: 0 se todos os testes passarem, 1 se algum falhar
 */

var path = require('path');
var executorPath = path.resolve(__dirname, '..', 'scripts', 'parallel-executor.js');
var executor = require(executorPath);

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

// ─── Test 1: 5 tasks onde 1 lança erro → as outras 4 completam ──────────
console.log('\n📋 Teste 1: 5 tasks, 1 lança erro → 4 completam');

test('5 tasks (4 success + 1 error) → 4 completam com sucesso', function () {
  return executor.executeParallel([
    { name: 'T1', fn: function () { return 'resultado 1'; } },
    { name: 'T2', fn: function () { return 'resultado 2'; } },
    { name: 'T3', fn: function () { throw new Error('Erro NON-BLOCKING simulado'); } },
    { name: 'T4', fn: function () { return 'resultado 4'; } },
    { name: 'T5', fn: function () { return 'resultado 5'; } }
  ], { maxWorkers: 6, timeout: 30000 }).then(function (results) {
    if (!results) throw new Error('executeParallel retornou null/undefined');
    if (results.length !== 5) throw new Error('Esperava 5 resultados, obteve ' + results.length);

    // Conta status
    var successCount = 0;
    var failedCount = 0;
    for (var i = 0; i < results.length; i++) {
      if (results[i].status === 'success') successCount++;
      else if (results[i].status === 'failed') failedCount++;
    }

    if (successCount !== 4) {
      throw new Error('Esperava 4 success (NON-BLOCKING), obteve ' + successCount +
        ' (failed=' + failedCount + ')');
    }
    if (failedCount !== 1) {
      throw new Error('Esperava 1 failed (a task T3), obteve ' + failedCount);
    }
  });
});

test('Task com erro tem error preenchido e as outras têm result', function () {
  return executor.executeParallel([
    { name: 'T1', fn: function () { return 'ok'; } },
    { name: 'T2', fn: function () { throw new Error('Falha T2'); } },
    { name: 'T3', fn: function () { return 'ok'; } }
  ], { maxWorkers: 6, timeout: 30000 }).then(function (results) {
    // T1 deve ter resultado
    if (results[0].status !== 'success') throw new Error('T1 deveria ser success, é ' + results[0].status);
    // T2 deve ter erro
    if (results[1].status !== 'failed') throw new Error('T2 deveria ser failed, é ' + results[1].status);
    if (!results[1].error) throw new Error('T2 deveria ter mensagem de erro');
    // T3 deve ter resultado
    if (results[2].status !== 'success') throw new Error('T3 deveria ser success, é ' + results[2].status);
  });
});

test('Erro síncrono no fn não quebra o pool inteiro', function () {
  return executor.executeParallel([
    { name: 'T1', fn: function () { return 'ok'; } },
    { name: 'T2', fn: function () { throw 'erro string'; } }, // throw string (não Error)
    { name: 'T3', fn: function () { return 'ok'; } },
    { name: 'T4', fn: function () { return 'ok'; } }
  ], { maxWorkers: 6, timeout: 30000 }).then(function (results) {
    if (results.length !== 4) throw new Error('Esperava 4 resultados, obteve ' + results.length);
    var successCount = 0;
    for (var i = 0; i < results.length; i++) {
      if (results[i].status === 'success') successCount++;
    }
    if (successCount < 3) {
      throw new Error('Esperava >= 3 success (NON-BLOCKING), obteve ' + successCount);
    }
  });
});

// ─── Test 2: Pool não quebra ─────────────────────────────────────────────
console.log('\n📋 Teste 2: Pool não quebra após erro');

test('Pool retorna resultados mesmo com múltiplas exceptions', function () {
  return executor.executeParallel([
    { name: 'T1', fn: function () { throw new Error('Erro 1'); } },
    { name: 'T2', fn: function () { throw new Error('Erro 2'); } },
    { name: 'T3', fn: function () { return 'a única que funciona'; } }
  ], { maxWorkers: 6, timeout: 30000 }).then(function (results) {
    if (!results) throw new Error('Pool retornou null mesmo com erros');
    if (results.length !== 3) throw new Error('Esperava 3 resultados, obteve ' + results.length);
    var successCount = 0;
    var failedCount = 0;
    for (var i = 0; i < results.length; i++) {
      if (results[i].status === 'success') successCount++;
      else if (results[i].status === 'failed') failedCount++;
    }
    if (successCount !== 1) throw new Error('Esperava 1 success (T3), obteve ' + successCount);
    if (failedCount !== 2) throw new Error('Esperava 2 failed (T1, T2), obteve ' + failedCount);
  });
});

test('Task sem fn, nem script, nem agent → status failed (noop)', function () {
  return executor.executeParallel([
    { name: 'T1' }, // task sem executor
    { name: 'T2', fn: function () { return 'ok'; } }
  ], { maxWorkers: 6, timeout: 30000 }).then(function (results) {
    if (results.length !== 2) throw new Error('Esperava 2 resultados');
    if (results[0].status !== 'failed') throw new Error('T1 (sem executor) deveria ser failed');
    if (results[1].status !== 'success') throw new Error('T2 deveria ser success');
  });
});

test('maxWorkers=1 executa em série mas ainda NON-BLOCKING', function () {
  var order = [];
  return executor.executeParallel([
    { name: 'T1', fn: function () { order.push('T1'); return 'r1'; } },
    { name: 'T2', fn: function () { order.push('T2'); return 'r2'; } },
    { name: 'T3', fn: function () { order.push('T3'); return 'r3'; } }
  ], { maxWorkers: 1, timeout: 30000 }).then(function (results) {
    if (results.length !== 3) throw new Error('Esperava 3 resultados');
    var allSuccess = results.every(function (r) { return r.status === 'success'; });
    if (!allSuccess) throw new Error('Todas as tasks deveriam ser success com maxWorkers=1');
  });
});

test('Timeout em 1 task não afeta as demais', function () {
  // Task com timeout muito curto
  return executor.executeParallel([
    { name: 'Lenta', fn: function () {
      var start = Date.now();
      while (Date.now() - start < 200) { /* spin */ }
      return 'terminou';
    }, timeout: 50 }, // timeout muito curto (50ms)
    { name: 'Rápida', fn: function () { return 'ok'; } }
  ], { maxWorkers: 6, timeout: 30000 }).then(function (results) {
    if (results.length !== 2) throw new Error('Esperava 2 resultados');
    // A task rápida deve ter completado mesmo que a lenta tenha timeout
    var rapida = results[1];
    if (rapida.status !== 'success') {
      throw new Error('Task rápida deveria ser success (NON-BLOCKING), é ' + rapida.status);
    }
  });
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
