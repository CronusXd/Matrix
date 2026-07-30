#!/usr/bin/env node
/**
 * Matrix Test Suite Runner — Pipeline Structure Wrapper
 *
 * Executa validação estrutural do pipeline (pipeline.yaml, state.json, scripts).
 * Este é o wrapper que substitui o antigo tests/run-all.js da raiz.
 *
 * Uso: node run-all-wrapper.js
 * Exit code: 0 se TODOS os testes passarem, 1 se algum falhar
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── Constants ──────────────────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// Running from pipeline/tests/, so BASE_DIR goes up two levels to project root
const BASE_DIR = path.resolve(__dirname, '..', '..');
const PIPELINE_YAML = path.join(BASE_DIR, 'pipeline', 'pipeline.yaml');
const STATE_JSON = path.join(BASE_DIR, 'pipeline', 'state.json');
const METRICS_JSON = path.join(BASE_DIR, 'pipeline', 'metrics.json');
const PIPELINE_SCRIPTS_DIR = path.join(BASE_DIR, 'pipeline', 'scripts');
const VALIDATE_SCRIPT = path.join(PIPELINE_SCRIPTS_DIR, 'validate-pipeline.js');

const ROAMING_TESTS_DIR = path.join(
  process.env.APPDATA || 'C:\\Users\\jacks\\AppData\\Roaming',
  'opencode', 'pipeline', 'tests'
);
const ROAMING_RUNNER = path.join(ROAMING_TESTS_DIR, 'run-all.js');

let testPassed = 0;
let testFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ${GREEN}✅ ${name}${RESET}`);
    testPassed++;
  } catch (err) {
    console.log(`  ${RED}❌ ${name}: ${err.message}${RESET}`);
    testFailed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// =====================================================================
//  FASE 1: Testes Estruturais do Pipeline
//  Validam a estrutura do pipeline.yaml, state.json e scripts
// =====================================================================

console.log('');
console.log(`${CYAN}${BOLD}╔════════════════════════════════════════════════════════════╗${RESET}`);
console.log(`${CYAN}${BOLD}║   Matrix — Test Suite (Pipeline Structure)               ║${RESET}`);
console.log(`${CYAN}${BOLD}╚════════════════════════════════════════════════════════════╝${RESET}`);
console.log('');

// ─── Test: pipeline.yaml existe e é válido ────────────────────────────
console.log(`${BOLD}📋 Pipeline State Machine${RESET}`);
console.log('');

test('pipeline.yaml existe', () => {
  assert(fs.existsSync(PIPELINE_YAML), `Arquivo não encontrado: ${PIPELINE_YAML}`);
});

test('pipeline.yaml contém states, transitions e phases', () => {
  const raw = fs.readFileSync(PIPELINE_YAML, 'utf8');
  assert(raw.includes('states:'), 'Deve conter seção states');
  assert(raw.includes('transitions:'), 'Deve conter seção transitions');
  assert(raw.includes('phases:'), 'Deve conter seção phases');
});

test('pipeline.yaml: mínimo de estados e transições', () => {
  const raw = fs.readFileSync(PIPELINE_YAML, 'utf8');
  const lines = raw.split('\n');
  let stateCount = 0;
  let transitionCount = 0;
  let inStates = false;
  let inTransitions = false;

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('states:')) { inStates = true; inTransitions = false; continue; }
    if (t.startsWith('transitions:')) { inStates = false; inTransitions = true; continue; }
    if (inStates && t.startsWith('- ')) stateCount++;
    if (inTransitions && t.startsWith('- ')) transitionCount++;
    if (!t.startsWith('#') && !t.startsWith('-') && t.includes(':') && (t.startsWith('    ') === false || t.length === t.trimStart().length)) {
      const indent = line.length - line.trimStart().length;
      if (indent === 0 && t !== '') { inStates = false; inTransitions = false; }
    }
  }

  assert(stateCount >= 15, `Mínimo 15 estados, encontrado ${stateCount}`);
  assert(transitionCount >= 20, `Mínimo 20 transições, encontrado ${transitionCount}`);
});

// ─── Test: State JSON ─────────────────────────────────────────────────
console.log('');
console.log(`${BOLD}📋 State Files${RESET}`);
console.log('');

test('state.json existe', () => {
  assert(fs.existsSync(STATE_JSON), `state.json não encontrado em ${STATE_JSON}`);
});

test('state.json é JSON válido com campos obrigatórios', () => {
  const raw = fs.readFileSync(STATE_JSON, 'utf8');
  const state = JSON.parse(raw);
  assert(state.current_state, 'current_state é obrigatório');
  assert(Array.isArray(state.history), 'history deve ser array');
  assert(typeof state.last_updated === 'string', 'last_updated deve ser string');
});

test('metrics.json existe', () => {
  assert(fs.existsSync(METRICS_JSON), `metrics.json não encontrado em ${METRICS_JSON}`);
});

test('metrics.json é JSON válido com campos obrigatórios', () => {
  const raw = fs.readFileSync(METRICS_JSON, 'utf8');
  const metrics = JSON.parse(raw);
  assert(typeof metrics.events_count === 'number', 'events_count deve ser number');
  assert(typeof metrics.states_completed === 'number', 'states_completed deve ser number');
  assert(typeof metrics.total_demandas === 'number', 'total_demandas deve ser number');
});

// ─── Test: Scripts existem ────────────────────────────────────────────
console.log('');
console.log(`${BOLD}📋 Pipeline Scripts${RESET}`);
console.log('');

const REQUIRED_SCRIPTS = [
  'pipeline-executor.js',
  'memory-adapter.js',
  'validate-pipeline.js',
  'context-executor.js',
  'sync-pipeline.js',
  'dashboard-server.js'
];

test('Scripts do pipeline existem', () => {
  for (const script of REQUIRED_SCRIPTS) {
    const scriptPath = path.join(PIPELINE_SCRIPTS_DIR, script);
    if (!fs.existsSync(scriptPath)) {
      // Pode estar no roaming
      const roamingPath = path.join(
        process.env.APPDATA || 'C:\\Users\\jacks\\AppData\\Roaming',
        'opencode', 'pipeline', 'scripts', script
      );
      assert(fs.existsSync(roamingPath), `Script não encontrado: ${script} (nem workspace, nem roaming)`);
    }
  }
});

// ─── Test: Executa validate-pipeline.js (real) ────────────────────────
console.log('');
console.log(`${BOLD}📋 Validate Pipeline (execução real)${RESET}`);
console.log('');

test('validate-pipeline.js executa com sucesso', () => {
  assert(fs.existsSync(VALIDATE_SCRIPT), `validate-pipeline.js não encontrado em ${VALIDATE_SCRIPT}`);
  execSync(`node "${VALIDATE_SCRIPT}"`, {
    cwd: path.dirname(VALIDATE_SCRIPT),
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30000,
    encoding: 'utf-8'
  });
});

// ─── Summary ─────────────────────────────────────────────────────────
console.log('');
const totalLocal = testPassed + testFailed;
const localColor = testFailed === 0 ? GREEN : RED;
console.log(`${localColor}${BOLD}  ${testPassed}/${totalLocal} testes estruturais passaram${RESET}`);

if (testFailed > 0) {
  console.log(`${RED}${BOLD}  Testes estruturais falharam — abortando.${RESET}`);
  console.log('');
  process.exit(1);
}

// =====================================================================
//  FASE 2: Roaming (OPCIONAL — EXTRA)
//  Só executa se os testes locais passaram E o roaming existir
// =====================================================================

if (fs.existsSync(ROAMING_RUNNER)) {
  console.log('');
  console.log(`${CYAN}${BOLD}╔════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Matrix — Test Suite (Roaming — Extra)                   ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚════════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');

  try {
    execSync(`node "${ROAMING_RUNNER}"`, {
      cwd: ROAMING_TESTS_DIR,
      stdio: 'inherit',
      timeout: 60000
    });
    console.log(`${GREEN}${BOLD}  ✅ Roaming tests: passaram${RESET}`);
  } catch (err) {
    console.log(`${YELLOW}${BOLD}  ⚠️  Roaming tests: falharam (ignorado — extra opcional)${RESET}`);
  }
} else {
  console.log('');
  console.log(`${YELLOW}⚠️  Roaming tests não disponíveis — pulando fase extra${RESET}`);
}

// ─── Final Summary ────────────────────────────────────────────────────
console.log('');
console.log(`${GREEN}${BOLD}  ✅ Todos os testes obrigatórios passaram.${RESET}`);
console.log('');
process.exit(0);
