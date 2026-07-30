#!/usr/bin/env node
/**
 * Matrix Parallel Dispatcher Tests v1.0
 * Testes formais para parallel-dispatcher.js
 *
 * Cobre:
 *   1. Dispatch com todolist vazia → 0 tasks, 0 batches
 *   2. Dispatch com 6 tasks independentes → 6 tasks, batch único
 *   3. Dispatch com dependências (task2 depende de task1) → batches [[0],[1]]
 *   4. Fallback quando agent-router não está disponível
 *
 * Uso: node test-parallel-dispatcher.js
 * Exit code: 0 se todos os testes passarem, 1 se algum falhar
 */

var path = require('path');
var dispatcherPath = path.resolve(__dirname, '..', 'scripts', 'parallel-dispatcher.js');
var dispatcher = require(dispatcherPath);

// ─── Test Runner ──────────────────────────────────────────────────────────
var passed = 0;
var failed = 0;
var total = 0;

/**
 * Testa uma condição. Se falhar, lança erro com detalhes.
 * @param {string} name - Nome descritivo do teste
 * @param {Function} fn - Função que executa as asserções
 */
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

// ─── Test 1: Todolist vazia ──────────────────────────────────────────────
console.log('\n📋 Teste 1: Dispatch com todolist vazia');

test('Todolist vazia (array vazio) retorna 0 tasks e 0 batches', function () {
  var result = dispatcher.dispatch([]);
  if (!result) throw new Error('dispatch([]) retornou null/undefined');
  if (!Array.isArray(result.tasks)) throw new Error('result.tasks não é array');
  if (!Array.isArray(result.batches)) throw new Error('result.batches não é array');
  if (result.tasks.length !== 0) throw new Error('Esperava 0 tasks, obteve ' + result.tasks.length);
  if (result.batches.length !== 0) throw new Error('Esperava 0 batches, obteve ' + result.batches.length);
});

test('Todolist null retorna 0 tasks e 0 batches', function () {
  var result = dispatcher.dispatch(null);
  if (!result) throw new Error('dispatch(null) retornou null/undefined');
  if (result.tasks.length !== 0) throw new Error('Esperava 0 tasks, obteve ' + result.tasks.length);
  if (result.batches.length !== 0) throw new Error('Esperava 0 batches, obteve ' + result.batches.length);
});

test('Todolist undefined retorna 0 tasks e 0 batches', function () {
  var result = dispatcher.dispatch(undefined);
  if (!result) throw new Error('dispatch(undefined) retornou null/undefined');
  if (result.tasks.length !== 0) throw new Error('Esperava 0 tasks, obteve ' + result.tasks.length);
  if (result.batches.length !== 0) throw new Error('Esperava 0 batches, obteve ' + result.batches.length);
});

test('Todolist com objeto sem description é ignorado', function () {
  var result = dispatcher.dispatch([{ notDescription: 'foo' }]);
  if (!result) throw new Error('dispatch retornou null/undefined');
  if (result.tasks.length !== 0) throw new Error('Esperava 0 tasks (sem description), obteve ' + result.tasks.length);
});

// ─── Test 2: 6 tasks independentes ───────────────────────────────────────
console.log('\n📋 Teste 2: Dispatch com 6 tasks independentes');

test('6 tasks independentes → 6 tasks no resultado', function () {
  var todolist = [
    { description: 'Implementar API REST de usuários' },
    { description: 'Criar componente React de login' },
    { description: 'Configurar CI/CD no GitHub Actions' },
    { description: 'Escrever testes unitários para o módulo de pagamento' },
    { description: 'Otimizar queries SQL no banco de dados' },
    { description: 'Criar documentação da API no Swagger' }
  ];
  var result = dispatcher.dispatch(todolist, { skipDecompose: true });
  if (result.tasks.length !== 6) throw new Error('Esperava 6 tasks, obteve ' + result.tasks.length);
});

test('6 tasks independentes → todas no batch 1 (lote único)', function () {
  var todolist = [
    { description: 'Implementar API REST de usuários' },
    { description: 'Criar componente React de login' },
    { description: 'Configurar CI/CD no GitHub Actions' },
    { description: 'Escrever testes unitários para o módulo de pagamento' },
    { description: 'Otimizar queries SQL no banco de dados' },
    { description: 'Criar documentação da API no Swagger' }
  ];
  var result = dispatcher.dispatch(todolist, { skipDecompose: true });
  // Sem dependências: tudo no mesmo batch
  if (result.batches.length < 1) throw new Error('Esperava pelo menos 1 batch, obteve ' + result.batches.length);
  // O primeiro batch deve conter todas as tasks (ou pelo menos a maioria)
  var firstBatch = result.batches[0];
  if (firstBatch.length < 6) throw new Error('Esperava 6 tasks no primeiro batch, obteve ' + firstBatch.length);
});

test('6 tasks independentes → cada task tem agent definido', function () {
  var todolist = [
    { description: 'Implementar API REST de usuários' },
    { description: 'Criar componente React de login' },
    { description: 'Configurar CI/CD no GitHub Actions' },
    { description: 'Escrever testes unitários para o módulo de pagamento' },
    { description: 'Otimizar queries SQL no banco de dados' },
    { description: 'Criar documentação da API no Swagger' }
  ];
  var result = dispatcher.dispatch(todolist, { skipDecompose: true });
  for (var i = 0; i < result.tasks.length; i++) {
    if (!result.tasks[i].agent) throw new Error('Task #' + i + ' não tem agent definido');
  }
});

test('6 tasks independentes → cada task tem contexto gerado (CB.1-CB.6)', function () {
  var todolist = [
    { description: 'Implementar API REST de usuários' },
    { description: 'Criar componente React de login' },
    { description: 'Configurar CI/CD no GitHub Actions' },
    { description: 'Escrever testes unitários para o módulo de pagamento' },
    { description: 'Otimizar queries SQL no banco de dados' },
    { description: 'Criar documentação da API no Swagger' }
  ];
  var result = dispatcher.dispatch(todolist, { skipDecompose: true });
  for (var i = 0; i < result.tasks.length; i++) {
    if (!result.tasks[i].context) throw new Error('Task #' + i + ' não tem contexto gerado');
    // Deve conter o template do contexto
    if (result.tasks[i].context.indexOf('Contexto Otimizado') === -1) {
      throw new Error('Task #' + i + ' contexto não contém template esperado');
    }
  }
});

// ─── Test 3: Dependências entre tasks ────────────────────────────────────
console.log('\n📋 Teste 3: Dispatch com dependências entre tasks');

test('Task2 depende de task1 → batches corretos [[0],[1]]', function () {
  var todolist = [
    { description: 'Criar schema do banco de dados' },
    { description: 'Implementar API com base no schema', dependsOn: [0] },
    { description: 'Criar frontend independente' }
  ];
  var result = dispatcher.dispatch(todolist, { skipDecompose: true });
  // Verifica que temos pelo menos 2 batches
  if (result.batches.length < 2) throw new Error('Esperava >= 2 batches para tasks com dependência, obteve ' + result.batches.length);
  // Batch 0 deve ter task 0 (schema) e task 2 (independente), batch 1 deve ter task 1 (API)
  var batch0 = result.batches[0];
  var batch1 = result.batches[1];
  if (batch0.indexOf(0) === -1) throw new Error('Task 0 (schema) deveria estar no batch 0, não está');
  if (batch1.indexOf(1) === -1) throw new Error('Task 1 (API) deveria estar no batch 1, não está');
});

test('Task com dependsOn é corretamente propagada no resultado', function () {
  var todolist = [
    { description: 'Tarefa base', id: 'base' },
    { description: 'Tarefa dependente', dependsOn: ['base'] }
  ];
  var result = dispatcher.dispatch(todolist, { skipDecompose: true });
  // Verifica se o dependsOn foi propagado para a task
  var depTask = result.tasks[1];
  if (!depTask.dependsOn || depTask.dependsOn.length === 0) {
    throw new Error('Task dependente deveria ter dependsOn propagado');
  }
});

test('Cadeia de dependências (A→B→C) → 3 batches', function () {
  var todolist = [
    { description: 'Tarefa A — completamente independente' },
    { description: 'Tarefa B — depende de A', dependsOn: [0] },
    { description: 'Tarefa C — depende de B', dependsOn: [1] }
  ];
  var result = dispatcher.dispatch(todolist, { skipDecompose: true });
  // Devemos ter 3 batches
  if (result.batches.length < 3) throw new Error('Esperava >= 3 batches para A→B→C, obteve ' + result.batches.length);
  // Batch 0: task 0 (A), Batch 1: task 1 (B), Batch 2: task 2 (C)
  var b0 = result.batches[0];
  var b1 = result.batches[1];
  var b2 = result.batches[2];
  if (b0.indexOf(0) === -1) throw new Error('Task A deveria estar no batch 0');
  if (b1.indexOf(1) === -1) throw new Error('Task B deveria estar no batch 1');
  if (b2.indexOf(2) === -1) throw new Error('Task C deveria estar no batch 2');
});

// ─── Test 4: Fallback de roteamento (função _fallbackAgent) ──────────────
console.log('\n📋 Teste 4: Fallback de roteamento via _fallbackAgent()');

test('_fallbackAgent para backend complexity>=4 → backend-architect', function () {
  var agent = dispatcher._fallbackAgent('backend', 4, ['api', 'rest']);
  if (agent !== 'backend-architect') {
    throw new Error('Esperava backend-architect, obteve @' + agent);
  }
});

test('_fallbackAgent para backend complexity<4 → senior-developer', function () {
  var agent = dispatcher._fallbackAgent('backend', 2, ['api']);
  if (agent !== 'senior-developer') {
    throw new Error('Esperava senior-developer, obteve @' + agent);
  }
});

test('_fallbackAgent para design → ArchitectUX', function () {
  var agent = dispatcher._fallbackAgent('design', 2, ['design']);
  if (agent !== 'ArchitectUX') {
    throw new Error('Esperava ArchitectUX, obteve @' + agent);
  }
});

test('_fallbackAgent para frontend → frontend-developer', function () {
  // Nota: keywords 'ui' e 'ux' são capturadas antes de 'frontend' no fallback
  var agent = dispatcher._fallbackAgent('frontend', 2, ['component', 'frontend']);
  if (agent !== 'frontend-developer') {
    throw new Error('Esperava frontend-developer, obteve @' + agent);
  }
});

test('_fallbackAgent para test → testing-reality-checker (complexity<4)', function () {
  var agent = dispatcher._fallbackAgent('test', 2, ['qa']);
  if (agent !== 'testing-reality-checker') {
    throw new Error('Esperava testing-reality-checker, obteve @' + agent);
  }
});

test('_fallbackAgent para test complexity>=4 → EvidenceQA', function () {
  var agent = dispatcher._fallbackAgent('test', 4, ['qa']);
  if (agent !== 'EvidenceQA') {
    throw new Error('Esperava EvidenceQA, obteve @' + agent);
  }
});

test('_fallbackAgent fallback global → senior-developer', function () {
  var agent = dispatcher._fallbackAgent('unknown', 1, ['foo']);
  if (agent !== 'senior-developer') {
    throw new Error('Esperava senior-developer, obteve @' + agent);
  }
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
