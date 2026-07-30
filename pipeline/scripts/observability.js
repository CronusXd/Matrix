#!/usr/bin/env node
/**
 * Matrix Observability Module v1.0
 * Responsável por eventos (events.log) e métricas (metrics.json).
 *
 * Pure Node.js — zero npm dependencies.
 * CommonJS module format.
 *
 * Uso:
 *   const obs = require('./observability');
 *   if (obs.isObservabilityEnabled()) {
 *     obs.appendEvent({ timestamp: '...', event_type: 'transition', ... });
 *     obs.updateMetrics('from', 'to', { agent, tool, durationMs });
 *   }
 */

const fs = require('fs');
const path = require('path');
const { lockFile, unlockFile, loadMetrics, getMetricsPath, getEventsLogPath, getObservabilityPath, getBaseDir } = require('./state-machine');

// ─── Cores para Terminal ──────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

// ─── Observability Config ─────────────────────────────────────────────

/**
 * Lê observability.yaml e retorna se está habilitado.
 * NON-BLOCKING: se falhar, assume enabled=true.
 *
 * @returns {boolean}
 */
function isObservabilityEnabled() {
  const OBSERVABILITY_YAML = getObservabilityPath();
  try {
    const raw = fs.readFileSync(OBSERVABILITY_YAML, 'utf8');
    const lines = raw.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('enabled:')) {
        const val = trimmed.substring(8).trim();
        return val !== 'false';
      }
    }
    return true;
  } catch {
    return true;
  }
}

// ─── Events Log ───────────────────────────────────────────────────────

/**
 * Garante que events.log existe.
 */
function ensureEventsLogHeader() {
  const EVENTS_LOG = getEventsLogPath();
  try {
    if (!fs.existsSync(EVENTS_LOG)) {
      fs.writeFileSync(EVENTS_LOG, '');
    }
  } catch (err) {
    console.warn(`${YELLOW}⚠️  events.log init falhou (NON-BLOCKING): ${err.message}${RESET}`);
  }
}

/**
 * Append de um evento JSON em events.log.
 * Rotation: se o arquivo exceder ~500KB, renomeia para .1 e cria novo.
 *
 * @param {Object} event - Objeto do evento (será serializado como JSON)
 */
function appendEvent(event) {
  const EVENTS_LOG = getEventsLogPath();
  try {
    lockFile(EVENTS_LOG);
    try {
      ensureEventsLogHeader();
      const line = `${JSON.stringify(event)}\n`;
      fs.appendFileSync(EVENTS_LOG, line);

      // Rotação aproximada (~500KB ≈ 10000 linhas × 50 bytes)
      const stats = fs.statSync(EVENTS_LOG);
      if (stats.size > 500000) {
        const rotated = `${EVENTS_LOG}.1`;
        if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
        fs.renameSync(EVENTS_LOG, rotated);
        ensureEventsLogHeader();
        // Re-escreve o evento no novo arquivo
        fs.appendFileSync(EVENTS_LOG, line);
      }
    } finally {
      unlockFile(EVENTS_LOG);
    }
  } catch (err) {
    console.warn(`${YELLOW}⚠️  events.log append falhou (NON-BLOCKING): ${err.message}${RESET}`);
  }
}

// ─── Metrics ──────────────────────────────────────────────────────────

/**
 * Salva metrics.json no disco.
 * @param {Object} metrics
 */
function saveMetrics(metrics) {
  const METRICS_JSON = getMetricsPath();
  fs.writeFileSync(METRICS_JSON, `${JSON.stringify(metrics, null, 2)}\n`);
}

/**
 * Detecta o agente caller através do stack trace / require.main / process.argv.
 * NON-BLOCKING: se falhar, retorna null.
 *
 * @returns {string|null}
 */
function detectCallerAgent() {
  try {
    // 1. Se require.main existe, usa o nome do script principal
    if (require.main && require.main.filename) {
      const mainFile = require.main.filename;
      const baseName = mainFile.split(/[\\/]/).pop().replace(/\.\w+$/, '');
      if (baseName && baseName !== 'observability') {
        // Mapeia nomes de arquivo para agentes legíveis
        const agentMap = {
          'pipeline-executor': 'pipeline-executor (CLI)',
          'pipeline-start': 'pipeline-start',
          'orchestrator': '@AgentsOrchestrator',
          'fable-method-agent': '@fable-method-agent',
          'fable-judge': '@fable-judge',
          'code-reviewer': '@code-reviewer',
          'senior-developer': '@senior-developer'
        };
        return agentMap[baseName] || baseName;
      }
    }

    // 2. Tenta detectar pelo stack trace (procura por caller fora do observability)
    const stack = new Error().stack;
    if (stack) {
      const lines = stack.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Pula linhas do próprio observability
        if (line.indexOf('observability.js') !== -1) continue;
        if (line.indexOf('node:internal') !== -1) continue;
        // Procura por um arquivo .js que seja o caller
        const match = line.match(/([a-zA-Z0-9_-]+\.js)/);
        if (match) {
          const callerFile = match[1].replace(/\.\w+$/, '');
          if (callerFile && callerFile !== 'observability') {
            return callerFile;
          }
        }
      }
    }

    // 3. Fallback: usa o nome do script do argv
    if (process.argv[1]) {
      const scriptName = process.argv[1].split(/[\\/]/).pop().replace(/\.\w+$/, '');
      if (scriptName) return scriptName;
    }

    return null;
  } catch (_) {
    return null;
  }
}

/**
 * Detecta a ferramenta caller através do stack trace / process.argv.
 * NON-BLOCKING: se falhar, retorna null.
 *
 * @returns {string|null}
 */
function detectCallerTool() {
  try {
    // 1. Se process.argv tem flags conhecidas de ferramenta
    const argv = process.argv;
    for (let i = 0; i < argv.length; i++) {
      if (argv[i].startsWith('--tool=')) {
        return argv[i].substring(7);
      }
    }

    // 2. Detecta pelo script principal do require.main
    if (require.main && require.main.filename) {
      const mainFile = require.main.filename;
      const baseName = mainFile.split(/[\\/]/).pop().replace(/\.\w+$/, '');
      const toolMap = {
        'pipeline-executor': 'cli',
        'pipeline-start': 'cli',
        'orchestrator': 'pipeline',
        'fable-method-agent': 'analysis',
        'fable-judge': 'validation',
        'code-reviewer': 'review',
        'senior-developer': 'coding'
      };
      if (toolMap[baseName]) return toolMap[baseName];
    }

    // 3. Detecta pelo stack — procura caller
    const stack = new Error().stack;
    if (stack) {
      const lines = stack.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.indexOf('observability.js') !== -1) continue;
        if (line.indexOf('node:internal') !== -1) continue;
        const match = line.match(/([a-zA-Z0-9_-]+\.js)/);
        if (match) {
          const callerFile = match[1].replace(/\.\w+$/, '');
          const toolMap = {
            'pipeline-executor': 'cli',
            'pipeline-start': 'cli',
            'orchestrator': 'pipeline',
            'fable-method-agent': 'analysis',
            'fable-judge': 'validation',
            'code-reviewer': 'review',
            'senior-developer': 'coding'
          };
          if (toolMap[callerFile]) return toolMap[callerFile];
          return 'script';
        }
      }
    }

    return null;
  } catch (_) {
    return null;
  }
}

/**
 * Atualiza metrics.json com os contadores da transição.
 * NON-BLOCKING: se falhar, loga warning e continua.
 *
 * Suporta detecção automática de caller: se options.agent não for
 * informado, tenta detectar via require.main / stack trace / process.argv.
 *
 * @param {string} from - Estado anterior
 * @param {string} to - Novo estado
 * @param {Object} [options] - Opções (agent, tool, durationMs)
 * @returns {Object|null} Metrics atualizado ou null se falhou
 */
function updateMetrics(from, to, options) {
  const METRICS_JSON = getMetricsPath();
  lockFile(METRICS_JSON);
  try {
    let metrics;
    try {
      metrics = loadMetrics();
    } catch (_) {
      // Cria metrics padrão se não existir
      metrics = {
        pipeline_version: '1.0',
        observability_version: '1.0',
        total_demandas: 0,
        states_completed: 0,
        states_failed: 0,
        escalations: 0,
        total_duration_ms: 0,
        agents_by_type: {},
        tools_by_type: {},
        retries: { fase3_validation: 0, fase4_review: 0 },
        failures_by_phase: {},
        events_count: 0,
        last_reset: null
      };
    }

    options = options || {};

    // Events count
    metrics.events_count = (metrics.events_count || 0) + 1;

    // total_demandas: se to == "identifying"
    if (to === 'identifying') {
      metrics.total_demandas = (metrics.total_demandas || 0) + 1;
    }

    // states_completed
    if (to === 'completed' || to === 'todolist_created' || to === 'fase2_complete' ||
        to === 'fase3_approved' || to === 'fase4_approved') {
      metrics.states_completed = (metrics.states_completed || 0) + 1;
    }

    // states_failed
    if (to === 'failed') {
      metrics.states_failed = (metrics.states_failed || 0) + 1;
    }

    // escalations
    if (to === 'escalated') {
      metrics.escalations = (metrics.escalations || 0) + 1;
    }

    // total_duration_ms
    if (options.durationMs) {
      metrics.total_duration_ms = (metrics.total_duration_ms || 0) + options.durationMs;
    }

    // ── agents_by_type ──────────────────────────────────────────────
    // Tenta obter o agente: 1) options.agent  2) detecção automática  3) fallback descritivo
    let resolvedAgent = options.agent;
    if (!resolvedAgent) {
      resolvedAgent = detectCallerAgent();
    }
    if (!resolvedAgent) {
      // Fallback final: usa o script do argv
      resolvedAgent = (process.argv[1] || 'unknown').split(/[\\/]/).pop().replace(/\.\w+$/, '') || 'unknown';
    }
    if (!metrics.agents_by_type) metrics.agents_by_type = {};
    metrics.agents_by_type[resolvedAgent] = (metrics.agents_by_type[resolvedAgent] || 0) + 1;
    // Log da resolução em modo debug via env
    if (process.env.DEBUG_METRICS === '1') {
      console.log(`   [METRICS] agent resolved: "${resolvedAgent}" (from options=${!!options.agent}, detection=${!options.agent && resolvedAgent !== 'unknown'})`);
    }

    // ── tools_by_type ───────────────────────────────────────────────
    // Tenta obter a ferramenta: 1) options.tool  2) detecção automática  3) fallback descritivo
    let resolvedTool = options.tool;
    if (!resolvedTool) {
      resolvedTool = detectCallerTool();
    }
    if (!resolvedTool) {
      resolvedTool = 'cli';
    }
    if (!metrics.tools_by_type) metrics.tools_by_type = {};
    metrics.tools_by_type[resolvedTool] = (metrics.tools_by_type[resolvedTool] || 0) + 1;

    // retries
    if (!metrics.retries) {
      metrics.retries = { fase3_validation: 0, fase4_review: 0 };
    }
    if (to === 'fase3_refuted') {
      metrics.retries.fase3_validation = (metrics.retries.fase3_validation || 0) + 1;
    }
    if (to === 'fase4_changes_needed') {
      metrics.retries.fase4_review = (metrics.retries.fase4_review || 0) + 1;
    }

    // failures_by_phase
    if (to === 'failed') {
      if (!metrics.failures_by_phase) metrics.failures_by_phase = {};
      const phaseMap = {
        fase1_analysis: 'fase_1',
        context_building: 'fase_2',
        fase2_execution: 'fase_2'
      };
      const phase = phaseMap[from] || 'unknown';
      metrics.failures_by_phase[phase] = (metrics.failures_by_phase[phase] || 0) + 1;
    }

    saveMetrics(metrics);
    return metrics;
  } catch (err) {
    console.warn(`${YELLOW}⚠️  metrics update falhou (NON-BLOCKING): ${err.message}${RESET}`);
    return null;
  } finally {
    unlockFile(METRICS_JSON);
  }
}

module.exports = {
  isObservabilityEnabled,
  ensureEventsLogHeader,
  appendEvent,
  saveMetrics,
  updateMetrics,
};
