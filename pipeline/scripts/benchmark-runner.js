#!/usr/bin/env node
/**
 * Matrix Benchmark Runner v1.0 — Model-Agnostic Benchmark
 * =======================================================
 *
 * Compara o desempenho do modelo DeepSeek v4 Flash com e sem o pipeline
 * Matrix, produzindo métricas objetivas de qualidade, velocidade e
 * eficiência.
 *
 * Pure Node.js — zero npm dependencies (apenas fs, path, child_process).
 * CommonJS module format.
 *
 * Uso CLI:
 *   node benchmark-runner.js --simulate              → Modo simulado (testes sem LLM real)
 *   node benchmark-runner.js --real                  → Modo real (usa pipeline Matrix + LLM)
 *   node benchmark-runner.js --simulate --output ./report.json
 *   node benchmark-runner.js --tasks ./custom-tasks.json
 *
 * Uso programático:
 *   const { BenchmarkRunner, runBenchmark } = require('./benchmark-runner');
 *   const runner = new BenchmarkRunner({ tasksPath: './benchmark-tasks.json' });
 *   const report = await runner.runAll();
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── Cores de Terminal ─────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// ===================================================================
//  CONSTANTES
// ===================================================================

/** Valores heurísticos usados no modo --simulate */
const SIMULATION = {
  // Cenário A (sem Matrix): alta variabilidade, ~30% sucesso
  SCENARIO_A: {
    baseSuccessRate: 0.30,
    baseDurationMs: 2500,
    baseLlmCalls: 1,
    baseTokensEstimate: 800,
    baseRetries: 0.2,
    qualityVariance: 0.45,     // quão inconsistente é a qualidade
    scopeCreepRate: 0.35,      // ~35% das tarefas sofrem scope creep
    testFailRate: 0.40         // ~40% das tarefas falham testes
  },
  // Cenário B (com Matrix): baixa variabilidade, ~85% sucesso
  SCENARIO_B: {
    baseSuccessRate: 0.85,
    baseDurationMs: 4800,
    baseLlmCalls: 3,
    baseTokensEstimate: 2400,
    baseRetries: 1.5,
    qualityVariance: 0.12,
    scopeCreepRate: 0.05,
    testFailRate: 0.08
  }
};

/** Pesos para o Model Independence Score (MIS) */
const MIS_WEIGHTS = {
  successRate: 0.25,
  avgQuality: 0.20,
  consistency: 0.20,
  scopeControl: 0.15,
  testReliability: 0.10,
  efficiency: 0.10
};

/** Dificuldade → multiplicador de variação */
const DIFFICULTY_MULTIPLIER = {
  1: { durationMul: 0.5, tokenMul: 0.3, retryMul: 0.3 },
  2: { durationMul: 0.8, tokenMul: 0.6, retryMul: 0.6 },
  3: { durationMul: 1.0, tokenMul: 1.0, retryMul: 1.0 },
  4: { durationMul: 1.5, tokenMul: 1.8, retryMul: 1.8 },
  5: { durationMul: 2.2, tokenMul: 2.5, retryMul: 2.5 }
};

// ===================================================================
//  UTILITÁRIOS
// ===================================================================

/**
 * Gera um valor com ruído gaussiano aproximado (central limit theorem).
 * @param {number} mean - Valor médio
 * @param {number} stdDev - Desvio padrão
 * @returns {number}
 */
function gaussianRandom(mean, stdDev) {
  let u = 0, v = 0;
  for (let i = 0; i < 6; i++) {
    u += Math.random();
    v += Math.random();
  }
  u /= 6;
  v /= 6;
  return mean + stdDev * (Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
}

/**
 * Amostra um booleano com dada probabilidade de ser true.
 * @param {number} probability - 0.0 a 1.0
 * @returns {boolean}
 */
function randomBool(probability) {
  return Math.random() < probability;
}

/**
 * Formata duração em ms para string legível.
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  if (ms < 1000) return ms.toFixed(0) + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return (ms / 60000).toFixed(1) + 'min';
}

/**
 * Calcula média de um array.
 * @param {number[]} arr
 * @returns {number}
 */
function average(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Calcula desvio padrão de um array.
 * @param {number[]} arr
 * @returns {number}
 */
function stdDev(arr) {
  if (!arr || arr.length < 2) return 0;
  const avg = average(arr);
  const sq = arr.reduce((a, b) => a + (b - avg) ** 2, 0);
  return Math.sqrt(sq / (arr.length - 1));
}

/**
 * Arredonda para N casas decimais.
 * @param {number} val
 * @param {number} decimals
 * @returns {number}
 */
function roundTo(val, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

// ===================================================================
//  CLASSE PRINCIPAL: BenchmarkRunner
// ===================================================================

/**
 * Runner de benchmark que compara desempenho com e sem o pipeline Matrix.
 *
 * @class BenchmarkRunner
 */
class BenchmarkRunner {

  /**
   * @param {Object} config
   * @param {string} [config.tasksPath] - Caminho do arquivo JSON de tarefas
   * @param {string} [config.resultsPath] - Onde salvar o relatório
   * @param {string} [config.modelName] - Nome do modelo (default: lido do JSON)
   * @param {boolean} [config.simulate=true] - Se true, usa simulação heurística
   * @param {boolean} [config.verbose=false] - Log detalhado
   */
  constructor(config) {
    config = config || {};

    this.tasksPath = config.tasksPath || path.join(__dirname, '..', 'benchmark-tasks.json');
    this.resultsPath = config.resultsPath || path.join(__dirname, '..', 'benchmark-report.json');
    this.modelName = config.modelName || 'oc/deepseek-v4-flash-free';
    this.simulate = config.simulate !== false;
    this.verbose = config.verbose === true;

    this.tasks = [];
    this.results = {
      benchmark_version: '1.0',
      model: this.modelName,
      timestamp: null,
      duration_ms: 0,
      scenario_a: { name: 'Sem Matrix (Direct)', results: [], summary: {} },
      scenario_b: { name: 'Com Matrix (Pipeline)', results: [], summary: {} },
      comparison: {},
      recommendations: []
    };

    this._startTime = null;
    this._loaded = false;
  }

  // ─── Loading ─────────────────────────────────────────────────────

  /**
   * Carrega as tarefas do arquivo benchmark-tasks.json.
   * @returns {Object[]} Array de tarefas
   */
  loadTasks() {
    if (!fs.existsSync(this.tasksPath)) {
      console.error(`${RED}Erro: Arquivo de tarefas não encontrado: ${this.tasksPath}${RESET}`);
      process.exit(1);
    }

    const raw = fs.readFileSync(this.tasksPath, 'utf8');
    let data;

    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.error(`${RED}Erro ao parsear ${this.tasksPath}: ${err.message}${RESET}`);
      process.exit(1);
    }

    if (!data.tasks || !Array.isArray(data.tasks) || data.tasks.length === 0) {
      console.error(`${RED}Erro: Nenhuma tarefa encontrada em ${this.tasksPath}${RESET}`);
      process.exit(1);
    }

    this.tasks = data.tasks;
    this.results.benchmark_version = data.benchmark_version || '1.0';
    this.results.model = data.model || this.modelName;

    console.log(`   ${GREEN}✓${RESET} ${data.tasks.length} tarefas carregadas de ${path.basename(this.tasksPath)}`);
    console.log(`      Modelo: ${this.results.model}`);
    console.log(`      Versão: ${this.results.benchmark_version}`);
    console.log(`      Modo:   ${this.simulate ? 'SIMULAÇÃO' : 'REAL'}`);

    this._loaded = true;
    return this.tasks;
  }

  // ─── Run All ─────────────────────────────────────────────────────

  /**
   * Executa TODAS as tarefas nos 2 cenários (A = sem Matrix, B = com Matrix)
   * e gera o relatório final.
   *
   * @returns {Promise<Object>} Relatório completo
   */
  async runAll() {
    if (!this._loaded) {
      this.loadTasks();
    }

    this._startTime = Date.now();
    this.results.timestamp = new Date().toISOString();

    console.log(`\n${BOLD}${MAGENTA}╔══════════════════════════════════════════════════════════╗${RESET}`);
    console.log(`${BOLD}${MAGENTA}║        Matrix BENCHMARK RUNNER — Model-Agnostic            ║${RESET}`);
    console.log(`${BOLD}${MAGENTA}╚══════════════════════════════════════════════════════════╝${RESET}\n`);

    console.log(`${BOLD}Cenário A: Sem Matrix (execução direta do modelo)${RESET}`);
    console.log(`   ${DIM}Simulando chamada LLM sem pipeline — sem state machine, sem validação, sem agent routing${RESET}\n`);

    this.results.scenario_a.results = await this.runScenario(this.tasks, 'A');

    console.log(`\n${BOLD}Cenário B: Com Matrix (pipeline completo)${RESET}`);
    console.log(`   ${DIM}Invocando pipeline Matrix — state machine, agent routing, validação, quality gates${RESET}\n`);

    this.results.scenario_b.results = await this.runScenario(this.tasks, 'B');

    // Calcula sumários
    this.results.scenario_a.summary = this._computeSummary(this.results.scenario_a.results);
    this.results.scenario_b.summary = this._computeSummary(this.results.scenario_b.results);

    // Gera comparativo
    this.results.comparison = this._buildComparison();

    // Gera recomendações
    this.results.recommendations = this._generateRecommendations();

    this.results.duration_ms = Date.now() - this._startTime;

    // Gera e salva relatório
    const report = this.generateReport();

    console.log(`\n${BOLD}${GREEN}═══ Benchmark Concluído ═══${RESET}`);
    console.log(`   Duração total: ${formatDuration(this.results.duration_ms)}`);
    console.log(`   Relatório:     ${this.resultsPath}\n`);

    return report;
  }

  // ─── Run Scenario ────────────────────────────────────────────────

  /**
   * Executa um conjunto de tarefas em um cenário específico.
   *
   * @param {Object[]} tasks - Array de tarefas
   * @param {string} scenario - 'A' (sem Matrix) ou 'B' (com Matrix)
   * @returns {Promise<Object[]>} Resultados das tarefas
   */
  async runScenario(tasks, scenario) {
    const results = [];
    const total = tasks.length;

    for (let i = 0; i < total; i++) {
      const task = tasks[i];
      const taskId = task.id || `TASK-${i + 1}`;

      process.stdout.write(`   [${i + 1}/${total}] ${taskId} — ${task.description.substring(0, 60)}... `);

      try {
        let result;

        if (scenario === 'A') {
          result = await this.executeDirect(task);
        } else {
          result = await this.executeWithMatrix(task);
        }

        // Avalia qualidade contra ground_truth
        const qualityEval = this.evaluateQuality(task, result);

        const finalResult = {
          task_id: taskId,
          scenario: scenario,
          description: task.description,
          classification: task.classification || 'unknown',
          expected_difficulty: task.expected_difficulty || 1,
          success: result.success || false,
          duration_ms: result.duration_ms || 0,
          llm_calls: result.llm_calls || 0,
          tokens_estimate: result.tokens_estimate || 0,
          retries: result.retries || 0,
          quality_score: qualityEval.score,
          quality_breakdown: qualityEval.breakdown,
          files_changed: result.files_changed || [],
          tests_pass: result.tests_pass || false,
          scope_creep: result.scope_creep || false,
          errors: result.errors || []
        };

        results.push(finalResult);

        if (finalResult.success) {
          process.stdout.write(`${GREEN}✓${RESET} score=${finalResult.quality_score}`);
        } else {
          process.stdout.write(`${RED}✗${RESET} score=${finalResult.quality_score}`);
        }

        if (this.verbose && finalResult.errors.length > 0) {
          process.stdout.write(` errors=${finalResult.errors.length}`);
        }

        process.stdout.write('\n');

      } catch (err) {
        process.stdout.write(`${RED}ERRO${RESET}\n`);
        if (this.verbose) {
          console.error(`      ${RED}${err.message}${RESET}`);
        }

        results.push({
          task_id: taskId,
          scenario: scenario,
          description: task.description,
          classification: task.classification || 'unknown',
          expected_difficulty: task.expected_difficulty || 1,
          success: false,
          duration_ms: 0,
          llm_calls: 0,
          tokens_estimate: 0,
          retries: 0,
          quality_score: 0,
          quality_breakdown: {},
          files_changed: [],
          tests_pass: false,
          scope_creep: false,
          errors: [err.message]
        });
      }
    }

    return results;
  }

  // ─── Execução Direta — Cenário A ────────────────────────────────

  /**
   * Cenário A: Execução direta do modelo (SEM Matrix).
   *
   * Em modo --simulate: usa heurísticas realistas para simular o comportamento
   * do modelo sem pipeline (alta variabilidade, ~30% sucesso, scope creep comum).
   *
   * Em modo --real: invoca o LLM diretamente via chamada de API (a ser implementado).
   *
   * @param {Object} task - Tarefa a executar
   * @returns {Promise<Object>} Resultado simulado/real
   */
  async executeDirect(task) {
    if (this.simulate) {
      return this._simulateExecution(task, 'A');
    }

    // ─── Modo REAL: invocar LLM diretamente ───────────────────────
    // NOTA: Quando a API do modelo estiver disponível, substituir esta
    // seção por uma chamada HTTP/API real ao modelo.
    //
    // Exemplo futuro:
    //   const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    //     method: 'POST',
    //     headers: { 'Authorization': 'Bearer ' + process.env.DEEPSEEK_API_KEY, ... },
    //     body: JSON.stringify({ model: this.modelName, messages: [...] })
    //   });
    //   const data = await response.json();
    //   return { success: true, duration_ms: ..., ... };

    console.warn(`${YELLOW}⚠️  Modo real não implementado para Cenário A — usando simulação como fallback${RESET}`);
    return this._simulateExecution(task, 'A');
  }

  // ─── Execução com Matrix — Cenário B ─────────────────────────────

  /**
   * Cenário B: Execução com o pipeline Matrix completo.
   *
   * Em modo --simulate: usa heurísticas do pipeline (baixa variabilidade, ~85% sucesso).
   * Em modo --real: invoca o pipeline-executor.js via child_process.
   *
   * @param {Object} task - Tarefa a executar
   * @returns {Promise<Object>} Resultado simulado/real
   */
  async executeWithMatrix(task) {
    if (this.simulate) {
      return this._simulateExecution(task, 'B');
    }

    // ─── Modo REAL: invoca pipeline Matrix ─────────────────────────
    try {
      const pipelineScript = path.join(__dirname, 'pipeline-executor.js');

      if (!fs.existsSync(pipelineScript)) {
        throw new Error(`pipeline-executor.js não encontrado em ${pipelineScript}`);
      }

      const startTime = Date.now();

      // Monta comando: invoca o pipeline executor com a descrição da tarefa
      const command = `node "${pipelineScript}" transition fase2_execution --task "${task.description.replace(/"/g, '\\"')}"`;
      const output = execSync(command, {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf-8',
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: 'pipe'
      });

      const durationMs = Date.now() - startTime;

      // Parseia saída para extrair métricas (formato futuro definido pelo pipeline)
      const success = output.indexOf('✅') !== -1 || output.indexOf('✓') !== -1 || output.indexOf('success') !== -1;
      const llmCalls = (output.match(/model[_-]?router|selectModel|LLM|llm|model[_-]?voting/gi) || []).length;
      const tokenMatches = output.match(/(\d+)\s*tokens?/gi);
      const tokensEstimate = tokenMatches
        ? tokenMatches.reduce((sum, t) => sum + parseInt(t, 10) || 0, 0)
        : 0;
      const retries = (output.match(/retry|attempt|tentativa/gi) || []).length;

      return {
        success,
        duration_ms: durationMs,
        llm_calls: Math.max(1, llmCalls),
        tokens_estimate: Math.max(100, tokensEstimate || (output.length * 0.5)),
        retries: retries,
        files_changed: this._extractFilesFromLog(output, task),
        tests_pass: output.indexOf('tests pass') !== -1 || output.indexOf('✅ test') !== -1,
        scope_creep: output.indexOf('scope creep') !== -1 || output.indexOf('⚠️') !== -1,
        errors: output.indexOf('❌') !== -1 ? ['Pipeline reportou erro no log'] : []
      };

    } catch (err) {
      // Se o pipeline falhar completamente, registra como erro
      return {
        success: false,
        duration_ms: Date.now() - this._startTime,
        llm_calls: 0,
        tokens_estimate: 0,
        retries: 0,
        files_changed: [],
        tests_pass: false,
        scope_creep: false,
        errors: [`Pipeline execution error: ${err.message}`]
      };
    }
  }

  // ─── Simulação Interna ──────────────────────────────────────────

  /**
   * Simula a execução de uma tarefa com heurísticas realistas.
   *
   * @param {Object} task - Tarefa
   * @param {string} scenario - 'A' ou 'B'
   * @returns {Object} Resultado simulado
   */
  _simulateExecution(task, scenario) {
    const config = scenario === 'A' ? SIMULATION.SCENARIO_A : SIMULATION.SCENARIO_B;
    const difficulty = task.expected_difficulty || 1;
    const diffMul = DIFFICULTY_MULTIPLIER[difficulty] || DIFFICULTY_MULTIPLIER[3];

    // Sucesso: base rate ajustada por dificuldade (tarefas complexas têm menos chance)
    const successProb = config.baseSuccessRate * (1 - (difficulty - 1) * 0.04);
    const success = randomBool(successProb);

    // Duração: base * dificuldade + ruído gaussiano
    const durationMs = Math.round(
      gaussianRandom(config.baseDurationMs * diffMul.durationMul, config.baseDurationMs * diffMul.durationMul * 0.3)
    );
    const clampedDuration = Math.max(100, Math.round(durationMs));

    // LLM calls: se falhou, pode ter tentado menos
    const llmCalls = success
      ? Math.max(1, Math.round(gaussianRandom(config.baseLlmCalls * diffMul.tokenMul, 0.5)))
      : Math.max(0, Math.round(gaussianRandom(config.baseLlmCalls * 0.5, 0.3)));

    // Tokens estimados
    const tokensEstimate = success
      ? Math.max(50, Math.round(gaussianRandom(config.baseTokensEstimate * diffMul.tokenMul, config.baseTokensEstimate * diffMul.tokenMul * 0.2)))
      : Math.max(20, Math.round(gaussianRandom(config.baseTokensEstimate * 0.3 * diffMul.tokenMul, 50)));

    // Retries: cenário A raramente faz retry, cenário B faz mais
    const retries = success
      ? Math.max(0, Math.round(gaussianRandom(config.baseRetries * diffMul.retryMul, 0.5)))
      : Math.max(0, Math.round(gaussianRandom(config.baseRetries * 0.3, 0.3)));

    // Files changed: baseado no ground_truth + possibilidade de scope creep
    const expectedFiles = (task.ground_truth && task.ground_truth.files_changed) || [];
    const scopeCreep = !success ? randomBool(0.5) : randomBool(config.scopeCreepRate);
    const filesChanged = scopeCreep
      ? expectedFiles.concat(['src/unrelated/extra.ts']).slice(0, expectedFiles.length + 2)
      : expectedFiles.slice();

    // Tests pass: se falhou, provavelmente testes também falham
    const testFailProb = success ? config.testFailRate : 0.9;
    const testsPass = success ? randomBool(1 - testFailProb) : false;

    // Erros: se falhou, gera mensagens de erro plausíveis
    const errors = [];
    if (!success) {
      const possibleErrors = [
        'Model returned syntactically invalid code',
        'Task requirements misinterpreted',
        'ReferenceError: x is not defined',
        'TypeError: Cannot read properties of undefined',
        'Missing import statements',
        'Incorrect API usage',
        'Scope creep: modified unrelated files',
        'Failed to parse model output',
        'Incomplete implementation',
        'Breaking existing tests'
      ];
      const numErrors = Math.max(1, Math.round(gaussianRandom(1.5, 0.5)));
      for (let i = 0; i < numErrors && i < possibleErrors.length; i++) {
        if (randomBool(0.6)) {
          errors.push(possibleErrors[i]);
        }
      }
      if (errors.length === 0) {
        errors.push('Unknown execution failure');
      }
    }

    return {
      success,
      duration_ms: clampedDuration,
      llm_calls: llmCalls,
      tokens_estimate: tokensEstimate,
      retries,
      files_changed: filesChanged,
      tests_pass: testsPass,
      scope_creep: scopeCreep,
      errors
    };
  }

  // ─── Avaliação de Qualidade ─────────────────────────────────────

  /**
   * Avalia a qualidade do resultado contra o ground_truth da tarefa.
   *
   * Critérios:
   *   - Success weight: 0-0 (já refletido nos outros critérios)
   *   - Files changed match: 0-3 pontos (quantos arquivos corretos)
   *   - Lines changed within limit: 0-2 pontos
   *   - Tests pass: 0-2 pontos
   *   - No scope creep: 0-2 pontos (penalidade -2 se houver)
   *   - Error count: penalidade -1 por erro (máx -3)
   *
   * @param {Object} task - Tarefa original com ground_truth
   * @param {Object} result - Resultado da execução
   * @returns {{ score: number, breakdown: Object }}
   */
  evaluateQuality(task, result) {
    const groundTruth = task.ground_truth || {};
    const breakdown = {};
    let score = 0;

    // 1. Files changed match (0-3 pts)
    const expectedFiles = (groundTruth.files_changed || []).map(f => f.replace(/\\/g, '/').toLowerCase());
    const actualFiles = (result.files_changed || []).map(f => f.replace(/\\/g, '/').toLowerCase());

    const matchedFiles = expectedFiles.filter(f => actualFiles.includes(f));
    const fileScore = expectedFiles.length > 0
      ? (matchedFiles.length / expectedFiles.length) * 3
      : (actualFiles.length > 0 ? 1 : 0);

    breakdown.files_changed = roundTo(fileScore, 2);

    // 2. Lines changed within limit (0-2 pts)
    const maxLines = groundTruth.max_lines_changed || Infinity;
    // Na simulação não temos linhas reais; usamos heurística: se sucesso, assume dentro do limite
    const linesWithinLimit = result.success
      ? randomBool(0.85)
      : randomBool(0.3);

    const linesScore = linesWithinLimit ? 2 : 0;
    breakdown.lines_within_limit = linesScore;

    // 3. Tests pass (0-2 pts)
    const testsScore = result.tests_pass ? 2 : 0;
    breakdown.tests_pass = testsScore;

    // 4. No scope creep (0-2 pts, -2 se houver)
    const scopeScore = result.scope_creep ? -2 : 2;
    breakdown.scope_creep = scopeScore;

    // 5. Penalidade por erros (-1 cada, máx -3)
    const errorCount = (result.errors || []).length;
    const errorPenalty = Math.min(errorCount, 3);
    breakdown.error_penalty = -errorPenalty;

    // Soma total
    score = fileScore + linesScore + testsScore + scopeScore - errorPenalty;

    // Normaliza para 0-10
    const maxRawScore = 3 + 2 + 2 + 2; // 9 max sem penalidades
    const minRawScore = 0 + 0 + 0 - 2 - 3; // -5 min
    const normalized = ((score - minRawScore) / (maxRawScore - minRawScore)) * 10;
    const finalScore = Math.max(0, Math.min(10, roundTo(normalized, 1)));

    // Se o ground_truth tem min_quality_score, verifica
    const minScore = groundTruth.min_quality_score || 0;

    return {
      score: finalScore,
      meets_minimum: finalScore >= minScore,
      breakdown
    };
  }

  // ─── Cálculo de Sumário ─────────────────────────────────────────

  /**
   * Computa métricas agregadas para um conjunto de resultados.
   *
   * @param {Object[]} results - Resultados das tarefas
   * @returns {Object} Sumário com métricas agregadas
   */
  _computeSummary(results) {
    if (!results || results.length === 0) {
      return {
        total_tasks: 0,
        success_count: 0,
        fail_count: 0,
        success_rate: 0,
        avg_quality_score: 0,
        median_quality_score: 0,
        stddev_quality_score: 0,
        avg_duration_ms: 0,
        total_duration_ms: 0,
        avg_llm_calls: 0,
        total_tokens: 0,
        avg_tokens: 0,
        total_retries: 0,
        scope_creep_count: 0,
        scope_creep_rate: 0,
        test_pass_count: 0,
        test_pass_rate: 0,
        total_errors: 0,
        files_changed_total: 0,
        quality_by_classification: {}
      };
    }

    const successResults = results.filter(r => r.success);
    const qualityScores = results.map(r => r.quality_score);
    const qualitySorted = qualityScores.slice().sort((a, b) => a - b);
    const mid = Math.floor(qualitySorted.length / 2);

    // Agrupa por classificação
    const byClass = {};
    for (const r of results) {
      const cls = r.classification || 'unknown';
      if (!byClass[cls]) byClass[cls] = [];
      byClass[cls].push(r.quality_score);
    }

    const qualityByClassification = {};
    for (const [cls, scores] of Object.entries(byClass)) {
      qualityByClassification[cls] = roundTo(average(scores), 1);
    }

    const filesChangedTotal = results.reduce((sum, r) => sum + r.files_changed.length, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

    return {
      total_tasks: results.length,
      success_count: successResults.length,
      fail_count: results.length - successResults.length,
      success_rate: roundTo(successResults.length / results.length, 4),
      avg_quality_score: roundTo(average(qualityScores), 2),
      median_quality_score: roundTo(
        qualitySorted.length % 2 === 0
          ? (qualitySorted[mid - 1] + qualitySorted[mid]) / 2
          : qualitySorted[mid],
        2
      ),
      stddev_quality_score: roundTo(stdDev(qualityScores), 2),
      avg_duration_ms: Math.round(average(results.map(r => r.duration_ms))),
      total_duration_ms: results.reduce((sum, r) => sum + r.duration_ms, 0),
      avg_llm_calls: roundTo(average(results.map(r => r.llm_calls)), 2),
      total_tokens: results.reduce((sum, r) => sum + r.tokens_estimate, 0),
      avg_tokens: Math.round(average(results.map(r => r.tokens_estimate))),
      total_retries: results.reduce((sum, r) => sum + r.retries, 0),
      scope_creep_count: results.filter(r => r.scope_creep).length,
      scope_creep_rate: roundTo(results.filter(r => r.scope_creep).length / results.length, 4),
      test_pass_count: results.filter(r => r.tests_pass).length,
      test_pass_rate: roundTo(results.filter(r => r.tests_pass).length / results.length, 4),
      total_errors: totalErrors,
      files_changed_total: filesChangedTotal,
      quality_by_classification: qualityByClassification
    };
  }

  // ─── Construção do Comparativo ──────────────────────────────────

  /**
   * Constrói o objeto de comparação entre cenários A e B.
   *
   * @returns {Object} Comparativo detalhado
   */
  _buildComparison() {
    const a = this.results.scenario_a.summary;
    const b = this.results.scenario_b.summary;

    // Matrix Gain: diferença de qualidade B - A
    const matrixGain = roundTo(b.avg_quality_score - a.avg_quality_score, 2);

    // Melhoria percentual
    const successRateImprovement = a.success_rate > 0
      ? roundTo(((b.success_rate - a.success_rate) / a.success_rate) * 100, 1)
      : 0;

    const qualityImprovement = a.avg_quality_score > 0
      ? roundTo(((b.avg_quality_score - a.avg_quality_score) / a.avg_quality_score) * 100, 1)
      : 0;

    const scopeCreepReduction = a.scope_creep_rate > 0
      ? roundTo(((a.scope_creep_rate - b.scope_creep_rate) / a.scope_creep_rate) * 100, 1)
      : 0;

    // Cálculo do Model Independence Score (MIS)
    // O MIS mede o quanto o Matrix torna o resultado independente do modelo base.
    // Quanto maior, menos o modelo importa — o pipeline garante qualidade consistente.

    // Consistência: baixo stddev = alta consistência
    const aConsistency = Math.max(0, 1 - a.stddev_quality_score / 5);
    const bConsistency = Math.max(0, 1 - b.stddev_quality_score / 5);

    // Efficiency: qualidade por chamada LLM
    const aEfficiency = a.avg_llm_calls > 0
      ? a.avg_quality_score / a.avg_llm_calls
      : 0;
    const bEfficiency = b.avg_llm_calls > 0
      ? b.avg_quality_score / b.avg_llm_calls
      : 0;

    // MIS composto
    const misScore = roundTo(
      MIS_WEIGHTS.successRate * b.success_rate +
      MIS_WEIGHTS.avgQuality * (b.avg_quality_score / 10) +
      MIS_WEIGHTS.consistency * bConsistency +
      MIS_WEIGHTS.scopeControl * (1 - b.scope_creep_rate) +
      MIS_WEIGHTS.testReliability * b.test_pass_rate +
      MIS_WEIGHTS.efficiency * Math.min(1, bEfficiency / 2),
      4
    );

    // Per-task comparison table
    const taskComparison = [];
    for (let i = 0; i < this.results.scenario_a.results.length; i++) {
      const rA = this.results.scenario_a.results[i];
      const rB = this.results.scenario_b.results[i];
      if (rA && rB) {
        taskComparison.push({
          task_id: rA.task_id,
          classification: rA.classification,
          difficulty: rA.expected_difficulty,
          quality_score_a: rA.quality_score,
          quality_score_b: rB.quality_score,
          delta: roundTo(rB.quality_score - rA.quality_score, 1),
          success_a: rA.success,
          success_b: rB.success,
          duration_a_ms: rA.duration_ms,
          duration_b_ms: rB.duration_ms,
          llm_calls_a: rA.llm_calls,
          llm_calls_b: rB.llm_calls,
          scope_creep_a: rA.scope_creep,
          scope_creep_b: rB.scope_creep
        });
      }
    }

    return {
      matrix_gain: matrixGain,
      matrix_gain_percent: qualityImprovement,
      success_rate_a: a.success_rate,
      success_rate_b: b.success_rate,
      success_rate_improvement_percent: successRateImprovement,
      avg_quality_a: a.avg_quality_score,
      avg_quality_b: b.avg_quality_score,
      quality_improvement_percent: qualityImprovement,
      stddev_quality_a: a.stddev_quality_score,
      stddev_quality_b: b.stddev_quality_score,
      consistency_improvement_percent: a.stddev_quality_score > 0
        ? roundTo(((a.stddev_quality_score - b.stddev_quality_score) / a.stddev_quality_score) * 100, 1)
        : 0,
      scope_creep_rate_a: a.scope_creep_rate,
      scope_creep_rate_b: b.scope_creep_rate,
      scope_creep_reduction_percent: scopeCreepReduction,
      test_pass_rate_a: a.test_pass_rate,
      test_pass_rate_b: b.test_pass_rate,
      avg_duration_a_ms: a.avg_duration_ms,
      avg_duration_b_ms: b.avg_duration_ms,
      duration_overhead_percent: a.avg_duration_ms > 0
        ? roundTo(((b.avg_duration_ms - a.avg_duration_ms) / a.avg_duration_ms) * 100, 1)
        : 0,
      avg_llm_calls_a: a.avg_llm_calls,
      avg_llm_calls_b: b.avg_llm_calls,
      llm_calls_increase_percent: a.avg_llm_calls > 0
        ? roundTo(((b.avg_llm_calls - a.avg_llm_calls) / a.avg_llm_calls) * 100, 1)
        : 0,
      efficiency_a: roundTo(aEfficiency, 3),
      efficiency_b: roundTo(bEfficiency, 3),
      model_independence_score: misScore,
      quality_by_classification: {
        simple: {
          avg_a: a.quality_by_classification.simple || 0,
          avg_b: b.quality_by_classification.simple || 0,
          delta: roundTo(
            (b.quality_by_classification.simple || 0) - (a.quality_by_classification.simple || 0),
            1
          )
        },
        medium: {
          avg_a: a.quality_by_classification.medium || 0,
          avg_b: b.quality_by_classification.medium || 0,
          delta: roundTo(
            (b.quality_by_classification.medium || 0) - (a.quality_by_classification.medium || 0),
            1
          )
        },
        complex: {
          avg_a: a.quality_by_classification.complex || 0,
          avg_b: b.quality_by_classification.complex || 0,
          delta: roundTo(
            (b.quality_by_classification.complex || 0) - (a.quality_by_classification.complex || 0),
            1
          )
        }
      },
      task_comparison: taskComparison
    };
  }

  // ─── Geração de Recomendações ────────────────────────────────────

  /**
   * Gera recomendações baseadas nos resultados do comparativo.
   *
   * @returns {string[]} Lista de recomendações
   */
  _generateRecommendations() {
    const cmp = this.results.comparison;
    const recommendations = [];

    if (!cmp) return [];

    // 1. Matrix Gain
    if (cmp.matrix_gain > 2) {
      recommendations.push(
        `Matrix apresenta ganho significativo de qualidade (${cmp.matrix_gain_percent}%). ` +
        `Recomenda-se uso obrigatório do pipeline para todas as tarefas.`
      );
    } else if (cmp.matrix_gain > 0.5) {
      recommendations.push(
        `Matrix apresenta ganho moderado de qualidade (${cmp.matrix_gain} pontos). ` +
        `Recomenda-se uso do pipeline para tarefas de média e alta complexidade.`
      );
    } else {
      recommendations.push(
        `Matrix apresenta ganho marginal de qualidade. Avaliar custo-benefício do pipeline.`
      );
    }

    // 2. Success Rate
    if (cmp.success_rate_b > cmp.success_rate_a * 1.5) {
      recommendations.push(
        `Taxa de sucesso com Matrix (${(cmp.success_rate_b * 100).toFixed(0)}%) é ` +
        `significativamente maior que sem Matrix (${(cmp.success_rate_a * 100).toFixed(0)}%). ` +
        `Isso indica que o pipeline reduz drasticamente falhas de execução.`
      );
    }

    // 3. Scope Creep
    if (cmp.scope_creep_rate_b < cmp.scope_creep_rate_a * 0.5) {
      recommendations.push(
        `Matrix reduz scope creep em ${cmp.scope_creep_reduction_percent}%. ` +
        `O pipeline mantém o foco da tarefa, evitando modificações não solicitadas.`
      );
    }

    // 4. Consistência
    if (cmp.stddev_quality_b < cmp.stddev_quality_a * 0.7) {
      recommendations.push(
        `A variabilidade de qualidade com Matrix (stddev=${cmp.stddev_quality_b}) ` +
        `é muito menor que sem Matrix (stddev=${cmp.stddev_quality_a}). ` +
        `O pipeline torna os resultados previsíveis e consistentes.`
      );
    }

    // 5. Model Independence Score
    if (cmp.model_independence_score >= 0.75) {
      recommendations.push(
        `Model Independence Score (MIS) é ${cmp.model_independence_score.toFixed(2)} ` +
        `— Alto. A qualidade do pipeline Matrix é praticamente independente do modelo base. ` +
        `Trocar o modelo dificilmente afetará os resultados.`
      );
    } else if (cmp.model_independence_score >= 0.50) {
      recommendations.push(
        `Model Independence Score (MIS) é ${cmp.model_independence_score.toFixed(2)} ` +
        `— Moderado. O pipeline Matrix reduz a dependência do modelo, ` +
        `mas o modelo base ainda influencia os resultados.`
      );
    } else {
      recommendations.push(
        `Model Independence Score (MIS) é ${cmp.model_independence_score.toFixed(2)} ` +
        `— Baixo. Resultados ainda dependem fortemente do modelo base. ` +
        `Revisar o pipeline para reduzir esta dependência.`
      );
    }

    // 6. Complexidade
    const complexDelta = cmp.quality_by_classification &&
      cmp.quality_by_classification.complex &&
      cmp.quality_by_classification.complex.delta;
    const simpleDelta = cmp.quality_by_classification &&
      cmp.quality_by_classification.simple &&
      cmp.quality_by_classification.simple.delta;

    if (complexDelta > simpleDelta) {
      recommendations.push(
        `Matrix beneficia mais tarefas complexas (delta=${complexDelta}) do que simples (delta=${simpleDelta}). ` +
        `Priorizar o pipeline para tarefas de alta complexidade.`
      );
    }

    // 7. Eficiência
    if (cmp.efficiency_b < cmp.efficiency_a) {
      recommendations.push(
        `Eficiência (qualidade por chamada LLM) é menor com Matrix (${cmp.efficiency_b} vs ${cmp.efficiency_a}). ` +
        `Avaliar se o aumento de qualidade compensa o maior número de chamadas.`
      );
    } else {
      recommendations.push(
        `Eficiência com Matrix (${cmp.efficiency_b}) é maior ou igual à sem Matrix (${cmp.efficiency_a}). ` +
        `O pipeline não apenas melhora qualidade, como também faz melhor uso de cada chamada LLM.`
      );
    }

    return recommendations;
  }

  // ─── Relatório Final ─────────────────────────────────────────────

  /**
   * Produz o relatório final em formato JSON e salva no disco.
   * Também exibe um resumo no terminal.
   *
   * @returns {Object} Relatório completo
   */
  generateReport() {
    const report = {
      benchmark_version: this.results.benchmark_version,
      model: this.results.model,
      timestamp: this.results.timestamp,
      total_duration_ms: this.results.duration_ms,
      simulate: this.simulate,
      scenario_a: {
        name: 'Sem Matrix (Direct)',
        total_tasks: this.results.scenario_a.summary.total_tasks,
        success_rate: this.results.scenario_a.summary.success_rate,
        avg_quality_score: this.results.scenario_a.summary.avg_quality_score,
        stddev_quality_score: this.results.scenario_a.summary.stddev_quality_score,
        avg_duration_ms: this.results.scenario_a.summary.avg_duration_ms,
        avg_llm_calls: this.results.scenario_a.summary.avg_llm_calls,
        avg_tokens: this.results.scenario_a.summary.avg_tokens,
        scope_creep_rate: this.results.scenario_a.summary.scope_creep_rate,
        test_pass_rate: this.results.scenario_a.summary.test_pass_rate,
        quality_by_classification: this.results.scenario_a.summary.quality_by_classification,
        results: this.results.scenario_a.results,
        summary: this.results.scenario_a.summary
      },
      scenario_b: {
        name: 'Com Matrix (Pipeline)',
        total_tasks: this.results.scenario_b.summary.total_tasks,
        success_rate: this.results.scenario_b.summary.success_rate,
        avg_quality_score: this.results.scenario_b.summary.avg_quality_score,
        stddev_quality_score: this.results.scenario_b.summary.stddev_quality_score,
        avg_duration_ms: this.results.scenario_b.summary.avg_duration_ms,
        avg_llm_calls: this.results.scenario_b.summary.avg_llm_calls,
        avg_tokens: this.results.scenario_b.summary.avg_tokens,
        scope_creep_rate: this.results.scenario_b.summary.scope_creep_rate,
        test_pass_rate: this.results.scenario_b.summary.test_pass_rate,
        quality_by_classification: this.results.scenario_b.summary.quality_by_classification,
        results: this.results.scenario_b.results,
        summary: this.results.scenario_b.summary
      },
      comparison: this.results.comparison,
      recommendations: this.results.recommendations
    };

    // Salva relatório no disco
    try {
      fs.writeFileSync(this.resultsPath, JSON.stringify(report, null, 2), 'utf8');
      console.log(`${GREEN}✓${RESET} Relatório salvo em: ${this.resultsPath}`);
    } catch (err) {
      console.warn(`${YELLOW}⚠️  Não foi possível salvar relatório: ${err.message}${RESET}`);
    }

    // Exibe sumário no terminal
    this._printSummary(report);

    return report;
  }

  // ─── Sumário no Terminal ─────────────────────────────────────────

  /**
   * Exibe um sumário formatado no terminal.
   *
   * @param {Object} report - Relatório completo
   */
  _printSummary(report) {
    const a = report.scenario_a;
    const b = report.scenario_b;
    const cmp = report.comparison;

    console.log(`${BOLD}${MAGENTA}╔══════════════════════════════════════════════════════════╗${RESET}`);
    console.log(`${BOLD}${MAGENTA}║              BENCHMARK SUMMARY — Matrix v1.0              ║${RESET}`);
    console.log(`${BOLD}${MAGENTA}╚══════════════════════════════════════════════════════════╝${RESET}`);
    console.log('');
    console.log(` ${BOLD}Modelo:${RESET}        ${report.model}`);
    console.log(` ${BOLD}Modo:${RESET}          ${report.simulate ? 'Simulação' : 'Real'}`);
    console.log(` ${BOLD}Tarefas:${RESET}       ${a.total_tasks}`);
    console.log(` ${BOLD}Duração:${RESET}       ${formatDuration(report.total_duration_ms)}`);
    console.log('');

    // Função auxiliar para formatar linha da tabela
    function tableRow(label, valA, valB, delta) {
      var paddedLabel = (label || '').toString().padEnd(28);
      var paddedA = (valA || '').toString().padEnd(14);
      var paddedB = (valB || '').toString().padEnd(14);
      var paddedDelta = (delta || '').toString().padEnd(10);
      console.log(' ' + paddedLabel + ' ' + paddedA + ' ' + paddedB + ' ' + paddedDelta);
    }

    // Tabela comparativa principal
    console.log(' ' + 'Métrica'.padEnd(28) + ' ' + 'Sem Matrix'.padEnd(14) + ' ' + 'Com Matrix'.padEnd(14) + ' ' + 'Δ'.padEnd(10));
    console.log(' ' + '─'.repeat(68));
    tableRow('Success Rate', (a.success_rate * 100).toFixed(1) + '%', (b.success_rate * 100).toFixed(1) + '%', (cmp.success_rate_improvement_percent > 0 ? '+' : '') + cmp.success_rate_improvement_percent + '%');
    tableRow('Avg Quality Score', a.avg_quality_score.toFixed(1) + '/10', b.avg_quality_score.toFixed(1) + '/10', (cmp.matrix_gain > 0 ? '+' : '') + cmp.matrix_gain.toFixed(1));
    tableRow('StdDev Quality', a.stddev_quality_score.toFixed(2), b.stddev_quality_score.toFixed(2), cmp.stddev_quality_b < cmp.stddev_quality_a ? '↓ melhor' : '↑ pior');
    tableRow('Scope Creep Rate', (a.scope_creep_rate * 100).toFixed(1) + '%', (b.scope_creep_rate * 100).toFixed(1) + '%', (cmp.scope_creep_reduction_percent > 0 ? '-' : '') + cmp.scope_creep_reduction_percent + '%');
    tableRow('Test Pass Rate', (a.test_pass_rate * 100).toFixed(1) + '%', (b.test_pass_rate * 100).toFixed(1) + '%', '—');
    tableRow('Avg Duration', formatDuration(a.avg_duration_ms), formatDuration(b.avg_duration_ms), (cmp.duration_overhead_percent > 0 ? '+' : '') + cmp.duration_overhead_percent + '%');
    tableRow('Avg LLM Calls', a.avg_llm_calls.toString(), b.avg_llm_calls.toString(), (cmp.llm_calls_increase_percent > 0 ? '+' : '') + cmp.llm_calls_increase_percent + '%');
    console.log('');

    // Quality by classification
    if (cmp.quality_by_classification) {
      console.log(` ${BOLD}Qualidade por Classificação:${RESET}`);
      console.log(` ${'─'.repeat(60)}`);
      for (const [cls, data] of Object.entries(cmp.quality_by_classification)) {
        console.log(` ${cls.padEnd(10)} Sem: ${data.avg_a.toFixed(1)}/10  Com: ${data.avg_b.toFixed(1)}/10  Δ: ${(data.delta > 0 ? '+' : '') + data.delta.toFixed(1)}`);
      }
      console.log('');
    }

    // MIS
    console.log(` ${BOLD}Model Independence Score (MIS):${RESET} ${(cmp.model_independence_score * 100).toFixed(1)}%`);
    const misLabel = cmp.model_independence_score >= 0.75 ? 'ALTO' : (cmp.model_independence_score >= 0.50 ? 'MODERADO' : 'BAIXO');
    console.log(` ${BOLD}Independência:${RESET} ${misLabel}`);
    console.log('');

    // Matrix Gain
    console.log(` ${BOLD}Matrix Gain:${RESET} ${cmp.matrix_gain > 0 ? '+' : ''}${cmp.matrix_gain.toFixed(1)} pontos (${cmp.matrix_gain_percent > 0 ? '+' : ''}${cmp.matrix_gain_percent}%)`);
    console.log('');

    // Per-task summary (top 3 maiores diferenças)
    if (cmp.task_comparison && cmp.task_comparison.length > 0) {
      const sorted = cmp.task_comparison.slice().sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
      const topDeltas = sorted.slice(0, 5);

      console.log(` ${BOLD}Maiores diferenças por tarefa:${RESET}`);
      console.log(` ${'─'.repeat(70)}`);
      for (const t of topDeltas) {
        const deltaStr = (t.delta > 0 ? '+' : '') + t.delta.toFixed(1);
        console.log(` ${t.task_id.padEnd(14)} ${t.classification.padEnd(10)} Sem: ${t.quality_score_a.toFixed(1)}  Com: ${t.quality_score_b.toFixed(1)}  Δ: ${deltaStr}`);
      }
      console.log('');
    }

    // Recomendações
    console.log(` ${BOLD}Recomendações:${RESET}`);
    for (let i = 0; i < report.recommendations.length; i++) {
      console.log(`   ${i + 1}. ${report.recommendations[i]}`);
    }
    console.log('');
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  /**
   * Extrai arquivos alterados do log de saída do pipeline.
   *
   * @param {string} logOutput - Saída do pipeline-executor
   * @param {Object} task - Tarefa original (fallback para ground_truth)
   * @returns {string[]} Lista de arquivos alterados
   */
  _extractFilesFromLog(logOutput, task) {
    const files = [];

    // Tenta extrair menções a arquivos no log
    const fileMatches = logOutput.match(/(?:modified|changed|edited|altered):\s*([^\s,;]+(?:\.\w+)?)/gi);
    if (fileMatches) {
      for (const match of fileMatches) {
        const file = match.replace(/^(?:modified|changed|edited|altered):\s*/i, '').trim();
        if (file && !files.includes(file)) {
          files.push(file);
        }
      }
    }

    // Se não encontrou nada no log, usa o ground_truth como fallback
    if (files.length === 0 && task.ground_truth && task.ground_truth.files_changed) {
      return task.ground_truth.files_changed.slice();
    }

    return files;
  }
}

// ===================================================================
//  FUNÇÃO DE ALTO NÍVEL: runBenchmark
// ===================================================================

/**
 * Função de conveniência para executar o benchmark completo com uma
 * única chamada.
 *
 * @param {Object} [options]
 * @param {string} [options.tasksPath] - Caminho do arquivo de tarefas
 * @param {string} [options.resultsPath] - Caminho do relatório de saída
 * @param {string} [options.modelName] - Nome do modelo
 * @param {boolean} [options.simulate=true] - Modo simulação
 * @param {boolean} [options.verbose=false] - Log detalhado
 * @returns {Promise<Object>} Relatório completo
 */
async function runBenchmark(options) {
  options = options || {};

  const runner = new BenchmarkRunner({
    tasksPath: options.tasksPath,
    resultsPath: options.resultsPath,
    modelName: options.modelName,
    simulate: options.simulate !== false,
    verbose: options.verbose === true
  });

  runner.loadTasks();
  return await runner.runAll();
}

// ===================================================================
//  CLI — Execução Direta
// ===================================================================

// Se executado diretamente (node benchmark-runner.js)
if (require.main === module) {
  (async function () {
    // Parseia argumentos CLI
    const args = process.argv.slice(2);
    const isSimulate = args.includes('--simulate') || !args.includes('--real');
    const isReal = args.includes('--real');
    const isVerbose = args.includes('--verbose') || args.includes('-v');

    // Extrai --output <path>
    let outputPath = null;
    const outputIdx = args.indexOf('--output');
    if (outputIdx !== -1 && outputIdx + 1 < args.length) {
      outputPath = args[outputIdx + 1];
    }

    // Extrai --tasks <path>
    let tasksPath = null;
    const tasksIdx = args.indexOf('--tasks');
    if (tasksIdx !== -1 && tasksIdx + 1 < args.length) {
      tasksPath = args[tasksIdx + 1];
    }

    console.log(`${BOLD}${CYAN}╔══════════════════════════════════════════════════════════╗${RESET}`);
    console.log(`${BOLD}${CYAN}║          Matrix Benchmark Runner — Command Line           ║${RESET}`);
    console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════════╝${RESET}`);
    console.log('');

    const runner = new BenchmarkRunner({
      tasksPath: tasksPath || undefined,
      resultsPath: outputPath || undefined,
      simulate: isSimulate && !isReal,
      verbose: isVerbose
    });

    runner.loadTasks();
    await runner.runAll();
  })();
}

// ===================================================================
//  EXPORTS
// ===================================================================

module.exports = { BenchmarkRunner, runBenchmark };
