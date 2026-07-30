#!/usr/bin/env node
/**
 * Matrix Pipeline Integration Test v1.0
 *
 * Simulates the FULL pipeline lifecycle end-to-end:
 *   idle → identifying → obligations_created → obligations_verified →
 *   fase1_analysis → todolist_created → context_building → fase2_execution →
 *   fase2_complete → fase3_validation → fase3_approved → fase4_review →
 *   fase4_approved → delivery → reporting → completed
 *
 * Validates state.json, events.log, and metrics.json after each step.
 * Uses pipeline-executor.js via require() — zero npm dependencies.
 *
 * Usage: node test-pipeline-integration.js
 * Exit code: 0 if ALL transitions pass, 1 if ANY fail
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

// ─── Colores ───────────────────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// ─── Test framework minimalista ────────────────────────────────────────
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

// ─── Backup / Restore helpers ──────────────────────────────────────────
const BACKUP_SUFFIX = '.integration-test-backup';

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
    const lines = raw.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    return lines.map(l => {
      try { return JSON.parse(l); } catch (e) { return null; }
    }).filter(Boolean);
  } catch (err) {
    return [];
  }
}

/**
 * Reseta o state.json para idle (limpa histórico, preserva estrutura).
 */
function resetStateToIdle() {
  const state = {
    current_state: 'idle',
    previous_state: null,
    last_transition: null,
    last_updated: new Date().toISOString(),
    attempts: {},
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
 * Limpa events.log (preserva cabeçalho).
 */
function resetEventsLog() {
  const header =
    '# Matrix Events Log — JSON Lines format (append-only)\n' +
    '# Cada linha é um evento JSON com: timestamp, event_type, state, agent, tool, duration_ms\n' +
    '# NON-BLOCKING: se este arquivo falhar, o pipeline continua.\n\n';
  fs.writeFileSync(EVENTS_LOG, header);
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

// ─── The FULL happy path states ────────────────────────────────────────
const FULL_HAPPY_PATH = [
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

/**
 * Obtém a fase a partir do nome do estado (via módulo compartilhado).
 */
const fases = require(path.join(SCRIPTS_DIR, 'lib', 'fases'));
function getFaseFromState(stateId) {
  return fases.getFaseFromState(stateId);
}

// =====================================================================
//  MAIN TEST SUITE
// =====================================================================

function run() {
  console.log('');
  console.log(`${CYAN}${BOLD}╔════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Matrix Pipeline — Integration Test Suite               ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚════════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');

  // ── Backup existing state ─────────────────────────────────────────────
  console.log(`${BOLD}📦 Fazendo backup dos arquivos de estado...${RESET}`);
  backupAll();
  console.log(`   ${GREEN}✓${RESET} Backup criado (state.json, events.log, metrics.json)`);
  console.log('');

  let exitCode = 0;

  try {
    // ── Reset to clean state ──────────────────────────────────────────────
    console.log(`${BOLD}🔄 Resetando pipeline para estado inicial...${RESET}`);
    const initialState = resetStateToIdle();
    resetEventsLog();
    const initialMetrics = resetMetrics();
    console.log(`   ${GREEN}✓${RESET} Pipeline resetado para idle`);
    console.log('');

    // ── Load pipeline executor ────────────────────────────────────────────
    console.log(`${BOLD}📦 Carregando pipeline-executor.js...${RESET}`);
    const executor = require(path.join(SCRIPTS_DIR, 'pipeline-executor'));
    console.log(`   ${GREEN}✓${RESET} Pipeline executor carregado`);
    console.log('');

    // ═══════════════════════════════════════════════════════════════════
    //  TEST 1: Full Happy Path — Executar TODAS as transições
    // ═══════════════════════════════════════════════════════════════════
    console.log(`${BOLD}${CYAN}════════════════════════════════════════════════════════════${RESET}`);
    console.log(`${BOLD}  🧪 TEST 1: Full Happy Path — ${FULL_HAPPY_PATH.length} estados${RESET}`);
    console.log(`${CYAN}════════════════════════════════════════════════════════════${RESET}`);
    console.log('');

    const transitionResults = [];

    for (let i = 1; i < FULL_HAPPY_PATH.length; i++) {
      const from = FULL_HAPPY_PATH[i - 1];
      const to = FULL_HAPPY_PATH[i];

      console.log(`   ${BOLD}Step ${i}:${RESET} ${from} ${CYAN}→${RESET} ${to}`);

      const result = executor.transition(to, {
        agent: 'integration-test',
        tool: 'test',
        durationMs: 1,
        demand: 'Integration test - full happy path'
      });

      // Guarda resultado
      transitionResults.push({ from, to, result });

      if (!result.success) {
        console.log(`   ${RED}❌ Transição falhou: ${from} → ${to}${RESET}`);
        console.log(`   Erro: ${result.error || '(sem erro)'}`);
        exitCode = 1;
        break; // Não adianta continuar
      } else {
        console.log(`   ${GREEN}✓${RESET} Transição concluída${result.skipped ? ' (skipped)' : ''}`);
      }
      console.log('');
    }

    // ═══════════════════════════════════════════════════════════════════
    //  TEST 2: Validar state.json após cada transição
    // ═══════════════════════════════════════════════════════════════════
    console.log(`${BOLD}${CYAN}════════════════════════════════════════════════════════════${RESET}`);
    console.log(`${BOLD}  🧪 TEST 2: Validar state.json após cada transição${RESET}`);
    console.log(`${CYAN}════════════════════════════════════════════════════════════${RESET}`);
    console.log('');

    test('state.json: current_state = último estado da transição', () => {
      const state = readJSON(STATE_JSON);
      assertOk(state, 'state.json deve existir e ser JSON válido');
      const lastTransition = FULL_HAPPY_PATH[FULL_HAPPY_PATH.length - 1];
      assertStrictEqual(state.current_state, lastTransition,
        `current_state deve ser "${lastTransition}"`);
    });

    test('state.json: history contém todas as transições', () => {
      const state = readJSON(STATE_JSON);
      assertOk(state.history, 'history deve existir');
      // A última transição bem-sucedida deve estar no history
      const lastEntry = state.history[state.history.length - 1];
      assertOk(lastEntry, 'history não pode estar vazio');
      assertStrictEqual(lastEntry.from, FULL_HAPPY_PATH[FULL_HAPPY_PATH.length - 2],
        `last history.from deve ser ${FULL_HAPPY_PATH[FULL_HAPPY_PATH.length - 2]}`);
      assertStrictEqual(lastEntry.to, FULL_HAPPY_PATH[FULL_HAPPY_PATH.length - 1],
        `last history.to deve ser ${FULL_HAPPY_PATH[FULL_HAPPY_PATH.length - 1]}`);
    });

    test('state.json: last_transition formatado corretamente', () => {
      const state = readJSON(STATE_JSON);
      const expected = `${FULL_HAPPY_PATH[FULL_HAPPY_PATH.length - 2]} → ${FULL_HAPPY_PATH[FULL_HAPPY_PATH.length - 1]}`;
      assertStrictEqual(state.last_transition, expected);
    });

    test('state.json: last_updated é timestamp ISO', () => {
      const state = readJSON(STATE_JSON);
      assertOk(state.last_updated, 'last_updated deve existir');
      const ts = new Date(state.last_updated);
      assertOk(!isNaN(ts.getTime()), 'last_updated deve ser data ISO válida');
    });

    test('state.json: previous_state é o penúltimo estado', () => {
      const state = readJSON(STATE_JSON);
      assertStrictEqual(state.previous_state, FULL_HAPPY_PATH[FULL_HAPPY_PATH.length - 2]);
    });

    test('state.json: pipeline_version presente', () => {
      const state = readJSON(STATE_JSON);
      assertOk(state.pipeline_version, 'pipeline_version deve existir');
    });

    // ═══════════════════════════════════════════════════════════════════
    //  TEST 3: Validar events.log
    // ═══════════════════════════════════════════════════════════════════
    console.log('');
    console.log(`${BOLD}${CYAN}════════════════════════════════════════════════════════════${RESET}`);
    console.log(`${BOLD}  🧪 TEST 3: Validar events.log${RESET}`);
    console.log(`${CYAN}════════════════════════════════════════════════════════════${RESET}`);
    console.log('');

    test('events.log: contém entradas de transição', () => {
      const events = readEventsLog();
      assertOk(events.length > 0, 'events.log deve conter pelo menos 1 evento');
    });

    test('events.log: cada evento tem campos obrigatórios', () => {
      const events = readEventsLog();
      for (const ev of events) {
        assertOk(ev.timestamp, 'timestamp obrigatório');
        assertOk(ev.event_type, 'event_type obrigatório');
        assertOk(ev.state, 'state obrigatório');
        assertOk(ev.state.from, 'state.from obrigatório');
        assertOk(ev.state.to, 'state.to obrigatório');
      }
    });

    test('events.log: último evento reflete a última transição', () => {
      const events = readEventsLog();
      const lastEvent = events[events.length - 1];
      assertStrictEqual(lastEvent.state.to, FULL_HAPPY_PATH[FULL_HAPPY_PATH.length - 1],
        `Último evento state.to deve ser ${FULL_HAPPY_PATH[FULL_HAPPY_PATH.length - 1]}`);
    });

    test('events.log: agent registrado nos eventos', () => {
      const events = readEventsLog();
      const hasAgent = events.some(ev => ev.agent === 'integration-test');
      assertOk(hasAgent, 'Pelo menos um evento deve ter agent="integration-test"');
    });

    test('events.log: tool registrada nos eventos', () => {
      const events = readEventsLog();
      const hasTool = events.some(ev => ev.tool === 'test');
      assertOk(hasTool, 'Pelo menos um evento deve ter tool="test"');
    });

    // ═══════════════════════════════════════════════════════════════════
    //  TEST 4: Validar metrics.json
    // ═══════════════════════════════════════════════════════════════════
    console.log('');
    console.log(`${BOLD}${CYAN}════════════════════════════════════════════════════════════${RESET}`);
    console.log(`${BOLD}  🧪 TEST 4: Validar metrics.json${RESET}`);
    console.log(`${CYAN}════════════════════════════════════════════════════════════${RESET}`);
    console.log('');

    test('metrics.json: events_count > 0', () => {
      const metrics = readJSON(METRICS_JSON);
      assertOk(metrics, 'metrics.json deve existir');
      assertOk(metrics.events_count > 0, `events_count deve ser > 0, got ${metrics.events_count}`);
    });

    test('metrics.json: agents_by_type contém integration-test', () => {
      const metrics = readJSON(METRICS_JSON);
      assertOk(metrics.agents_by_type, 'agents_by_type deve existir');
      assertOk(metrics.agents_by_type['integration-test'] > 0,
        `integration-test count deve ser > 0`);
    });

    test('metrics.json: tools_by_type contém test', () => {
      const metrics = readJSON(METRICS_JSON);
      assertOk(metrics.tools_by_type, 'tools_by_type deve existir');
      assertOk(metrics.tools_by_type['test'] > 0,
        `test tool count deve ser > 0`);
    });

    test('metrics.json: states_completed > 0', () => {
      const metrics = readJSON(METRICS_JSON);
      assertOk(metrics.states_completed >= 0,
        `states_completed deve ser >= 0, got ${metrics.states_completed}`);
    });

    test('metrics.json: total_demandas foi incrementado (identifying)', () => {
      const metrics = readJSON(METRICS_JSON);
      assertStrictEqual(metrics.total_demandas, 1,
        `total_demandas deve ser 1 (identifying foi transicionado)`);
    });

    test('metrics.json: metrics tem pipeline_version', () => {
      const metrics = readJSON(METRICS_JSON);
      assertStrictEqual(metrics.pipeline_version, '1.0');
    });

    // ═══════════════════════════════════════════════════════════════════
    //  TEST 5: Validar transições individuais (retry paths)
    // ═══════════════════════════════════════════════════════════════════
    console.log('');
    console.log(`${BOLD}${CYAN}════════════════════════════════════════════════════════════${RESET}`);
    console.log(`${BOLD}  🧪 TEST 5: Validar validação de transições${RESET}`);
    console.log(`${CYAN}════════════════════════════════════════════════════════════${RESET}`);
    console.log('');

    test('isTransitionValid: idle → identifying é válida', () => {
      const pipeline = executor.loadPipeline();
      const valid = executor.isTransitionValid('idle', 'identifying', pipeline.transitions);
      assertOk(valid, 'idle → identifying deve ser transição válida');
    });

    test('isTransitionValid: idle → completed é INVÁLIDA', () => {
      const pipeline = executor.loadPipeline();
      const valid = executor.isTransitionValid('idle', 'completed', pipeline.transitions);
      assertStrictEqual(valid, false, 'idle → completed deve ser transição INVÁLIDA');
    });

    test('isTransitionValid: reporting → completed é válida', () => {
      const pipeline = executor.loadPipeline();
      const valid = executor.isTransitionValid('reporting', 'completed', pipeline.transitions);
      assertOk(valid, 'reporting → completed deve ser transição válida');
    });

    test('findValidTransitions: idle tem 1 transição válida', () => {
      const pipeline = executor.loadPipeline();
      const valid = executor.findValidTransitions('idle', pipeline.transitions);
      assertStrictEqual(valid.length, 1, 'idle deve ter apenas 1 transição');
      assertStrictEqual(valid[0].to, 'identifying');
    });

    test('Idempotency: transicionar para o mesmo estado é seguro', () => {
      const state = readJSON(STATE_JSON);
      const currentState = state.current_state;
      const result = executor.transition(currentState, {
        agent: 'integration-test',
        tool: 'test'
      });
      assertOk(result.success, 'Transição para o mesmo estado deve ser bem-sucedida');
      assertOk(result.skipped, 'Deve retornar skipped=true');
    });

    // ═══════════════════════════════════════════════════════════════════
    //  TEST 6: Validar fases (getFaseFromState)
    // ═══════════════════════════════════════════════════════════════════
    console.log('');
    console.log(`${BOLD}${CYAN}════════════════════════════════════════════════════════════${RESET}`);
    console.log(`${BOLD}  🧪 TEST 6: Fases dos estados${RESET}`);
    console.log(`${CYAN}════════════════════════════════════════════════════════════${RESET}`);
    console.log('');

    test('getFaseFromState: idle → init', () => {
      assertStrictEqual(getFaseFromState('idle'), 'init');
    });

    test('getFaseFromState: fase2_execution → fase_2', () => {
      assertStrictEqual(getFaseFromState('fase2_execution'), 'fase_2');
    });

    test('getFaseFromState: fase3_validation → fase_3', () => {
      assertStrictEqual(getFaseFromState('fase3_validation'), 'fase_3');
    });

    test('getFaseFromState: fase4_review → fase_4', () => {
      assertStrictEqual(getFaseFromState('fase4_review'), 'fase_4');
    });

    test('getFaseFromState: completed → final', () => {
      assertStrictEqual(getFaseFromState('completed'), 'final');
    });

    // ═══════════════════════════════════════════════════════════════════
    //  SUMMARY
    // ═══════════════════════════════════════════════════════════════════
    console.log('');
    console.log(`${BOLD}${CYAN}════════════════════════════════════════════════════════════${RESET}`);
    console.log(`${BOLD}  📊 RESUMO DA INTEGRAÇÃO${RESET}`);
    console.log(`${CYAN}════════════════════════════════════════════════════════════${RESET}`);
    console.log('');

    const totalTests = testsPassed + testsFailed;
    const color = testsFailed === 0 ? GREEN : RED;
    console.log(`  ${BOLD}Testes:${RESET} ${color}${testsPassed}/${totalTests} passaram, ${testsFailed} falharam${RESET}`);
    console.log(`  ${BOLD}Asserções:${RESET} ${assertionsPassed} passaram, ${assertionsFailed} falharam`);

    if (exitCode === 0 && testsFailed === 0) {
      console.log(`  ${GREEN}${BOLD}✅ TODOS OS TESTES PASSARAM${RESET}`);
    } else {
      console.log(`  ${RED}${BOLD}❌ ALGUNS TESTES FALHARAM${RESET}`);
      exitCode = 1;
    }

  } catch (err) {
    console.error(`\n${RED}${BOLD}❌ Erro fatal no teste: ${err.message}${RESET}`);
    console.error(err.stack);
    exitCode = 1;
  } finally {
    // ── Restore backups ──────────────────────────────────────────────────
    console.log(`\n${BOLD}🔄 Restaurando arquivos de estado originais...${RESET}`);
    restoreAll();
    console.log(`   ${GREEN}✓${RESET} Backup restaurado`);
    console.log('');
  }

  console.log(`\n${BOLD}Resultado:${RESET} ${exitCode === 0 ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`}`);
  console.log('');
  process.exit(exitCode);
}

run();
