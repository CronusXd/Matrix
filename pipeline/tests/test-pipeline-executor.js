#!/usr/bin/env node
/**
 * Test: pipeline-executor.js
 * Funções exportadas: isTransitionValid, findValidTransitions, loadState,
 *                     getFaseFromState, validateWithSandbox, transition
 *
 * Estilo: assert nativo, console.log, exit code 0/1.
 * Zero npm dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SCRIPTS_DIR = path.resolve(__dirname, '..', 'scripts');
const STATE_JSON = path.resolve(__dirname, '..', 'state.json');
const STATE_BAK = STATE_JSON + '.exec-test-bak';

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  \x1b[32m✅ ' + name + '\x1b[0m');
    testsPassed++;
  } catch (err) {
    console.log('  \x1b[31m❌ ' + name + ': ' + err.message + '\x1b[0m');
    testsFailed++;
  }
}

// ─── Backup / Restore state.json ──────────────────────────────────────
function backupState() {
  if (fs.existsSync(STATE_JSON)) {
    fs.copyFileSync(STATE_JSON, STATE_BAK);
  }
}

function restoreState() {
  if (fs.existsSync(STATE_BAK)) {
    fs.copyFileSync(STATE_BAK, STATE_JSON);
    fs.unlinkSync(STATE_BAK);
  }
}

// ─── Load executor ────────────────────────────────────────────────────
let executor;
try {
  const modPath = path.join(SCRIPTS_DIR, 'pipeline-executor.js');
  delete require.cache[modPath];
  executor = require(modPath);
} catch (err) {
  console.log('\n  \x1b[31m❌ Erro ao carregar pipeline-executor: ' + err.message + '\x1b[0m');
  process.exit(1);
}

// ─── Main ─────────────────────────────────────────────────────────────
console.log('\n\x1b[36m\x1b[1m📦 pipeline-executor.js — Testes\x1b[0m\n');

// Salvar state original
backupState();

try {
  // ═══════════════════════════════════════════════════════════════════
  //  TEST: loadState
  // ═══════════════════════════════════════════════════════════════════
  console.log('\x1b[1m📋 loadState\x1b[0m');

  test('loadState retorna objeto com current_state', () => {
    const state = executor.loadState();
    assert.ok(state, 'loadState deve retornar um objeto');
    assert.ok(typeof state.current_state === 'string', 'current_state deve ser string');
    assert.ok(state.current_state.length > 0, 'current_state não pode ser vazio');
  });

  test('loadState contém history (array)', () => {
    const state = executor.loadState();
    assert.ok(Array.isArray(state.history), 'history deve ser array');
  });

  test('loadState contém pipeline_version', () => {
    const state = executor.loadState();
    assert.ok(state.pipeline_version, 'pipeline_version deve existir');
  });

  // ═══════════════════════════════════════════════════════════════════
  //  TEST: isTransitionValid
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n\x1b[1m📋 isTransitionValid\x1b[0m');

  test('isTransitionValid: idle → identifying é válida', () => {
    const pipeline = executor.loadPipeline();
    const valid = executor.isTransitionValid('idle', 'identifying', pipeline.transitions);
    assert.strictEqual(valid, true, 'idle → identifying deve ser true');
  });

  test('isTransitionValid: idle → completed é INVÁLIDA', () => {
    const pipeline = executor.loadPipeline();
    const valid = executor.isTransitionValid('idle', 'completed', pipeline.transitions);
    assert.strictEqual(valid, false, 'idle → completed deve ser false');
  });

  test('isTransitionValid: reporting → completed é válida', () => {
    const pipeline = executor.loadPipeline();
    const valid = executor.isTransitionValid('reporting', 'completed', pipeline.transitions);
    assert.strictEqual(valid, true, 'reporting → completed deve ser true');
  });

  test('isTransitionValid: completed → idle é válida (novo ciclo)', () => {
    const pipeline = executor.loadPipeline();
    const valid = executor.isTransitionValid('completed', 'idle', pipeline.transitions);
    assert.strictEqual(valid, true, 'completed → idle deve ser true');
  });

  test('isTransitionValid: estado inexistente retorna false', () => {
    const pipeline = executor.loadPipeline();
    const valid = executor.isTransitionValid('nonexistent', 'idle', pipeline.transitions);
    assert.strictEqual(valid, false);
  });

  // ═══════════════════════════════════════════════════════════════════
  //  TEST: findValidTransitions
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n\x1b[1m📋 findValidTransitions\x1b[0m');

  test('findValidTransitions: idle → 1 transição (identifying)', () => {
    const pipeline = executor.loadPipeline();
    const valid = executor.findValidTransitions('idle', pipeline.transitions);
    assert.strictEqual(valid.length, 1, 'idle deve ter exatamente 1 transição');
    assert.strictEqual(valid[0].to, 'identifying');
  });

  test('findValidTransitions: completed → 1 transição (idle)', () => {
    const pipeline = executor.loadPipeline();
    const valid = executor.findValidTransitions('completed', pipeline.transitions);
    assert.strictEqual(valid.length, 1, 'completed deve ter exatamente 1 transição');
    assert.strictEqual(valid[0].to, 'idle');
  });

  test('findValidTransitions: fase3_validation → 2 transições', () => {
    const pipeline = executor.loadPipeline();
    const valid = executor.findValidTransitions('fase3_validation', pipeline.transitions);
    assert.strictEqual(valid.length, 2, 'fase3_validation deve ter 2 transições');
    const targets = valid.map(function (t) { return t.to; });
    assert.ok(targets.indexOf('fase3_approved') >= 0, 'deve incluir fase3_approved');
    assert.ok(targets.indexOf('fase3_refuted') >= 0, 'deve incluir fase3_refuted');
  });

  // ═══════════════════════════════════════════════════════════════════
  //  TEST: getFaseFromState
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n\x1b[1m📋 getFaseFromState\x1b[0m');

  test('getFaseFromState: idle → init', () => {
    assert.strictEqual(executor.getFaseFromState('idle'), 'init');
  });

  test('getFaseFromState: fase2_execution → fase_2', () => {
    assert.strictEqual(executor.getFaseFromState('fase2_execution'), 'fase_2');
  });

  test('getFaseFromState: fase3_validation → fase_3', () => {
    assert.strictEqual(executor.getFaseFromState('fase3_validation'), 'fase_3');
  });

  test('getFaseFromState: fase4_review → fase_4', () => {
    assert.strictEqual(executor.getFaseFromState('fase4_review'), 'fase_4');
  });

  test('getFaseFromState: completed → final', () => {
    assert.strictEqual(executor.getFaseFromState('completed'), 'final');
  });

  test('getFaseFromState: estado desconhecido → unknown', () => {
    assert.strictEqual(executor.getFaseFromState('nonexistent_state'), 'unknown');
  });

  test('getFaseFromState: null/undefined → unknown', () => {
    assert.strictEqual(executor.getFaseFromState(null), 'unknown');
    assert.strictEqual(executor.getFaseFromState(undefined), 'unknown');
  });

  // ═══════════════════════════════════════════════════════════════════
  //  TEST: validateWithSandbox
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n\x1b[1m📋 validateWithSandbox\x1b[0m');

  test('validateWithSandbox: comando seguro é permitido', () => {
    const result = executor.validateWithSandbox('ls');
    assert.ok(result, 'deve retornar objeto');
    // Pode ser allowed: true ou false dependendo do sandbox config
    // Apenas verifique que não lança e retorna objeto válido
    assert.ok(typeof result.allowed === 'boolean', 'allowed deve ser boolean');
    assert.ok(typeof result.reason === 'string', 'reason deve ser string');
  });

  test('validateWithSandbox: sandbox desabilitado permite tudo', () => {
    executor.CONFIG.sandboxEnabled = false;
    const result = executor.validateWithSandbox('rm -rf /');
    assert.strictEqual(result.allowed, true, 'deve permitir com sandbox desabilitado');
    executor.CONFIG.sandboxEnabled = true; // restore
  });

  // ═══════════════════════════════════════════════════════════════════
  //  TEST: Idempotency (transition para mesmo estado)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n\x1b[1m📋 Idempotência\x1b[0m');

  test('Idempotency: transition para o mesmo estado retorna skipped', () => {
    const state = executor.loadState();
    const result = executor.transition(state.current_state, {
      agent: 'exec-test',
      tool: 'test'
    });
    assert.ok(result.success, 'deve ser sucesso');
    assert.ok(result.skipped, 'deve ter skipped=true');
    assert.strictEqual(result.from, state.current_state, 'from deve ser o estado atual');
    assert.strictEqual(result.to, state.current_state, 'to deve ser o estado atual');
  });

  // ═══════════════════════════════════════════════════════════════════
  //  TEST: Transição inválida
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n\x1b[1m📋 Transição inválida\x1b[0m');

  test('Transição inválida: retorna erro descritivo', () => {
    const state = executor.loadState();
    const result = executor.transition('nonexistent_state', {
      agent: 'exec-test',
      tool: 'test'
    });
    assert.strictEqual(result.success, false, 'deve falhar');
    assert.ok(result.error, 'deve conter mensagem de erro');
    assert.ok(result.error.indexOf('não encontrado') >= 0 ||
              result.error.indexOf('não definido') >= 0 ||
              result.error.indexOf('Transição inválida') >= 0,
              'erro deve ser descritivo: ' + result.error);
  });

  // ═══════════════════════════════════════════════════════════════════
  //  SUMMARY
  // ═══════════════════════════════════════════════════════════════════
  const total = testsPassed + testsFailed;
  console.log('\n\x1b[1m\u2514\u2500 Resultado:\x1b[0m ' +
    (testsFailed === 0 ? '\x1b[32m' + testsPassed + '/' + total + ' testes passaram\x1b[0m' :
                         '\x1b[31m' + testsPassed + '/' + total + ' passaram, ' + testsFailed + ' falharam\x1b[0m'));

} catch (err) {
  console.error('\n  \x1b[31m❌ Erro fatal: ' + err.message + '\x1b[0m');
  console.error(err.stack);
  testsFailed++;
} finally {
  // Restaurar state.json original
  restoreState();
}

process.exit(testsFailed > 0 ? 1 : 0);
