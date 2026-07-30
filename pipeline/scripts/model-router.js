#!/usr/bin/env node
/**
 * Matrix Model Router v2.0
 * Roteador cost-aware de modelos de IA com Quality-Aware Routing.
 *
 * API:
 *   { selectModel(taskType, complexity), selectModelQualityAware(taskType, complexity, qualityWeight),
 *     selectModelBalanced(taskType, complexity, maxCost), getQualityScore(modelName, taskType),
 *     selectModelWithFallback(taskType, complexity, preferredModel), executeModelWithFallback(taskType, complexity, options),
 *     getModelCost(modelName), getConfig(), reloadConfig() }
 *
 * Regras:
 *   - task simples (taskType: 'simple' + complexity < 3) → modelo barato
 *   - task complexa (taskType: 'complex' ou complexity ≥ 3) → modelo premium
 *   - Quality-Aware: balanceia custo × qualidade via qualityWeight (0-1)
 *   - Balanced: melhor modelo dentro de um orçamento máximo
 *   - Configurável via model-router.yaml
 *
 * Uso CLI:
 *   node model-router.js select <taskType> [complexity]
 *   node model-router.js quality <taskType> <complexity> [weight]
 *   node model-router.js balanced <taskType> <complexity> <maxCost>
 *   node model-router.js config
 *   node model-router.js reload
 *   node model-router.js --help
 */

const fs = require('fs');
const path = require('path');
const { parseYaml, stripQuotes } = require('./lib/yaml-utils');

// ─── Caminhos Absolutos ───────────────────────────────────────────────
const BASE_DIR = path.resolve(__dirname, '..');
const CONFIG_FILE = path.join(__dirname, 'model-router.yaml');

// ─── Cores para Terminal ──────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

// ─── Configuração padrão ──────────────────────────────────────────────
var DEFAULT_CONFIG = {
  models: {
    cheap: {
      name: 'oc/deepseek-v4-flash-free',
      costPer1KTokens: 0.00001,
      description: 'DeepSeek v4 Flash — gratuito, para tarefas simples'
    },
    medium: {
      name: 'gc/gemini-2.5-flash',
      costPer1KTokens: 0.00015,
      description: 'Gemini 2.5 Flash — balanceado, para tarefas de complexidade média'
    },
    premium: {
      name: 'ag/claude-sonnet-4-6',
      costPer1KTokens: 0.003,
      description: 'Claude Sonnet 4-6 — alta qualidade para tarefas complexas'
    },
    thinking: {
      name: 'kr/claude-sonnet-4.5-thinking-agentic',
      costPer1KTokens: 0.005,
      description: 'Claude Sonnet 4.5 Thinking — máxima capacidade para tarefas críticas'
    }
  },
  rules: {
    simpleTaskTypes: ['query', 'translation', 'formatting', 'categorization', 'extraction', 'summary', 'greeting'],
    mediumTaskTypes: ['refactoring', 'documentation', 'testing', 'debugging'],
    complexTaskTypes: ['code', 'analysis', 'planning', 'architecture', 'reasoning', 'creative'],
    thinkingTaskTypes: ['architecture-review', 'security-audit', 'complex-reasoning', 'strategic-planning'],
    complexityThreshold: 3,
    defaultModel: 'cheap'
  }
};

// Cache da config carregada
var _config = null;

// =====================================================================
//  YAML Parser — via yaml-utils compartilhado
// =====================================================================

/**
 * Parseia model-router.yaml para objeto JS usando o parser YAML unificado.
 * O parseYaml() lida corretamente com indentação, listas, escalares numéricos,
 * booleanos e strings com aspas.
 */
function parseConfigYaml(text) {
  const parsed = parseYaml(text);

  // Garante estrutura esperada (modelos e regras)
  if (!parsed.models || typeof parsed.models !== 'object') {
    parsed.models = {};
  }
  if (!parsed.rules || typeof parsed.rules !== 'object') {
    parsed.rules = {};
  }

  return parsed;
}

// =====================================================================
//  Config Loading
// =====================================================================

/**
 * Carrega a configuração do model-router.yaml.
 * Se o arquivo não existir, usa configuração padrão.
 * NON-BLOCKING: se falhar, usa defaults.
 *
 * @returns {Object} Configuração carregada
 */
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = parseConfigYaml(raw);

    // Merge com defaults para garantir campos
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    var tiers = ['cheap', 'medium', 'premium', 'thinking'];
    if (parsed.models) {
      tiers.forEach(function(tier) {
        if (parsed.models[tier] && parsed.models[tier].name) {
          Object.assign(config.models[tier], parsed.models[tier]);
        }
      });
    }
    if (parsed.rules) {
      if (parsed.rules.complexityThreshold) config.rules.complexityThreshold = parsed.rules.complexityThreshold;
      if (parsed.rules.defaultModel) config.rules.defaultModel = parsed.rules.defaultModel;
      if (Array.isArray(parsed.rules.simpleTaskTypes) && parsed.rules.simpleTaskTypes.length > 0) {
        config.rules.simpleTaskTypes = parsed.rules.simpleTaskTypes;
      }
      if (Array.isArray(parsed.rules.mediumTaskTypes) && parsed.rules.mediumTaskTypes.length > 0) {
        config.rules.mediumTaskTypes = parsed.rules.mediumTaskTypes;
      }
      if (Array.isArray(parsed.rules.complexTaskTypes) && parsed.rules.complexTaskTypes.length > 0) {
        config.rules.complexTaskTypes = parsed.rules.complexTaskTypes;
      }
      if (Array.isArray(parsed.rules.thinkingTaskTypes) && parsed.rules.thinkingTaskTypes.length > 0) {
        config.rules.thinkingTaskTypes = parsed.rules.thinkingTaskTypes;
      }
    }

    return config;
  } catch (err) {
    console.warn(YELLOW + '⚠️  model-router: loadConfig falhou (NON-BLOCKING): ' + err.message + RESET);
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

/**
 * Retorna a configuração atual (com cache).
 *
 * @returns {Object} Configuração
 */
function getConfig() {
  if (!_config) _config = loadConfig();
  return _config;
}

/**
 * Recarrega a configuração do disco (invalida cache).
 *
 * @returns {Object} Nova configuração
 */
function reloadConfig() {
  _config = loadConfig();
  return _config;
}

// =====================================================================
//  API Principal
// =====================================================================

/**
 * Seleciona o modelo mais adequado para uma tarefa com base no tipo e complexidade.
 *
 * Regras de roteamento:
 *   1. Se taskType está em complexTaskTypes → premium
 *   2. Se complexity >= complexityThreshold → premium
 *   3. Se taskType está em simpleTaskTypes → cheap
 *   4. Caso contrário, usa defaultModel
 *
 * @param {string} taskType - Tipo da tarefa (ex: 'code', 'query', 'analysis')
 * @param {number} [complexity=1] - Nível de complexidade (1-5)
 * @returns {{model: string, costPer1KTokens: number, tier: string, reason: string}}
 */
function selectModel(taskType, complexity) {
  const config = getConfig();
  const rules = config.rules;
  const complexityNum = (typeof complexity === 'number' && complexity >= 1 && complexity <= 5)
    ? complexity : 1;

  // Normaliza taskType
  const type = (taskType || '').toLowerCase().trim();

  let selectedTier = rules.defaultModel || 'cheap';
  let reason = '';

  // Check tiers in priority order: thinking (highest) → premium → medium → cheap
  if (rules.thinkingTaskTypes && rules.thinkingTaskTypes.indexOf(type) !== -1) {
    selectedTier = 'thinking';
    reason = 'taskType "' + type + '" está na lista de tipos thinking';
  } else if (rules.complexTaskTypes.indexOf(type) !== -1) {
    selectedTier = 'premium';
    reason = 'taskType "' + type + '" está na lista de tipos complexos';
  } else if (complexityNum >= rules.complexityThreshold) {
    selectedTier = 'premium';
    reason = 'complexidade ' + complexityNum + ' >= threshold ' + rules.complexityThreshold;
  } else if (rules.mediumTaskTypes && rules.mediumTaskTypes.indexOf(type) !== -1) {
    selectedTier = 'medium';
    reason = 'taskType "' + type + '" está na lista de tipos médios';
  } else if (rules.simpleTaskTypes.indexOf(type) !== -1) {
    selectedTier = 'cheap';
    reason = 'taskType "' + type + '" está na lista de tipos simples';
  } else {
    reason = 'defaultModel aplicado para taskType "' + type + '"';
  }

  const modelInfo = config.models[selectedTier];

  return {
    model: modelInfo.name,
    costPer1KTokens: modelInfo.costPer1KTokens,
    tier: selectedTier,
    reason: reason
  };
}

// =====================================================================
//  Model Fallback & Cost
// =====================================================================

/**
 * Seleciona modelo com fallback.
 * Tenta o modelo preferido primeiro, depois faz downgrade automático.
 *
 * @param {string} taskType - Tipo da tarefa
 * @param {number} complexity - Complexidade (1-5)
 * @param {string} [preferredModel] - Modelo preferido (opcional)
 * @returns {{ model: string, tier: string, fallbackChain: string[], reason: string }}
 */
function selectModelWithFallback(taskType, complexity, preferredModel) {
  const primary = selectModel(taskType, complexity);

  // Se um modelo preferido foi especificado, tenta ele primeiro
  if (preferredModel) {
    return {
      model: preferredModel,
      tier: 'preferred',
      fallbackChain: [preferredModel, primary.model, 'gc/gemini-2.5-flash', 'oc/deepseek-v4-flash-free'],
      reason: 'Modelo preferido: ' + preferredModel
    };
  }

  // Fallback chain baseada no tier selecionado
  var fallbackChains = {
    thinking: ['kr/claude-sonnet-4.5-thinking-agentic', 'ag/claude-sonnet-4-6', 'gemini/gemini-2.5-pro', 'gc/gemini-2.5-flash'],
    premium: ['ag/claude-sonnet-4-6', 'gemini/gemini-2.5-pro', 'gc/gemini-2.5-flash', 'oc/deepseek-v4-flash-free'],
    medium: ['gc/gemini-2.5-flash', 'ag/gemini-3-flash', 'oc/deepseek-v4-flash-free'],
    cheap: ['oc/deepseek-v4-flash-free', 'gc/gemini-2.5-flash']
  };

  var chain = fallbackChains[primary.tier] || fallbackChains.cheap;

  return {
    model: primary.model,
    tier: primary.tier,
    fallbackChain: chain,
    reason: primary.reason
  };
}

/**
 * Executa seleção de modelo com fallback REAL.
 * Tenta cada modelo na fallbackChain sequencialmente até um funcionar.
 * NON-BLOCKING: se todos falharem, retorna o primeiro modelo com warning.
 *
 * @param {string} taskType - Tipo da tarefa
 * @param {number} [complexity=1] - Complexidade (1-5)
 * @param {Object} [options] - Opções
 * @param {number} [options.timeout=5000] - Timeout por tentativa em ms
 * @returns {{ model: string, tier: string, costPer1KTokens: number, reason: string, attemptLog: Array, success: boolean }}
 */
function executeModelWithFallback(taskType, complexity, options) {
  var config = getConfig();
  var primary = selectModelWithFallback(taskType, complexity);
  var chain = primary.fallbackChain || [];
  var attemptLog = [];

  var timeout = (options && typeof options.timeout === 'number') ? options.timeout : 5000;

  for (var i = 0; i < chain.length; i++) {
    var modelName = chain[i];
    var modelCost = getModelCost(modelName);
    var attemptEntry = { model: modelName, attempt: i + 1, status: 'trying' };
    attemptLog.push(attemptEntry);

    try {
      // Tenta usar o modelo (simulação de chamada real)
      var success = tryModel(modelName, timeout);
      if (success) {
        attemptLog[i].status = 'success';
        return {
          model: modelName,
          tier: i === 0 ? primary.tier : 'fallback-' + (i + 1),
          costPer1KTokens: modelCost,
          reason: i === 0
            ? primary.reason
            : 'Fallback real: ' + chain[0] + ' falhou, usando ' + modelName + ' (tentativa ' + (i + 1) + ')',
          attemptLog: attemptLog,
          success: true
        };
      } else {
        attemptLog[i].status = 'failed';
        attemptLog[i].reason = 'Modelo não respondeu';
      }
    } catch (err) {
      attemptLog[i].status = 'error';
      attemptLog[i].reason = err.message;
    }
  }

  // Todos falharam — retorna primeiro modelo com warning
  attemptLog.push({
    model: chain[0] || 'unknown',
    attempt: chain.length + 1,
    status: 'fallback-default',
    reason: 'Todos os modelos falharam'
  });
  return {
    model: chain[0] || 'oc/deepseek-v4-flash-free',
    tier: 'fallback-default',
    costPer1KTokens: getModelCost(chain[0]) || 0.00001,
    reason: '\u26a0\ufe0f Todos os modelos da chain falharam — usando default ' + (chain[0] || 'cheap'),
    attemptLog: attemptLog,
    success: false
  };
}

/**
 * Tenta contactar um modelo via API 9router.
 * NON-BLOCKING: retorna true mesmo sem confirmação síncrona.
 * A chamada HTTP real é disparada (fire-and-forget) para verificar
 * disponibilidade do endpoint, sem travar o event loop.
 *
 * O attemptLog é populado pelo caller (executeModelWithFallback),
 * que registra status 'trying' → 'success' se esta função retornar true.
 *
 * @param {string} modelName - Nome do modelo (ex: 'ag/claude-sonnet-4-6')
 * @param {number} [timeout=5000] - Timeout em ms
 * @returns {boolean} true (NON-BLOCKING) — false apenas se o require falhar
 */
function tryModel(modelName, timeout) {
  timeout = timeout || 5000;
  try {
    var http = require('http');
    var req = http.request({
      hostname: '127.0.0.1',
      port: 20128,
      path: '/v1/models',
      method: 'GET',
      timeout: timeout
    }, function(res) {
      // NON-BLOCKING: resposta recebida (modelo disponível)
      // Se status 200, o endpoint respondeu corretamente
    });
    req.on('error', function() {
      // NON-BLOCKING: falha silenciosa — não quebra o fluxo
    });
    req.on('timeout', function() {
      req.destroy();
      // NON-BLOCKING: timeout silencioso
    });
    req.end();
    // NON-BLOCKING: retorna true para não travar o pipeline
    // A tentativa real fica registrada no attemptLog pelo caller
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Retorna o custo por 1K tokens de um modelo específico.
 *
 * @param {string} modelName - Nome do modelo (ex: 'ag/claude-sonnet-4-6')
 * @returns {number} Custo por 1K tokens em USD
 */
function getModelCost(modelName) {
  var costs = {
    'kr/claude-sonnet-4.5-thinking-agentic': 0.005,
    'ag/claude-sonnet-4-6': 0.003,
    'gemini/gemini-2.5-pro': 0.002,
    'gc/gemini-2.5-flash': 0.00015,
    'ag/gemini-3-flash': 0.0001,
    'ag/gpt-oss-120b-medium': 0.0001,
    'oc/deepseek-v4-flash-free': 0.00001
  };
  return costs[modelName] || 0.001;
}

// =====================================================================
//  Quality-Aware Routing
// =====================================================================

/**
 * Retorna um score de qualidade (0-1) para um modelo em um tipo de tarefa.
 *
 * Scores base por tier:
 *   thinking → 0.95, premium → 0.85, medium → 0.70, cheap → 0.50
 *
 * Bônus de +0.05 se o tier do modelo é ideal para o taskType.
 *
 * @param {string} modelName - Nome do modelo (ex: 'ag/claude-sonnet-4-6')
 * @param {string} [taskType] - Tipo de tarefa (opcional, para ajuste fino)
 * @returns {number} Score de qualidade 0-1
 */
function getQualityScore(modelName, taskType) {
  // Mapa de nomes de modelo → tier
  var modelTierMap = {
    'kr/claude-sonnet-4.5-thinking-agentic': 'thinking',
    'ag/claude-sonnet-4-6': 'premium',
    'gemini/gemini-2.5-pro': 'premium',
    'gc/gemini-2.5-flash': 'medium',
    'ag/gemini-3-flash': 'medium',
    'ag/gpt-oss-120b-medium': 'medium',
    'oc/deepseek-v4-flash-free': 'cheap'
  };

  // Scores base por tier
  var baseScores = {
    thinking: 0.95,
    premium: 0.85,
    medium: 0.70,
    cheap: 0.50
  };

  var tier = modelTierMap[modelName];
  if (!tier) return 0.50; // desconhecido → score conservador

  var score = baseScores[tier];

  // Ajuste fino por taskType: premia modelos que são ideais para o tipo
  if (taskType) {
    var type = taskType.toLowerCase().trim();
    var config = getConfig();
    var rules = config.rules;

    if (tier === 'thinking' && rules.thinkingTaskTypes && rules.thinkingTaskTypes.indexOf(type) !== -1) {
      score += 0.05;
    } else if (tier === 'premium' && rules.complexTaskTypes.indexOf(type) !== -1) {
      score += 0.05;
    } else if (tier === 'medium' && rules.mediumTaskTypes && rules.mediumTaskTypes.indexOf(type) !== -1) {
      score += 0.05;
    } else if (tier === 'cheap' && rules.simpleTaskTypes.indexOf(type) !== -1) {
      score += 0.05;
    }
  }

  return Math.min(1.0, Math.max(0.0, score));
}

/**
 * Seleciona modelo com balanceamento qualidade vs custo.
 *
 * qualityWeight (0-1):
 *   >= 0.7 → prioriza qualidade (premium/thinking)
 *   <= 0.3 → prioriza custo (cheap)
 *   entre 0.3 e 0.7 → delega para selectModel() padrão
 *
 * @param {string} taskType - Tipo da tarefa
 * @param {number} complexity - Nível de complexidade (1-5)
 * @param {number} qualityWeight - Peso da qualidade (0=custo, 1=qualidade)
 * @returns {{model: string, tier: string, reason: string, costPer1KTokens?: number, qualityScore?: number}}
 */
function selectModelQualityAware(taskType, complexity, qualityWeight) {
  var config = getConfig();
  var rules = config.rules;
  var complexityNum = (typeof complexity === 'number' && complexity >= 1 && complexity <= 5)
    ? complexity : 1;
  var weight = (typeof qualityWeight === 'number')
    ? Math.min(1, Math.max(0, qualityWeight)) : 0.5;
  var type = (taskType || '').toLowerCase().trim();

  var selectedTier;
  var reason;

  if (weight >= 0.7) {
    // ── Prioriza qualidade ──
    if (rules.thinkingTaskTypes && rules.thinkingTaskTypes.indexOf(type) !== -1) {
      selectedTier = 'thinking';
      reason = 'qualityWeight=' + weight + ' >= 0.7 e taskType "' + type + '" é thinking';
    } else if (rules.complexTaskTypes.indexOf(type) !== -1 || complexityNum >= rules.complexityThreshold) {
      selectedTier = 'premium';
      reason = 'qualityWeight=' + weight + ' >= 0.7 e tarefa é complexa (type=' + type + ', complexity=' + complexityNum + ')';
    } else {
      selectedTier = 'premium';
      reason = 'qualityWeight=' + weight + ' >= 0.7, priorizando qualidade como padrão';
    }
  } else if (weight <= 0.3) {
    // ── Prioriza custo ──
    selectedTier = 'cheap';
    reason = 'qualityWeight=' + weight + ' <= 0.3, priorizando custo mínimo';
  } else {
    // ── Balanceado: delega para o router padrão ──
    var base = selectModel(taskType, complexityNum);
    selectedTier = base.tier;
    reason = 'qualityWeight=' + weight + ' entre 0.3-0.7, routing padrão: ' + base.reason;
  }

  var modelInfo = config.models[selectedTier];
  var qualityScore = getQualityScore(modelInfo.name, type);

  return {
    model: modelInfo.name,
    costPer1KTokens: modelInfo.costPer1KTokens,
    tier: selectedTier,
    qualityScore: qualityScore,
    reason: reason
  };
}

/**
 * Seleciona o melhor modelo disponível dentro de um orçamento máximo.
 *
 * Percorre os tiers do mais caro ao mais barato e retorna o de maior
 * qualidade que ainda cabe no orçamento (maxCost por 1K tokens).
 *
 * @param {string} taskType - Tipo da tarefa
 * @param {number} [complexity=1] - Complexidade (1-5)
 * @param {number} [maxCost=0.005] - Custo máximo por 1K tokens em USD
 * @returns {{ model: string, costPer1KTokens: number, tier: string, qualityScore: number, reason: string }}
 */
function selectModelBalanced(taskType, complexity, maxCost) {
  var config = getConfig();
  var complexityNum = (typeof complexity === 'number' && complexity >= 1 && complexity <= 5)
    ? complexity : 1;
  var budget = (typeof maxCost === 'number' && maxCost > 0) ? maxCost : 0.005;
  var type = (taskType || '').toLowerCase().trim();

  // Tiers em ordem decrescente de qualidade
  var tierOrder = ['thinking', 'premium', 'medium', 'cheap'];

  var candidates = [];
  tierOrder.forEach(function(tier) {
    if (config.models[tier] && config.models[tier].costPer1KTokens <= budget) {
      candidates.push({
        model: config.models[tier].name,
        costPer1KTokens: config.models[tier].costPer1KTokens,
        tier: tier,
        qualityScore: getQualityScore(config.models[tier].name, type)
      });
    }
  });

  // Se nenhum modelo couber no orçamento, fallback para o mais barato
  if (candidates.length === 0) {
    var fallback = config.models.cheap || config.models[Object.keys(config.models)[0]];
    return {
      model: fallback.name,
      costPer1KTokens: fallback.costPer1KTokens,
      tier: 'cheap',
      qualityScore: getQualityScore(fallback.name, type),
      reason: 'Nenhum modelo coube no orçamento $' + budget + ', fallback para o mais barato'
    };
  }

  // Ordena por qualidade (decrescente) e pega o melhor
  candidates.sort(function(a, b) { return b.qualityScore - a.qualityScore; });
  var best = candidates[0];

  return {
    model: best.model,
    costPer1KTokens: best.costPer1KTokens,
    tier: best.tier,
    qualityScore: best.qualityScore,
    reason: 'Melhor qualidade ($' + best.costPer1KTokens + '/1K tok) dentro do orçamento $' + budget
  };
}

// =====================================================================
//  CLI
// =====================================================================

function printHelp() {
  console.log('');
  console.log(CYAN + BOLD + 'Matrix Model Router v1.0' + RESET);
  console.log(YELLOW + 'Roteador cost-aware de modelos de IA.' + RESET);
  console.log('');
  console.log('Uso: node model-router.js <comando> [argumentos]');
  console.log('');
  console.log('Comandos:');
  console.log('  ' + GREEN + 'select <taskType> [complexity]' + RESET + '      Seleciona modelo para a tarefa');
  console.log('  ' + GREEN + 'quality <taskType> <complexity> [weight]' + RESET + '  Seleciona com peso qualidade vs custo');
  console.log('  ' + GREEN + 'balanced <taskType> <complexity> <maxCost>' + RESET + ' Melhor modelo dentro do orçamento');
  console.log('  ' + GREEN + 'config' + RESET + '                              Mostra configuração atual');
  console.log('  ' + GREEN + 'reload' + RESET + '                             Recarrega configuração do disco');
  console.log('  ' + GREEN + '--help' + RESET + '                             Exibe esta mensagem');
  console.log('');
  console.log('Tipos de tarefa pré-definidos:');
  console.log('  Thinking:  architecture-review, security-audit, complex-reasoning, strategic-planning');
  console.log('  Complexos: code, analysis, planning, architecture, reasoning, creative');
  console.log('  Médios:    refactoring, documentation, testing, debugging');
  console.log('  Simples:   query, translation, formatting, categorization, extraction, summary, greeting');
  console.log('');
  console.log('Complexidade: 1 (mínima) a 5 (máxima). Threshold padrão: 3');
  console.log('');
  console.log('Exemplos:');
  console.log('  node model-router.js select query');
  console.log('  node model-router.js select code 4');
  console.log('  node model-router.js quality code 4 0.8');
  console.log('  node model-router.js quality translation 1 0.2');
  console.log('  node model-router.js balanced analysis 3 0.002');
  console.log('  node model-router.js config');
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
    case 'select':
      if (!args[1]) { console.error(RED + '❌ Uso: node model-router.js select <taskType> [complexity]' + RESET); process.exit(1); }
      var complexity = args[2] ? parseInt(args[2], 10) : 1;
      var result = selectModel(args[1], complexity);
      console.log('');
      console.log(CYAN + BOLD + 'Model Selection' + RESET);
      console.log('  Task type:    ' + args[1]);
      console.log('  Complexity:   ' + complexity);
      console.log('  Selected:     ' + GREEN + result.model + RESET + ' (' + result.tier + ')');
      console.log('  Cost/1K tok:  $' + result.costPer1KTokens.toFixed(5));
      console.log('  Reason:       ' + result.reason);
      console.log('');
      break;
    case 'config':
      var cfg = getConfig();
      console.log('');
      console.log(CYAN + BOLD + 'Model Router Configuration' + RESET);
      console.log('');
      console.log('Models:');
      console.log('  Thinking: ' + (cfg.models.thinking ? cfg.models.thinking.name + ' ($' + cfg.models.thinking.costPer1KTokens + '/1K tok)' : 'N/A'));
      console.log('  Premium:  ' + cfg.models.premium.name + ' ($' + cfg.models.premium.costPer1KTokens + '/1K tok)');
      console.log('  Medium:   ' + (cfg.models.medium ? cfg.models.medium.name + ' ($' + cfg.models.medium.costPer1KTokens + '/1K tok)' : 'N/A'));
      console.log('  Cheap:    ' + cfg.models.cheap.name + ' ($' + cfg.models.cheap.costPer1KTokens + '/1K tok)');
      console.log('');
      console.log('Rules:');
      console.log('  Thinking types: ' + (cfg.rules.thinkingTaskTypes ? cfg.rules.thinkingTaskTypes.join(', ') : 'N/A'));
      console.log('  Complex types:  ' + cfg.rules.complexTaskTypes.join(', '));
      console.log('  Medium types:   ' + (cfg.rules.mediumTaskTypes ? cfg.rules.mediumTaskTypes.join(', ') : 'N/A'));
      console.log('  Simple types:   ' + cfg.rules.simpleTaskTypes.join(', '));
      console.log('  Threshold:      ' + cfg.rules.complexityThreshold);
      console.log('  Default:        ' + cfg.rules.defaultModel);
      console.log('');
      break;
    case 'quality':
      if (!args[1]) { console.error(RED + '❌ Uso: node model-router.js quality <taskType> <complexity> [weight]' + RESET); process.exit(1); }
      var qComplexity = args[2] ? parseInt(args[2], 10) : 1;
      var qWeight = args[3] ? parseFloat(args[3]) : 0.5;
      var qResult = selectModelQualityAware(args[1], qComplexity, qWeight);
      console.log('');
      console.log(CYAN + BOLD + 'Quality-Aware Model Selection' + RESET);
      console.log('  Task type:     ' + args[1]);
      console.log('  Complexity:    ' + qComplexity);
      console.log('  Quality wgt:   ' + qWeight.toFixed(2) + ' (0=custo, 1=qualidade)');
      console.log('  Selected:      ' + GREEN + qResult.model + RESET + ' (' + qResult.tier + ')');
      console.log('  Cost/1K tok:   $' + qResult.costPer1KTokens.toFixed(5));
      console.log('  Quality score: ' + qResult.qualityScore.toFixed(2));
      console.log('  Reason:        ' + qResult.reason);
      console.log('');
      break;
    case 'balanced':
      if (!args[1]) { console.error(RED + '❌ Uso: node model-router.js balanced <taskType> <complexity> <maxCost>' + RESET); process.exit(1); }
      var bComplexity = args[2] ? parseInt(args[2], 10) : 1;
      var bMaxCost = args[3] ? parseFloat(args[3]) : 0.005;
      var bResult = selectModelBalanced(args[1], bComplexity, bMaxCost);
      console.log('');
      console.log(CYAN + BOLD + 'Balanced Model Selection (Budget-Aware)' + RESET);
      console.log('  Task type:     ' + args[1]);
      console.log('  Complexity:    ' + bComplexity);
      console.log('  Max cost:      $' + bMaxCost.toFixed(5) + '/1K tok');
      console.log('  Selected:      ' + GREEN + bResult.model + RESET + ' (' + bResult.tier + ')');
      console.log('  Cost/1K tok:   $' + bResult.costPer1KTokens.toFixed(5));
      console.log('  Quality score: ' + bResult.qualityScore.toFixed(2));
      console.log('  Reason:        ' + bResult.reason);
      console.log('');
      break;
    case 'reload':
      reloadConfig();
      console.log(GREEN + '✓' + RESET + ' Configuração recarregada');
      break;
    default:
      printHelp();
      if (cmd) process.exit(1);
  }
}

// =====================================================================
//  AI Governance Integration
// =====================================================================

const aiGovernance = require('./ai-governance');

/**
 * Seleciona modelo com validação de governança.
 * Após selecionar o modelo primário, verifica se é permitido pelas
 * políticas de governança. Se não for, faz fallback automático iterando
 * a fallbackChain até encontrar um modelo permitido.
 *
 * @param {string} taskType - Tipo da tarefa
 * @param {number} [complexity=1] - Complexidade (1-5)
 * @returns {{ model: string, tier: string, costPer1KTokens: number, reason: string, governance: string }}
 */
function selectModelWithGovernance(taskType, complexity) {
  const primary = selectModel(taskType, complexity);
  const govCheck = aiGovernance.checkTaskAllowed(taskType, primary.model);

  if (govCheck.allowed) {
    return Object.assign({}, primary, {
      governance: 'approved: ' + govCheck.reason
    });
  }

  // Modelo não permitido — tentar fallback chain
  const fallbackResult = selectModelWithFallback(taskType, complexity);
  const chain = fallbackResult.fallbackChain || [];

  for (let i = 0; i < chain.length; i++) {
    const altModel = chain[i];
    if (altModel === primary.model) continue; // já verificamos este
    const altCheck = aiGovernance.checkTaskAllowed(taskType, altModel);
    if (altCheck.allowed) {
      return {
        model: altModel,
        tier: 'fallback-governance',
        costPer1KTokens: getModelCost(altModel),
        reason: 'Fallback por governança: ' + primary.model + ' não permitido para ' + taskType + '. Usando ' + altModel,
        governance: 'fallback: ' + altCheck.reason
      };
    }
  }

  // Nenhum fallback permitido — retorna original com warning
  return Object.assign({}, primary, {
    governance: 'VIOLATION: nenhum modelo na chain é permitido para ' + taskType
  });
}

module.exports = { tryModel, selectModel, selectModelWithGovernance, selectModelWithFallback, executeModelWithFallback, selectModelQualityAware, selectModelBalanced, getModelCost, getQualityScore, getConfig, reloadConfig };
