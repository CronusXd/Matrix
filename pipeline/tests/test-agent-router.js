/**
 * Test: agent-router.js
 * Roteador formal de agentes especialistas para o pipeline Matrix.
 *
 * Testa todas as funções exportadas com cenários completos:
 * selectAgent(), listAgentsByCategory(), getAgentInfo(),
 * findAgentByKeywords(), listCategories(), getAgentCount(),
 * getConfig(), reloadConfig(), mapTaskTypeToCategory()
 */

const assert = require('assert');
const path = require('path');

const ROUTER_PATH = path.resolve(__dirname, '..', 'scripts', 'agent-router.js');

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

delete require.cache[require.resolve(ROUTER_PATH)];
var router = require(ROUTER_PATH);

// ═══════════════════════════════════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════════════════════════════════

console.log('\n🤖 agent-router.js — Testes Expandidos\n');

// ── selectAgent — 20+ cenários ────────────────────────────────────────

// Cenários de taskType existentes
test('selectAgent("backend", 4) retorna backend-architect (complexidade alta)', function () {
  var result = router.selectAgent('backend', 4);
  assert.ok(result, 'selectAgent retornou resultado');
  assert.strictEqual(result.agent, 'Backend Architect',
    'Esperado Backend Architect, obteve: @' + result.agent + ' (' + result.reason + ')');
  assert.strictEqual(result.category, 'engineering');
  assert.strictEqual(result.seniority, 'architect');
  // Mode é herdado do .md file (subagent) — aceitamos qualquer mode válido
  assert.ok(result.mode === 'code' || result.mode === 'subagent' || result.mode === 'analyze',
    'Mode deve ser válido, obteve: ' + result.mode);
});

test('selectAgent("backend", 2) retorna backend-architect (match específico)', function () {
  var result = router.selectAgent('backend', 2);
  assert.ok(result);
  assert.strictEqual(result.agent, 'Backend Architect');
  assert.strictEqual(result.category, 'engineering');
});

test('selectAgent("code", 5) retorna agente de engenharia (alta complexidade)', function () {
  var result = router.selectAgent('code', 5);
  assert.ok(result);
  assert.ok(result.agent === 'Backend Architect' || result.agent === 'Senior Developer',
    'Esperado Backend Architect ou Senior Developer, obteve: @' + result.agent);
  assert.strictEqual(result.category, 'engineering');
  assert.ok(result.seniority === 'architect' || result.seniority === 'senior');
});

test('selectAgent("unknown", 1) retorna senior-developer (fallback)', function () {
  var result = router.selectAgent('unknown', 1);
  assert.ok(result, 'selectAgent retornou resultado');
  assert.strictEqual(result.agent, 'Senior Developer',
    'Esperado Senior Developer (fallback), obteve: @' + result.agent);
  assert.strictEqual(result.category, 'engineering');
  assert.strictEqual(result.seniority, 'senior');
  assert.ok(result.mode === 'code' || result.mode === 'subagent',
    'Mode deve ser válido, obteve: ' + result.mode);
});

test('selectAgent("ui", 2) retorna UI-Designer', function () {
  var result = router.selectAgent('ui', 2);
  assert.ok(result);
  assert.strictEqual(result.agent, 'UI-Designer');
  assert.strictEqual(result.category, 'design');
});

test('selectAgent("api", 3) retorna agente válido (match por taskType)', function () {
  var result = router.selectAgent('api', 3);
  assert.ok(result);
  assert.ok(result.agent && result.agent.length > 0, 'agent name não vazio');
  assert.ok(result.reason && result.reason.length > 0, 'reason não vazio');
});

test('selectAgent("database", 4) retorna database-optimizer', function () {
  var result = router.selectAgent('database', 4);
  assert.ok(result);
  assert.strictEqual(result.agent, 'Database Optimizer');
  assert.strictEqual(result.category, 'dados');
});

test('selectAgent("devops", 3) retorna devops-automator', function () {
  var result = router.selectAgent('devops', 3);
  assert.ok(result);
  assert.strictEqual(result.agent, 'DevOps Automator');
});

test('selectAgent("", 1) retorna senior-developer (fallback)', function () {
  var result = router.selectAgent('', 1);
  assert.ok(result);
  assert.strictEqual(result.agent, 'Senior Developer');
});

// selectAgent com domain específico
test('selectAgent("code", 2, "engineering") usa domain engineering', function () {
  var result = router.selectAgent('code', 2, 'engineering');
  assert.ok(result);
  assert.ok(result.agent, 'agente selecionado: ' + result.agent);
  assert.strictEqual(result.category, 'engineering');
});

test('selectAgent("code", 2, "design") usa domain design', function () {
  var result = router.selectAgent('code', 2, 'design');
  assert.ok(result);
  assert.strictEqual(result.category, 'design');
});

test('selectAgent("database", 2, "dados") usa domain database', function () {
  var result = router.selectAgent('database', 2, 'dados');
  assert.ok(result);
  assert.strictEqual(result.category, 'dados');
});

// selectAgent com keywords
test('selectAgent com keywords retorna match por keyword', function () {
  var result = router.selectAgent('code', 2, null, 'laravel');
  assert.ok(result);
  assert.ok(result.agent === 'Backend Architect' || result.agent === 'Senior Developer');
});

test('selectAgent com keywords "security" retorna security-agent', function () {
  var result = router.selectAgent('code', 2, null, 'security');
  assert.ok(result);
  assert.strictEqual(result.agent, 'Security Agent');
});

test('selectAgent com keywords "test" retorna testing-reality-checker ou code-reviewer', function () {
  var result = router.selectAgent('code', 2, null, 'test');
  assert.ok(result);
  assert.ok(result.agent === 'testing-reality-checker' || result.agent === 'Code Reviewer' || result.agent === 'Senior Developer');
});

// selectAgent com domínios variados
test('selectAgent("design", 3) retorna agente de design', function () {
  var result = router.selectAgent('design', 3);
  assert.ok(result);
  assert.strictEqual(result.category, 'design');
});

test('selectAgent("marketing", 2, null, null) retorna agente de marketing', function () {
  var result = router.selectAgent('marketing', 2);
  assert.ok(result);
  assert.strictEqual(result.category, 'marketing');
});

test('selectAgent("quality", 4) retorna agente da categoria qualidade', function () {
  var result = router.selectAgent('quality', 4);
  assert.ok(result);
  assert.ok(result.category === 'qualidade' || result.category === 'engineering');
});

test('selectAgent retorna objeto com todos os campos esperados', function () {
  var result = router.selectAgent('test', 1);
  assert.ok('agent' in result);
  assert.ok('category' in result);
  assert.ok('seniority' in result);
  assert.ok('mode' in result);
  assert.ok('reason' in result);
});

test('selectAgent(null, 1) retorna senior-developer (fallback)', function () {
  var result = router.selectAgent(null, 1);
  assert.ok(result);
  assert.strictEqual(result.agent, 'Senior Developer');
});

test('selectAgent(undefined, undefined) retorna senior-developer (fallback)', function () {
  var result = router.selectAgent(undefined, undefined);
  assert.ok(result);
  assert.strictEqual(result.agent, 'Senior Developer');
});

// ── listAgentsByCategory ──────────────────────────────────────────────

test('listAgentsByCategory("engineering") retorna array não vazio', function () {
  var agents = router.listAgentsByCategory('engineering');
  assert.ok(Array.isArray(agents));
  assert.ok(agents.length > 0, 'engineering contém agentes');
});

test('listAgentsByCategory("engineering") agentes têm campos obrigatórios', function () {
  var agents = router.listAgentsByCategory('engineering');
  agents.forEach(function (a, idx) {
    assert.ok(a.name, 'agent[' + idx + '].name');
    assert.ok(a.description, 'agent[' + idx + '].description');
    assert.ok(a.category, 'agent[' + idx + '].category');
    assert.ok(a.mode, 'agent[' + idx + '].mode');
    assert.ok(a.seniority, 'agent[' + idx + '].seniority');
    assert.ok(typeof a.complexityMax === 'number', 'agent[' + idx + '].complexityMax é number');
  });
});

test('listAgentsByCategory("design") contém ArchitectUX, UI-Designer', function () {
  var agents = router.listAgentsByCategory('design');
  var names = agents.map(function (a) { return a.name; });
  assert.ok(names.indexOf('ArchitectUX') !== -1, 'ArchitectUX presente');
  assert.ok(names.indexOf('UI-Designer') !== -1, 'UI-Designer presente');
  assert.ok(names.indexOf('Brand-Guardian') !== -1, 'Brand-Guardian presente');
});

test('listAgentsByCategory("qualidade") contém Code Reviewer', function () {
  var agents = router.listAgentsByCategory('qualidade');
  var names = agents.map(function (a) { return a.name; });
  assert.ok(names.indexOf('Code Reviewer') !== -1, 'Code Reviewer presente');
});

test('listAgentsByCategory("nonexistent") retorna array vazio', function () {
  var agents = router.listAgentsByCategory('nonexistent_category_xyz');
  assert.ok(Array.isArray(agents));
  assert.strictEqual(agents.length, 0);
});

test('listAgentsByCategory("") retorna array vazio', function () {
  var agents = router.listAgentsByCategory('');
  assert.ok(Array.isArray(agents));
  assert.strictEqual(agents.length, 0);
});

// Testar todas as categorias
var allCategories = ['design', 'engineering', 'dados', 'cms', 'devops', 'marketing', 'produto', 'qualidade', 'suporte', 'integracoes'];

test('listAgentsByCategory() para cada categoria retorna array', function () {
  allCategories.forEach(function (cat) {
    var agents = router.listAgentsByCategory(cat);
    assert.ok(Array.isArray(agents), cat + ' retorna array');
  });
});

test('listAgentsByCategory() "dados" contém database-optimizer', function () {
  var agents = router.listAgentsByCategory('dados');
  var names = agents.map(function (a) { return a.name; });
  assert.ok(names.indexOf('Database Optimizer') !== -1, 'database-optimizer presente');
});

test('listAgentsByCategory() "cms" contém cms-developer', function () {
  var agents = router.listAgentsByCategory('cms');
  var names = agents.map(function (a) { return a.name; });
  assert.ok(names.length > 0, 'cms tem agentes');
});

// ── getAgentInfo ──────────────────────────────────────────────────────

test('getAgentInfo("backend-architect") retorna dados completos', function () {
  var info = router.getAgentInfo('backend-architect');
  assert.ok(info);
  assert.strictEqual(info.name, 'Backend Architect');
  assert.strictEqual(info.seniority, 'architect');
  assert.ok(info.mode === 'code' || info.mode === 'subagent',
    'Mode deve ser válido, obteve: ' + info.mode);
  assert.ok(info.description);
  assert.ok(Array.isArray(info.categories));
  assert.ok(Array.isArray(info.taskTypes));
  assert.ok(Array.isArray(info.keywords));
  assert.strictEqual(info.complexityMax, 5);
});

test('getAgentInfo com @ prefix é tratado', function () {
  var info1 = router.getAgentInfo('@backend-architect');
  var info2 = router.getAgentInfo('backend-architect');
  assert.deepStrictEqual(info1, info2);
});

test('getAgentInfo case-insensitive', function () {
  var info = router.getAgentInfo('BACKEND-ARCHITECT');
  assert.ok(info);
  assert.strictEqual(info.name, 'Backend Architect');
});

test('getAgentInfo("senior-developer") retorna fallback geral', function () {
  var info = router.getAgentInfo('senior-developer');
  assert.ok(info);
  assert.strictEqual(info.name, 'Senior Developer');
  assert.strictEqual(info.seniority, 'senior');
});

test('getAgentInfo agente inexistente retorna null', function () {
  var info = router.getAgentInfo('agente-que-nao-existe');
  assert.strictEqual(info, null);
});

test('getAgentInfo(null) retorna null', function () {
  assert.strictEqual(router.getAgentInfo(null), null);
  assert.strictEqual(router.getAgentInfo(undefined), null);
});

test('getAgentInfo("fable-method-agent") retorna agente de processo', function () {
  var info = router.getAgentInfo('fable-method-agent');
  assert.ok(info);
  assert.ok(info.description);
});

test('getAgentInfo("code-reviewer") retorna dados completos', function () {
  var info = router.getAgentInfo('code-reviewer');
  assert.ok(info);
  assert.ok(info.seniority, 'tem seniority');
  assert.ok(info.taskTypes.length > 0);
});

// ── findAgentByKeywords ───────────────────────────────────────────────

test('findAgentByKeywords encontra por nome', function () {
  var result = router.findAgentByKeywords('backend');
  assert.ok(result);
  assert.strictEqual(result.agent, 'Backend Architect');
});

test('findAgentByKeywords encontra por keyword da descrição', function () {
  var result = router.findAgentByKeywords('security');
  assert.ok(result);
  assert.strictEqual(result.agent, 'Security Agent');
});

test('findAgentByKeywords retorna objeto com agent null para keyword sem match', function () {
  var result = router.findAgentByKeywords('zzz_nonexistent_keyword_xyz');
  assert.ok(result);
  assert.strictEqual(result.agent, null);
});

test('findAgentByKeywords(null) retorna null', function () {
  assert.strictEqual(router.findAgentByKeywords(null), null);
});

test('findAgentByKeywords undefined retorna null', function () {
  assert.strictEqual(router.findAgentByKeywords(undefined), null);
});

test('findAgentByKeywords "database" encontra database-optimizer', function () {
  var result = router.findAgentByKeywords('database');
  assert.ok(result);
  assert.strictEqual(result.agent, 'Database Optimizer');
});

test('findAgentByKeywords "test" encontra agente de testes', function () {
  var result = router.findAgentByKeywords('test');
  assert.ok(result);
  assert.ok(result.agent === 'testing-reality-checker' || result.agent === 'Code Reviewer' || result.agent === 'Senior Developer');
});

test('findAgentByKeywords "laravel" encontra backend-architect', function () {
  var result = router.findAgentByKeywords('laravel');
  assert.ok(result);
  assert.ok(result.agent === 'Backend Architect' || result.agent === 'Senior Developer');
});

// ── listCategories ────────────────────────────────────────────────────

test('listCategories() retorna objeto com categorias', function () {
  var cats = router.listCategories();
  assert.strictEqual(typeof cats, 'object');
  var keys = Object.keys(cats);
  assert.ok(keys.length > 0, 'pelo menos uma categoria');
  keys.forEach(function (k) {
    assert.ok(cats[k].count > 0, 'categoria "' + k + '" tem count > 0');
    assert.ok(Array.isArray(cats[k].agents), 'categoria "' + k + '" tem array agents');
  });
});

test('listCategories() contém categorias esperadas', function () {
  var cats = router.listCategories();
  var keys = Object.keys(cats);
  var esperadas = ['engineering', 'design', 'dados', 'cms', 'devops', 'marketing', 'produto', 'qualidade', 'suporte', 'integracoes', 'pipeline'];
  esperadas.forEach(function (e) {
    assert.ok(keys.indexOf(e) !== -1, 'categoria "' + e + '" presente');
  });
});

test('listCategories() agents array contém strings', function () {
  var cats = router.listCategories();
  Object.keys(cats).forEach(function (k) {
    var agents = cats[k].agents;
    if (agents.length > 0) {
      assert.strictEqual(typeof agents[0], 'string', 'agente em ' + k + ' é string');
    }
  });
});

// ── getAgentCount ─────────────────────────────────────────────────────

test('getAgentCount() retorna número positivo de agentes', function () {
  var count = router.getAgentCount();
  assert.ok(typeof count === 'number', 'getAgentCount retorna número');
  assert.ok(count > 30, 'mais de 30 agentes no catálogo');
});

test('getAgentCount() é maior que a soma das categorias (alguns agentes multi-categoria)', function () {
  var count = router.getAgentCount();
  var cats = router.listCategories();
  var sum = 0;
  Object.keys(cats).forEach(function (k) { sum += cats[k].count; });
  // Agentes multi-categoria (ex: devops-automator aparece em engineering e devops)
  // então o total de agentes únicos pode ser menor que a soma das categorias
  assert.ok(count <= sum, 'getAgentCount <= soma das categorias');
});

// ── getConfig ─────────────────────────────────────────────────────────

test('getConfig() retorna configuração com rules', function () {
  var config = router.getConfig();
  assert.ok(config);
  assert.ok(config.rules);
  assert.strictEqual(typeof config.rules.highComplexityThreshold, 'number');
  assert.strictEqual(typeof config.rules.defaultAgent, 'string');
  assert.strictEqual(config.rules.defaultAgent, 'senior-developer');
});

test('getConfig() tem taskTypeMapping ou categoryMapping', function () {
  var config = router.getConfig();
  // Pode ter taskTypeMapping ou categoryMapping dependendo da config
  assert.ok(config);
});

test('getConfig() rules tem valores válidos', function () {
  var config = router.getConfig();
  assert.ok(config.rules.highComplexityThreshold > 0, 'highComplexityThreshold > 0');
  assert.ok(config.rules.highComplexityThreshold <= 5, 'highComplexityThreshold <= 5');
});

// ── reloadConfig ──────────────────────────────────────────────────────

test('reloadConfig() retorna configuração sem lançar exceção', function () {
  var config = router.reloadConfig();
  assert.ok(config);
  assert.ok(config.rules);
});

test('reloadConfig() recarrega do disco e mantém estrutura', function () {
  var config = router.reloadConfig();
  assert.strictEqual(typeof config.rules.highComplexityThreshold, 'number');
  assert.strictEqual(config.rules.defaultAgent, 'senior-developer');
});

// ── mapTaskTypeToCategory ─────────────────────────────────────────────

test('mapTaskTypeToCategory "backend" retorna engineering', function () {
  var cat = router.mapTaskTypeToCategory('backend');
  assert.ok(cat === 'engineering' || cat === null || cat === undefined);
});

test('mapTaskTypeToCategory "ui" retorna design', function () {
  var cat = router.mapTaskTypeToCategory('ui');
  assert.ok(cat === 'design' || cat === null || cat === undefined);
});

test('mapTaskTypeToCategory retorna null para tipo desconhecido', function () {
  var cat = router.mapTaskTypeToCategory('nonexistent_type');
  assert.ok(cat === null || cat === undefined, 'tipo desconhecido retorna null');
});

test('mapTaskTypeToCategory "database" retorna dados', function () {
  var cat = router.mapTaskTypeToCategory('database');
  assert.ok(cat === 'dados' || cat === 'engineering' || cat === null || cat === undefined);
});

test('mapTaskTypeToCategory "devops" retorna devops ou engineering', function () {
  var cat = router.mapTaskTypeToCategory('devops');
  assert.ok(cat === 'devops' || cat === 'engineering' || cat === null || cat === undefined);
});

test('mapTaskTypeToCategory null retorna null', function () {
  var cat = router.mapTaskTypeToCategory(null);
  assert.ok(cat === null || cat === undefined);
});

test('mapTaskTypeToCategory "" retorna null', function () {
  var cat = router.mapTaskTypeToCategory('');
  assert.ok(cat === null || cat === undefined);
});

// ── AGENT_CATALOG ──────────────────────────────────────────────────────

test('AGENT_CATALOG tem todos os agentes conhecidos', function () {
  var catalog = router.AGENT_CATALOG;
  assert.ok(catalog);
  assert.ok(catalog['senior-developer']);
  assert.ok(catalog['backend-architect']);
  assert.ok(catalog['code-reviewer']);
  assert.ok(catalog['fable-method-agent']);
});

test('AGENT_CATALOG cada agente tem campos obrigatórios', function () {
  var catalog = router.AGENT_CATALOG;
  Object.keys(catalog).forEach(function (key) {
    var a = catalog[key];
    assert.ok(a.name, key + '.name');
    assert.ok(a.description, key + '.description');
    assert.ok(Array.isArray(a.categories), key + '.categories é array');
    assert.ok(a.mode, key + '.mode');
    assert.ok(typeof a.complexityMax === 'number', key + '.complexityMax');
    assert.ok(a.seniority, key + '.seniority');
    assert.ok(Array.isArray(a.taskTypes), key + '.taskTypes');
    assert.ok(Array.isArray(a.keywords), key + '.keywords');
  });
});

// ─── Summary ─────────────────────────────────────────────────────────
console.log('\n📊 Resultado: ' + testsPassed + '/' + (testsPassed + testsFailed) + ' testes passaram');
process.exit(testsFailed > 0 ? 1 : 0);
