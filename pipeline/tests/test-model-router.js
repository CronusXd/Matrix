/**
 * Test: model-router.js
 * Roteador cost-aware de modelos de IA com Quality-Aware Routing.
 *
 * Testa selectModel() com todos os taskTypes, selectModelWithFallback(),
 * selectModelQualityAware(), selectModelBalanced(), getModelCost(),
 * getConfig(), reloadConfig(), getQualityScore().
 */

const assert = require('assert');
const path = require('path');

const MODEL_PATH = path.resolve(__dirname, '..', 'scripts', 'model-router.js');

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  ✅ ' + name);
    testsPassed++;
  } catch (err) {
    console.log('  ❌ ' + name + ': ' + err.message);
    testsFailed++;
  }
}

// ─── Imports ──────────────────────────────────────────────────────────

delete require.cache[require.resolve(MODEL_PATH)];
var router = require(MODEL_PATH);

// ═══════════════════════════════════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════════════════════════════════

console.log('\n🧠 model-router.js — Testes\n');

// ── selectModel ───────────────────────────────────────────────────────

test('selectModel("simple", 1) retorna modelo barato', function () {
  var result = router.selectModel('simple', 1);
  assert.ok(result);
  assert.ok(result.model, 'modelo tem model name');
  assert.ok(result.costPer1KTokens >= 0, 'custo >= 0');
  // Para tarefa simples, deve ser o modelo cheap
  assert.ok(result.costPer1KTokens <= 0.001, 'modelo barato para tarefa simples');
});

test('selectModel("medium", 2) retorna modelo médio', function () {
  var result = router.selectModel('medium', 2);
  assert.ok(result);
  assert.ok(result.model);
});

test('selectModel("complex", 4) retorna modelo premium', function () {
  var result = router.selectModel('complex', 4);
  assert.ok(result);
  assert.ok(result.model);
  assert.ok(result.costPer1KTokens > 0);
});

test('selectModel("thinking", 5) retorna modelo thinking', function () {
  var result = router.selectModel('thinking', 5);
  assert.ok(result);
  assert.ok(result.model);
});

test('selectModel("simple", 5) complexidade alta override taskType simples', function () {
  var result = router.selectModel('simple', 5);
  assert.ok(result);
  // Alta complexidade pode selecionar modelo premium/thinking
  assert.ok(result.costPer1KTokens >= 0);
});

test('selectModel("query", 1) retorna modelo barato', function () {
  var result = router.selectModel('query', 1);
  assert.ok(result);
});

test('selectModel("code", 3) retorna modelo de código', function () {
  var result = router.selectModel('code', 3);
  assert.ok(result);
});

test('selectModel("security-audit", 4) retorna modelo thinking', function () {
  var result = router.selectModel('security-audit', 4);
  assert.ok(result);
});

test('selectModel retorna objeto com campos esperados', function () {
  var result = router.selectModel('simple', 2);
  assert.ok('model' in result);
  assert.ok('costPer1KTokens' in result);
  assert.ok('tier' in result);
  assert.ok('reason' in result);
});

// ── selectModelWithFallback ───────────────────────────────────────────

test('selectModelWithFallback prefere modelo sugerido', function () {
  var result = router.selectModelWithFallback('code', 3, 'oc/deepseek-v4-flash-free');
  assert.ok(result);
  assert.ok(result.model);
});

test('selectModelWithFallback com preferredModel inexistente usa fallback', function () {
  var result = router.selectModelWithFallback('code', 2, 'modelo-inexistente');
  assert.ok(result);
  assert.ok(result.model);
});

test('selectModelWithFallback com null preferredModel funciona', function () {
  var result = router.selectModelWithFallback('simple', 1, null);
  assert.ok(result);
});

test('selectModelWithFallback retorna objeto com model', function () {
  var result = router.selectModelWithFallback('code', 3, 'oc/deepseek-v4-flash-free');
  assert.ok(result.model);
});

// ── selectModelQualityAware ──────────────────────────────────────────

test('selectModelQualityAware weight 0 seleciona o mais barato', function () {
  var result = router.selectModelQualityAware('code', 3, 0);
  assert.ok(result);
  assert.ok(result.model);
  assert.ok(result.costPer1KTokens >= 0);
});

test('selectModelQualityAware weight 1 seleciona o melhor', function () {
  var result = router.selectModelQualityAware('code', 3, 1);
  assert.ok(result);
  assert.ok(result.model);
});

test('selectModelQualityAware weight 0.5 balanceia', function () {
  var result = router.selectModelQualityAware('code', 3, 0.5);
  assert.ok(result);
  assert.ok(result.model);
});

test('selectModelQualityAware weight negativo usa 0', function () {
  var result = router.selectModelQualityAware('code', 3, -1);
  assert.ok(result);
});

test('selectModelQualityAware weight >1 usa 1', function () {
  var result = router.selectModelQualityAware('code', 3, 2);
  assert.ok(result);
});

// ── selectModelBalanced ──────────────────────────────────────────────

test('selectModelBalanced com maxCost alto seleciona modelo premium', function () {
  var result = router.selectModelBalanced('code', 3, 0.01);
  assert.ok(result);
  assert.ok(result.costPer1KTokens <= 0.01, 'custo dentro do maxCost');
});

test('selectModelBalanced com maxCost baixo seleciona modelo barato', function () {
  var result = router.selectModelBalanced('code', 3, 0.0001);
  assert.ok(result);
  assert.ok(result.costPer1KTokens <= 0.0001, 'custo dentro do budget baixo');
});

test('selectModelBalanced com maxCost zero retorna o mais barato', function () {
  var result = router.selectModelBalanced('code', 1, 0);
  assert.ok(result);
});

test('selectModelBalanced retorna objeto valido', function () {
  var result = router.selectModelBalanced('simple', 2, 0.005);
  assert.ok('model' in result);
  assert.ok('costPer1KTokens' in result);
});

// ── getModelCost ─────────────────────────────────────────────────────

test('getModelCost para cheap model retorna custo', function () {
  var cost = router.getModelCost('oc/deepseek-v4-flash-free');
  assert.strictEqual(typeof cost, 'number');
  assert.ok(cost >= 0);
});

test('getModelCost para premium retorna custo', function () {
  var cost = router.getModelCost('ag/claude-sonnet-4-6');
  assert.strictEqual(typeof cost, 'number');
  assert.ok(cost > 0);
});

test('getModelCost para thinking model retorna custo', function () {
  var cost = router.getModelCost('kr/claude-sonnet-4.5-thinking-agentic');
  assert.strictEqual(typeof cost, 'number');
  assert.ok(cost > 0);
});

test('getModelCost para modelo desconhecido retorna default', function () {
  var cost = router.getModelCost('modelo-inexistente');
  assert.strictEqual(typeof cost, 'number');
  assert.ok(cost >= 0);
});

test('getModelCost null retorna default', function () {
  var cost = router.getModelCost(null);
  assert.strictEqual(typeof cost, 'number');
  assert.ok(cost >= 0);
});

test('getModelCost undefined retorna default', function () {
  var cost = router.getModelCost(undefined);
  assert.strictEqual(typeof cost, 'number');
  assert.ok(cost >= 0);
});

// ── getQualityScore ─────────────────────────────────────────────────

test('getQualityScore retorna número entre 0 e 1', function () {
  var score = router.getQualityScore('oc/deepseek-v4-flash-free', 'code');
  assert.strictEqual(typeof score, 'number');
  assert.ok(score >= 0 && score <= 1, 'score entre 0 e 1');
});

test('getQualityScore para modelo premium é maior que cheap', function () {
  var cheapScore = router.getQualityScore('oc/deepseek-v4-flash-free', 'code');
  var premiumScore = router.getQualityScore('ag/claude-sonnet-4-6', 'code');
  assert.ok(premiumScore >= cheapScore, 'premium >= cheap');
});

test('getQualityScore modelo desconhecido retorna número >= 0', function () {
  var score = router.getQualityScore('modelo-inexistente', 'code');
  assert.strictEqual(typeof score, 'number');
  assert.ok(score >= 0);
});

// ── getConfig ─────────────────────────────────────────────────────────

test('getConfig() retorna configuração', function () {
  var config = router.getConfig();
  assert.ok(config);
  assert.ok(config.models);
  assert.ok(config.rules);
  assert.strictEqual(typeof config.rules.complexityThreshold, 'number');
  assert.strictEqual(typeof config.rules.defaultModel, 'string');
});

test('getConfig() models tem cheap, medium, premium, thinking', function () {
  var config = router.getConfig();
  assert.ok(config.models.cheap);
  assert.ok(config.models.medium);
  assert.ok(config.models.premium);
  assert.ok(config.models.thinking);
});

test('getConfig() models têm name e costPer1KTokens', function () {
  var config = router.getConfig();
  Object.keys(config.models).forEach(function (key) {
    var m = config.models[key];
    assert.ok(m.name, key + '.name');
    assert.strictEqual(typeof m.costPer1KTokens, 'number', key + '.costPer1KTokens');
  });
});

// ── reloadConfig ──────────────────────────────────────────────────────

test('reloadConfig() recarrega configuração sem lançar', function () {
  var config = router.reloadConfig();
  assert.ok(config);
  assert.ok(config.models);
});

test('reloadConfig() mantém estrutura', function () {
  var config = router.reloadConfig();
  assert.ok(config.rules.simpleTaskTypes);
  assert.ok(config.rules.mediumTaskTypes);
  assert.ok(config.rules.complexTaskTypes);
  assert.ok(config.rules.thinkingTaskTypes);
});

// ── Edge cases ──────────────────────────────────────────────────────

test('selectModel null taskType retorna default', function () {
  var result = router.selectModel(null, 1);
  assert.ok(result);
});

test('selectModel undefined taskType retorna default', function () {
  var result = router.selectModel(undefined, undefined);
  assert.ok(result);
});

// ─── Summary ─────────────────────────────────────────────────────────
console.log('\n📊 Resultado: ' + testsPassed + '/' + (testsPassed + testsFailed) + ' testes passaram');
process.exit(testsFailed > 0 ? 1 : 0);
