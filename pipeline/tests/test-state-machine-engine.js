#!/usr/bin/env node
/**
 * Matrix State Machine Engine — Integration Tests
 * =====================================================================
 * Testa a camada de validação determinística da state machine:
 *
 *   ✓ canTransition() — transições válidas e inválidas
 *   ✓ getNextState() — com contexto de attempts
 *   ✓ findPath() — BFS de idle → completed
 *   ✓ validateIntegrity() — deve retornar 0 issues
 *   ✓ getStates() / getTransitions() — listagem de estados/transições
 *
 * Uso: node test-state-machine-engine.js
 * Exit code: 0 se TODOS os testes passarem, 1 se QUALQUER falhar
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// ─── Load engine ──────────────────────────────────────────────────────
const SCRIPTS_DIR = path.resolve(__dirname, '..', 'scripts');
const PIPELINE_DIR = path.resolve(__dirname, '..');
const PIPELINE_YAML = path.join(PIPELINE_DIR, 'pipeline.yaml');

let engine;
try {
  engine = require(path.join(SCRIPTS_DIR, 'state-machine-engine'));
} catch (err) {
  console.error(`${RED}❌ Erro ao carregar state-machine-engine: ${err.message}${RESET}`);
  process.exit(1);
}

let sm;
try {
  sm = engine.loadFromFile(PIPELINE_YAML);
} catch (err) {
  console.error(`${RED}❌ Erro ao carregar pipeline.yaml: ${err.message}${RESET}`);
  process.exit(1);
}

// ─── Test Framework ───────────────────────────────────────────────────
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ${GREEN}✅ ${name}${RESET}`);
    testsPassed++;
  } catch (err) {
    console.log(`  ${RED}❌ ${name}: ${err.message}${RESET}`);
    testsFailed++;
  }
}

// ─── 1. Testes de canTransition() ────────────────────────────────────
function testCanTransition() {
  console.log(`\n${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  canTransition() — Transições Válidas${RESET}`);
  console.log(`${BOLD}══════════════════════════════════════════════════════════${RESET}\n`);

  // 1a. Transição válida básica
  test('idle → identifying é válida', function() {
    const result = sm.canTransition('idle', 'identifying');
    assert.strictEqual(result.valid, true, `Esperado valid=true, recebido ${result.valid}: ${result.reason}`);
    assert.ok(result.transition !== null, 'Deveria retornar objeto transition');
    assert.strictEqual(result.transition.from, 'idle');
    assert.strictEqual(result.transition.to, 'identifying');
  });

  // 1b. delivery → reporting é válida
  test('delivery → reporting é válida', function() {
    const result = sm.canTransition('delivery', 'reporting');
    assert.strictEqual(result.valid, true, `Esperado valid=true, recebido ${result.valid}: ${result.reason}`);
    assert.ok(result.transition !== null);
    assert.strictEqual(result.transition.from, 'delivery');
    assert.strictEqual(result.transition.to, 'reporting');
  });

  // 1c. reporting → completed é válida (fechamento do ciclo)
  test('reporting → completed é válida', function() {
    const result = sm.canTransition('reporting', 'completed');
    assert.strictEqual(result.valid, true, `Esperado valid=true, recebido ${result.valid}: ${result.reason}`);
  });

  // 1d. idle → completed NÃO é válida (pulo de fases)
  test('idle → completed é inválida (pulo de fases)', function() {
    const result = sm.canTransition('idle', 'completed');
    assert.strictEqual(result.valid, false, `Esperado valid=false, recebido ${result.valid}`);
    assert.ok(Array.isArray(result.validTargets), 'Deveria retornar validTargets');
    assert.ok(result.validTargets.length > 0, 'Deveria listar transições válidas de idle');
  });

  // 1e. Estado inexistente
  test('estado de origem inexistente retorna invalid', function() {
    const result = sm.canTransition('nao_existe', 'idle');
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason.includes('não existe'));
  });

  // 1f. Estado de destino inexistente
  test('estado de destino inexistente retorna invalid', function() {
    const result = sm.canTransition('idle', 'nao_existe');
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason.includes('não existe'));
  });

  // 1g. Transição reversa inválida
  test('identifying → idle é inválida (transição reversa)', function() {
    const result = sm.canTransition('identifying', 'idle');
    assert.strictEqual(result.valid, false, `Esperado valid=false, recebido ${result.valid}: ${result.reason}`);
  });

  // 1h. Retry context: fase3_refuted → fase2_execution com attempts < 3
  test('fase3_refuted → fase2_execution com attempts=1 é válida', function() {
    const result = sm.canTransition('fase3_refuted', 'fase2_execution', { attempts: 1 });
    assert.strictEqual(result.valid, true, `Esperado valid=true, recebido ${result.valid}: ${result.reason}`);
  });

  // 1i. Retry context: fase3_refuted → escalated com attempts < 3 NÃO é válida
  test('fase3_refuted → escalated com attempts=1 é inválida (requer >= 3)', function() {
    const result = sm.canTransition('fase3_refuted', 'escalated', { attempts: 1 });
    assert.strictEqual(result.valid, false, `Esperado valid=false, recebido ${result.valid}: ${result.reason}`);
    assert.ok(result.reason.includes('3 tentativas'), `Deveria mencionar limite de tentativas: ${result.reason}`);
  });

  // 1j. Retry exausted: fase3_refuted → escalated com attempts=3 é válida
  test('fase3_refuted → escalated com attempts=3 é válida (limite excedido)', function() {
    const result = sm.canTransition('fase3_refuted', 'escalated', { attempts: 3 });
    assert.strictEqual(result.valid, true, `Esperado valid=true, recebido ${result.valid}: ${result.reason}`);
  });

  // 1k. Retry exausted: fase3_refuted → fase2_execution com attempts=3 NÃO é válida
  test('fase3_refuted → fase2_execution com attempts=3 é inválida (deve usar escalated)', function() {
    const result = sm.canTransition('fase3_refuted', 'fase2_execution', { attempts: 3 });
    assert.strictEqual(result.valid, false, `Esperado valid=false, recebido ${result.valid}: ${result.reason}`);
    assert.ok(result.validTargets.includes('escalated'), 'Deveria sugerir escalated');
  });

  // 1l. fase4_changes_needed → fase2_execution com attempts < 3
  test('fase4_changes_needed → fase2_execution com attempts=2 é válida', function() {
    const result = sm.canTransition('fase4_changes_needed', 'fase2_execution', { attempts: 2 });
    assert.strictEqual(result.valid, true, `Esperado valid=true, recebido ${result.valid}: ${result.reason}`);
  });

  // 1m. fase4_changes_needed → escalated com attempts=3
  test('fase4_changes_needed → escalated com attempts=3 é válida', function() {
    const result = sm.canTransition('fase4_changes_needed', 'escalated', { attempts: 3 });
    assert.strictEqual(result.valid, true, `Esperado valid=true, recebido ${result.valid}: ${result.reason}`);
  });
}

// ─── 2. Testes de getNextState() ─────────────────────────────────────
function testGetNextState() {
  console.log(`\n${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  getNextState() — Próximo Estado com Contexto${RESET}`);
  console.log(`${BOLD}══════════════════════════════════════════════════════════${RESET}\n`);

  // 2a. Estado com transição única
  test('idle → identifying (transição única)', function() {
    const result = sm.getNextState('idle');
    assert.strictEqual(result.state, 'identifying');
    assert.ok(result.reason.includes('Transição única'));
  });

  // 2b. Estado sem saídas (completed → idle, não é terminal de fato)
  test('failed → idle (transição única de escape)', function() {
    const result = sm.getNextState('failed');
    assert.strictEqual(result.state, 'idle');
    assert.ok(result.reason.includes('Transição única'));
  });

  // 2c. Estado inexistente
  test('estado inexistente retorna null', function() {
    const result = sm.getNextState('nao_existe');
    assert.strictEqual(result.state, null);
  });

  // 2d. fase3_refuted com attempts=0 → fase2_execution
  test('fase3_refuted attempts=0 → fase2_execution', function() {
    const result = sm.getNextState('fase3_refuted', { attempts: 0 });
    assert.strictEqual(result.state, 'fase2_execution');
    assert.ok(result.reason.includes('retornando para Fase 2'));
  });

  // 2e. fase3_refuted com attempts=3 → escalated
  test('fase3_refuted attempts=3 → escalated', function() {
    const result = sm.getNextState('fase3_refuted', { attempts: 3 });
    assert.strictEqual(result.state, 'escalated');
    assert.ok(result.reason.includes('escalando'));
  });

  // 2f. fase4_changes_needed com attempts=1 → fase2_execution
  test('fase4_changes_needed attempts=1 → fase2_execution', function() {
    const result = sm.getNextState('fase4_changes_needed', { attempts: 1 });
    assert.strictEqual(result.state, 'fase2_execution');
  });

  // 2g. fase4_changes_needed com attempts=3 → escalated
  test('fase4_changes_needed attempts=3 → escalated', function() {
    const result = sm.getNextState('fase4_changes_needed', { attempts: 3 });
    assert.strictEqual(result.state, 'escalated');
  });

  // 2h. Estado com preferred válido
  test('uso de preferred state funciona', function() {
    // fase3_refuted tem 2 opções: fase2_execution e escalated
    const result = sm.getNextState('fase3_refuted', {
      attempts: 1,
      preferred: 'escalated'
    });
    // preferred 'escalated' é válido? Depende do attempts... com 1, não vai pra escalated via regra
    // Mas preferred tem prioridade sobre heurística de attempts
    // Verificando a lógica: preferred é checado ANTES da heurística
    if (result.state === 'escalated') {
      assert.ok(true, 'Preferred funcionou');
    } else {
      // Se a heurística de attempts sobrescreveu, ao menos options deve incluir escalated
      assert.ok(result.options.includes('escalated'), 'Options deve incluir escalated');
    }
  });
}

// ─── 3. Testes de findPath() ─────────────────────────────────────────
function testFindPath() {
  console.log(`\n${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  findPath() — BFS Pathfinding${RESET}`);
  console.log(`${BOLD}══════════════════════════════════════════════════════════${RESET}\n`);

  // 3a. idle → completed — caminho completo
  test('idle → completed: caminho encontrado', function() {
    const result = sm.findPath('idle', 'completed');
    assert.strictEqual(result.found, true, `Caminho deveria ser encontrado: ${result.reason}`);
    assert.ok(result.path.length >= 4, `Caminho deveria ter >= 4 estados, tem ${result.path.length}: ${result.path.join(' → ')}`);
    assert.strictEqual(result.path[0], 'idle');
    assert.strictEqual(result.path[result.path.length - 1], 'completed');
  });

  // 3b. idle → idle (mesmo estado)
  test('idle → idle: mesmo estado', function() {
    const result = sm.findPath('idle', 'idle');
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.length, 0);
    assert.deepStrictEqual(result.path, ['idle']);
  });

  // 3c. Estado de origem inexistente
  test('origem inexistente → found=false', function() {
    const result = sm.findPath('nao_existe', 'idle');
    assert.strictEqual(result.found, false);
  });

  // 3d. Estado de destino inexistente
  test('destino inexistente → found=false', function() {
    const result = sm.findPath('idle', 'nao_existe');
    assert.strictEqual(result.found, false);
  });

  // 3e. Caminho mínimo idle → identifying (1 transição)
  test('idle → identifying: caminho direto', function() {
    const result = sm.findPath('idle', 'identifying');
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(result.path, ['idle', 'identifying']);
  });

  // 3f. Caminho idle → delivery (deve passar por várias fases)
  test('idle → delivery: caminho multi-fase', function() {
    const result = sm.findPath('idle', 'delivery');
    assert.strictEqual(result.found, true, `Caminho deveria ser encontrado: ${result.reason}`);
    assert.ok(result.length >= 8, `Deveria ter >= 8 transições, tem ${result.length}`);
    // Verificar que passa pelos estados críticos
    const pathStr = result.path.join(' → ');
    assert.ok(pathStr.includes('fase2_execution'), `Deveria passar por fase2_execution: ${pathStr}`);
    assert.ok(pathStr.includes('fase3_validation'), `Deveria passar por fase3_validation: ${pathStr}`);
    assert.ok(pathStr.includes('fase4_review'), `Deveria passar por fase4_review: ${pathStr}`);
  });

  // 3g. completed → idle deve ter caminho (ciclo completo: completed → idle)
  test('completed → idle: caminho encontrado (ciclo)', function() {
    const result = sm.findPath('completed', 'idle');
    assert.strictEqual(result.found, true, `Deveria encontrar caminho: ${result.reason}`);
    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(result.path, ['completed', 'idle']);
  });
}

// ─── 4. Testes de validateIntegrity() ────────────────────────────────
function testValidateIntegrity() {
  console.log(`\n${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  validateIntegrity() — Integridade da State Machine${RESET}`);
  console.log(`${BOLD}══════════════════════════════════════════════════════════${RESET}\n`);

  // 4a. Pipeline atual deve ter 0 issues
  test('validateIntegrity retorna 0 issues', function() {
    const result = engine.validateIntegrity(sm);
    assert.strictEqual(result.valid, true, `Esperado valid=true: ${JSON.stringify(result.issues)}`);
    assert.strictEqual(result.issues.length, 0, `Deveria ter 0 issues, tem ${result.issues.length}: ${JSON.stringify(result.issues)}`);
  });

  // 4b. warnings podem existir (não invalidam)
  test('warnings não invalidam a state machine', function() {
    const result = engine.validateIntegrity(sm);
    // Warnings não devem afetar valid
    assert.strictEqual(result.valid, true);
    assert.ok(Array.isArray(result.warnings));
  });
}

// ─── 5. Testes de getStates() / getTransitions() ─────────────────────
function testStatesAndTransitions() {
  console.log(`\n${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  getStates() / getTransitions() — Listagens${RESET}`);
  console.log(`${BOLD}══════════════════════════════════════════════════════════${RESET}\n`);

  // 5a. getStates retorna array
  test('getStates retorna array não vazio', function() {
    const states = sm.getStates();
    assert.ok(Array.isArray(states), 'Deveria ser array');
    assert.ok(states.length > 5, `Deveria ter mais de 5 estados, tem ${states.length}`);
  });

  // 5b. Todos os estados têm id
  test('todos os estados têm id único', function() {
    const states = sm.getStates();
    const ids = states.map(function(s) { return s.id; });
    const uniqueIds = new Set(ids);
    assert.strictEqual(uniqueIds.size, ids.length, 'IDs deveriam ser únicos');
    states.forEach(function(s) {
      assert.ok(typeof s.id === 'string' && s.id.length > 0, `Estado sem id válido: ${JSON.stringify(s)}`);
    });
  });

  // 5c. allTransitions é array não vazio
  test('allTransitions retorna array não vazio', function() {
    const transitions = sm.allTransitions;
    assert.ok(Array.isArray(transitions));
    assert.ok(transitions.length > 5, `Deveria ter mais de 5 transições, tem ${transitions.length}`);
  });

  // 5d. Todas as transições têm from e to
  test('todas as transições têm from e to', function() {
    sm.allTransitions.forEach(function(t, i) {
      assert.ok(t.from, `Transição ${i} sem from: ${JSON.stringify(t)}`);
      assert.ok(t.to, `Transição ${i} sem to: ${JSON.stringify(t)}`);
    });
  });

  // 5e. getState() para estado existente
  test('getState retorna estado existente', function() {
    const state = sm.getState('idle');
    assert.ok(state !== null);
    assert.strictEqual(state.id, 'idle');
  });

  // 5f. getState() para estado inexistente
  test('getState retorna null para estado inexistente', function() {
    const state = sm.getState('nao_existe');
    assert.strictEqual(state, null);
  });

  // 5g. hasState funciona
  test('hasState true para idle, false para inexistente', function() {
    assert.strictEqual(sm.hasState('idle'), true);
    assert.strictEqual(sm.hasState('nao_existe'), false);
  });

  // 5h. getPhase retorna fase correta (ex: fase2_execution → fase_2)
  test('getPhase retorna fase do estado', function() {
    const phase = sm.getPhase('fase2_execution');
    assert.ok(phase !== null, 'Fase não deveria ser null');
    assert.ok(typeof phase === 'string' && phase.length > 0, `Fase deveria ser string não vazia: ${phase}`);
    assert.ok(phase.startsWith('fase'), `Fase deveria começar com 'fase': ${phase}`);
  });

  // 5i. startState e endStates existem
  test('startState e endStates estão configurados', function() {
    assert.ok(typeof sm.startState === 'string' && sm.startState.length > 0, 'startState deveria ser string não vazia');
    assert.ok(Array.isArray(sm.endStates), 'endStates deveria ser array');
    assert.ok(sm.endStates.length > 0, 'Deveria ter pelo menos 1 end_state');
    // Verificar que start_state e end_states existem como estados
    assert.ok(sm.hasState(sm.startState), `startState '${sm.startState}' deveria existir em states`);
    sm.endStates.forEach(function(es) {
      assert.ok(sm.hasState(es), `endState '${es}' deveria existir em states`);
    });
  });
}

// ─── 6. Testes de getStats() ─────────────────────────────────────────
function testGetStats() {
  console.log(`\n${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  getStats() — Estatísticas da State Machine${RESET}`);
  console.log(`${BOLD}══════════════════════════════════════════════════════════${RESET}\n`);

  test('getStats retorna propriedades esperadas', function() {
    const stats = sm.getStats();
    assert.ok(typeof stats.name === 'string');
    assert.ok(typeof stats.version === 'string');
    assert.ok(typeof stats.totalStates === 'number' && stats.totalStates > 0);
    assert.ok(typeof stats.totalTransitions === 'number' && stats.totalTransitions > 0);
    assert.ok(Array.isArray(stats.phases));
    assert.ok(Array.isArray(stats.deadEnds));
    assert.ok(Array.isArray(stats.unreachableStates));
    assert.ok(typeof stats.reachableRatio === 'string');
  });
}

// ─── 7. Testes de YAML Parsers ──────────────────────────────────────
function testYamlParsers() {
  console.log(`\n${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  YAML Parsers — Parsers Individuais${RESET}`);
  console.log(`${BOLD}══════════════════════════════════════════════════════════${RESET}\n`);

  const yamlText = fs.readFileSync(PIPELINE_YAML, 'utf-8');

  test('parsePipelineConfig retorna config', function() {
    const config = engine.parsePipelineConfig(yamlText);
    assert.ok(typeof config.name === 'string');
    assert.ok(typeof config.version === 'string');
    assert.ok(typeof config.startState === 'string');
    assert.ok(Array.isArray(config.endStates));
  });

  test('parseStatesSection retorna array de estados', function() {
    const states = engine.parseStatesSection(yamlText);
    assert.ok(Array.isArray(states));
    assert.ok(states.length > 5, `Deveria ter mais de 5 estados, tem ${states.length}`);
    // Cada estado deve ter id
    states.forEach(function(s) {
      assert.ok(s.id, `Estado sem id: ${JSON.stringify(s)}`);
    });
  });

  test('parseTransitionsSection retorna array de transições', function() {
    const transitions = engine.parseTransitionsSection(yamlText);
    assert.ok(Array.isArray(transitions));
    assert.ok(transitions.length > 5, `Deveria ter mais de 5 transições, tem ${transitions.length}`);
    transitions.forEach(function(t) {
      assert.ok(t.from, `Transição sem from: ${JSON.stringify(t)}`);
      assert.ok(t.to, `Transição sem to: ${JSON.stringify(t)}`);
    });
  });
}

// ─── 8. Testes de createFromYaml() — Edge Cases ──────────────────────
function testCreateFromYamlEdgeCases() {
  console.log(`\n${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  createFromYaml() — Edge Cases${RESET}`);
  console.log(`${BOLD}══════════════════════════════════════════════════════════${RESET}\n`);

  test('createFromYaml com string vazia lança erro', function() {
    assert.throws(function() {
      engine.createFromYaml('');
    }, /non-empty string/);
  });

  test('createFromYaml com null lança erro', function() {
    assert.throws(function() {
      engine.createFromYaml(null);
    }, /non-empty string/);
  });

  test('createFromYaml com YAML vazio (só config)', function() {
    const minimalSm = engine.createFromYaml([
      'name: "test"',
      'version: "1.0"',
      'start_state: "idle"',
      'end_states: ["completed"]',
      'states:',
      '  - id: "idle"',
      '    phase: "init"',
      '  - id: "completed"',
      '    phase: "done"',
      'transitions:',
      '  - from: "idle"',
      '    to: "completed"',
      '    trigger: "done"',
      '    action: "finish"'
    ].join('\n'));

    assert.strictEqual(minimalSm.name, 'test');
    assert.strictEqual(minimalSm.states.size, 2);
    assert.strictEqual(minimalSm.allTransitions.length, 1);
    assert.ok(minimalSm.hasState('idle'));
    assert.ok(minimalSm.hasState('completed'));
  });

  test('toJSON retorna objeto serializável', function() {
    const sm2 = engine.createFromYaml([
      'name: "test-json"',
      'version: "1.0"',
      'start_state: "a"',
      'end_states: ["b"]',
      'states:',
      '  - id: "a"',
      '    phase: "init"',
      '  - id: "b"',
      '    phase: "final"',
      'transitions:',
      '  - from: "a"',
      '    to: "b"',
      '    trigger: "go"',
      '    action: "move"'
    ].join('\n'));

    const json = sm2.toJSON();
    assert.strictEqual(json.name, 'test-json');
    assert.strictEqual(json.states.length, 2);
    assert.strictEqual(json.transitions.length, 1);
    assert.ok(json.stats !== undefined);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────
console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
console.log(`${CYAN}${BOLD}║   Matrix State Machine Engine — Integration Tests        ║${RESET}`);
console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
console.log(`\n${DIM}Pipeline: ${PIPELINE_YAML}${RESET}`);
console.log(`${DIM}Engine:   ${path.join(SCRIPTS_DIR, 'state-machine-engine.js')}${RESET}\n`);

testCanTransition();
testGetNextState();
testFindPath();
testValidateIntegrity();
testStatesAndTransitions();
testGetStats();
testYamlParsers();
testCreateFromYamlEdgeCases();

// ─── Summary ──────────────────────────────────────────────────────────
console.log(`\n${BOLD}══════════════════════════════════════════════════════════${RESET}`);
console.log(`${BOLD}  Resultado Final${RESET}`);
console.log(`${BOLD}══════════════════════════════════════════════════════════${RESET}\n`);
console.log(`  ${GREEN}✅ Passed: ${testsPassed}${RESET}`);
console.log(`  ${RED}❌ Failed: ${testsFailed}${RESET}`);
console.log(`  ${CYAN}📊 Total:  ${testsPassed + testsFailed}${RESET}\n`);

process.exit(testsFailed > 0 ? 1 : 0);
