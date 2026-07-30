#!/usr/bin/env node
/**
 * Test: pipeline-runtime.js — Pure functions extraídas
 *
 * Estratégia: COPIA funções PURAS do pipeline-runtime.js.
 * Não require() o módulo direto (inicia timers).
 *
 * Funções testadas:
 *   - loadState()          → testar com state mock
 *   - loadPipeline()       → testar com pipeline mock
 *   - getFaseFromState()   → testar mapeamento
 *   - runtimeLog()         → testar formatação de log
 *   - recommendNext()      → testar lógica de recomendação
 *   - getActionType()      → testar tipo de ação para cada estado
 *   - isTerminalState()    → testar detecção de estados finais
 *
 * Zero npm dependencies. assert nativo.
 */

'use strict';

const assert = require('assert');

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

// =====================================================================
//  FUNÇÕES EXTRAÍDAS (do pipeline-runtime.js)
// =====================================================================

/**
 * getFaseFromState — mapeia stateId → fase (inline).
 */
function getFaseFromState(stateId) {
  if (!stateId) return 'unknown';
  var map = {
    'idle': 'init',
    'identifying': 'init',
    'obligations_created': 'init',
    'obligations_verified': 'init',
    'fase1_analysis': 'fase_1',
    'todolist_created': 'fase_1',
    'context_building': 'fase_2',
    'fase2_execution': 'fase_2',
    'fase2_complete': 'fase_2',
    'fase3_validation': 'fase_3',
    'fase3_approved': 'fase_3',
    'fase3_refuted': 'fase_3',
    'fase4_review': 'fase_4',
    'fase4_approved': 'fase_4',
    'fase4_changes_needed': 'fase_4',
    'delivery': 'entrega',
    'reporting': 'entrega',
    'completed': 'final',
    'failed': 'final',
    'escalated': 'final'
  };
  return map[stateId] || 'unknown';
}

/**
 * ACTION_MAP — mapa de ações por estado (versão resumida para teste).
 */
var ACTION_MAP = {
  'idle': { type: 'noop', description: 'Aguardando demanda do usuário' },
  'identifying': { type: 'transition', target: 'obligations_created' },
  'obligations_created': { type: 'transition', target: 'obligations_verified' },
  'obligations_verified': { type: 'transition', target: 'fase1_analysis' },
  'fase1_analysis': { type: 'dispatch', agent: '@fable-method-agent', waitFor: ['todolist_created'] },
  'todolist_created': { type: 'transition', target: 'context_building' },
  'context_building': { type: 'exec', fn: 'runContextBuilder', next: 'fase2_execution' },
  'fase2_execution': { type: 'dispatch', agent: '@senior-developer', waitFor: ['fase2_complete'] },
  'fase2_complete': { type: 'transition', target: 'fase3_validation' },
  'fase3_validation': { type: 'dispatch', agent: '@fable-judge', waitFor: ['fase3_approved', 'fase3_refuted'] },
  'fase3_approved': { type: 'transition', target: 'fase4_review' },
  'fase3_refuted': { type: 'check_attempts', key: 'fase3_validation', max: 3, nextOk: 'fase2_execution', nextFail: 'escalated' },
  'fase4_review': { type: 'dispatch', agent: '@code-reviewer', waitFor: ['fase4_approved', 'fase4_changes_needed'] },
  'fase4_approved': { type: 'transition', target: 'delivery' },
  'fase4_changes_needed': { type: 'check_attempts', key: 'fase4_review', max: 3, nextOk: 'fase2_execution', nextFail: 'escalated' },
  'delivery': { type: 'exec', fn: 'runGitCommit', next: 'reporting' },
  'reporting': { type: 'transition', target: 'completed' },
  'completed': { type: 'terminal', description: '✅ Pipeline concluído!' },
  'failed': { type: 'terminal', description: '❌ Pipeline falhou!' },
  'escalated': { type: 'terminal', description: '⚠️  Máximo de tentativas excedido!' }
};

/**
 * getActionType — retorna tipo de ação para um estado.
 */
function getActionType(stateId) {
  var entry = ACTION_MAP[stateId];
  return entry ? entry.type : null;
}

/**
 * getActionForState — retorna entry completa da ACTION_MAP.
 */
function getActionForState(stateId) {
  return ACTION_MAP[stateId] || null;
}

function isTerminalState(stateId) {
  return getActionType(stateId) === 'terminal';
}

function isNoopState(stateId) {
  return getActionType(stateId) === 'noop';
}

function isDispatchState(stateId) {
  return getActionType(stateId) === 'dispatch';
}

function isTransitionState(stateId) {
  return getActionType(stateId) === 'transition';
}

function isExecState(stateId) {
  return getActionType(stateId) === 'exec';
}

/**
 * loadStatePure — versão pura de loadState.
 * Recebe raw JSON string, retorna objeto ou null.
 */
function loadStatePure(raw) {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/**
 * loadPipelinePure — versão pura de loadPipeline.
 * Extrai states e transitions de um objeto parsed.
 */
function loadPipelinePure(parsed) {
  if (!parsed) return { states: [], transitions: [] };
  return {
    states: parsed.states || [],
    transitions: parsed.transitions || []
  };
}

/**
 * recommendNext — recomenda próximo estado baseado no estado atual.
 * Função pura.
 */
function recommendNext(currentState, history) {
  history = history || [];
  var entry = ACTION_MAP[currentState];
  if (!entry) return { recommended: null, reason: 'Estado desconhecido: ' + currentState };

  switch (entry.type) {
    case 'noop':
      return { recommended: null, reason: 'Nenhuma ação necessária — ' + (entry.description || 'monitorando') };
    case 'transition':
      return { recommended: entry.target, reason: 'Transição automática: ' + currentState + ' → ' + entry.target };
    case 'dispatch':
      return { recommended: entry.waitFor, reason: 'Aguardando agente ' + entry.agent + ' completar' };
    case 'exec':
      return { recommended: entry.next, reason: 'Executando ' + (entry.fn || 'ação interna') };
    case 'check_attempts':
      return { recommended: null, reason: 'Verificando tentativas para ' + entry.key };
    case 'terminal':
      return { recommended: null, reason: 'Estado terminal — pipeline ' + currentState };
    default:
      return { recommended: null, reason: 'Tipo de ação desconhecido: ' + entry.type };
  }
}

/**
 * runtimeLog — formata mensagem de log (versão pura).
 */
function runtimeLog(level, message) {
  var prefix = '';
  switch (level) {
    case 'info': prefix = ' INFO '; break;
    case 'warn': prefix = ' WARN '; break;
    case 'error': prefix = ' ERROR'; break;
    default: prefix = ' ' + level.toUpperCase().substring(0, 5); break;
  }
  return '[' + new Date().toTimeString().substring(0, 8) + ']' + prefix + ' • ' + message;
}

// =====================================================================
//  getFaseFromState
// =====================================================================

console.log('\n\x1b[36m\x1b[1m📦 getFaseFromState\x1b[0m\n');

test('idle → init', () => {
  assert.strictEqual(getFaseFromState('idle'), 'init');
});

test('fase2_execution → fase_2', () => {
  assert.strictEqual(getFaseFromState('fase2_execution'), 'fase_2');
});

test('fase3_validation → fase_3', () => {
  assert.strictEqual(getFaseFromState('fase3_validation'), 'fase_3');
});

test('fase4_review → fase_4', () => {
  assert.strictEqual(getFaseFromState('fase4_review'), 'fase_4');
});

test('completed → final', () => {
  assert.strictEqual(getFaseFromState('completed'), 'final');
});

test('delivery → entrega', () => {
  assert.strictEqual(getFaseFromState('delivery'), 'entrega');
});

test('null → unknown', () => {
  assert.strictEqual(getFaseFromState(null), 'unknown');
});

test('undefined → unknown', () => {
  assert.strictEqual(getFaseFromState(undefined), 'unknown');
});

test('estado desconhecido → unknown', () => {
  assert.strictEqual(getFaseFromState('nonexistent'), 'unknown');
});

// =====================================================================
//  getActionType / getActionForState
// =====================================================================

console.log('\n\x1b[36m\x1b[1m📦 getActionType\x1b[0m\n');

test('idle → noop', () => {
  assert.strictEqual(getActionType('idle'), 'noop');
});

test('fase1_analysis → dispatch', () => {
  assert.strictEqual(getActionType('fase1_analysis'), 'dispatch');
});

test('fase2_complete → transition', () => {
  assert.strictEqual(getActionType('fase2_complete'), 'transition');
});

test('context_building → exec', () => {
  assert.strictEqual(getActionType('context_building'), 'exec');
});

test('fase3_refuted → check_attempts', () => {
  assert.strictEqual(getActionType('fase3_refuted'), 'check_attempts');
});

test('completed → terminal', () => {
  assert.strictEqual(getActionType('completed'), 'terminal');
});

test('estado inexistente → null', () => {
  assert.strictEqual(getActionType('nonexistent'), null);
});

test('getActionForState: estado existente → entry completa', () => {
  var entry = getActionForState('fase3_validation');
  assert.strictEqual(entry.type, 'dispatch');
  assert.strictEqual(entry.agent, '@fable-judge');
});

test('getActionForState: estado inexistente → null', () => {
  assert.strictEqual(getActionForState('foo_bar'), null);
});

// =====================================================================
//  isTerminalState / isNoopState / isDispatchState / isTransitionState / isExecState
// =====================================================================

console.log('\n\x1b[36m\x1b[1m📦 State type classifiers\x1b[0m\n');

test('isTerminalState: completed → true', () => {
  assert.strictEqual(isTerminalState('completed'), true);
});

test('isTerminalState: failed → true', () => {
  assert.strictEqual(isTerminalState('failed'), true);
});

test('isTerminalState: escalated → true', () => {
  assert.strictEqual(isTerminalState('escalated'), true);
});

test('isTerminalState: idle → false', () => {
  assert.strictEqual(isTerminalState('idle'), false);
});

test('isNoopState: idle → true', () => {
  assert.strictEqual(isNoopState('idle'), true);
});

test('isNoopState: fase2_execution → false', () => {
  assert.strictEqual(isNoopState('fase2_execution'), false);
});

test('isDispatchState: fase1_analysis → true', () => {
  assert.strictEqual(isDispatchState('fase1_analysis'), true);
});

test('isDispatchState: fase2_execution → true', () => {
  assert.strictEqual(isDispatchState('fase2_execution'), true);
});

test('isDispatchState: fase3_validation → true', () => {
  assert.strictEqual(isDispatchState('fase3_validation'), true);
});

test('isDispatchState: fase4_review → true', () => {
  assert.strictEqual(isDispatchState('fase4_review'), true);
});

test('isDispatchState: idle → false', () => {
  assert.strictEqual(isDispatchState('idle'), false);
});

test('isTransitionState: idle → false (noop)', () => {
  assert.strictEqual(isTransitionState('idle'), false);
});

test('isTransitionState: fase2_complete → true', () => {
  assert.strictEqual(isTransitionState('fase2_complete'), true);
});

test('isTransitionState: fase3_approved → true', () => {
  assert.strictEqual(isTransitionState('fase3_approved'), true);
});

test('isExecState: context_building → true', () => {
  assert.strictEqual(isExecState('context_building'), true);
});

test('isExecState: delivery → true', () => {
  assert.strictEqual(isExecState('delivery'), true);
});

test('isExecState: idle → false', () => {
  assert.strictEqual(isExecState('idle'), false);
});

test('classificadores para estado inexistente → false', () => {
  assert.strictEqual(isTerminalState('foo'), false);
  assert.strictEqual(isNoopState('foo'), false);
  assert.strictEqual(isDispatchState('foo'), false);
  assert.strictEqual(isTransitionState('foo'), false);
  assert.strictEqual(isExecState('foo'), false);
});

// =====================================================================
//  loadStatePure
// =====================================================================

console.log('\n\x1b[36m\x1b[1m📦 loadStatePure\x1b[0m\n');

test('JSON válido → objeto', () => {
  var state = loadStatePure('{"current_state": "idle"}');
  assert.strictEqual(state.current_state, 'idle');
});

test('null → null', () => {
  assert.strictEqual(loadStatePure(null), null);
});

test('JSON inválido → null', () => {
  assert.strictEqual(loadStatePure('{invalid}'), null);
});

test('JSON vazio → null', () => {
  assert.strictEqual(loadStatePure(''), null);
});

test('objeto complexo preservado', () => {
  var raw = JSON.stringify({ current_state: 'fase2_execution', history: [{ from: 'idle', to: 'fase1_analysis' }] });
  var state = loadStatePure(raw);
  assert.strictEqual(state.current_state, 'fase2_execution');
  assert.strictEqual(state.history.length, 1);
});

// =====================================================================
//  loadPipelinePure
// =====================================================================

console.log('\n\x1b[36m\x1b[1m📦 loadPipelinePure\x1b[0m\n');

test('objeto completo → states e transitions', () => {
  var p = loadPipelinePure({ states: ['idle'], transitions: [{ from: 'idle', to: 'identifying' }] });
  assert.strictEqual(p.states.length, 1);
  assert.strictEqual(p.transitions.length, 1);
});

test('objeto vazio → arrays vazios', () => {
  var p = loadPipelinePure({});
  assert.deepStrictEqual(p, { states: [], transitions: [] });
});

test('null → arrays vazios', () => {
  var p = loadPipelinePure(null);
  assert.deepStrictEqual(p, { states: [], transitions: [] });
});

test('sem transitions → array vazio', () => {
  var p = loadPipelinePure({ states: ['idle'] });
  assert.strictEqual(p.states.length, 1);
  assert.strictEqual(p.transitions.length, 0);
});

// =====================================================================
//  recommendNext
// =====================================================================

console.log('\n\x1b[36m\x1b[1m📦 recommendNext\x1b[0m\n');

test('recommendNext: noop → null com reason', () => {
  var rec = recommendNext('idle');
  assert.strictEqual(rec.recommended, null);
  assert.ok(rec.reason.indexOf('Nenhuma ação') >= 0);
});

test('recommendNext: transition → target', () => {
  var rec = recommendNext('identifying');
  assert.strictEqual(rec.recommended, 'obligations_created');
});

test('recommendNext: dispatch → waitFor array', () => {
  var rec = recommendNext('fase1_analysis');
  assert.deepStrictEqual(rec.recommended, ['todolist_created']);
});

test('recommendNext: exec → next state', () => {
  var rec = recommendNext('context_building');
  assert.strictEqual(rec.recommended, 'fase2_execution');
});

test('recommendNext: check_attempts → null', () => {
  var rec = recommendNext('fase3_refuted');
  assert.strictEqual(rec.recommended, null);
  assert.ok(rec.reason.indexOf('Verificando tentativas') >= 0);
});

test('recommendNext: terminal → null', () => {
  var rec = recommendNext('completed');
  assert.strictEqual(rec.recommended, null);
});

test('recommendNext: unknown state → null', () => {
  var rec = recommendNext('nonexistent');
  assert.strictEqual(rec.recommended, null);
  assert.ok(rec.reason.indexOf('Estado desconhecido') >= 0);
});

test('recommendNext: completed → reason indica terminal', () => {
  var rec = recommendNext('completed');
  assert.ok(rec.reason.indexOf('terminal') >= 0 || rec.reason.indexOf('completed') >= 0);
});

test('recommendNext: failed → reason indica terminal', () => {
  var rec = recommendNext('failed');
  assert.ok(rec.reason.indexOf('terminal') >= 0 || rec.reason.indexOf('failed') >= 0);
});

// =====================================================================
//  runtimeLog (pure)
// =====================================================================

console.log('\n\x1b[36m\x1b[1m📦 runtimeLog\x1b[0m\n');

test('runtimeLog: formato info', () => {
  var msg = runtimeLog('info', 'test message');
  assert.ok(msg.indexOf('INFO') >= 0);
  assert.ok(msg.indexOf('test message') >= 0);
  assert.ok(msg.indexOf('[') === 0); // começa com timestamp
});

test('runtimeLog: formato warn', () => {
  var msg = runtimeLog('warn', 'warning message');
  assert.ok(msg.indexOf('WARN') >= 0);
  assert.ok(msg.indexOf('warning message') >= 0);
});

test('runtimeLog: formato error', () => {
  var msg = runtimeLog('error', 'error message');
  assert.ok(msg.indexOf('ERROR') >= 0);
  assert.ok(msg.indexOf('error message') >= 0);
});

test('runtimeLog: nível desconhecido', () => {
  var msg = runtimeLog('debug', 'debug message');
  assert.ok(msg.indexOf('DEBUG') >= 0 || msg.indexOf('debug message') >= 0);
  assert.ok(msg.indexOf('debug message') >= 0);
});

// =====================================================================
//  SUMMARY
// =====================================================================

const total = testsPassed + testsFailed;
console.log('\n\x1b[1m\u2514\u2500 Resultado:\x1b[0m ' +
  (testsFailed === 0 ? '\x1b[32m' + testsPassed + '/' + total + ' testes passaram\x1b[0m' :
                       '\x1b[31m' + testsPassed + '/' + total + ' passaram, ' + testsFailed + ' falharam\x1b[0m'));

process.exit(testsFailed > 0 ? 1 : 0);
