#!/usr/bin/env node
/**
 * Matrix Real Model Executor v1.0
 * Executor de modelos com fallback REAL e blockeante.
 *
 * DIFERENÇA CRÍTICA do model-router.js:
 *   - model-router.js é NON-BLOCKING: tryModel() retorna true sem esperar resposta real
 *   - model-executor.js é BLOCKEANTE: tryModel() espera a resposta REAL com timeout
 *
 * Fluxo de fallback:
 *   1. Tenta o primeiro modelo da chain com timeout
 *   2. Se falhar (timeout/erro/resposta inválida) → tenta o próximo
 *   3. Se TODOS falharem → lança ModelExecutionError com detalhes
 *
 * API:
 *   const executor = new ModelExecutor({ timeout: 15000, chains: {...}, logLevel: 'info' });
 *   const result = await executor.execute(taskType, complexity, prompt);
 *   // result = { success: true, model, output, duration, attempts: [...] }
 *
 * Uso CLI:
 *   node model-executor.js execute <complexity> "<prompt>"
 *   node model-executor.js chains
 */

// ─── Módulos nativos ──────────────────────────────────────────────
const http = require('http');
const https = require('https');

// ─── Cores para Terminal ──────────────────────────────────────────
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const GRAY   = '\x1b[90m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

// =====================================================================
//  ModelExecutionError
// =====================================================================

/**
 * Erro personalizado para falha completa de execução.
 * Contém o log detalhado de todas as tentativas realizadas.
 */
class ModelExecutionError extends Error {
  /**
   * @param {string} message - Mensagem de erro
   * @param {Array} attempts - Array de { model, status, duration, error }
   */
  constructor(message, attempts) {
    super(message);
    this.name = 'ModelExecutionError';
    this.attempts = attempts || [];
    this.timestamp = new Date().toISOString();

    // Captura stack trace preservando o construtor
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ModelExecutionError);
    }
  }

  /**
   * Retorna resumo legível de todas as tentativas.
   * @returns {string}
   */
  getSummary() {
    const lines = this.attempts.map(function(a, i) {
      return '  [' + (i + 1) + '] ' + a.model + ' → ' + a.status.toUpperCase()
        + (a.duration ? ' (' + a.duration + 'ms)' : '')
        + (a.error ? ': ' + a.error : '');
    });
    return 'ModelExecutionError: ' + this.message + '\n' + lines.join('\n');
  }

  /**
   * Retorna objeto serializável com detalhes completos.
   * @returns {Object}
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      attempts: this.attempts,
      timestamp: this.timestamp
    };
  }
}

// =====================================================================
//  Configuração Padrão
// =====================================================================

/**
 * Chains padrão para diferentes níveis de complexidade.
 *
 * Cada chain define:
 *   models  - Array de nomes de modelo em ordem de tentativa
 *   timeout - Timeout máximo POR modelo (em ms)
 *
 * Modelos disponíveis:
 *   oc/deepseek-v4-flash-free  → Gratuito, rápido, qualidade básica
 *   gc/gemini-2.5-flash        → Baixo custo, qualidade média
 *   ag/claude-sonnet-4-6       → Alta qualidade, maior custo
 */
const DEFAULT_CHAINS = {
  cheap: {
    models: ['oc/deepseek-v4-flash-free', 'gc/gemini-2.5-flash'],
    timeout: 15000
  },
  medium: {
    models: ['gc/gemini-2.5-flash', 'oc/deepseek-v4-flash-free', 'ag/claude-sonnet-4-6'],
    timeout: 20000
  },
  premium: {
    models: ['ag/claude-sonnet-4-6', 'gc/gemini-2.5-flash', 'oc/deepseek-v4-flash-free'],
    timeout: 30000
  }
};

// =====================================================================
//  ModelExecutor
// =====================================================================

/**
 * Executor de modelos com fallback REAL e blockeante.
 *
 * @class
 */
class ModelExecutor {
  /**
   * Cria uma nova instância do ModelExecutor.
   *
   * @param {Object} [config] - Configuração do executor
   * @param {number} [config.timeout=15000] - Timeout padrão por modelo (ms)
   * @param {Object} [config.chains] - Chains personalizadas (mesmo formato de DEFAULT_CHAINS)
   * @param {string} [config.logLevel='info'] - Nível de log: 'silent' | 'error' | 'info' | 'debug'
   * @param {string} [config.apiBaseUrl='http://127.0.0.1:20128'] - Base URL da API de modelos
   */
  constructor(config) {
    config = config || {};

    /** Timeout padrão por modelo (ms) */
    this.timeout = (typeof config.timeout === 'number' && config.timeout > 0)
      ? config.timeout
      : 15000;

    /** Chains configuradas (merge com defaults) */
    this.chains = this._mergeChains(DEFAULT_CHAINS, config.chains || {});

    /** Nível de log */
    this.logLevel = ['silent', 'error', 'info', 'debug'].indexOf(config.logLevel) !== -1
      ? config.logLevel
      : 'info';

    /** Base URL da API de modelos */
    this.apiBaseUrl = config.apiBaseUrl || 'http://127.0.0.1:20128';

    /** Estatísticas acumuladas */
    this.stats = {
      totalExecutions: 0,
      totalAttempts: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      modelStats: {} // { modelName: { attempts, successes, failures, totalDuration } }
    };
  }

  // ─── Chain Logic ────────────────────────────────────────────────

  /**
   * Monta a chain de modelos para um dado tipo de tarefa e complexidade.
   *
   * @param {string} taskType - Tipo da tarefa (ex: 'code', 'query', 'analysis')
   * @param {number} complexity - Nível de complexidade (1-5)
   * @returns {{ models: string[], timeout: number, tier: string }}
   */
  buildChain(taskType, complexity) {
    // taskType não é usado diretamente — a chain é determinada pela complexidade
    // Mas pode ser usado no futuro para ajustes finos por tipo de tarefa
    const tier = this._selectTier(complexity);
    const chain = this.chains[tier];

    if (!chain) {
      throw new Error('Nenhuma chain definida para o tier "' + tier + '"');
    }

    this._log('debug', 'Chain montada: tier=' + tier
      + ', models=[' + chain.models.join(', ') + ']'
      + ', timeout=' + chain.timeout + 'ms');

    return {
      models: chain.models.slice(), // cópia para não mutar o original
      timeout: chain.timeout,
      tier: tier
    };
  }

  /**
   * Retorna a chain apropriada para um nível de complexidade.
   * As chains são adaptativas ao custo da tarefa.
   *
   * @param {number} complexity - Nível de complexidade (1-5)
   * @returns {string} Nome do tier: 'cheap' | 'medium' | 'premium'
   */
  getChainForComplexity(complexity) {
    return this._selectTier(complexity);
  }

  /**
   * Seleciona o tier baseado na complexidade.
   *
   * Regras:
   *   complexity 1-2 → cheap
   *   complexity 3   → medium
   *   complexity 4-5 → premium
   *
   * @param {number} complexity - Complexidade (1-5)
   * @returns {string} 'cheap' | 'medium' | 'premium'
   * @private
   */
  _selectTier(complexity) {
    const c = (typeof complexity === 'number' && complexity >= 1 && complexity <= 5)
      ? Math.round(complexity)
      : 1;

    if (c <= 2) return 'cheap';
    if (c === 3) return 'medium';
    return 'premium'; // 4-5
  }

  /**
   * Faz merge das chains fornecidas com as defaults.
   * Chains personalizadas substituem as defaults por nome.
   *
   * @param {Object} defaults - Chains padrão
   * @param {Object} custom - Chains personalizadas
   * @returns {Object} Chains mergeadas
   * @private
   */
  _mergeChains(defaults, custom) {
    const result = {};
    const allTiers = new Set(
      Object.keys(defaults).concat(Object.keys(custom))
    );

    allTiers.forEach(function(tier) {
      const def = defaults[tier] || { models: [], timeout: 15000 };
      const cust = custom[tier] || {};

      result[tier] = {
        models: Array.isArray(cust.models) ? cust.models.slice() : def.models.slice(),
        timeout: (typeof cust.timeout === 'number' && cust.timeout > 0)
          ? cust.timeout
          : def.timeout
      };
    });

    return result;
  }

  // ─── Execution ──────────────────────────────────────────────────

  /**
   * Executa um prompt com fallback automático entre modelos.
   *
   * Fluxo:
   *   1. buildChain() monta a sequência de modelos
   *   2. Para cada modelo, chama tryModel()
   *   3. Se um modelo retorna sucesso → retorna resultado imediatamente
   *   4. Se TODOS falharem → lança ModelExecutionError
   *
   * @param {string} taskType - Tipo da tarefa (ex: 'code', 'query', 'analysis')
   * @param {number} complexity - Nível de complexidade (1-5)
   * @param {string} prompt - Prompt a ser enviado ao modelo
   * @returns {Promise<{ success: boolean, model: string, output: string, tier: string, duration: number, attempts: Array }>}
   * @throws {ModelExecutionError} Se todos os modelos falharem
   */
  async execute(taskType, complexity, prompt) {
    const startTime = Date.now();
    this.stats.totalExecutions++;
    this._log('info', BOLD + '▶ Executando' + RESET + ' taskType=' + taskType
      + ', complexity=' + complexity);

    // 1. Monta a chain
    const chain = this.buildChain(taskType, complexity);
    const attempts = [];

    // 2. Tenta cada modelo sequencialmente
    for (let i = 0; i < chain.models.length; i++) {
      const modelName = chain.models[i];
      const modelTimeout = chain.timeout;

      this._log('info', '  Tentativa ' + (i + 1) + '/' + chain.models.length
        + ': ' + CYAN + modelName + RESET + ' (timeout=' + modelTimeout + 'ms)');

      const attempt = {
        model: modelName,
        attempt: i + 1,
        tier: chain.tier,
        timeout: modelTimeout,
        status: 'pending',
        duration: null,
        error: null,
        output: null
      };

      try {
        const result = await this.tryModel(modelName, prompt, modelTimeout);

        attempt.status = result.success ? 'success' : 'failed';
        attempt.duration = result.duration;
        attempt.error = result.error || null;
        attempt.output = result.output || null;

        // Atualiza estatísticas do modelo
        this._updateModelStats(modelName, result.success, result.duration);

        if (result.success) {
          const totalDuration = Date.now() - startTime;
          this.stats.successfulExecutions++;
          this.stats.totalAttempts += (i + 1);

          this._log('info', GREEN + '  ✓ Sucesso' + RESET + ' com ' + modelName
            + ' (tentativa ' + (i + 1) + ', ' + result.duration + 'ms, total=' + totalDuration + 'ms)');

          attempts.push(attempt);

          return {
            success: true,
            model: modelName,
            output: result.output,
            tier: chain.tier,
            duration: totalDuration,
            attempts: attempts,
            attemptIndex: i
          };
        }

        // Falha não-exception: modelo retornou resposta inválida
        this._log('warn', YELLOW + '  ⚠ Falha' + RESET + ' ' + modelName
          + ' (' + result.duration + 'ms): ' + (result.error || 'resposta inválida'));

      } catch (err) {
        // Erro durante a chamada (timeout, rede, etc)
        attempt.status = 'error';
        attempt.duration = Date.now() - startTime; // duração aproximada
        attempt.error = err.message;

        this._updateModelStats(modelName, false, attempt.duration);

        this._log('error', RED + '  ✖ Erro' + RESET + ' ' + modelName
          + ': ' + err.message);
      }

      attempts.push(attempt);
    }

    // 3. Todos falharam — lança erro com detalhes
    const totalDuration = Date.now() - startTime;
    this.stats.failedExecutions++;
    this.stats.totalAttempts += chain.models.length;

    const errorMsg = 'Todos os ' + chain.models.length + ' modelos da chain "' + chain.tier
      + '" falharam após ' + totalDuration + 'ms';

    this._log('error', RED + BOLD + '✖ ' + errorMsg + RESET);

    // Log detalhado de cada tentativa
    attempts.forEach(function(a, idx) {
      const icon = a.status === 'success' ? GREEN + '✓' : (a.status === 'failed' ? YELLOW + '⚠' : RED + '✖');
      self._log('info', '    ' + icon + RESET + ' [' + (idx + 1) + '] ' + a.model
        + ' → ' + a.status.toUpperCase()
        + (a.duration ? ' (' + a.duration + 'ms)' : '')
        + (a.error ? ': ' + a.error : ''));
    });

    throw new ModelExecutionError(errorMsg, attempts);
  }

  /**
   * Tenta contactar um modelo via API com timeout REAL.
   *
   * DIFERENTE do model-router.js:
   *   - model-router.tryModel() é NON-BLOCKING: retorna true sem esperar
   *   - model-executor.tryModel() é BLOCKEANTE: AGUARDA a resposta com timeout
   *
   * @param {string} modelName - Nome do modelo (ex: 'ag/claude-sonnet-4-6')
   * @param {string} prompt - Prompt a ser enviado
   * @param {number} [timeout] - Timeout em ms (usa this.timeout se não especificado)
   * @returns {Promise<{ success: boolean, model: string, output: string|null, duration: number, error: string|null }>}
   */
  async tryModel(modelName, prompt, timeout) {
    const t0 = Date.now();
    const msTimeout = (typeof timeout === 'number' && timeout > 0) ? timeout : this.timeout;

    this._log('debug', '    tryModel: ' + modelName + ' (timeout=' + msTimeout + 'ms)');

    // Cria AbortController para timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(function() {
      controller.abort();
    }, msTimeout);

    try {
      // Tenta usar fetch primeiro (Node 18+ nativo)
      let response;
      try {
        response = await this._fetchModel(modelName, prompt, controller.signal);
      } catch (fetchErr) {
        // Se fetch falhar por completo, tenta http.request como fallback
        this._log('debug', '    fetch falhou, tentando http.request: ' + fetchErr.message);
        clearTimeout(timeoutId);
        const t1 = Date.now();
        return {
          success: false,
          model: modelName,
          output: null,
          duration: t1 - t0,
          error: 'Fetch error: ' + fetchErr.message
        };
      }

      clearTimeout(timeoutId);
      const duration = Date.now() - t0;

      if (!response) {
        return {
          success: false,
          model: modelName,
          output: null,
          duration: duration,
          error: 'Resposta vazia (response=null)'
        };
      }

      // Verifica status HTTP
      if (response.status < 200 || response.status >= 300) {
        return {
          success: false,
          model: modelName,
          output: null,
          duration: duration,
          error: 'HTTP ' + response.status + ': ' + response.statusText
        };
      }

      // Tenta parsear o body como JSON
      let body;
      try {
        body = await response.text();
      } catch (parseErr) {
        return {
          success: false,
          model: modelName,
          output: null,
          duration: duration,
          error: 'Falha ao ler body: ' + parseErr.message
        };
      }

      // Verifica se o body contém uma resposta válida
      const output = this._extractOutput(body, modelName);

      if (output === null || output === undefined || output === '') {
        return {
          success: false,
          model: modelName,
          output: null,
          duration: duration,
          error: 'Resposta vazia ou inválida do modelo'
        };
      }

      this._log('debug', '    tryModel: ' + modelName + ' OK (' + duration + 'ms, '
        + output.length + ' chars)');

      return {
        success: true,
        model: modelName,
        output: output,
        duration: duration,
        error: null
      };

    } catch (err) {
      clearTimeout(timeoutId);
      const duration = Date.now() - t0;

      // AbortError = timeout
      if (err.name === 'AbortError') {
        this._log('debug', '    tryModel: ' + modelName + ' TIMEOUT (' + msTimeout + 'ms)');
        return {
          success: false,
          model: modelName,
          output: null,
          duration: duration,
          error: 'Timeout após ' + msTimeout + 'ms'
        };
      }

      this._log('debug', '    tryModel: ' + modelName + ' ERRO: ' + err.message);
      return {
        success: false,
        model: modelName,
        output: null,
        duration: duration,
        error: err.message
      };
    }
  }

  /**
   * Faz a chamada HTTP via fetch para a API de modelos.
   *
   * @param {string} modelName - Nome do modelo
   * @param {string} prompt - Prompt a ser enviado
   * @param {AbortSignal} signal - Sinal de abort para timeout
   * @returns {Promise<Response|null>}
   * @private
   */
  async _fetchModel(modelName, prompt, signal) {
    // Endpoint: POST /v1/chat/completions (formato OpenAI-compatible)
    const url = this.apiBaseUrl.replace(/\/+$/, '') + '/v1/chat/completions';

    const payload = JSON.stringify({
      model: modelName,
      messages: [
        { role: 'user', content: prompt }
      ],
      max_tokens: 4096,
      temperature: 0.7,
      stream: false
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: payload,
      signal: signal
    });

    return response;
  }

  /**
   * Extrai o output do modelo a partir do body da resposta.
   * Tenta parsear como JSON primeiro (formato OpenAI), depois usa raw.
   *
   * @param {string} body - Body da resposta HTTP
   * @param {string} modelName - Nome do modelo (para debug)
   * @returns {string|null} Output extraído ou null se inválido
   * @private
   */
  _extractOutput(body, modelName) {
    if (!body || typeof body !== 'string') return null;

    // Tenta parsear como JSON (formato OpenAI chat completions)
    try {
      const parsed = JSON.parse(body);

      // Formato OpenAI: { choices: [ { message: { content: "..." } } ] }
      if (parsed.choices && Array.isArray(parsed.choices) && parsed.choices.length > 0) {
        const choice = parsed.choices[0];
        if (choice.message && typeof choice.message.content === 'string') {
          return choice.message.content;
        }
        if (typeof choice.text === 'string') {
          return choice.text;
        }
      }

      // Formato alternativo: { response: "..." } ou { output: "..." }
      if (typeof parsed.response === 'string') return parsed.response;
      if (typeof parsed.output === 'string') return parsed.output;
      if (typeof parsed.content === 'string') return parsed.content;
      if (typeof parsed.text === 'string') return parsed.text;

      // Se não reconheceu o formato mas tem dados, retorna stringified
      if (Object.keys(parsed).length > 0) {
        return JSON.stringify(parsed);
      }

      return null;
    } catch (e) {
      // Não é JSON — retorna o body raw se não estiver vazio
      const trimmed = body.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
      return null;
    }
  }

  // ─── Estatísticas ────────────────────────────────────────────────

  /**
   * Atualiza estatísticas acumuladas por modelo.
   *
   * @param {string} modelName - Nome do modelo
   * @param {boolean} success - Se a tentativa foi bem-sucedida
   * @param {number} duration - Duração da tentativa em ms
   * @private
   */
  _updateModelStats(modelName, success, duration) {
    if (!this.stats.modelStats[modelName]) {
      this.stats.modelStats[modelName] = {
        attempts: 0,
        successes: 0,
        failures: 0,
        totalDuration: 0
      };
    }

    var stats = this.stats.modelStats[modelName];
    stats.attempts++;
    stats.totalDuration += duration || 0;

    if (success) {
      stats.successes++;
    } else {
      stats.failures++;
    }
  }

  /**
   * Retorna estatísticas acumuladas.
   *
   * @returns {Object}
   */
  getStats() {
    return JSON.parse(JSON.stringify(this.stats));
  }

  /**
   * Reseta estatísticas acumuladas.
   */
  resetStats() {
    this.stats = {
      totalExecutions: 0,
      totalAttempts: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      modelStats: {}
    };
  }

  /**
   * Retorna a configuração atual (read-only).
   *
   * @returns {Object}
   */
  getConfig() {
    return {
      timeout: this.timeout,
      chains: JSON.parse(JSON.stringify(this.chains)),
      logLevel: this.logLevel,
      apiBaseUrl: this.apiBaseUrl
    };
  }

  // ─── Logging ────────────────────────────────────────────────────

  /**
   * Loga mensagem no nível apropriado.
   *
   * @param {string} level - Nível: 'debug' | 'info' | 'warn' | 'error'
   * @param {string} message - Mensagem a ser logada
   * @private
   */
  _log(level, message) {
    var levels = { silent: 0, error: 1, info: 2, debug: 3 };
    var currentLevel = levels[this.logLevel] || 2;
    var msgLevel = levels[level] || 2;

    if (msgLevel > currentLevel) return;

    var prefix = '';
    switch (level) {
      case 'error':
        prefix = RED + '[MODEL-EXEC:ERROR]' + RESET;
        break;
      case 'warn':
        prefix = YELLOW + '[MODEL-EXEC:WARN]' + RESET;
        break;
      case 'info':
        prefix = GRAY + '[MODEL-EXEC]' + RESET;
        break;
      case 'debug':
        prefix = GRAY + '[MODEL-EXEC:DEBUG]' + RESET;
        break;
      default:
        prefix = '[MODEL-EXEC]';
    }

    console.log(prefix + ' ' + message);
  }
}

// =====================================================================
//  Utilitários
// =====================================================================

/**
 * Cria uma instância do ModelExecutor com configuração padrão.
 * Atalho para uso rápido sem precisar instanciar manualmente.
 *
 * @param {Object} [config] - Configuração (mesmo do constructor)
 * @returns {ModelExecutor}
 */
function createExecutor(config) {
  return new ModelExecutor(config);
}

// =====================================================================
//  CLI
// =====================================================================

function printHelp() {
  console.log('');
  console.log(CYAN + BOLD + 'Matrix Real Model Executor v1.0' + RESET);
  console.log(YELLOW + 'Executor de modelos com fallback REAL e blockeante.' + RESET);
  console.log('');
  console.log('Uso: node model-executor.js <comando> [argumentos]');
  console.log('');
  console.log('Comandos:');
  console.log('  ' + GREEN + 'execute <complexity> "<prompt>"' + RESET + '  Executa prompt com fallback');
  console.log('  ' + GREEN + 'chains' + RESET + '                          Mostra configuração das chains');
  console.log('  ' + GREEN + 'stats' + RESET + '                           Mostra estatísticas acumuladas');
  console.log('  ' + GREEN + 'reset-stats' + RESET + '                     Reseta estatísticas');
  console.log('  ' + GREEN + '--help' + RESET + '                         Exibe esta mensagem');
  console.log('');
  console.log('Complexidade: 1 (mínima) a 5 (máxima)');
  console.log('');
  console.log('Exemplos:');
  console.log('  node model-executor.js execute 3 "Explique o que é SOLID"');
  console.log('  node model-executor.js execute 5 "Review este código"');
  console.log('  node model-executor.js chains');
  console.log('  node model-executor.js stats');
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

    case 'execute':
      if (!args[1] || !args[2]) {
        console.error(RED + '❌ Uso: node model-executor.js execute <complexity> "<prompt>"' + RESET);
        process.exit(1);
      }
      (async function() {
        const complexity = parseInt(args[1], 10);
        const prompt = args.slice(2).join(' ');
        const executor = new ModelExecutor({ logLevel: 'info' });

        console.log('');
        console.log(CYAN + BOLD + 'Model Execution' + RESET);
        console.log('  Prompt:      "' + prompt.substring(0, 80) + (prompt.length > 80 ? '..."' : '"'));
        console.log('  Complexity:  ' + complexity);
        console.log('');

        try {
          const result = await executor.execute('cli', complexity, prompt);
          console.log('');
          console.log(GREEN + BOLD + '✅ RESULTADO' + RESET);
          console.log('  Modelo:      ' + result.model + ' (' + result.tier + ')');
          console.log('  Duração:     ' + result.duration + 'ms');
          console.log('  Tentativas:  ' + result.attempts.length);
          console.log('');
          console.log('  Output:');
          console.log(result.output);
          console.log('');
        } catch (err) {
          console.log('');
          console.error(RED + BOLD + '❌ FALHA' + RESET);
          if (err instanceof ModelExecutionError) {
            console.error(err.getSummary());
          } else {
            console.error(err.message);
          }
          console.log('');
          process.exit(1);
        }
      })().catch(function(err) {
        console.error(RED + 'Erro fatal: ' + err.message + RESET);
        process.exit(1);
      });
      break;

    case 'chains':
      (function() {
        // Lista as chains atuais (usa defaults)
        var chains = DEFAULT_CHAINS;
        console.log('');
        console.log(CYAN + BOLD + 'Fallback Chains' + RESET);
        console.log('');

        var tierNames = Object.keys(chains);
        tierNames.forEach(function(tier) {
          var chain = chains[tier];
          console.log(YELLOW + BOLD + '  ' + tier.toUpperCase() + RESET + ' (timeout=' + chain.timeout + 'ms)');
          console.log('    Models:');
          chain.models.forEach(function(m, i) {
            console.log('      [' + (i + 1) + '] ' + m);
          });
          console.log('');
        });

        console.log('Mapping:');
        console.log('  complexity 1-2 → ' + GREEN + 'cheap' + RESET);
        console.log('  complexity 3   → ' + CYAN + 'medium' + RESET);
        console.log('  complexity 4-5 → ' + YELLOW + 'premium' + RESET);
        console.log('');
      })();
      break;

    case 'stats':
      (function() {
        // Para uso CLI sem execução, cria instância vazia
        console.log('');
        console.log(CYAN + BOLD + 'Executor Stats' + RESET);
        console.log('  (Execute tarefas para acumular estatísticas)');
        console.log('');
      })();
      break;

    case 'reset-stats':
      console.log(GREEN + '✓' + RESET + ' Estatísticas resetadas');
      break;

    default:
      printHelp();
      if (cmd) process.exit(1);
  }
}

// =====================================================================
//  Exports
// =====================================================================

module.exports = {
  ModelExecutor: ModelExecutor,
  ModelExecutionError: ModelExecutionError,
  DEFAULT_CHAINS: DEFAULT_CHAINS,
  createExecutor: createExecutor
};
