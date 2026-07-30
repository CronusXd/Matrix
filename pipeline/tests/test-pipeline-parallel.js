#!/usr/bin/env node
/**
 * Matrix Pipeline Parallel Orchestrator Tests v1.0
 * Testes formais para pipeline-parallel.js
 *
 * Cobre:
 *   1. Ciclo completo com 3 tasks independentes
 *   2. Todolist vazia → resultado vazio
 *   3. maxWorkers respeita limite 6
 *
 * Uso: node test-pipeline-parallel.js
 * Exit code: 0 se todos os testes passarem, 1 se algum falhar
 */

var path = require('path');
var pipelineParallelPath = path.resolve(__dirname, '..', 'scripts', 'pipeline-parallel.js');
var pipelineParallel = require(pipelineParallelPath);

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

// ─── Test 1: Ciclo completo com 3 tasks independentes ────────────────────
console.log('\n📋 Teste 1: Ciclo completo com 3 tasks independentes usando fn-based');

test('run() com 3 tasks fn-based retorna resultado com 3 entries', function () {
  return pipelineParallel.run([
    { description: 'Task 1', fn: function () { return 'resultado 1'; } },
    { description: 'Task 2', fn: function () { return 'resultado 2'; } },
    { description: 'Task 3', fn: function () { return 'resultado 3'; } }
  ], { skipDecompose: true, detectConflicts: false }).then(function (result) {
    if (!result) throw new Error('run() retornou null/undefined');
    if (result.summary.total !== 3) throw new Error('Esperava total=3, obteve ' + result.summary.total);
  });
});

test('run() com 3 tasks fn-based → 3 success', function () {
  return pipelineParallel.run([
    { description: 'Task 1', fn: function () { return 'r1'; } },
    { description: 'Task 2', fn: function () { return 'r2'; } },
    { description: 'Task 3', fn: function () { return 'r3'; } }
  ], { skipDecompose: true, detectConflicts: false }).then(function (result) {
    if (result.summary.success !== 3) {
      throw new Error('Esperava 3 success, obteve ' + result.summary.success +
        ' (failed=' + result.summary.failed + ', timedOut=' + result.summary.timedOut +
        ', delegated=' + result.summary.delegated + ')');
    }
  });
});

test('run() com 3 tasks fn-based → success=true', function () {
  return pipelineParallel.run([
    { description: 'Task 1', fn: function () { return 'r1'; } },
    { description: 'Task 2', fn: function () { return 'r2'; } },
    { description: 'Task 3', fn: function () { return 'r3'; } }
  ], { skipDecompose: true, detectConflicts: false }).then(function (result) {
    if (result.success !== true) throw new Error('Esperava success=true, obteve ' + result.success);
  });
});

test('run() com 3 tasks → agentsUsed não vazio', function () {
  return pipelineParallel.run([
    { description: 'Task 1', fn: function () { return 'r1'; } },
    { description: 'Task 2', fn: function () { return 'r2'; } },
    { description: 'Task 3', fn: function () { return 'r3'; } }
  ], { skipDecompose: true, detectConflicts: false }).then(function (result) {
    if (!result.agentsUsed || result.agentsUsed.length === 0) {
      throw new Error('agentsUsed deveria ter pelo menos 1 agente');
    }
  });
});

test('run() com 3 tasks → details array com 3 entries', function () {
  return pipelineParallel.run([
    { description: 'Task 1', fn: function () { return 'r1'; } },
    { description: 'Task 2', fn: function () { return 'r2'; } },
    { description: 'Task 3', fn: function () { return 'r3'; } }
  ], { skipDecompose: true, detectConflicts: false }).then(function (result) {
    if (!result.details || result.details.length !== 3) {
      throw new Error('Esperava 3 details, obteve ' + (result.details ? result.details.length : 0));
    }
  });
});

test('run() com 3 tasks → stages array com 3 ou mais stages', function () {
  return pipelineParallel.run([
    { description: 'Task 1', fn: function () { return 'r1'; } },
    { description: 'Task 2', fn: function () { return 'r2'; } },
    { description: 'Task 3', fn: function () { return 'r3'; } }
  ], { skipDecompose: true, detectConflicts: false }).then(function (result) {
    if (!result.stages || !result.stages.stages || result.stages.stages.length < 3) {
      throw new Error('Esperava >= 3 stages (dispatch, execution, merge), obteve ' +
        (result.stages ? (result.stages.stages ? result.stages.stages.length : 'no stages array') : 'null'));
    }
  });
});

test('run() com 3 tasks → totalTime > 0', function () {
  return pipelineParallel.run([
    { description: 'Task 1', fn: function () { return 'r1'; } },
    { description: 'Task 2', fn: function () { return 'r2'; } },
    { description: 'Task 3', fn: function () { return 'r3'; } }
  ], { skipDecompose: true, detectConflicts: false }).then(function (result) {
    if (result.totalTime <= 0) throw new Error('totalTime deveria ser > 0, obteve ' + result.totalTime);
  });
});

// ─── Test 2: Todolist vazia ──────────────────────────────────────────────
console.log('\n📋 Teste 2: Todolist vazia → resultado vazio');

test('Array vazio → total=0', function () {
  return pipelineParallel.run([], { detectConflicts: false }).then(function (result) {
    if (result.summary.total !== 0) throw new Error('Esperava total=0, obteve ' + result.summary.total);
  });
});

test('Array vazio → details vazio', function () {
  return pipelineParallel.run([], { detectConflicts: false }).then(function (result) {
    if (!result.details || result.details.length !== 0) {
      throw new Error('Esperava details vazio, obteve ' + (result.details ? result.details.length : 'null'));
    }
  });
});

test('Array vazio → success=false (nenhuma task)', function () {
  return pipelineParallel.run([], { detectConflicts: false }).then(function (result) {
    if (result.success !== false) throw new Error('Esperava success=false (vazio), obteve ' + result.success);
  });
});

test('Array vazio → batchCount=0', function () {
  return pipelineParallel.run([], { detectConflicts: false }).then(function (result) {
    if (result.batchCount !== 0) throw new Error('Esperava batchCount=0, obteve ' + result.batchCount);
  });
});

test('Array vazio → errors array contém mensagem', function () {
  return pipelineParallel.run([], { detectConflicts: false }).then(function (result) {
    if (!result.errors || result.errors.length === 0) {
      throw new Error('Deveria ter pelo menos 1 erro (todolist is empty)');
    }
  });
});

test('null → resultado vazio sem lançar exceção', function () {
  return pipelineParallel.run(null, { detectConflicts: false }).then(function (result) {
    if (result.summary.total !== 0) throw new Error('Esperava total=0 para null');
  });
});

test('undefined → resultado vazio sem lançar exceção', function () {
  return pipelineParallel.run(undefined, { detectConflicts: false }).then(function (result) {
    if (result.summary.total !== 0) throw new Error('Esperava total=0 para undefined');
  });
});

// ─── Test 3: maxWorkers respeita limite 6 ────────────────────────────────
console.log('\n📋 Teste 3: maxWorkers respeita limite 6');

test('maxWorkers=999 → limitado a 6', function () {
  return pipelineParallel.run([
    { description: 'Task 1', fn: function () { return 'r1'; } }
  ], { maxWorkers: 999, skipDecompose: true, detectConflicts: false }).then(function (result) {
    if (result.maxWorkers > 6) throw new Error('maxWorkers deveria ser <= 6, obteve ' + result.maxWorkers);
  });
});

test('maxWorkers=0 → sobe para 1 (mínimo)', function () {
  return pipelineParallel.run([
    { description: 'Task 1', fn: function () { return 'r1'; } }
  ], { maxWorkers: 0, skipDecompose: true, detectConflicts: false }).then(function (result) {
    if (result.maxWorkers < 1) throw new Error('maxWorkers deveria ser >= 1, obteve ' + result.maxWorkers);
    if (result.maxWorkers !== 1) throw new Error('maxWorkers=0 deveria ser corrigido para 1, obteve ' + result.maxWorkers);
  });
});

test('maxWorkers=-5 → sobe para 1 (mínimo)', function () {
  return pipelineParallel.run([
    { description: 'Task 1', fn: function () { return 'r1'; } }
  ], { maxWorkers: -5, skipDecompose: true, detectConflicts: false }).then(function (result) {
    if (result.maxWorkers < 1) throw new Error('maxWorkers=-5 deveria ser >= 1, obteve ' + result.maxWorkers);
  });
});

test('maxWorkers=3 → mantém 3 (válido)', function () {
  return pipelineParallel.run([
    { description: 'Task 1', fn: function () { return 'r1'; } },
    { description: 'Task 2', fn: function () { return 'r2'; } },
    { description: 'Task 3', fn: function () { return 'r3'; } }
  ], { maxWorkers: 3, skipDecompose: true, detectConflicts: false }).then(function (result) {
    if (result.maxWorkers !== 3) throw new Error('Esperava maxWorkers=3, obteve ' + result.maxWorkers);
  });
});

test('maxWorkers não informado → default 6', function () {
  return pipelineParallel.run([
    { description: 'Task 1', fn: function () { return 'r1'; } }
  ], { skipDecompose: true, detectConflicts: false }).then(function (result) {
    if (result.maxWorkers !== 6) throw new Error('Esperava maxWorkers=6 (default), obteve ' + result.maxWorkers);
  });
});

test('Sem options → usa default maxWorkers=6 sem lançar', function () {
  return pipelineParallel.run([
    { description: 'Task 1', fn: function () { return 'r1'; } }
  ]).then(function (result) {
    if (!result) throw new Error('run() sem options retornou null');
    if (result.maxWorkers !== 6) throw new Error('Esperava maxWorkers=6 default, obteve ' + result.maxWorkers);
  });
});

// ─── Test 4: Erros NON-BLOCKING ─────────────────────────────────────────
console.log('\n📋 Teste 4: Erros NON-BLOCKING no pipeline');

test('Uma task que falha não impede as outras de completar', function () {
  return pipelineParallel.run([
    { description: 'Task boa 1', fn: function () { return 'ok1'; } },
    { description: 'Task que falha', fn: function () { throw new Error('Falha simulada'); } },
    { description: 'Task boa 3', fn: function () { return 'ok3'; } }
  ], { skipDecompose: true, detectConflicts: false }).then(function (result) {
    if (result.summary.total !== 3) throw new Error('Esperava total=3, obteve ' + result.summary.total);
    if (result.summary.success < 2) throw new Error('Esperava pelo menos 2 success, obteve ' + result.summary.success);
    if (result.summary.failed < 1) throw new Error('Esperava pelo menos 1 failed, obteve ' + result.summary.failed);
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
