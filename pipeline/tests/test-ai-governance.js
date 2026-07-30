/**
 * Test: ai-governance.js
 * Políticas de governança para uso de IA no pipeline.
 * Testa loadPolicies(), checkTaskAllowed().
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const GOV_PATH = path.resolve(__dirname, '..', 'scripts', 'ai-governance.js');
const GOV_FILE = path.resolve(__dirname, '..', 'ai-governance.json');

let testsPassed = 0;
let testsFailed = 0;
let backupContent = null;

function test(name, fn) {
  try { fn(); console.log('  ✅ ' + name); testsPassed++; }
  catch (err) { console.log('  ❌ ' + name + ': ' + err.message); testsFailed++; }
}

// Backup governance file
if (fs.existsSync(GOV_FILE)) {
  backupContent = fs.readFileSync(GOV_FILE, 'utf8');
}

delete require.cache[require.resolve(GOV_PATH)];
const gov = require(GOV_PATH);

console.log('\n📋 ai-governance.js — Testes\n');

// ── loadPolicies ───────────────────────────────────────────────────────
test('loadPolicies() retorna objeto com policies e rules', function() {
  var p = gov.loadPolicies();
  assert.ok(p, 'loadPolicies retornou resultado');
  assert.ok(Array.isArray(p.policies), 'policies é array');
  assert.ok(p.rules, 'rules existe');
  assert.ok(typeof p.rules.maxDailyCost === 'number', 'maxDailyCost é number');
});

test('loadPolicies() contém políticas padrão', function() {
  var p = gov.loadPolicies();
  assert.ok(p.policies.length > 0, 'pelo menos 1 política');
  var codePolicy = p.policies.find(function(po) { return po.taskType === 'code'; });
  assert.ok(codePolicy, 'política para "code" existe');
  assert.ok(Array.isArray(codePolicy.allowedModels), 'allowedModels é array');
  assert.ok(codePolicy.allowedModels.length > 0, 'allowedModels não vazio');
});

test('loadPolicies() regras padrão têm limites', function() {
  var p = gov.loadPolicies();
  assert.ok(p.rules.maxDailyCost > 0, 'maxDailyCost > 0');
  assert.ok(p.rules.maxMonthlyCost > 0, 'maxMonthlyCost > 0');
  assert.ok(Array.isArray(p.rules.requireAuditForTypes), 'requireAuditForTypes é array');
  assert.ok(p.rules.requireAuditForTypes.length > 0, 'requireAuditForTypes não vazio');
  assert.ok(Array.isArray(p.rules.blockedModels), 'blockedModels é array');
});

test('loadPolicies() todos os tipos de política têm campos obrigatórios', function() {
  var p = gov.loadPolicies();
  p.policies.forEach(function(po, idx) {
    assert.ok(po.taskType, 'policy[' + idx + '].taskType');
    assert.ok(Array.isArray(po.allowedModels), 'policy[' + idx + '].allowedModels é array');
    assert.ok(typeof po.maxCostPerCall === 'number', 'policy[' + idx + '].maxCostPerCall é number');
  });
});

test('loadPolicies() retorna cópia independente (deep clone)', function() {
  var p1 = gov.loadPolicies();
  var p2 = gov.loadPolicies();
  p2.policies[0].taskType = 'modified';
  assert.notStrictEqual(p1.policies[0].taskType, 'modified', 'alterar cópia não afeta original');
});

// ── checkTaskAllowed ───────────────────────────────────────────────────
test('checkTaskAllowed("code", "ag/claude-sonnet-4-6") retorna allowed true', function() {
  var r = gov.checkTaskAllowed('code', 'ag/claude-sonnet-4-6');
  assert.ok(r.allowed, 'deveria ser permitido');
  assert.ok(r.reason, 'tem reason');
  assert.ok(r.maxCost !== undefined, 'tem maxCost');
});

test('checkTaskAllowed("code", "invalid-model") retorna allowed false', function() {
  var r = gov.checkTaskAllowed('code', 'invalid-model');
  assert.strictEqual(r.allowed, false, 'não deveria ser permitido');
  assert.ok(r.reason, 'tem reason com explicação');
  assert.ok(r.reason.indexOf('invalid-model') > -1, 'reason menciona o modelo');
});

test('checkTaskAllowed("unknown-task", "any-model") retorna allowed true (sem política)', function() {
  var r = gov.checkTaskAllowed('unknown-task', 'any-model');
  assert.strictEqual(r.allowed, true, 'sem política definida = permitido');
  assert.ok(r.reason.indexOf('Nenhuma política') > -1, 'reason explica que não há política');
});

test('checkTaskAllowed("security-audit", "kr/claude-sonnet-4.5-thinking-agentic") retorna allowed true', function() {
  var r = gov.checkTaskAllowed('security-audit', 'kr/claude-sonnet-4.5-thinking-agentic');
  assert.ok(r.allowed);
  assert.ok(r.maxCost > 0);
});

test('checkTaskAllowed("analysis", "gc/gemini-2.5-flash") retorna allowed true', function() {
  var r = gov.checkTaskAllowed('analysis', 'gc/gemini-2.5-flash');
  assert.ok(r.allowed, 'gemini permitido para analysis');
});

test('checkTaskAllowed("query", "oc/deepseek-v4-flash-free") retorna allowed true', function() {
  var r = gov.checkTaskAllowed('query', 'oc/deepseek-v4-flash-free');
  assert.ok(r.allowed, 'deepseek free permitido para query');
});

test('checkTaskAllowed("query", "kr/claude-sonnet-4.5-thinking-agentic") retorna allowed false (muito caro)', function() {
  var r = gov.checkTaskAllowed('query', 'kr/claude-sonnet-4.5-thinking-agentic');
  assert.strictEqual(r.allowed, false, 'modelo caro não permitido para query simples');
});

test('checkTaskAllowed("architecture-review", "kr/claude-sonnet-4.5-thinking-agentic") retorna allowed true', function() {
  var r = gov.checkTaskAllowed('architecture-review', 'kr/claude-sonnet-4.5-thinking-agentic');
  assert.ok(r.allowed);
});

test('checkTaskAllowed com taskType vazio retorna true (nenhuma política)', function() {
  var r = gov.checkTaskAllowed('', 'any-model');
  assert.strictEqual(r.allowed, true, 'taskType vazio = sem política = permitido');
});

test('checkTaskAllowed com model vazio retorna !allowed (não na lista)', function() {
  var r = gov.checkTaskAllowed('code', '');
  assert.strictEqual(r.allowed, false, 'model vazio não está na lista');
});

// ─── Summary ───────────────────────────────────────────────────────────
console.log('\n📊 Resultado: ' + testsPassed + '/' + (testsPassed + testsFailed) + ' testes passaram\n');

// Restore governance file
if (backupContent !== null) {
  fs.writeFileSync(GOV_FILE, backupContent);
} else if (fs.existsSync(GOV_FILE)) {
  try { fs.unlinkSync(GOV_FILE); } catch(e) {}
}

process.exit(testsFailed > 0 ? 1 : 0);
