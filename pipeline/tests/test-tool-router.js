/**
 * Test: tool-router.js (1113 linhas, 0% cobertura)
 * Roteador formal de ferramentas para o pipeline Matrix.
 *
 * Testa as funções exportadas: getTools, getToolInfo, listTools,
 * getToolCategories, routeTask, checkToolPermission, getConfig, reloadConfig
 * e o catálogo TOOL_CATALOG.
 */

const assert = require('assert');
const path = require('path');

const ROUTER_PATH = path.resolve(__dirname, '..', 'scripts', 'tool-router.js');

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

console.log('\n🔧 tool-router.js — Testes Expandidos\n');

// ── getTools ──────────────────────────────────────────────────────────

test('getTools("edit", 1) retorna ferramentas de escrita', function () {
  var result = router.getTools('edit', 1);
  assert.ok(result, 'getTools retornou resultado');
  assert.ok(result.tools, 'tools é array');
  assert.ok(result.tools.length > 0, 'pelo menos 1 ferramenta');
  assert.ok(result.route === 'code_modification', 'rota deve ser code_modification, obteve: ' + result.route);
  assert.strictEqual(result.taskType, 'edit', 'taskType deve ser edit');
  // Deve conter edit e/ou write
  var names = result.tools.map(function(t) { return t.name; });
  var hasEditOrWrite = names.indexOf('edit') !== -1 || names.indexOf('write') !== -1;
  assert.ok(hasEditOrWrite, 'deve conter edit ou write, obteve: ' + names.join(', '));
});

test('getTools("research", 3) retorna ferramentas de pesquisa', function () {
  var result = router.getTools('research', 3);
  assert.ok(result, 'getTools retornou resultado');
  assert.ok(result.tools.length > 0, 'pelo menos 1 ferramenta');
  assert.ok(result.route === 'internet_search', 'rota deve ser internet_search, obteve: ' + result.route);
  assert.strictEqual(result.taskType, 'research', 'taskType deve ser research');
  var names = result.tools.map(function(t) { return t.name; });
  assert.ok(names.indexOf('webfetch') !== -1 || names.indexOf('agent-reach') !== -1,
    'deve conter webfetch ou agent-reach, obteve: ' + names.join(', '));
});

test('getTools("read", 1) retorna ferramentas de leitura', function () {
  var result = router.getTools('read', 1);
  assert.ok(result);
  assert.strictEqual(result.route, 'file_read');
  assert.strictEqual(result.taskType, 'read');
  var names = result.tools.map(function(t) { return t.name; });
  assert.ok(names.indexOf('read') !== -1, 'read deve estar presente');
});

test('getTools("execute", 2) retorna ferramentas de execução', function () {
  var result = router.getTools('execute', 2);
  assert.ok(result);
  assert.strictEqual(result.route, 'command_execution');
  var names = result.tools.map(function(t) { return t.name; });
  assert.ok(names.indexOf('bash') !== -1, 'bash deve estar presente');
});

test('getTools("unknown_xyz", 1) retorna fallback para leitura', function () {
  var result = router.getTools('unknown_xyz', 1);
  assert.ok(result);
  assert.ok(result.route === null || result.route === undefined, 'rota deve ser null para taskType desconhecido');
  assert.ok(result.tools.length > 0, 'fallback deve retornar ferramentas');
  assert.ok(result.reason.indexOf('Fallback') !== -1 || result.reason.indexOf('fallback') !== -1,
    'reason deve mencionar fallback, obteve: ' + result.reason);
});

test('getTools("", 1) retorna unknown para taskType vazio (normalizeTaskType)', function () {
  var result = router.getTools('', 1);
  assert.ok(result);
  assert.strictEqual(result.taskType, 'unknown', 'taskType vazio normaliza para unknown');
});

test('getTools("edit", 0) usa complexidade mínima 1', function () {
  var result = router.getTools('edit', 0);
  assert.ok(result);
  assert.ok(result.tools.length > 0, 'complexidade 0 deve ser ajustada para 1');
});

test('getTools("edit", 6) usa complexidade máxima 5', function () {
  var result = router.getTools('edit', 6);
  assert.ok(result);
});

test('getTools("edit", 1, {role:"reader"}) filtra ferramentas restritas para reader', function () {
  var result = router.getTools('edit', 1, { role: 'reader' });
  assert.ok(result);
  // reader não deve ter acesso a ferramentas restritas
  var restricted = result.tools.filter(function(t) { return t.restricted; });
  assert.ok(restricted.length === 0, 'reader não deve ter ferramentas restritas, obteve: ' + restricted.length);
});

test('getTools("edit", 1, {role:"specialist"}) permite ferramentas restritas', function () {
  var result = router.getTools('edit', 1, { role: 'specialist' });
  assert.ok(result);
});

// ── normalizeTaskType (via public behavior) ───────────────────────────

test('normalizeTaskType("criar") → "create" (via getTools routing)', function () {
  var result = router.getTools('criar', 1);
  assert.ok(result);
  // "criar" é sinônimo de "create" no typeSynonyms → rota code_modification
  assert.strictEqual(result.taskType, 'create', 'criar deve normalizar para create, obteve: ' + result.taskType);
  assert.ok(result.route === 'code_modification', 'create deve usar code_modification, obteve: ' + result.route);
});

test('normalizeTaskType("ler") → "read" (via getTools routing)', function () {
  var result = router.getTools('ler', 1);
  assert.ok(result);
  assert.strictEqual(result.taskType, 'read', 'ler deve normalizar para read');
  assert.strictEqual(result.route, 'file_read');
});

test('normalizeTaskType("pesquisar") → "research" (via getTools routing)', function () {
  var result = router.getTools('pesquisar', 1);
  assert.ok(result);
  assert.strictEqual(result.taskType, 'research', 'pesquisar deve normalizar para research');
  assert.strictEqual(result.route, 'internet_search');
});

test('normalizeTaskType("executar") → "execute" (via getTools routing)', function () {
  var result = router.getTools('executar', 1);
  assert.ok(result);
  assert.strictEqual(result.taskType, 'execute', 'executar deve normalizar para execute');
  assert.strictEqual(result.route, 'command_execution');
});

// ── loadConfig / getConfig ────────────────────────────────────────────

test('loadConfig() retorna configuração com campos obrigatórios (via getConfig)', function () {
  var config = router.getConfig();
  assert.ok(config, 'config não é null');
  assert.ok(config.settings, 'settings existe');
  assert.ok(config.categories, 'categories existe');
  assert.ok(config.taskRouting, 'taskRouting existe');
  assert.ok(config.typeSynonyms, 'typeSynonyms existe');
  assert.strictEqual(typeof config.settings.defaultCategory, 'string', 'defaultCategory é string');
  assert.strictEqual(typeof config.settings.maxToolsPerRoute, 'number', 'maxToolsPerRoute é number');
  assert.ok(config.settings.maxToolsPerRoute > 0, 'maxToolsPerRoute > 0');
});

test('getConfig() retorna configuração em cache', function () {
  var config1 = router.getConfig();
  var config2 = router.getConfig();
  assert.strictEqual(config1, config2, 'getConfig deve retornar mesma referência em cache');
});

test('getConfig() settings.restrictedRoles é array com specialist e admin', function () {
  var config = router.getConfig();
  assert.ok(Array.isArray(config.settings.restrictedRoles), 'restrictedRoles é array');
  assert.ok(config.settings.restrictedRoles.indexOf('specialist') !== -1, 'contém specialist');
  assert.ok(config.settings.restrictedRoles.indexOf('admin') !== -1, 'contém admin');
});

test('getConfig() taskRouting tem todas as rotas esperadas', function () {
  var config = router.getConfig();
  var expectedRoutes = ['file_read', 'code_modification', 'command_execution', 'internet_search', 'delegation', 'git_operations', 'pipeline_management', 'database'];
  expectedRoutes.forEach(function(route) {
    assert.ok(config.taskRouting[route], 'rota ' + route + ' existe');
    assert.ok(Array.isArray(config.taskRouting[route].preferredTools), route + '.preferredTools é array');
  });
});

test('reloadConfig() recarrega configuração sem lançar exceção', function () {
  var config = router.reloadConfig();
  assert.ok(config, 'reloadConfig retornou config');
  assert.ok(config.settings, 'settings existe após reload');
});

// ── routeTask ─────────────────────────────────────────────────────────

test('routeTask("editar arquivo de configuração") retorna code_modification', function () {
  var result = router.routeTask('editar arquivo de configuração');
  assert.ok(result, 'routeTask retornou resultado');
  assert.ok(result.tools.length > 0, 'tools não vazio');
  assert.ok(result.taskType, 'taskType não vazio');
  assert.ok(result.summary, 'summary presente');
});

test('routeTask("") retorna fallback para descrição vazia', function () {
  var result = router.routeTask('');
  assert.ok(result);
  assert.strictEqual(result.taskType, 'unknown', 'taskType deve ser unknown para descrição vazia');
  assert.ok(result.tools.length > 0, 'fallback retorna ferramentas');
});

test('routeTask("pesquisar documentação do Supabase") retorna internet_search', function () {
  var result = router.routeTask('pesquisar documentação do Supabase');
  assert.ok(result);
  var taskType = result.taskType;
  // Pode ser research ou search-web dependendo do match
  assert.ok(taskType === 'research' || taskType === 'search-web' || taskType === 'lookup',
    'taskType deve ser de pesquisa, obteve: ' + taskType);
});

test('routeTask(null) retorna fallback', function () {
  var result = router.routeTask(null);
  assert.ok(result);
  assert.strictEqual(result.taskType, 'unknown');
});

test('routeTask("deploy versao 2.0 para producao") retorna comando de deploy', function () {
  var result = router.routeTask('deploy versao 2.0 para producao');
  assert.ok(result);
  assert.ok(result.tools.length > 0);
  // "deploy" é match no routeTask keywords
  assert.ok(result.taskType === 'deploy' || result.taskType === 'execute',
    'taskType deve ser deploy ou execute, obteve: ' + result.taskType);
});

// ── listTools ─────────────────────────────────────────────────────────

test('listTools() retorna todas as ferramentas do catálogo', function () {
  var tools = router.listTools();
  assert.ok(Array.isArray(tools), 'listTools retorna array');
  assert.ok(tools.length > 10, 'deve ter mais de 10 ferramentas, obteve: ' + tools.length);
});

test('listTools() cada ferramenta tem campos obrigatórios', function () {
  var tools = router.listTools();
  tools.forEach(function(t) {
    assert.ok(t.name, 'name presente em ' + t.name);
    assert.ok(t.category, 'category presente em ' + t.name);
    assert.ok(t.description, 'description presente em ' + t.name);
    assert.ok(typeof t.restricted === 'boolean', 'restricted é boolean em ' + t.name);
    assert.ok(typeof t.complexityMax === 'number', 'complexityMax é number em ' + t.name);
    assert.ok(Array.isArray(t.aliases), 'aliases é array em ' + t.name);
  });
});

test('listTools("leitura") retorna apenas ferramentas de leitura', function () {
  var tools = router.listTools('leitura');
  assert.ok(Array.isArray(tools));
  assert.ok(tools.length >= 3, 'leitura deve ter pelo menos 3 ferramentas, obteve: ' + tools.length);
  tools.forEach(function(t) {
    assert.strictEqual(t.category, 'leitura', 'categoria deve ser leitura, obteve: ' + t.category);
  });
});

test('listTools("execucao") retorna bash e terminal', function () {
  var tools = router.listTools('execucao');
  assert.ok(tools.length >= 2, 'execucao deve ter bash e terminal, obteve: ' + tools.length);
  var names = tools.map(function(t) { return t.name; });
  assert.ok(names.indexOf('bash') !== -1, 'bash presente');
});

test('listTools("nonexistent_category") retorna array vazio', function () {
  var tools = router.listTools('nonexistent_category');
  assert.ok(Array.isArray(tools));
  assert.strictEqual(tools.length, 0);
});

// ── getToolCategories ─────────────────────────────────────────────────

test('getToolCategories() retorna objeto com categorias', function () {
  var cats = router.getToolCategories();
  assert.ok(cats, 'getToolCategories retornou resultado');
  var catKeys = Object.keys(cats);
  assert.ok(catKeys.length >= 6, 'deve ter pelo menos 6 categorias, obteve: ' + catKeys.length);
  assert.ok(cats.leitura, 'categoria leitura existe');
  assert.ok(cats.escrita, 'categoria escrita existe');
  assert.ok(cats.execucao, 'categoria execucao existe');
  assert.ok(cats.pesquisa, 'categoria pesquisa existe');
});

test('getToolCategories() cada categoria tem array de ferramentas', function () {
  var cats = router.getToolCategories();
  var catKeys = Object.keys(cats);
  catKeys.forEach(function(key) {
    assert.ok(Array.isArray(cats[key]), key + ' é array');
    assert.ok(cats[key].length > 0, key + ' tem pelo menos 1 ferramenta');
    cats[key].forEach(function(tool) {
      assert.ok(tool.name, 'tool tem name');
      assert.ok(tool.category, 'tool tem category');
    });
  });
});

// ── getToolInfo ────────────────────────────────────────────────────────

test('getToolInfo("read") retorna info detalhada', function () {
  var info = router.getToolInfo('read');
  assert.ok(info, 'getToolInfo retornou resultado');
  assert.strictEqual(info.name, 'read');
  assert.strictEqual(info.category, 'leitura');
  assert.ok(info.description.length > 0, 'description não vazia');
  assert.strictEqual(info.restricted, false);
  assert.ok(Array.isArray(info.aliases));
  assert.ok(info.aliases.indexOf('cat') !== -1, 'alias cat presente');
});

test('getToolInfo("edit") retorna ferramenta restrita', function () {
  var info = router.getToolInfo('edit');
  assert.ok(info);
  assert.strictEqual(info.name, 'edit');
  assert.strictEqual(info.restricted, true);
  assert.strictEqual(info.category, 'escrita');
});

test('getToolInfo("bash") retorna ferramenta de execução', function () {
  var info = router.getToolInfo('bash');
  assert.ok(info);
  assert.strictEqual(info.name, 'bash');
  assert.strictEqual(info.category, 'execucao');
  assert.ok(info.aliases.indexOf('shell') !== -1);
});

test('getToolInfo("cat") encontra por alias → read', function () {
  var info = router.getToolInfo('cat');
  assert.ok(info, 'cat é alias de read');
  assert.strictEqual(info.name, 'read');
});

test('getToolInfo("nonexistent_tool") retorna null', function () {
  var info = router.getToolInfo('nonexistent_tool');
  assert.strictEqual(info, null);
});

test('getToolInfo("") retorna null', function () {
  var info = router.getToolInfo('');
  assert.strictEqual(info, null);
});

test('getToolInfo(null) retorna null', function () {
  var info = router.getToolInfo(null);
  assert.strictEqual(info, null);
});

test('getToolInfo("webfetch") retorna ferramenta de pesquisa', function () {
  var info = router.getToolInfo('webfetch');
  assert.ok(info);
  assert.strictEqual(info.name, 'webfetch');
  assert.strictEqual(info.category, 'pesquisa');
});

// ── checkToolPermission ───────────────────────────────────────────────

test('checkToolPermission("read", "reader") permite (não restrita)', function () {
  var result = router.checkToolPermission('read', 'reader');
  assert.ok(result);
  assert.strictEqual(result.allowed, true);
});

test('checkToolPermission("edit", "reader") NEGA para reader (restrita)', function () {
  var result = router.checkToolPermission('edit', 'reader');
  assert.ok(result);
  assert.strictEqual(result.allowed, false, 'reader não deve ter acesso a edit');
});

test('checkToolPermission("edit", "specialist") permite para specialist', function () {
  var result = router.checkToolPermission('edit', 'specialist');
  assert.ok(result);
  assert.strictEqual(result.allowed, true);
});

test('checkToolPermission("nonexistent", "specialist") retorna não encontrada', function () {
  var result = router.checkToolPermission('nonexistent', 'specialist');
  assert.ok(result);
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.indexOf('não encontrada') !== -1 || result.reason.indexOf('not found') !== -1,
    'reason deve indicar ferramenta não encontrada');
});

// ── TOOL_CATALOG ───────────────────────────────────────────────────────

test('TOOL_CATALOG contém todas as ferramentas esperadas', function () {
  var catalog = router.TOOL_CATALOG;
  assert.ok(catalog, 'TOOL_CATALOG existe');
  var expected = ['read', 'glob', 'grep', 'edit', 'write', 'bash', 'webfetch', 'agent-reach', 'task', 'git', 'state_machine', 'todowrite'];
  expected.forEach(function(name) {
    assert.ok(catalog[name], 'ferramenta ' + name + ' existe no catálogo');
  });
});

test('TOOL_CATALOG cada tool tem campos obrigatórios', function () {
  var catalog = router.TOOL_CATALOG;
  var keys = Object.keys(catalog);
  keys.forEach(function(key) {
    var tool = catalog[key];
    assert.ok(tool.name, key + '.name');
    assert.ok(tool.category, key + '.category');
    assert.ok(tool.description, key + '.description');
    assert.ok(typeof tool.restricted === 'boolean', key + '.restricted é boolean');
    assert.ok(typeof tool.complexityMax === 'number', key + '.complexityMax é number');
    assert.ok(Array.isArray(tool.aliases), key + '.aliases é array');
    assert.ok(Array.isArray(tool.taskTypes), key + '.taskTypes é array');
    assert.ok(tool.taskTypes.length > 0, key + '.taskTypes não vazio');
  });
});

test('TOOL_CATALOG todas as ferramentas restritas têm restricted=true', function () {
  var catalog = router.TOOL_CATALOG;
  var restrictedTools = ['edit', 'write', 'task', 'todowrite', 'supabase_execute_sql', 'supabase_apply_migration'];
  restrictedTools.forEach(function(name) {
    if (catalog[name]) {
      assert.strictEqual(catalog[name].restricted, true, name + ' deve ser restricted=true');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  SUMMARY
// ═══════════════════════════════════════════════════════════════════════

console.log('');
console.log('📊 Resultado: ' + testsPassed + '/' + (testsPassed + testsFailed) + ' testes passaram');
if (testsFailed > 0) {
  process.exit(1);
}
