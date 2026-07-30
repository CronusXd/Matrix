#!/usr/bin/env node
/**
 * Matrix Token Tracker v2.0
 * Estimativa de tokens e custos de modelos de IA.
 * Agora com tracking real separando input/output e suporte a 9router API.
 *
 * API:
 *   { estimateTokens(text), estimateTokensFromModel(text, modelName),
 *     estimateCost(model, tokens, type),
 *     trackUsage(model, tokens, type), trackUsageReal(model, inputTokens, outputTokens),
 *     getReport(), getRates(), reloadRates() }
 *
 * Storage: Adiciona token_usage e token_usage_real em metrics.json
 * Taxas: Configurável via token-tracker.yaml
 *
 * NON-BLOCKING: se metrics.json falhar, tracking continua sem persistência.
 *
 * Uso CLI:
 *   node token-tracker.js estimate <text>
 *   node token-tracker.js estimate-model <text> <model>
 *   node token-tracker.js cost <model> <tokens> [type]
 *   node token-tracker.js track <model> <tokens> [type]
 *   node token-tracker.js track-real <model> <inputTokens> <outputTokens>
 *   node token-tracker.js report
 *   node token-tracker.js rates
 *   node token-tracker.js reload
 *   node token-tracker.js --help
 */

const fs = require('fs');
const path = require('path');

// ─── Caminhos Absolutos ───────────────────────────────────────────────
const BASE_DIR = path.resolve(__dirname, '..');
const METRICS_JSON = path.join(BASE_DIR, 'metrics.json');
const CONFIG_FILE = path.join(__dirname, 'token-tracker.yaml');

// ─── Cores para Terminal ──────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

// ─── Taxas padrão por modelo (USD por 1K tokens) ──────────────────────
var DEFAULT_RATES = {
  'gpt-4o': { input: 0.005, output: 0.015, description: 'GPT-4 Optimized' },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006, description: 'GPT-4o Mini (econômico)' },
  'gpt-4-turbo': { input: 0.01, output: 0.03, description: 'GPT-4 Turbo' },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015, description: 'GPT-3.5 Turbo' },
  'claude-3-opus': { input: 0.015, output: 0.075, description: 'Claude 3 Opus' },
  'claude-3-sonnet': { input: 0.003, output: 0.015, description: 'Claude 3 Sonnet' },
  'claude-3-haiku': { input: 0.00025, output: 0.00125, description: 'Claude 3 Haiku' },
  'gemini-pro': { input: 0.0005, output: 0.0015, description: 'Gemini Pro' }
};

// Cache da configuração
var _rates = null;

// =====================================================================
//  Config Loading
// =====================================================================

/**
 * Carrega as taxas do token-tracker.yaml.
 * Faz merge com DEFAULT_RATES.
 * NON-BLOCKING: se falhar, usa defaults.
 *
 * @returns {Object} Taxas carregadas { model: { input, output } }
 */
function loadRates() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(JSON.stringify(DEFAULT_RATES));
    }

    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const rates = JSON.parse(JSON.stringify(DEFAULT_RATES));

    // Parse YAML simplificado
    const lines = raw.split('\n');
    let currentModel = null;

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;

      // Model key (indent 0, ends with ':')
      if (trimmed.endsWith(':') && !trimmed.startsWith('-') && rawLine[0] !== ' ') {
        currentModel = trimmed.slice(0, -1);
        if (currentModel !== 'rates' && currentModel !== '_comment') {
          if (!rates[currentModel]) rates[currentModel] = {};
        }
        continue;
      }

      // Sub-keys (indent 2)
      if (currentModel && trimmed.startsWith('- ') && rates[currentModel]) {
        // List item under a model — skip
        continue;
      }

      if (currentModel && rates[currentModel] && trimmed.includes(':')) {
        const colonIdx = trimmed.indexOf(':');
        const key = trimmed.substring(0, colonIdx).trim();
        let value = trimmed.substring(colonIdx + 1).trim();
        value = stripQuotes(value);

        if (key === 'input' || key === 'output') {
          rates[currentModel][key] = parseFloat(value);
        } else if (key === 'description') {
          rates[currentModel][key] = value;
        }
      }
    }

    // Remove non-model keys
    delete rates.rates;
    delete rates._comment;

    return rates;
  } catch (err) {
    console.warn(YELLOW + '⚠️  token-tracker: loadRates falhou (NON-BLOCKING): ' + err.message + RESET);
    return JSON.parse(JSON.stringify(DEFAULT_RATES));
  }
}

function stripQuotes(value) {
  if (typeof value !== 'string') return value;
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Retorna as taxas atuais (com cache).
 *
 * @returns {Object} Taxas por modelo
 */
function getRates() {
  if (!_rates) _rates = loadRates();
  return _rates;
}

/**
 * Recarrega as taxas do disco (invalida cache).
 *
 * @returns {Object} Novas taxas
 */
function reloadRates() {
  _rates = loadRates();
  return _rates;
}

// =====================================================================
//  Token Estimation
// =====================================================================

/**
 * Estima o número de tokens em um texto usando heurística simples.
 *
 * Regra: ~4 caracteres por token para texto em inglês,
 * ~2 para CJK, ~3 para português (médio).
 * Usamos 3.5 como fator médio conservador.
 *
 * @param {string} text - Texto a ser estimado
 * @returns {number} Número estimado de tokens (mínimo 1)
 */
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  if (text.trim().length === 0) return 0;

  // Contagem de caracteres (incluindo espaços)
  const charCount = text.length;

  // Estimativa: ~3.5 chars por token (médio para português/inglês)
  const estimated = Math.ceil(charCount / 3.5);

  return Math.max(1, estimated);
}

// =====================================================================
//  Token Estimation via Model (9router API)
// =====================================================================

/**
 * Estima tokens usando a API 9router se disponível.
 * Tenta chamar a API de tokenização do modelo específico.
 * Fallback: usa a heurística estimateTokens().
 *
 * @param {string} text - Texto a ser estimado
 * @param {string} modelName - Nome do modelo (ex: 'oc/deepseek-v4-flash-free')
 * @returns {Promise<number>} Número estimado de tokens
 */
async function estimateTokensFromModel(text, modelName) {
  if (!text || typeof text !== 'string') return 0;
  if (text.trim().length === 0) return 0;

  // Tenta usar 9router API se disponível
  const apiKey = process.env['9ROUTER_API_KEY'] || process.env['OPENROUTER_API_KEY'] || process.env['OPENAI_API_KEY'];
  const baseUrl = process.env['9ROUTER_BASE_URL'] || 'https://api.9router.com';

  if (apiKey && modelName) {
    try {
      const https = require('https');
      const url = new URL(baseUrl + '/api/v1/tokenize');

      const payload = JSON.stringify({
        model: modelName,
        input: text
      });

      const result = await new Promise((resolve, reject) => {
        const req = https.request(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey,
            'Content-Length': Buffer.byteLength(payload)
          },
          timeout: 5000
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (_) {
              resolve(null);
            }
          });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.write(payload);
        req.end();
      });

      if (result && typeof result.tokens === 'number') {
        return result.tokens;
      }
      if (result && Array.isArray(result.token_ids)) {
        return result.token_ids.length;
      }
      // Fallback: se API retornou mas sem campo esperado
    } catch (_) {
      // NON-BLOCKING: fallback para heurística
    }
  }

  // Fallback: heurística local
  return estimateTokens(text);
}

/**
 * Versão síncrona para compatibilidade com código não-async.
 * Usa apenas a heurística local (sem API).
 *
 * @param {string} text - Texto a ser estimado
 * @param {string} modelName - Nome do modelo (ignorado na versão sync)
 * @returns {number} Número estimado de tokens
 */
function estimateTokensFromModelSync(text, modelName) {
  return estimateTokens(text);
}

// =====================================================================
//  Cost Estimation
// =====================================================================

/**
 * Estima o custo em USD para um dado modelo e número de tokens.
 * Considera apenas custo de input (leitura). Para output, multiplique.
 *
 * @param {string} model - Nome do modelo (ex: 'gpt-4o')
 * @param {number} tokens - Número de tokens
 * @param {string} [type='input'] - 'input' ou 'output'
 * @returns {CostEstimate}
 */
function estimateCost(model, tokens, type) {
  const rates = getRates();
  const modelKey = model && rates[model] ? model : Object.keys(rates)[0];
  const modelRates = rates[modelKey];
  const costType = type === 'output' ? 'output' : 'input';
  const rate = modelRates ? modelRates[costType] : 0.001;
  const cost = (tokens / 1000) * rate;

  return {
    cost: cost,
    rate: rate,
    model: modelKey,
    tokens: tokens,
    type: costType
  };
}

// =====================================================================
//  Usage Tracking
// =====================================================================

/**
 * Carrega metrics.json do disco.
 *
 * @returns {Object} Métricas carregadas (ou padrão)
 */
function loadMetrics() {
  try {
    if (!fs.existsSync(METRICS_JSON)) {
      return { token_usage: {} };
    }
    const raw = fs.readFileSync(METRICS_JSON, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(YELLOW + '⚠️  token-tracker: loadMetrics falhou (NON-BLOCKING): ' + err.message + RESET);
    return { token_usage: {} };
  }
}

/**
 * Salva metrics.json no disco.
 * NON-BLOCKING: se falhar, apenas loga warning.
 *
 * @param {Object} metrics - Métricas a persistir
 */
function saveMetrics(metrics) {
  try {
    fs.writeFileSync(METRICS_JSON, JSON.stringify(metrics, null, 2) + '\n');
  } catch (err) {
    console.warn(YELLOW + '⚠️  token-tracker: saveMetrics falhou (NON-BLOCKING): ' + err.message + RESET);
  }
}

/**
 * Registra o uso de tokens para um modelo em metrics.json.
 *
 * Adiciona/atualiza a seção token_usage:
 * ```json
 * {
 *   "token_usage": {
 *     "gpt-4o": { "tokens": 15000, "cost": 0.075, "calls": 3 },
 *     ...
 *   }
 * }
 * ```
 *
 * @param {string} model - Nome do modelo
 * @param {number} tokens - Tokens consumidos
 * @param {string} [type='input'] - 'input' ou 'output'
 * @returns {Object} Uso atualizado para o modelo
 */
function trackUsage(model, tokens, type) {
  try {
    const metrics = loadMetrics();
    if (!metrics.token_usage) metrics.token_usage = {};

    const costInfo = estimateCost(model, tokens, type);
    const key = costInfo.model;

    if (!metrics.token_usage[key]) {
      metrics.token_usage[key] = { tokens: 0, cost: 0, calls: 0 };
    }

    metrics.token_usage[key].tokens += tokens;
    metrics.token_usage[key].cost += costInfo.cost;
    metrics.token_usage[key].calls += 1;

    // Arredonda para evitar floats enormes
    metrics.token_usage[key].tokens = Math.round(metrics.token_usage[key].tokens);
    metrics.token_usage[key].cost = Math.round(metrics.token_usage[key].cost * 1000000) / 1000000;

    saveMetrics(metrics);
    return metrics.token_usage[key];
  } catch (err) {
    console.warn(YELLOW + '⚠️  token-tracker.trackUsage() falhou (NON-BLOCKING): ' + err.message + RESET);
    return null;
  }
}

// =====================================================================
//  Real Usage Tracking (com input/output separados)
// =====================================================================

/**
 * Registra o uso real de tokens (input + output separados) em metrics.json.
 *
 * Adiciona/atualiza a seção token_usage_real:
 * ```json
 * {
 *   "token_usage_real": {
 *     "gpt-4o": {
 *       "input_tokens": 10000,
 *       "output_tokens": 5000,
 *       "total_tokens": 15000,
 *       "input_cost": 0.05,
 *       "output_cost": 0.075,
 *       "total_cost": 0.125,
 *       "calls": 3
 *     }
 *   }
 * }
 * ```
 *
 * @param {string} model - Nome do modelo
 * @param {number} inputTokens - Tokens de input
 * @param {number} outputTokens - Tokens de output
 * @returns {Object|null} Uso atualizado para o modelo ou null se falhar
 */
function trackUsageReal(model, inputTokens, outputTokens) {
  try {
    const metrics = loadMetrics();
    if (!metrics.token_usage_real) metrics.token_usage_real = {};

    const inputTokensNum = Math.max(0, Math.round(inputTokens || 0));
    const outputTokensNum = Math.max(0, Math.round(outputTokens || 0));
    const totalTokens = inputTokensNum + outputTokensNum;

    // Usa o model key do costInfo para normalizar
    const costInfo = estimateCost(model, totalTokens, 'input');
    const key = costInfo.model;

    if (!metrics.token_usage_real[key]) {
      metrics.token_usage_real[key] = {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        input_cost: 0,
        output_cost: 0,
        total_cost: 0,
        calls: 0
      };
    }

    const entry = metrics.token_usage_real[key];
    entry.input_tokens += inputTokensNum;
    entry.output_tokens += outputTokensNum;
    entry.total_tokens += totalTokens;
    entry.calls += 1;

    // Calcula custos separados
    const inputCostInfo = estimateCost(model, inputTokensNum, 'input');
    const outputCostInfo = estimateCost(model, outputTokensNum, 'output');
    entry.input_cost += inputCostInfo.cost;
    entry.output_cost += outputCostInfo.cost;
    entry.total_cost += inputCostInfo.cost + outputCostInfo.cost;

    // Arredonda para evitar floats enormes
    entry.input_cost = Math.round(entry.input_cost * 1000000) / 1000000;
    entry.output_cost = Math.round(entry.output_cost * 1000000) / 1000000;
    entry.total_cost = Math.round(entry.total_cost * 1000000) / 1000000;

    // Também atualiza o token_usage legado para compatibilidade
    if (!metrics.token_usage) metrics.token_usage = {};
    if (!metrics.token_usage[key]) {
      metrics.token_usage[key] = { tokens: 0, cost: 0, calls: 0 };
    }
    metrics.token_usage[key].tokens += totalTokens;
    metrics.token_usage[key].cost += inputCostInfo.cost + outputCostInfo.cost;
    metrics.token_usage[key].calls += 1;
    metrics.token_usage[key].tokens = Math.round(metrics.token_usage[key].tokens);
    metrics.token_usage[key].cost = Math.round(metrics.token_usage[key].cost * 1000000) / 1000000;

    saveMetrics(metrics);
    return entry;
  } catch (err) {
    console.warn(YELLOW + '⚠️  token-tracker.trackUsageReal() falhou (NON-BLOCKING): ' + err.message + RESET);
    return null;
  }
}

/**
 * Retorna o relatório de uso de tokens de metrics.json.
 * Inclui tanto token_usage (legado) quanto token_usage_real.
 *
 * @returns {TokenReport}
 */
function getReport() {
  try {
    const metrics = loadMetrics();
    const usage = metrics.token_usage || {};

    const modelKeys = Object.keys(usage);
    let totalTokens = 0;
    let totalCost = 0;
    const details = [];

    for (const model of modelKeys) {
      const data = usage[model];
      totalTokens += data.tokens || 0;
      totalCost += data.cost || 0;
      details.push({
        model: model,
        tokens: data.tokens || 0,
        cost: data.cost || 0,
        calls: data.calls || 0
      });
    }

    // Inclui token_usage_real se existir
    const realUsage = metrics.token_usage_real || {};
    const realKeys = Object.keys(realUsage);
    let realDetails = null;

    if (realKeys.length > 0) {
      realDetails = realKeys.map(model => ({
        model: model,
        input_tokens: realUsage[model].input_tokens || 0,
        output_tokens: realUsage[model].output_tokens || 0,
        total_tokens: realUsage[model].total_tokens || 0,
        input_cost: realUsage[model].input_cost || 0,
        output_cost: realUsage[model].output_cost || 0,
        total_cost: realUsage[model].total_cost || 0,
        calls: realUsage[model].calls || 0
      }));
    }

    return {
      totalTokens: totalTokens,
      totalCost: Math.round(totalCost * 1000000) / 1000000,
      models: modelKeys.length,
      details: details,
      realDetails: realDetails
    };
  } catch (err) {
    console.warn(YELLOW + '⚠️  token-tracker.getReport() falhou (NON-BLOCKING): ' + err.message + RESET);
    return { totalTokens: 0, totalCost: 0, models: 0, details: [], realDetails: [] };
  }
}

// =====================================================================
//  CLI
// =====================================================================

function printHelp() {
  console.log('');
  console.log(CYAN + BOLD + 'Matrix Token Tracker v1.0' + RESET);
  console.log(YELLOW + 'Estimativa de tokens e custos de modelos de IA.' + RESET);
  console.log('');
  console.log('Uso: node token-tracker.js <comando> [argumentos]');
  console.log('');
  console.log('Comandos:');
  console.log('  ' + GREEN + 'estimate <text>' + RESET + '                    Estima tokens para um texto');
  console.log('  ' + GREEN + 'estimate-model <text> <model>' + RESET + '      Estima tokens via API do modelo');
  console.log('  ' + GREEN + 'cost <model> <tokens> [type]' + RESET + '       Estima custo (type: input|output)');
  console.log('  ' + GREEN + 'track <model> <tokens> [type]' + RESET + '      Registra uso simples em metrics.json');
  console.log('  ' + GREEN + 'track-real <model> <inputTokens> <outputTokens>' + RESET + '  Registra uso real (input+output separados)');
  console.log('  ' + GREEN + 'report' + RESET + '                             Mostra relatório de uso acumulado');
  console.log('  ' + GREEN + 'rates' + RESET + '                              Lista taxas configuradas');
  console.log('  ' + GREEN + 'reload' + RESET + '                             Recarrega taxas do disco');
  console.log('  ' + GREEN + '--help' + RESET + '                             Exibe esta mensagem');
  console.log('');
  console.log('Exemplos:');
  console.log('  node token-tracker.js estimate "Hello, world!"');
  console.log('  node token-tracker.js estimate-model "Hello" oc/deepseek-v4-flash-free');
  console.log('  node token-tracker.js cost gpt-4o 500');
  console.log('  node token-tracker.js track gpt-4o 1500 input');
  console.log('  node token-tracker.js track-real gpt-4o 1000 500');
  console.log('  node token-tracker.js report');
  console.log('');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];

  switch (cmd) {
    case '--help':
    case '-h':
      printHelp();
      break;
    case 'estimate':
      if (!args[1]) { console.error(RED + '❌ Uso: node token-tracker.js estimate <text>' + RESET); process.exit(1); }
      var tokens = estimateTokens(args[1]);
      console.log('');
      console.log('Token estimate:');
      console.log('  Text:    "' + args[1].substring(0, 60) + (args[1].length > 60 ? '...' : '') + '"');
      console.log('  Tokens:  ' + CYAN + tokens + RESET);
      console.log('');
      break;
    case 'estimate-model':
      if (!args[1] || !args[2]) { console.error(RED + '❌ Uso: node token-tracker.js estimate-model <text> <model>' + RESET); process.exit(1); }
      estimateTokensFromModel(args[1], args[2]).then(function(modelTokens) {
        console.log('');
        console.log('Token estimate via model:');
        console.log('  Model:   ' + args[2]);
        console.log('  Text:    "' + args[1].substring(0, 60) + (args[1].length > 60 ? '...' : '') + '"');
        console.log('  Tokens:  ' + CYAN + modelTokens + RESET);
        console.log('');
      }).catch(function() {
        var fallbackTokens = estimateTokens(args[1]);
        console.log('');
        console.log('Token estimate (fallback):');
        console.log('  Model:   ' + args[2] + ' (API indisponível)');
        console.log('  Tokens:  ' + CYAN + fallbackTokens + RESET + ' (heurística local)');
        console.log('');
      });
      break;
    case 'cost':
      if (!args[1] || !args[2]) { console.error(RED + '❌ Uso: node token-tracker.js cost <model> <tokens> [type]' + RESET); process.exit(1); }
      var costResult = estimateCost(args[1], parseInt(args[2], 10), args[3]);
      console.log('');
      console.log('Cost estimate:');
      console.log('  Model:  ' + costResult.model);
      console.log('  Tokens: ' + costResult.tokens);
      console.log('  Type:   ' + costResult.type);
      console.log('  Rate:   $' + costResult.rate.toFixed(5) + '/1K tokens');
      console.log('  Cost:   ' + GREEN + '$' + costResult.cost.toFixed(6) + RESET);
      console.log('');
      break;
    case 'track':
      if (!args[1] || !args[2]) { console.error(RED + '❌ Uso: node token-tracker.js track <model> <tokens> [type]' + RESET); process.exit(1); }
      var trackResult = trackUsage(args[1], parseInt(args[2], 10), args[3]);
      if (trackResult) {
        console.log(GREEN + '✓' + RESET + ' Uso registrado em metrics.json');
        console.log('  Model:  ' + args[1]);
        console.log('  Tokens: ' + args[2]);
        console.log('  Total acumulado: ' + trackResult.tokens + ' tokens, $' + trackResult.cost.toFixed(6) + ', ' + trackResult.calls + ' calls');
      }
      break;
    case 'track-real':
      if (!args[1] || !args[2] || !args[3]) { console.error(RED + '❌ Uso: node token-tracker.js track-real <model> <inputTokens> <outputTokens>' + RESET); process.exit(1); }
      var realResult = trackUsageReal(args[1], parseInt(args[2], 10), parseInt(args[3], 10));
      if (realResult) {
        console.log(GREEN + '✓' + RESET + ' Uso real registrado em metrics.json (token_usage_real)');
        console.log('  Model:        ' + args[1]);
        console.log('  Input tokens: ' + args[2]);
        console.log('  Output tokens:' + args[3]);
        console.log('  Total acumulado: ' + realResult.total_tokens + ' tokens, $' + realResult.total_cost.toFixed(6) + ', ' + realResult.calls + ' calls');
        console.log('    Input:  ' + realResult.input_tokens + ' tokens ($' + realResult.input_cost.toFixed(6) + ')');
        console.log('    Output: ' + realResult.output_tokens + ' tokens ($' + realResult.output_cost.toFixed(6) + ')');
      }
      break;
    case 'report':
      var report = getReport();
      console.log('');
      console.log(CYAN + BOLD + 'Token Usage Report' + RESET);
      console.log('');
      console.log('  Total tokens: ' + report.totalTokens);
      console.log('  Total cost:   $' + report.totalCost.toFixed(6));
      console.log('  Models used:  ' + report.models);
      console.log('');
      if (report.details.length > 0) {
        console.log('  Per model (legacy):');
        for (var i = 0; i < report.details.length; i++) {
          var d = report.details[i];
          console.log('    ' + (i + 1) + '. ' + CYAN + d.model + RESET + ': ' + d.tokens + ' tokens, $' + d.cost.toFixed(6) + ', ' + d.calls + ' calls');
        }
        console.log('');
      }
      if (report.realDetails && report.realDetails.length > 0) {
        console.log('  Per model (real, input/output separados):');
        for (var i = 0; i < report.realDetails.length; i++) {
          var rd = report.realDetails[i];
          console.log('    ' + (i + 1) + '. ' + CYAN + rd.model + RESET);
          console.log('       Input:  ' + rd.input_tokens + ' tokens ($' + rd.input_cost.toFixed(6) + ')');
          console.log('       Output: ' + rd.output_tokens + ' tokens ($' + rd.output_cost.toFixed(6) + ')');
          console.log('       Total:  ' + rd.total_tokens + ' tokens ($' + rd.total_cost.toFixed(6) + ')');
          console.log('       Calls:  ' + rd.calls);
        }
        console.log('');
      }
      break;
    case 'rates':
      var rates = getRates();
      console.log('');
      console.log(CYAN + BOLD + 'Configured Rates' + RESET);
      console.log('');
      for (var model of Object.keys(rates)) {
        var r = rates[model];
        console.log('  ' + CYAN + model + RESET);
        console.log('    Input:   $' + (r.input || 0).toFixed(5) + '/1K tokens');
        console.log('    Output:  $' + (r.output || 0).toFixed(5) + '/1K tokens');
        console.log('    Desc:    ' + (r.description || ''));
        console.log('');
      }
      break;
    case 'reload':
      reloadRates();
      console.log(GREEN + '✓' + RESET + ' Taxas recarregadas');
      break;
    default:
      printHelp();
      if (cmd) process.exit(1);
  }
}

module.exports = { estimateTokens, estimateTokensFromModel, estimateTokensFromModelSync, estimateCost, trackUsage, trackUsageReal, getReport, getRates, reloadRates };
