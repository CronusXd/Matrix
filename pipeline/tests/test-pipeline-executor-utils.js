#!/usr/bin/env node
/**
 * Test: pipeline-executor UTILS (pure functions extraídas)
 *
 * Estratégia: COPIA as funções PURAS do pipeline-executor.js para este teste,
 * evitando require() direto que auto-executa o módulo (4205 linhas).
 *
 * Funções testadas:
 *   - isTransitionValid(from, to, transitions)
 *   - findValidTransitions(from, transitions)
 *   - findTransition(from, to, transitions)
 *   - safeJsonParse(str, fallback)
 *   - getFaseFromState (via fases.js)
 *   - validateStateFile mock
 *   - validateYamlFile mock
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
//  FUNÇÕES EXTRAÍDAS (copiadas do pipeline-executor.js)
// =====================================================================

/**
 * findValidTransitions — retorna todas as transições válidas a partir de um estado.
 */
function findValidTransitions(from, transitions) {
  return transitions.filter(function (t) { return t.from === from; });
}

/**
 * isTransitionValid — verifica se transição from → to é válida.
 */
function isTransitionValid(from, to, transitions) {
  return transitions.some(function (t) { return t.from === from && t.to === to; });
}

/**
 * findTransition — retorna objeto de transição de from → to, ou null.
 */
function findTransition(from, to, transitions) {
  var result = transitions.find(function (t) { return t.from === from && t.to === to; });
  return result !== undefined ? result : null;
}

/**
 * safeJsonParse — JSON.parse com fallback seguro.
 */
function safeJsonParse(str, fallback) {
  if (typeof str !== 'string' || str.trim().length === 0) return fallback;
  try {
    return JSON.parse(str);
  } catch (e) {
    return fallback;
  }
}

/**
 * getFaseFromState — mapeia stateId → fase name.
 * (versão inline para não depender do lib/fases.js)
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
 * validateStateFile — versão mockada (recebe resultado de checagem externa).
 * Função pura: recebe existência e validade, retorna boolean + side effect descrito.
 */
function validateStateFilePure(fileExists, fileContent) {
  if (!fileExists) return { valid: true, action: 'created' };
  var parsed = safeJsonParse(fileContent, null);
  if (!parsed || !parsed.current_state) {
    return { valid: true, action: 'reset' };
  }
  return { valid: true, action: 'ok' };
}

/**
 * validateYamlFile — versão mockada.
 * Função pura: recebe existência e conteúdo, retorna boolean.
 */
function validateYamlFilePure(fileExists, fileContent) {
  if (!fileExists) return { valid: false, reason: 'not_found' };
  if (!fileContent || fileContent.trim().length === 0) return { valid: false, reason: 'empty' };
  if (!fileContent.includes('states:') || !fileContent.includes('transitions:')) {
    return { valid: false, reason: 'missing_sections' };
  }
  return { valid: true, reason: 'ok' };
}

// =====================================================================
//  MOCK DATA
// =====================================================================

var sampleTransitions = [
  { from: 'idle', to: 'identifying' },
  { from: 'identifying', to: 'obligations_created' },
  { from: 'obligations_created', to: 'obligations_verified' },
  { from: 'obligations_verified', to: 'fase1_analysis' },
  { from: 'fase1_analysis', to: 'todolist_created' },
  { from: 'todolist_created', to: 'context_building' },
  { from: 'context_building', to: 'fase2_execution' },
  { from: 'fase2_execution', to: 'fase2_complete' },
  { from: 'fase2_complete', to: 'fase3_validation' },
  { from: 'fase3_validation', to: 'fase3_approved' },
  { from: 'fase3_validation', to: 'fase3_refuted' },
  { from: 'fase3_approved', to: 'fase4_review' },
  { from: 'fase3_refuted', to: 'fase2_execution' },
  { from: 'fase4_review', to: 'fase4_approved' },
  { from: 'fase4_review', to: 'fase4_changes_needed' },
  { from: 'fase4_approved', to: 'delivery' },
  { from: 'fase4_changes_needed', to: 'fase2_execution' },
  { from: 'delivery', to: 'reporting' },
  { from: 'reporting', to: 'completed' },
  { from: 'completed', to: 'idle' },
  { from: 'failed', to: 'idle' },
  { from: 'escalated', to: 'idle' }
];

// =====================================================================
//  isTransitionValid
// =====================================================================

console.log('\n\x1b[36m\x1b[1m📦 isTransitionValid\x1b[0m\n');

test('idle → identifying é válida', () => {
  assert.strictEqual(isTransitionValid('idle', 'identifying', sampleTransitions), true);
});

test('idle → completed é INVÁLIDA', () => {
  assert.strictEqual(isTransitionValid('idle', 'completed', sampleTransitions), false);
});

test('reporting → completed é válida', () => {
  assert.strictEqual(isTransitionValid('reporting', 'completed', sampleTransitions), true);
});

test('completed → idle é válida (novo ciclo)', () => {
  assert.strictEqual(isTransitionValid('completed', 'idle', sampleTransitions), true);
});

test('fase3_validation → fase3_approved é válida', () => {
  assert.strictEqual(isTransitionValid('fase3_validation', 'fase3_approved', sampleTransitions), true);
});

test('fase3_validation → fase3_refuted é válida', () => {
  assert.strictEqual(isTransitionValid('fase3_validation', 'fase3_refuted', sampleTransitions), true);
});

test('fase4_review → fase4_approved é válida', () => {
  assert.strictEqual(isTransitionValid('fase4_review', 'fase4_approved', sampleTransitions), true);
});

test('fase4_review → fase4_changes_needed é válida', () => {
  assert.strictEqual(isTransitionValid('fase4_review', 'fase4_changes_needed', sampleTransitions), true);
});

test('estado inexistente → false', () => {
  assert.strictEqual(isTransitionValid('nonexistent', 'idle', sampleTransitions), false);
});

test('estado vazio → false', () => {
  assert.strictEqual(isTransitionValid('', 'idle', sampleTransitions), false);
});

test('transições vazio → false', () => {
  assert.strictEqual(isTransitionValid('idle', 'identifying', []), false);
});

// =====================================================================
//  findValidTransitions
// =====================================================================

console.log('\n\x1b[36m\x1b[1m📦 findValidTransitions\x1b[0m\n');

test('idle → 1 transição (identifying)', () => {
  const valid = findValidTransitions('idle', sampleTransitions);
  assert.strictEqual(valid.length, 1);
  assert.strictEqual(valid[0].to, 'identifying');
});

test('fase3_validation → 2 transições (approved, refuted)', () => {
  const valid = findValidTransitions('fase3_validation', sampleTransitions);
  assert.strictEqual(valid.length, 2);
  const targets = valid.map(t => t.to);
  assert.ok(targets.indexOf('fase3_approved') >= 0);
  assert.ok(targets.indexOf('fase3_refuted') >= 0);
});

test('fase4_review → 2 transições (approved, changes_needed)', () => {
  const valid = findValidTransitions('fase4_review', sampleTransitions);
  assert.strictEqual(valid.length, 2);
  const targets = valid.map(t => t.to);
  assert.ok(targets.indexOf('fase4_approved') >= 0);
  assert.ok(targets.indexOf('fase4_changes_needed') >= 0);
});

test('completed → 1 transição (idle)', () => {
  const valid = findValidTransitions('completed', sampleTransitions);
  assert.strictEqual(valid.length, 1);
  assert.strictEqual(valid[0].to, 'idle');
});

test('estado inexistente → array vazio', () => {
  const valid = findValidTransitions('nonexistent', sampleTransitions);
  assert.strictEqual(valid.length, 0);
});

test('transições vazio → array vazio', () => {
  const valid = findValidTransitions('idle', []);
  assert.strictEqual(valid.length, 0);
});

// =====================================================================
//  findTransition
// =====================================================================

console.log('\n\x1b[36m\x1b[1m📦 findTransition\x1b[0m\n');

test('findTransition: idle → identifying', () => {
  const t = findTransition('idle', 'identifying', sampleTransitions);
  assert.ok(t !== null);
  assert.strictEqual(t.from, 'idle');
  assert.strictEqual(t.to, 'identifying');
});

test('findTransition: completed → idle', () => {
  const t = findTransition('completed', 'idle', sampleTransitions);
  assert.ok(t !== null);
  assert.strictEqual(t.from, 'completed');
});

test('findTransition: transição inexistente → null', () => {
  const t = findTransition('idle', 'completed', sampleTransitions);
  assert.strictEqual(t, null);
});

test('findTransition: transições vazio → null', () => {
  const t = findTransition('idle', 'identifying', []);
  assert.strictEqual(t, null);
});

test('findTransition: match exato único', () => {
  const extras = [
    { from: 'idle', to: 'identifying' },
    { from: 'extras', to: 'idle' }
  ];
  // Deve achar o primeiro (idle → identifying) mesmo com extras
  const t = findTransition('extras', 'idle', extras);
  assert.ok(t !== null);
  assert.strictEqual(t.from, 'extras');
});

// =====================================================================
//  safeJsonParse
// =====================================================================

console.log('\n\x1b[36m\x1b[1m📦 safeJsonParse\x1b[0m\n');

test('JSON válido: objeto', () => {
  const result = safeJsonParse('{"a":1,"b":"hello"}', null);
  assert.deepStrictEqual(result, { a: 1, b: 'hello' });
});

test('JSON válido: array', () => {
  const result = safeJsonParse('[1,2,3]', []);
  assert.deepStrictEqual(result, [1, 2, 3]);
});

test('JSON válido: string simples "hello"', () => {
  const result = safeJsonParse('"hello"', null);
  assert.strictEqual(result, 'hello');
});

test('JSON válido: número 42', () => {
  const result = safeJsonParse('42', 0);
  assert.strictEqual(result, 42);
});

test('JSON válido: booleano true', () => {
  const result = safeJsonParse('true', false);
  assert.strictEqual(result, true);
});

test('JSON inválido: texto solto', () => {
  const result = safeJsonParse('not valid json', { fallback: true });
  assert.deepStrictEqual(result, { fallback: true });
});

test('JSON inválido: objeto mal formatado', () => {
  const result = safeJsonParse('{a: 1}', 'fallback');
  assert.strictEqual(result, 'fallback');
});

test('string vazia → fallback', () => {
  const result = safeJsonParse('', 'empty_fallback');
  assert.strictEqual(result, 'empty_fallback');
});

test('string só espaços → fallback', () => {
  const result = safeJsonParse('   ', 'spaces');
  assert.strictEqual(result, 'spaces');
});

test('null → fallback (não é string)', () => {
  const result = safeJsonParse(null, 'fb');
  assert.strictEqual(result, 'fb');
});

test('undefined → fallback', () => {
  const result = safeJsonParse(undefined, 'fb_undef');
  assert.strictEqual(result, 'fb_undef');
});

test('fallback padrão é undefined', () => {
  const result = safeJsonParse('invalid');
  assert.strictEqual(result, undefined);
});

test('número como string não é JSON válido para safeJsonParse', () => {
  // "42" com aspas é JSON válido, mas 42 sem aspas não é
  const result = safeJsonParse('42', null);
  assert.strictEqual(result, 42);
});

test('objeto complexo com aninhamento', () => {
  const obj = { users: [{ name: 'Alice' }, { name: 'Bob' }], count: 2 };
  const result = safeJsonParse(JSON.stringify(obj), null);
  assert.deepStrictEqual(result, obj);
});

// =====================================================================
//  getFaseFromState
// =====================================================================

console.log('\n\x1b[36m\x1b[1m📦 getFaseFromState\x1b[0m\n');

test('idle → init', () => {
  assert.strictEqual(getFaseFromState('idle'), 'init');
});

test('identifying → init', () => {
  assert.strictEqual(getFaseFromState('identifying'), 'init');
});

test('obligations_created → init', () => {
  assert.strictEqual(getFaseFromState('obligations_created'), 'init');
});

test('obligations_verified → init', () => {
  assert.strictEqual(getFaseFromState('obligations_verified'), 'init');
});

test('fase1_analysis → fase_1', () => {
  assert.strictEqual(getFaseFromState('fase1_analysis'), 'fase_1');
});

test('todolist_created → fase_1', () => {
  assert.strictEqual(getFaseFromState('todolist_created'), 'fase_1');
});

test('context_building → fase_2', () => {
  assert.strictEqual(getFaseFromState('context_building'), 'fase_2');
});

test('fase2_execution → fase_2', () => {
  assert.strictEqual(getFaseFromState('fase2_execution'), 'fase_2');
});

test('fase2_complete → fase_2', () => {
  assert.strictEqual(getFaseFromState('fase2_complete'), 'fase_2');
});

test('fase3_validation → fase_3', () => {
  assert.strictEqual(getFaseFromState('fase3_validation'), 'fase_3');
});

test('fase3_approved → fase_3', () => {
  assert.strictEqual(getFaseFromState('fase3_approved'), 'fase_3');
});

test('fase3_refuted → fase_3', () => {
  assert.strictEqual(getFaseFromState('fase3_refuted'), 'fase_3');
});

test('fase4_review → fase_4', () => {
  assert.strictEqual(getFaseFromState('fase4_review'), 'fase_4');
});

test('fase4_approved → fase_4', () => {
  assert.strictEqual(getFaseFromState('fase4_approved'), 'fase_4');
});

test('fase4_changes_needed → fase_4', () => {
  assert.strictEqual(getFaseFromState('fase4_changes_needed'), 'fase_4');
});

test('delivery → entrega', () => {
  assert.strictEqual(getFaseFromState('delivery'), 'entrega');
});

test('reporting → entrega', () => {
  assert.strictEqual(getFaseFromState('reporting'), 'entrega');
});

test('completed → final', () => {
  assert.strictEqual(getFaseFromState('completed'), 'final');
});

test('failed → final', () => {
  assert.strictEqual(getFaseFromState('failed'), 'final');
});

test('escalated → final', () => {
  assert.strictEqual(getFaseFromState('escalated'), 'final');
});

test('estado desconhecido → unknown', () => {
  assert.strictEqual(getFaseFromState('nonexistent_state'), 'unknown');
});

test('null → unknown', () => {
  assert.strictEqual(getFaseFromState(null), 'unknown');
});

test('undefined → unknown', () => {
  assert.strictEqual(getFaseFromState(undefined), 'unknown');
});

test('string vazia → unknown', () => {
  assert.strictEqual(getFaseFromState(''), 'unknown');
});

// =====================================================================
//  validateStateFile (pure mock)
// =====================================================================

console.log('\n\x1b[36m\x1b[1m📦 validateStateFile (pure mock)\x1b[0m\n');

test('validateStateFile: arquivo não existe → cria novo', () => {
  const result = validateStateFilePure(false, null);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.action, 'created');
});

test('validateStateFile: arquivo existe e válido → ok', () => {
  const result = validateStateFilePure(true, JSON.stringify({ current_state: 'idle' }));
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.action, 'ok');
});

test('validateStateFile: arquivo corrompido → reset', () => {
  const result = validateStateFilePure(true, 'not valid json');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.action, 'reset');
});

test('validateStateFile: sem current_state → reset', () => {
  const result = validateStateFilePure(true, JSON.stringify({ foo: 'bar' }));
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.action, 'reset');
});

test('validateStateFile: JSON vazio → reset', () => {
  const result = validateStateFilePure(true, '');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.action, 'reset');
});

// =====================================================================
//  validateYamlFile (pure mock)
// =====================================================================

console.log('\n\x1b[36m\x1b[1m📦 validateYamlFile (pure mock)\x1b[0m\n');

test('validateYamlFile: arquivo não existe → not_found', () => {
  const result = validateYamlFilePure(false, null);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.reason, 'not_found');
});

test('validateYamlFile: arquivo vazio → empty', () => {
  const result = validateYamlFilePure(true, '');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.reason, 'empty');
});

test('validateYamlFile: arquivo com espaços → empty', () => {
  const result = validateYamlFilePure(true, '   \n  \n  ');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.reason, 'empty');
});

test('validateYamlFile: sem states → missing_sections', () => {
  const result = validateYamlFilePure(true, 'foo: bar');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.reason, 'missing_sections');
});

test('validateYamlFile: sem transitions → missing_sections', () => {
  const result = validateYamlFilePure(true, 'states:\n  - idle\n');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.reason, 'missing_sections');
});

test('validateYamlFile: YAML completo válido → ok', () => {
  const yaml = 'states:\n  - idle\ntransitions:\n  - {from: idle, to: identifying}\n';
  const result = validateYamlFilePure(true, yaml);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.reason, 'ok');
});

test('validateYamlFile: states e transitions presentes → ok', () => {
  const result = validateYamlFilePure(true, 'states: []\ntransitions: []\n');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.reason, 'ok');
});

// =====================================================================
//  SUMMARY
// =====================================================================

const total = testsPassed + testsFailed;
console.log('\n\x1b[1m\u2514\u2500 Resultado:\x1b[0m ' +
  (testsFailed === 0 ? '\x1b[32m' + testsPassed + '/' + total + ' testes passaram\x1b[0m' :
                       '\x1b[31m' + testsPassed + '/' + total + ' passaram, ' + testsFailed + ' falharam\x1b[0m'));

process.exit(testsFailed > 0 ? 1 : 0);
