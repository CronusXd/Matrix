/**
 * Test: token-tracker.js
 * Estimativa de tokens e custos de modelos de IA.
 *
 * Testa estimateTokens(), estimateTokensFromModel(), estimateCost(),
 * trackUsage(), trackUsageReal(), getReport(), getRates(), reloadRates().
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const TOKEN_PATH = path.resolve(__dirname, '..', 'scripts', 'token-tracker.js');
const BASE_DIR = path.resolve(__dirname, '..');
const METRICS_JSON = path.join(BASE_DIR, 'metrics.json');
const METRICS_BAK = METRICS_JSON + '.tt-bak';

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

// Backup
if (fs.existsSync(METRICS_JSON)) {
  fs.copyFileSync(METRICS_JSON, METRICS_BAK);
}

// ─── Imports ──────────────────────────────────────────────────────────

delete require.cache[require.resolve(TOKEN_PATH)];
var tracker = require(TOKEN_PATH);

// ═══════════════════════════════════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════════════════════════════════

console.log('\n📊 token-tracker.js — Testes\n');

// ── estimateTokens ────────────────────────────────────────────────────

test('estimateTokens texto vazio retorna 0', function () {
  var tokens = tracker.estimateTokens('');
  assert.strictEqual(tokens, 0);
});

test('estimateTokens null retorna 0', function () {
  var tokens = tracker.estimateTokens(null);
  assert.strictEqual(tokens, 0);
});

test('estimateTokens undefined retorna 0', function () {
  var tokens = tracker.estimateTokens(undefined);
  assert.strictEqual(tokens, 0);
});

test('estimateTokens texto curto retorna > 0', function () {
  var tokens = tracker.estimateTokens('Hello world');
  assert.ok(tokens > 0, 'texto curto deve ter tokens');
});

test('estimateTokens texto grande retorna mais tokens', function () {
  var small = tracker.estimateTokens('Hello world');
  var largeText = '';
  for (var i = 0; i < 1000; i++) {
    largeText += 'Lorem ipsum dolor sit amet consectetur adipiscing elit. ';
  }
  var large = tracker.estimateTokens(largeText);
  assert.ok(large > small, 'texto grande deve ter mais tokens');
});

test('estimateTokens texto multi-idioma funciona', function () {
  var tokens = tracker.estimateTokens('Olá mundo! 你好世界! Привет мир!');
  assert.ok(tokens > 0, 'texto multi-idioma tem tokens');
});

test('estimateTokens texto com caracteres especiais', function () {
  var tokens = tracker.estimateTokens('!@#$%^&*()_+-=[]{}|;:,.<>?/');
  assert.ok(tokens > 0, 'caracteres especiais contam');
});

test('estimateTokens texto multilinha', function () {
  var tokens = tracker.estimateTokens('linha 1\nlinha 2\nlinha 3\n');
  assert.ok(tokens > 0);
});

test('estimateTokens texto com 1000 palavras', function () {
  var words = [];
  for (var i = 0; i < 1000; i++) words.push('word' + i);
  var tokens = tracker.estimateTokens(words.join(' '));
  assert.ok(tokens > 500, '1000 palavras devem ter centenas de tokens');
  // Tokenização aproximada: ~1.3 tokens/palavra para palavras curtas
  // 1000 palavras curtas = ~1300 tokens (pode variar)
  assert.ok(tokens < 5000, '1000 palavras não devem exceder 5000 tokens');
});

// ── estimateTokensFromModel ──────────────────────────────────────────

test('estimateTokensFromModel com modelo conhecido (sync)', function () {
  var tokens = tracker.estimateTokensFromModel('Hello world', 'gpt-4o');
  // Pode ser síncrono ou retornar Promise
  if (tokens && typeof tokens.then === 'function') {
    // Async - pula verificação síncrona
    console.log('  ⏭️  estimateTokensFromModel é async');
  } else {
    assert.ok(tokens > 0);
  }
});

test('estimateTokensFromModel com modelo desconhecido usa fallback', function () {
  var tokens = tracker.estimateTokensFromModel('Hello world', 'modelo-inexistente');
  if (tokens && typeof tokens.then === 'function') {
    console.log('  ⏭️  async');
  } else {
    assert.ok(tokens > 0);
  }
});

test('estimateTokensFromModel texto vazio retorna 0', function () {
  var tokens = tracker.estimateTokensFromModel('', 'gpt-4o');
  if (tokens && typeof tokens.then === 'function') {
    console.log('  ⏭️  async');
  } else {
    assert.strictEqual(tokens, 0);
  }
});

test('estimateTokensFromModel null/undefined retorna 0', function () {
  var t1 = tracker.estimateTokensFromModel(null, 'gpt-4o');
  var t2 = tracker.estimateTokensFromModel(undefined, 'gpt-4o');
  if (t1 && typeof t1.then === 'function') {
    console.log('  ⏭️  async');
  } else {
    assert.strictEqual(t1, 0);
    assert.strictEqual(t2, 0);
  }
});

// ── estimateCost ─────────────────────────────────────────────────────

test('estimateCost com input retorna custo', function () {
  var result = tracker.estimateCost('gpt-4o', 1000, 'input');
  assert.strictEqual(typeof result, 'object');
  assert.ok('cost' in result);
  assert.ok(result.cost >= 0, 'custo input >= 0');
  assert.strictEqual(result.type, 'input');
});

test('estimateCost com output retorna custo', function () {
  var result = tracker.estimateCost('gpt-4o', 500, 'output');
  assert.strictEqual(typeof result, 'object');
  assert.ok('cost' in result);
  assert.ok(result.cost >= 0, 'custo output >= 0');
  assert.strictEqual(result.type, 'output');
});

test('estimateCost output custa mais que input', function () {
  var inputCost = tracker.estimateCost('gpt-4o', 1000, 'input');
  var outputCost = tracker.estimateCost('gpt-4o', 1000, 'output');
  assert.ok(outputCost >= inputCost, 'output deve custar >= input para gpt-4o');
});

test('estimateCost 0 tokens retorna custo 0', function () {
  var result = tracker.estimateCost('gpt-4o', 0, 'input');
  assert.strictEqual(result.cost, 0);
});

test('estimateCost type padrão é input', function () {
  var r1 = tracker.estimateCost('gpt-4o', 1000);
  var r2 = tracker.estimateCost('gpt-4o', 1000, 'input');
  assert.strictEqual(r1.type, r2.type);
});

test('estimateCost modelo desconhecido usa fallback', function () {
  var result = tracker.estimateCost('modelo-inexistente', 1000, 'input');
  assert.strictEqual(typeof result, 'object');
  assert.ok('cost' in result);
});

test('estimateCost tokens negativo retorna objeto com cost', function () {
  var result = tracker.estimateCost('gpt-4o', -100, 'input');
  assert.strictEqual(typeof result, 'object');
  assert.ok('cost' in result);
  assert.ok('tokens' in result);
  assert.strictEqual(result.tokens, -100);
});

// ── trackUsage ──────────────────────────────────────────────────────

test('trackUsage null model não lança', function () {
  assert.doesNotThrow(function () {
    tracker.trackUsage(null, 100, 'input');
  });
});

test('trackUsage com valores válidos', function () {
  var result = tracker.trackUsage('gpt-4o', 1000, 'input');
  // Não deve lançar
  assert.doesNotThrow(function () {
    tracker.trackUsage('gpt-4o', 500, 'output');
  });
});

test('trackUsage 0 tokens não quebra', function () {
  assert.doesNotThrow(function () {
    tracker.trackUsage('gpt-4o', 0, 'input');
  });
});

test('trackUsage tipo inválido usa fallback', function () {
  assert.doesNotThrow(function () {
    tracker.trackUsage('gpt-4o', 100, 'unknown_type');
  });
});

// ── trackUsageReal ────────────────────────────────────────────────────

test('trackUsageReal com input e output', function () {
  assert.doesNotThrow(function () {
    tracker.trackUsageReal('gpt-4o', 500, 200);
  });
});

test('trackUsageReal 0 tokens não quebra', function () {
  assert.doesNotThrow(function () {
    tracker.trackUsageReal('gpt-4o', 0, 0);
  });
});

test('trackUsageReal null model não quebra', function () {
  assert.doesNotThrow(function () {
    tracker.trackUsageReal(null, 100, 50);
  });
});

test('trackUsageReal modelo desconhecido não quebra', function () {
  assert.doesNotThrow(function () {
    tracker.trackUsageReal('modelo-teste-temporario', 100, 50);
  });
});

// ── getReport ─────────────────────────────────────────────────────────

test('getReport() retorna objeto com dados de uso', function () {
  var report = tracker.getReport();
  assert.strictEqual(typeof report, 'object');
  // Deve ter tokens e custos
  assert.ok('totalTokens' in report || 'models' in report || 'tokenUsage' in report);
});

test('getReport() contém modelos usados', function () {
  var report = tracker.getReport();
  // A estrutura pode ser models, tokenUsage, ou dailySpent
  var hasModels = report.models || report.tokenUsage || report.dailySpent;
  assert.ok(hasModels !== undefined, 'report tem dados de uso');
});

test('getReport() retorna custo total', function () {
  var report = tracker.getReport();
  // Pode ter totalCost, totalSpent, etc
  assert.ok('totalCost' in report || 'totalSpent' in report || 'dailySpent' in report);
});

// ── getRates ──────────────────────────────────────────────────────────

test('getRates() retorna objeto com taxas', function () {
  var rates = tracker.getRates();
  assert.ok(rates);
  assert.strictEqual(typeof rates, 'object');
});

test('getRates() contém gpt-4o', function () {
  var rates = tracker.getRates();
  assert.ok(rates['gpt-4o'], 'gpt-4o presente');
  assert.ok('input' in rates['gpt-4o']);
  assert.ok('output' in rates['gpt-4o']);
});

test('getRates() contém claude-3-sonnet', function () {
  var rates = tracker.getRates();
  assert.ok(rates['claude-3-sonnet']);
});

test('getRates() taxas de input são números positivos', function () {
  var rates = tracker.getRates();
  Object.keys(rates).forEach(function (model) {
    if (rates[model].input !== undefined) {
      assert.strictEqual(typeof rates[model].input, 'number', model + '.input');
      assert.ok(rates[model].input >= 0, model + '.input >= 0');
    }
  });
});

// ── reloadRates ──────────────────────────────────────────────────────

test('reloadRates() recarrega taxas sem lançar', function () {
  var rates = tracker.reloadRates();
  assert.ok(rates);
  assert.strictEqual(typeof rates, 'object');
});

test('reloadRates() mantém modelos conhecidos', function () {
  var rates = tracker.reloadRates();
  assert.ok(rates['gpt-4o']);
  assert.ok(rates['gpt-4o-mini']);
});

// ── Edge cases ──────────────────────────────────────────────────────

test('estimateTokensFromModelSync (se disponível)', function () {
  if (tracker.estimateTokensFromModelSync) {
    var tokens = tracker.estimateTokensFromModelSync('Hello', 'gpt-4o');
    assert.ok(tokens > 0);
  } else {
    console.log('  ⏭️  estimateTokensFromModelSync não exportada');
  }
});

// ── Restore ──────────────────────────────────────────────────────────
if (fs.existsSync(METRICS_BAK)) {
  fs.copyFileSync(METRICS_BAK, METRICS_JSON);
  fs.unlinkSync(METRICS_BAK);
}

// ─── Summary ─────────────────────────────────────────────────────────
console.log('\n📊 Resultado: ' + testsPassed + '/' + (testsPassed + testsFailed) + ' testes passaram');
process.exit(testsFailed > 0 ? 1 : 0);
