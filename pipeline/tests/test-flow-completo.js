#!/usr/bin/env node
/**
 * Matrix Pipeline — Teste de Fluxo Completo (Integration Test)
 *
 * Valida o fluxo COMPLETO do pipeline Matrix em 3 cenários:
 *   1. Happy Path:  idle → ... → completed (16 transições)
 *   2. Retry Flow:  fase3_refuted → retry → approved
 *   3. Failure Flow: context_building → failed
 *
 * Usa pipeline-executor.js via require() — zero npm dependencies.
 *
 * Usage: node pipeline/tests/test-flow-completo.js
 * Exit code: 0 se TODOS os testes passarem, 1 se ALGUM falhar
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Paths ─────────────────────────────────────────────────────────────
const TESTS_DIR = __dirname;
const PIPELINE_DIR = path.resolve(TESTS_DIR, '..');
const SCRIPTS_DIR = path.join(PIPELINE_DIR, 'scripts');

const STATE_JSON = path.join(PIPELINE_DIR, 'state.json');
const EVENTS_LOG = path.join(PIPELINE_DIR, 'events.log');
const METRICS_JSON = path.join(PIPELINE_DIR, 'metrics.json');

// ─── Cores para Terminal ───────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// ─── Contadores de Teste ───────────────────────────────────────────────
let testsPassed = 0;
let testsFailed = 0;
let assertionsPassed = 0;
let assertionsFailed = 0;

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

function assert(condition, message) {
  if (!condition) {
    assertionsFailed++;
    throw new Error(message || 'Assertion failed');
  }
  assertionsPassed++;
}

function assertStrictEqual(actual, expected, message) {
  if (actual !== expected) {
    assertionsFailed++;
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  assertionsPassed++;
}

function assertOk(value, message) {
  if (!value) {
    assertionsFailed++;
    throw new Error(message || `Expected truthy value, got ${JSON.stringify(value)}`);
  }
  assertionsPassed++;
}

// ─── Backup / Restore ──────────────────────────────────────────────────
const BACKUP_SUFFIX = '.flow-test-backup';

function backupFile(filePath) {
  const bak = filePath + BACKUP_SUFFIX;
  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, bak);
  }
}

function restoreFile(filePath) {
  const bak = filePath + BACKUP_SUFFIX;
  if (fs.existsSync(bak)) {
    fs.copyFileSync(bak, filePath);
    fs.unlinkSync(bak);
  }
}

function backupAll() {
  backupFile(STATE_JSON);
  backupFile(EVENTS_LOG);
  backupFile(METRICS_JSON);
}

function restoreAll() {
  restoreFile(STATE_JSON);
  restoreFile(EVENTS_LOG);
  restoreFile(METRICS_JSON);
}

// ─── Helpers ───────────────────────────────────────────────────────────
function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return null;
  }
}

function readEventsLog() {
  try {
    const raw = fs.readFileSync(EVENTS_LOG, 'utf8');
    const lines = raw.split('\n').filter(function (l) {
      const trimmed = l.trim();
      return trimmed && !trimmed.startsWith('#');
    });
    return lines.map(function (l) {
      try { return JSON.parse(l); } catch (e) { return null; }
    }).filter(Boolean);
  } catch (err) {
    return [];
  }
}

/**
 * Reseta state.json para idle limpo.
 */
function resetStateToIdle() {
  const state = {
    current_state: 'idle',
    previous_state: null,
    last_transition: null,
    last_updated: new Date().toISOString(),
    attempts: { fase3_validation: 0, fase4_review: 0 },
    history: [],
    pipeline_version: '1.0',
    metadata: {
      last_demand: null,
      last_especialista: null
    }
  };
  fs.writeFileSync(STATE_JSON, JSON.stringify(state, null, 2) + '\n');
  return state;
}

/**
 * Limpa events.log completamente.
 */
function resetEventsLog() {
  fs.writeFileSync(EVENTS_LOG, '');
}

/**
 * Reseta metrics.json para valores iniciais.
 */
function resetMetrics() {
  const metrics = {
    pipeline_version: '1.0',
    observability_version: '1.0',
    total_demandas: 0,
    states_completed: 0,
    states_failed: 0,
    escalations: 0,
    total_duration_ms: 0,
    agents_by_type: {},
    tools_by_type: {},
    retries: { fase3_validation: 0, fase4_review: 0 },
    failures_by_phase: {},
    events_count: 0,
    last_reset: null
  };
  fs.writeFileSync(METRICS_JSON, JSON.stringify(metrics, null, 2) + '\n');
  return metrics;
}

/**
 * Avança uma transição e verifica o resultado.
 * Retorna o resultado da transição.
 */
function doTransition(executor, to, options) {
  options = options || {};
  const result = executor.transition(to, {
    agent: options.agent || 'flow-test',
    tool: options.tool || 'test',
    durationMs: options.durationMs || 1,
    demand: options.demand || 'Flow test'
  });
  return result;
}

/**
 * Verifica que state.json reflete o estado esperado.
 */
function assertStateIs(expectedState, msg) {
  const state = readJSON(STATE_JSON);
  assertOk(state, 'state.json deve existir e ser JSON válido');
  assertStrictEqual(state.current_state, expectedState,
    msg || `current_state deve ser "${expectedState}", got "${state.current_state}"`);
  return state;
}

/**
 * Verifica que events.log contém pelo menos N eventos.
 */
function assertEventCount(minCount) {
  const events = readEventsLog();
  assertOk(events.length >= minCount,
    `events.log deve ter pelo menos ${minCount} entradas, tem ${events.length}`);
  return events;
}

/**
 * Verifica que metrics.json tem os campos básicos.
 */
function assertMetricsBasic() {
  const metrics = readJSON(METRICS_JSON);
  assertOk(metrics, 'metrics.json deve existir e ser JSON válido');
  assertOk(typeof metrics.events_count === 'number', 'events_count deve ser número');
  assertOk(typeof metrics.states_completed === 'number', 'states_completed deve ser número');
  return metrics;
}

// ═════════════════════════════════════════════════════════════════════════
//  CONSTANTS — Sequências de Estados
// ═════════════════════════════════════════════════════════════════════════

const HAPPY_PATH = [
  'idle',
  'identifying',
  'obligations_created',
  'obligations_verified',
  'fase1_analysis',
  'todolist_created',
  'context_building',
  'fase2_execution',
  'fase2_complete',
  'fase3_validation',
  'fase3_approved',
  'fase4_review',
  'fase4_approved',
  'delivery',
  'reporting',
  'completed'
];

// ═════════════════════════════════════════════════════════════════════════
//  SCENARIO 1: Happy Path
// ═════════════════════════════════════════════════════════════════════════
function runHappyPathTest(executor) {
  console.log(`\n${BOLD}${CYAN}════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  🧪 CENÁRIO 1: Happy Path — ${HAPPY_PATH.length} estados${RESET}`);
  console.log(`${CYAN}════════════════════════════════════════════════════════════${RESET}\n`);

  const transitionResults = [];
  let success = true;

  for (var i = 1; i < HAPPY_PATH.length; i++) {
    var from = HAPPY_PATH[i - 1];
    var to = HAPPY_PATH[i];

    console.log(`   ${BOLD}Step ${i}:${RESET} ${from} ${CYAN}→${RESET} ${to}`);

    var result = doTransition(executor, to, {
      agent: 'happy-path-test',
      tool: 'transition',
      demand: 'Happy path flow test'
    });

    transitionResults.push({ from: from, to: to, result: result });

    if (!result.success) {
      console.log(`   ${RED}❌ Transição falhou: ${from} → ${to}${RESET}`);
      console.log(`   Erro: ${result.error || '(sem erro)'}`);
      success = false;
      break;
    } else {
      var skipInfo = result.skipped ? ' (skipped)' : '';
      console.log(`   ${GREEN}✓${RESET} Concluída${skipInfo}`);

      // Verificar state.json após cada transição
      var state = assertStateIs(to, `Após transição ${from} → ${to}, current_state deve ser "${to}"`);
      assertStrictEqual(state.previous_state, from,
        `previous_state deve ser "${from}", got "${state.previous_state}"`);
      assertOk(state.last_updated, 'last_updated deve existir');
      var ts = new Date(state.last_updated);
      assertOk(!isNaN(ts.getTime()), 'last_updated deve ser data ISO válida');
    }
    console.log('');
  }

  // ── Verificações pós-fluxo ──────────────────────────────────────────
  console.log(`   ${BOLD}🔍 Verificações pós-fluxo...${RESET}`);

  test('state.json: current_state = completed', function () {
    var state = assertStateIs('completed');
    assertStrictEqual(state.last_transition, 'reporting → completed',
      'Última transição deve ser reporting → completed');
  });

  test('state.json: history contém todas as transições do happy path', function () {
    var state = readJSON(STATE_JSON);
    assertOk(state.history, 'history deve existir');
    // Deve ter pelo menos as transições executadas
    var executedCount = transitionResults.filter(function (r) { return r.result.success; }).length;
    assertOk(state.history.length >= executedCount,
      'history deve ter pelo menos ' + executedCount + ' entradas, tem ' + state.history.length);

    // Verificar a última entrada
    var lastEntry = state.history[state.history.length - 1];
    assertStrictEqual(lastEntry.from, 'reporting', 'last history.from deve ser reporting');
    assertStrictEqual(lastEntry.to, 'completed', 'last history.to deve ser completed');
    assertOk(lastEntry.timestamp, 'timestamp deve existir');
  });

  test('state.json: last_transition formatado corretamente', function () {
    var state = readJSON(STATE_JSON);
    assertStrictEqual(state.last_transition, 'reporting → completed');
  });

  test('state.json: previous_state é o penúltimo estado', function () {
    var state = readJSON(STATE_JSON);
    assertStrictEqual(state.previous_state, 'reporting');
  });

  test('state.json: pipeline_version presente', function () {
    var state = readJSON(STATE_JSON);
    assertStrictEqual(state.pipeline_version, '1.0');
  });

  test('events.log: contém entradas de transição', function () {
    var events = assertEventCount(1);
    assertOk(events.length > 0, 'events.log deve conter pelo menos 1 evento');
  });

  test('events.log: cada evento tem campos obrigatórios', function () {
    var events = readEventsLog();
    for (var j = 0; j < events.length; j++) {
      var ev = events[j];
      assertOk(ev.timestamp, 'timestamp obrigatório no evento ' + j);
      assertOk(ev.event_type, 'event_type obrigatório no evento ' + j);
      assertOk(ev.state, 'state obrigatório no evento ' + j);
      assertOk(ev.state.from, 'state.from obrigatório no evento ' + j);
      assertOk(ev.state.to, 'state.to obrigatório no evento ' + j);
    }
  });

  test('events.log: último evento reflete última transição', function () {
    var events = readEventsLog();
    var lastEvent = events[events.length - 1];
    assertStrictEqual(lastEvent.state.to, 'completed',
      'Último evento state.to deve ser completed');
  });

  test('events.log: agent happy-path-test registrado', function () {
    var events = readEventsLog();
    var hasAgent = events.some(function (ev) { return ev.agent === 'happy-path-test'; });
    assertOk(hasAgent, 'Pelo menos um evento deve ter agent="happy-path-test"');
  });

  test('events.log: tool transition registrada', function () {
    var events = readEventsLog();
    var hasTool = events.some(function (ev) { return ev.tool === 'transition'; });
    assertOk(hasTool, 'Pelo menos um evento deve ter tool="transition"');
  });

  test('metrics.json: events_count > 0', function () {
    var metrics = assertMetricsBasic();
    assertOk(metrics.events_count > 0,
      'events_count deve ser > 0, got ' + metrics.events_count);
  });

  test('metrics.json: agents_by_type contém happy-path-test', function () {
    var metrics = readJSON(METRICS_JSON);
    assertOk(metrics.agents_by_type, 'agents_by_type deve existir');
    assertOk(metrics.agents_by_type['happy-path-test'] > 0,
      'happy-path-test count deve ser > 0');
  });

  test('metrics.json: tools_by_type contém transition', function () {
    var metrics = readJSON(METRICS_JSON);
    assertOk(metrics.tools_by_type, 'tools_by_type deve existir');
    assertOk(metrics.tools_by_type['transition'] > 0,
      'transition count deve ser > 0');
  });

  test('metrics.json: states_completed >= 1', function () {
    var metrics = readJSON(METRICS_JSON);
    assertOk(metrics.states_completed >= 1,
      'states_completed deve ser >= 1, got ' + metrics.states_completed);
  });

  test('metrics.json: total_demandas foi incrementado (identifying)', function () {
    var metrics = readJSON(METRICS_JSON);
    assertStrictEqual(metrics.total_demandas, 1,
      'total_demandas deve ser 1 (identifying foi transicionado)');
  });

  test('metrics.json: retries estrutura presente', function () {
    var metrics = readJSON(METRICS_JSON);
    assertOk(metrics.retries, 'retries deve existir');
    assertOk(typeof metrics.retries.fase3_validation === 'number',
      'retries.fase3_validation deve ser número');
    assertOk(typeof metrics.retries.fase4_review === 'number',
      'retries.fase4_review deve ser número');
  });

  test('metrics.json: events_count >= transitions executadas', function () {
    var metrics = readJSON(METRICS_JSON);
    var executedCount = transitionResults.filter(function (r) { return r.result.success && !r.result.skipped; }).length;
    // O events_count conta eventos, mas cada transição pode gerar 1 evento
    assertOk(metrics.events_count >= executedCount,
      'events_count (' + metrics.events_count + ') deve ser >= transições executadas (' + executedCount + ')');
  });

  return success;
}

// ═════════════════════════════════════════════════════════════════════════
//  SCENARIO 2: Retry Flow (Judge Refuted → Retry → Approved)
// ═════════════════════════════════════════════════════════════════════════
function runRetryFlowTest(executor) {
  console.log(`\n${BOLD}${CYAN}════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  🧪 CENÁRIO 2: Retry Flow — Refuted → Retry → Approved${RESET}`);
  console.log(`${CYAN}════════════════════════════════════════════════════════════${RESET}\n`);

  // Reset para idle
  resetStateToIdle();
  resetEventsLog();
  resetMetrics();
  // Limpar cache do require para recarregar executor com estado limpo
  delete require.cache[require.resolve(path.join(SCRIPTS_DIR, 'pipeline-executor'))];
  executor = require(path.join(SCRIPTS_DIR, 'pipeline-executor'));

  // Estados para chegar até fase3_validation
  var preRetryPath = [
    'identifying',
    'obligations_created',
    'obligations_verified',
    'fase1_analysis',
    'todolist_created',
    'context_building',
    'fase2_execution',
    'fase2_complete',
    'fase3_validation'
  ];

  var success = true;

  // Executa pré-requisitos
  for (var i = 0; i < preRetryPath.length; i++) {
    var to = preRetryPath[i];
    console.log(`   ${BOLD}Setup ${i + 1}:${RESET} idle ${CYAN}→${RESET} ${to}`);
    var result = doTransition(executor, to, {
      agent: 'retry-flow-test',
      tool: 'setup',
      demand: 'Retry flow setup'
    });
    if (!result.success) {
      console.log(`   ${RED}❌ Setup falhou: idle → ${to}: ${result.error}${RESET}`);
      return false;
    }
    assertStateIs(to);
    console.log(`   ${GREEN}✓${RESET}`);
  }

  // ── Transição 1: fase3_validation → fase3_refuted (judge reprovou) ──
  console.log(`\n   ${BOLD}➡️  Retry Step 1:${RESET} fase3_validation ${CYAN}→${RESET} fase3_refuted`);
  var result1 = doTransition(executor, 'fase3_refuted', {
    agent: 'retry-flow-test',
    tool: 'judge',
    demand: 'Judge refuted - retry flow'
  });

  test('Retry Step 1: fase3_validation → fase3_refuted deve ser sucesso', function () {
    assertOk(result1.success, 'Transição fase3_validation → fase3_refuted deve ser sucesso');
  });

  test('Retry Step 1: state.json reflete fase3_refuted', function () {
    assertStateIs('fase3_refuted');
  });

  test('Retry Step 1: attempts.fase3_validation foi incrementado', function () {
    var state = readJSON(STATE_JSON);
    assertOk(state.attempts, 'attempts deve existir');
    assertStrictEqual(state.attempts.fase3_validation, 1,
      'attempts.fase3_validation deve ser 1');
  });

  test('Retry Step 1: metrics retries.fase3_validation incrementado', function () {
    var metrics = readJSON(METRICS_JSON);
    assertStrictEqual(metrics.retries.fase3_validation, 1,
      'retries.fase3_validation deve ser 1');
  });

  test('Retry Step 1: events.log registrou a transição', function () {
    var events = readEventsLog();
    var hasRefuted = events.some(function (ev) {
      return ev.state && ev.state.from === 'fase3_validation' && ev.state.to === 'fase3_refuted';
    });
    assertOk(hasRefuted, 'events.log deve conter evento fase3_validation → fase3_refuted');
  });

  // ── Transição 2: fase3_refuted → fase2_execution (retry) ──────────
  console.log(`\n   ${BOLD}➡️  Retry Step 2:${RESET} fase3_refuted ${CYAN}→${RESET} fase2_execution`);
  var result2 = doTransition(executor, 'fase2_execution', {
    agent: 'retry-flow-test',
    tool: 'orchestrator',
    demand: 'Retry - returning to fase 2'
  });

  test('Retry Step 2: fase3_refuted → fase2_execution deve ser sucesso', function () {
    assertOk(result2.success, 'Transição fase3_refuted → fase2_execution deve ser sucesso');
  });

  test('Retry Step 2: state.json reflete fase2_execution', function () {
    assertStateIs('fase2_execution');
  });

  test('Retry Step 2: previous_state é fase3_refuted', function () {
    var state = readJSON(STATE_JSON);
    assertStrictEqual(state.previous_state, 'fase3_refuted');
  });

  // ── Transição 3: fase2_execution → fase2_complete ────────────────
  console.log(`\n   ${BOLD}➡️  Retry Step 3:${RESET} fase2_execution ${CYAN}→${RESET} fase2_complete`);
  var result3 = doTransition(executor, 'fase2_complete', {
    agent: 'retry-flow-test',
    tool: 'specialist',
    demand: 'Retry - fase 2 complete'
  });

  test('Retry Step 3: fase2_execution → fase2_complete deve ser sucesso', function () {
    assertOk(result3.success, 'Transição fase2_execution → fase2_complete deve ser sucesso');
  });

  assertStateIs('fase2_complete');

  // ── Transição 4: fase2_complete → fase3_validation (segunda tentativa) ─
  console.log(`\n   ${BOLD}➡️  Retry Step 4:${RESET} fase2_complete ${CYAN}→${RESET} fase3_validation`);
  var result4 = doTransition(executor, 'fase3_validation', {
    agent: 'retry-flow-test',
    tool: 'orchestrator',
    demand: 'Retry - segunda tentativa de validação'
  });

  test('Retry Step 4: fase2_complete → fase3_validation deve ser sucesso', function () {
    assertOk(result4.success, 'Transição fase2_complete → fase3_validation deve ser sucesso');
  });

  assertStateIs('fase3_validation');

  // ── Transição 5: fase3_validation → fase3_approved (aprovado!) ─────
  console.log(`\n   ${BOLD}➡️  Retry Step 5:${RESET} fase3_validation ${CYAN}→${RESET} fase3_approved (aprovado!)`);
  var result5 = doTransition(executor, 'fase3_approved', {
    agent: 'retry-flow-test',
    tool: 'judge',
    demand: 'Judge approved on retry'
  });

  test('Retry Step 5: fase3_validation → fase3_approved deve ser sucesso', function () {
    assertOk(result5.success, 'Transição fase3_validation → fase3_approved deve ser sucesso');
  });

  test('Retry Step 5: state.json reflete fase3_approved', function () {
    assertStateIs('fase3_approved');
  });

  test('Retry Step 5: attempts.fase3_validation permanece 1 (não resetado)', function () {
    var state = readJSON(STATE_JSON);
    assertStrictEqual(state.attempts.fase3_validation, 1,
      'attempts.fase3_validation deve permanecer 1');
  });

  test('Retry Step 5: metrics retries.fase3_validation permanece 1', function () {
    var metrics = readJSON(METRICS_JSON);
    assertStrictEqual(metrics.retries.fase3_validation, 1,
      'retries.fase3_validation deve permanecer 1');
  });

  test('Retry Step 5: events.log contém pelo menos 5 eventos (setup + retry steps)', function () {
    var events = assertEventCount(5);
    var approvedEvents = events.filter(function (ev) {
      return ev.state && ev.state.to === 'fase3_approved';
    });
    assertOk(approvedEvents.length >= 1,
      'Deve haver pelo menos 1 evento com state.to = fase3_approved');
  });

  // ── Verificar que podemos continuar o happy path do fase3_approved em diante ─
  console.log(`\n   ${BOLD}➡️  Continuando happy path após retry...${RESET}`);

  var postRetryPath = [
    'fase4_review',
    'fase4_approved',
    'delivery',
    'reporting',
    'completed'
  ];

  for (var k = 0; k < postRetryPath.length; k++) {
    var nextTo = postRetryPath[k];
    console.log(`   ${BOLD}Final ${k + 1}:${RESET} ${CYAN}→${RESET} ${nextTo}`);
    var nextResult = doTransition(executor, nextTo, {
      agent: 'retry-flow-test',
      tool: 'transition',
      demand: 'Post-retry continuation'
    });
    if (!nextResult.success) {
      console.log(`   ${RED}❌ Falhou: ${nextTo}: ${nextResult.error}${RESET}`);
      success = false;
      break;
    }
    assertStateIs(nextTo);
    console.log(`   ${GREEN}✓${RESET}`);
  }

  test('Retry Flow: pipeline completou com sucesso', function () {
    var state = readJSON(STATE_JSON);
    assertStrictEqual(state.current_state, 'completed',
      'Pipeline deve estar em completed após retry flow');
  });

  test('Retry Flow: history contém ciclo de retry', function () {
    var state = readJSON(STATE_JSON);
    var hasRefuted = state.history.some(function (h) { return h.to === 'fase3_refuted'; });
    var hasApproved = state.history.some(function (h) { return h.to === 'fase3_approved'; });
    assertOk(hasRefuted, 'history deve conter fase3_refuted');
    assertOk(hasApproved, 'history deve conter fase3_approved');
  });

  return success;
}

// ═════════════════════════════════════════════════════════════════════════
//  SCENARIO 3: Failure Flow (Context Building → Failed)
// ═════════════════════════════════════════════════════════════════════════
function runFailureFlowTest(executor) {
  console.log(`\n${BOLD}${CYAN}════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  🧪 CENÁRIO 3: Failure Flow — Context Building → Failed${RESET}`);
  console.log(`${CYAN}════════════════════════════════════════════════════════════${RESET}\n`);

  // Reset para idle
  resetStateToIdle();
  resetEventsLog();
  resetMetrics();
  // Recarregar executor com estado limpo
  delete require.cache[require.resolve(path.join(SCRIPTS_DIR, 'pipeline-executor'))];
  executor = require(path.join(SCRIPTS_DIR, 'pipeline-executor'));

  // Estados para chegar até context_building
  var preFailurePath = [
    'identifying',
    'obligations_created',
    'obligations_verified',
    'fase1_analysis',
    'todolist_created',
    'context_building'
  ];

  for (var i = 0; i < preFailurePath.length; i++) {
    var to = preFailurePath[i];
    console.log(`   ${BOLD}Setup ${i + 1}:${RESET} idle ${CYAN}→${RESET} ${to}`);
    var result = doTransition(executor, to, {
      agent: 'failure-flow-test',
      tool: 'setup',
      demand: 'Failure flow setup'
    });
    if (!result.success) {
      console.log(`   ${RED}❌ Setup falhou: idle → ${to}: ${result.error}${RESET}`);
      return false;
    }
    assertStateIs(to);
    console.log(`   ${GREEN}✓${RESET}`);
  }

  // ── Transição de falha: context_building → failed ──────────────────
  console.log(`\n   ${BOLD}➡️  Failure Step:${RESET} context_building ${CYAN}→${RESET} failed`);
  var failResult = doTransition(executor, 'failed', {
    agent: 'failure-flow-test',
    tool: 'error_handler',
    demand: 'Simulating context building failure'
  });

  test('Failure Step: context_building → failed deve ser sucesso', function () {
    assertOk(failResult.success, 'Transição context_building → failed deve ser sucesso');
  });

  test('Failure Step: state.json reflete failed', function () {
    assertStateIs('failed');
  });

  test('Failure Step: previous_state é context_building', function () {
    var state = readJSON(STATE_JSON);
    assertStrictEqual(state.previous_state, 'context_building',
      'previous_state deve ser context_building');
  });

  test('Failure Step: last_transition formatado', function () {
    var state = readJSON(STATE_JSON);
    assertStrictEqual(state.last_transition, 'context_building → failed');
  });

  test('Failure Step: metrics states_failed foi incrementado', function () {
    var metrics = readJSON(METRICS_JSON);
    assertStrictEqual(metrics.states_failed, 1,
      'states_failed deve ser 1');
  });

  test('Failure Step: metrics failures_by_phase contém fase_2', function () {
    var metrics = readJSON(METRICS_JSON);
    assertOk(metrics.failures_by_phase, 'failures_by_phase deve existir');
    assertStrictEqual(metrics.failures_by_phase.fase_2, 1,
      'failures_by_phase.fase_2 deve ser 1');
  });

  test('Failure Step: events.log registrou falha', function () {
    var events = readEventsLog();
    var failEvents = events.filter(function (ev) {
      return ev.state && ev.state.to === 'failed';
    });
    assertOk(failEvents.length >= 1,
      'events.log deve conter pelo menos 1 evento com state.to = failed');
  });

  // ── Verificar recovery: failed → idle ──────────────────────────────
  console.log(`\n   ${BOLD}➡️  Recovery Step:${RESET} failed ${CYAN}→${RESET} idle (reset)`);
  var recResult = doTransition(executor, 'idle', {
    agent: 'failure-flow-test',
    tool: 'reset',
    demand: 'Reset after failure'
  });

  test('Recovery Step: failed → idle deve ser sucesso', function () {
    assertOk(recResult.success, 'Transição failed → idle deve ser sucesso');
  });

  test('Recovery Step: state.json reflete idle', function () {
    assertStateIs('idle');
  });

  test('Recovery Step: pipeline pode reiniciar de idle', function () {
    var state = readJSON(STATE_JSON);
    assertStrictEqual(state.current_state, 'idle');
    // previous_state deve ser failed
    assertStrictEqual(state.previous_state, 'failed');
  });

  test('Recovery Step: metrics states_failed ainda é 1', function () {
    var metrics = readJSON(METRICS_JSON);
    assertStrictEqual(metrics.states_failed, 1,
      'states_failed deve permanecer 1 (histórico preservado)');
  });

  return true;
}

// ═════════════════════════════════════════════════════════════════════════
//  Main Runner
// ═════════════════════════════════════════════════════════════════════════
function run() {
  console.log('');
  console.log(`${CYAN}${BOLD}╔════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Matrix Pipeline — Teste de Fluxo Completo                ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚════════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');

  var exitCode = 0;

  // ── Backup dos arquivos de estado ──────────────────────────────────
  console.log(`${BOLD}📦 Fazendo backup dos arquivos de estado...${RESET}`);
  backupAll();
  console.log(`   ${GREEN}✓${RESET} Backup criado (state.json, events.log, metrics.json)`);
  console.log('');

  try {
    // ── Load do pipeline executor ──────────────────────────────────────
    console.log(`${BOLD}📦 Carregando pipeline-executor.js...${RESET}`);
    var executor = require(path.join(SCRIPTS_DIR, 'pipeline-executor'));
    console.log(`   ${GREEN}✓${RESET} Pipeline executor carregado`);
    console.log('');

    // ── Reset limpo para começar ─────────────────────────────────────
    console.log(`${BOLD}🔄 Resetando pipeline para estado inicial...${RESET}`);
    resetStateToIdle();
    resetEventsLog();
    resetMetrics();
    console.log(`   ${GREEN}✓${RESET} Pipeline resetado para idle`);
    console.log('');

    // ═════════════════════════════════════════════════════════════════
    //  CENÁRIO 1: Happy Path
    // ═════════════════════════════════════════════════════════════════
    var happyPathOk = runHappyPathTest(executor);
    if (!happyPathOk) {
      console.log(`\n   ${RED}${BOLD}❌ Happy Path falhou!${RESET}`);
      exitCode = 1;
    } else {
      console.log(`\n   ${GREEN}${BOLD}✅ Happy Path concluído com sucesso!${RESET}`);
    }

    // ═════════════════════════════════════════════════════════════════
    //  CENÁRIO 2: Retry Flow
    // ═════════════════════════════════════════════════════════════════
    var retryOk = runRetryFlowTest(executor);
    if (!retryOk) {
      console.log(`\n   ${RED}${BOLD}❌ Retry Flow falhou!${RESET}`);
      exitCode = 1;
    } else {
      console.log(`\n   ${GREEN}${BOLD}✅ Retry Flow concluído com sucesso!${RESET}`);
    }

    // ═════════════════════════════════════════════════════════════════
    //  CENÁRIO 3: Failure Flow
    // ═════════════════════════════════════════════════════════════════
    var failureOk = runFailureFlowTest(executor);
    if (!failureOk) {
      console.log(`\n   ${RED}${BOLD}❌ Failure Flow falhou!${RESET}`);
      exitCode = 1;
    } else {
      console.log(`\n   ${GREEN}${BOLD}✅ Failure Flow concluído com sucesso!${RESET}`);
    }

    // ═════════════════════════════════════════════════════════════════
    //  Validações globais extras
    // ═════════════════════════════════════════════════════════════════
    console.log(`\n${BOLD}${CYAN}════════════════════════════════════════════════════════════${RESET}`);
    console.log(`${BOLD}  🧪 Validações Globais${RESET}`);
    console.log(`${CYAN}════════════════════════════════════════════════════════════${RESET}\n`);

    // A pipeline já foi resetada para idle no último teste, então idle → identifying
    test('Transição inválida: idle → completed retorna erro', function () {
      resetStateToIdle();
      resetEventsLog();
      resetMetrics();
      delete require.cache[require.resolve(path.join(SCRIPTS_DIR, 'pipeline-executor'))];
      var ex = require(path.join(SCRIPTS_DIR, 'pipeline-executor'));

      var result = ex.transition('completed', {
        agent: 'global-test',
        tool: 'validation'
      });
      assertStrictEqual(result.success, false,
        'Transição idle → completed deve falhar');
      assertOk(result.error, 'Deve conter mensagem de erro');
      assertOk(result.error.indexOf('Transição inválida') >= 0 ||
               result.error.indexOf('não encontrado') >= 0 ||
               result.error.indexOf('não definido') >= 0,
               'Erro deve ser descritivo: ' + result.error);
    });

    test('Idempotency: transicionar para o mesmo estado é seguro', function () {
      resetStateToIdle();
      delete require.cache[require.resolve(path.join(SCRIPTS_DIR, 'pipeline-executor'))];
      var ex = require(path.join(SCRIPTS_DIR, 'pipeline-executor'));

      var result = ex.transition('idle', {
        agent: 'global-test',
        tool: 'idempotency'
      });
      assertOk(result.success, 'Transição para o mesmo estado deve ser sucesso');
      assertOk(result.skipped, 'Deve retornar skipped=true');
    });

    test('loadState retorna objeto com current_state', function () {
      delete require.cache[require.resolve(path.join(SCRIPTS_DIR, 'pipeline-executor'))];
      var ex = require(path.join(SCRIPTS_DIR, 'pipeline-executor'));
      var state = ex.loadState();
      assertOk(state, 'loadState deve retornar objeto');
      assertOk(typeof state.current_state === 'string', 'current_state deve ser string');
      assertOk(state.current_state.length > 0, 'current_state não pode ser vazio');
    });

    test('loadPipeline retorna states e transitions', function () {
      delete require.cache[require.resolve(path.join(SCRIPTS_DIR, 'pipeline-executor'))];
      var ex = require(path.join(SCRIPTS_DIR, 'pipeline-executor'));
      var pipeline = ex.loadPipeline();
      assertOk(pipeline, 'loadPipeline deve retornar objeto');
      assertOk(Array.isArray(pipeline.states), 'states deve ser array');
      assertOk(Array.isArray(pipeline.transitions), 'transitions deve ser array');
      assertOk(pipeline.states.length > 0, 'deve ter pelo menos 1 estado');
      assertOk(pipeline.transitions.length > 0, 'deve ter pelo menos 1 transição');
    });

    test('isTransitionValid: verifica transições válidas e inválidas', function () {
      delete require.cache[require.resolve(path.join(SCRIPTS_DIR, 'pipeline-executor'))];
      var ex = require(path.join(SCRIPTS_DIR, 'pipeline-executor'));
      var pipeline = ex.loadPipeline();

      assertOk(ex.isTransitionValid('idle', 'identifying', pipeline.transitions),
        'idle → identifying deve ser válida');
      assertStrictEqual(ex.isTransitionValid('idle', 'completed', pipeline.transitions), false,
        'idle → completed deve ser inválida');
      assertOk(ex.isTransitionValid('fase3_validation', 'fase3_approved', pipeline.transitions),
        'fase3_validation → fase3_approved deve ser válida');
      assertOk(ex.isTransitionValid('fase3_validation', 'fase3_refuted', pipeline.transitions),
        'fase3_validation → fase3_refuted deve ser válida');
      assertOk(ex.isTransitionValid('context_building', 'failed', pipeline.transitions),
        'context_building → failed deve ser válida');
      assertOk(ex.isTransitionValid('failed', 'idle', pipeline.transitions),
        'failed → idle deve ser válida');
    });

  } catch (err) {
    console.error(`\n${RED}${BOLD}❌ Erro fatal: ${err.message}${RESET}`);
    console.error(err.stack);
    exitCode = 1;
  } finally {
    // ── Restaurar backups ──────────────────────────────────────────────
    console.log(`\n${BOLD}🔄 Restaurando arquivos de estado originais...${RESET}`);
    restoreAll();
    console.log(`   ${GREEN}✓${RESET} Backup restaurado`);
    console.log('');
  }

  // ═════════════════════════════════════════════════════════════════════
  //  SUMMARY
  // ═════════════════════════════════════════════════════════════════════
  console.log(`${BOLD}${CYAN}════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  📊 RESUMO FINAL${RESET}`);
  console.log(`${CYAN}════════════════════════════════════════════════════════════${RESET}`);
  console.log('');

  var totalTests = testsPassed + testsFailed;
  var color = testsFailed === 0 ? GREEN : RED;
  console.log(`  ${BOLD}Testes:${RESET} ${color}${testsPassed}/${totalTests} passaram, ${testsFailed} falharam${RESET}`);
  console.log(`  ${BOLD}Asserções:${RESET} ${assertionsPassed} passaram, ${assertionsFailed} falharam`);

  if (testsFailed > 0) {
    exitCode = 1;
  }

  console.log('');
  if (exitCode === 0) {
    console.log(`  ${GREEN}${BOLD}✅ TODOS OS TESTES PASSARAM${RESET}`);
  } else {
    console.log(`  ${RED}${BOLD}❌ ALGUNS TESTES FALHARAM${RESET}`);
  }
  console.log('');
  console.log(`${BOLD}Resultado:${RESET} ${exitCode === 0 ? GREEN + 'PASS' + RESET : RED + 'FAIL' + RESET}`);
  console.log('');

  process.exit(exitCode);
}

run();
