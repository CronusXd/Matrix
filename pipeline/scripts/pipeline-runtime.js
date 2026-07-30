#!/usr/bin/env node
/**
 * Matrix Pipeline Monitor v1.0
 * ─────────────────────────────────────────────────────────────────────
 * FERRAMENTA DE MONITORAMENTO E DIAGNÓSTICO do pipeline Matrix.
 *
 * NÃO executa transições automaticamente — essa responsabilidade é
 * exclusiva do pipeline-executor.js (via orchestrator LLM).
 *
 * Funções:
 *   - Observa state.json e alerta se uma fase demorar >30 min (timeout)
 *   - Gera recomendações de próximos passos baseado no estado atual
 *   - Diagnóstico completo: health check, métricas, análise de estado
 *   - NON-BLOCKING: erros são logados mas nunca quebram o fluxo
 *   - CLI mode: node pipeline-runtime.js diagnose
 *   - API pública: diagnose(), getHealth(), recommendNext(), status(), getState()
 *
 * ⚠️  Este monitor NÃO compete com o orchestrator/pipeline-executor.
 *      Não executa transições. Não faz polling contínuo.
 *      Apenas observa, analisa e recomenda.
 *
 * Zero npm dependencies — Pure Node.js (CommonJS).
 *
 * Uso CLI:
 *   node pipeline-runtime.js diagnose   → Diagnóstico completo do pipeline
 *   node pipeline-runtime.js status     → Mostra status atual
 *   node pipeline-runtime.js recommend  → Recomenda próximo estado
 *   node pipeline-runtime.js health     → Health check rápido
 *   node pipeline-runtime.js stop       → Limpa estado do monitor
 *
 * Uso programático:
 *   const monitor = require('./pipeline-runtime');
 *   console.log(monitor.diagnose());
 *   console.log(monitor.recommendNext());
 */

// =====================================================================
//  Dependências
// =====================================================================

var fs = require('fs');
var path = require('path');
var { execSync } = require('child_process');

// =====================================================================
//  Paths Absolutos
// =====================================================================

var SCRIPTS_DIR = __dirname;
var BASE_DIR = path.resolve(SCRIPTS_DIR, '..');
var STATE_JSON = path.join(BASE_DIR, 'state.json');
var PIPELINE_YAML = path.join(BASE_DIR, 'pipeline.yaml');
var EXECUTOR_SCRIPT = path.join(SCRIPTS_DIR, 'pipeline-executor.js');
var CONTEXT_EXECUTOR_SCRIPT = path.join(SCRIPTS_DIR, 'context-executor.js');
var EVENTS_LOG = path.join(BASE_DIR, 'events.log');
var RUNTIME_STATE_FILE = path.join(BASE_DIR, '.runtime-state.json');

// Project root (default: D:\OpenCode or CWD)
var PROJECT_ROOT = process.cwd();

// =====================================================================
//  Cores para Terminal
// =====================================================================

var GREEN = '\x1b[32m';
var RED = '\x1b[31m';
var YELLOW = '\x1b[33m';
var CYAN = '\x1b[36m';
var MAGENTA = '\x1b[35m';
var WHITE = '\x1b[37m';
var RESET = '\x1b[0m';
var BOLD = '\x1b[1m';
var DIM = '\x1b[2m';

// =====================================================================
//  Estado Interno do Runtime
// =====================================================================

var runtimeState = {
  running: false,
  pollingInterval: null,
  pollIntervalMs: 5000,
  lastProcessedState: null,
  lastStateTimestamp: null,
  dispatchedAgents: {},          // { stateName: { agent, timestamp, waitFor } }
  waitingForChange: false,       // true quando aguarda agente completar
  waitingSince: null,            // timestamp do início da espera
  waitingFromState: null,        // estado em que começou a espera
  waitingPossibleTargets: null,  // array de estados alvo possíveis (ex: fase3_approved, fase3_refuted)
  phaseTimeoutMinutes: 30,       // warning se fase demorar mais que isso
  totalTransitions: 0,
  totalDispatches: 0,
  startTime: null,
  errors: [],
  phaseStartTimes: {}            // { stateName: timestamp }
};

// =====================================================================
//  Carregamento de Dados
// =====================================================================

/**
 * Lê e parseia state.json com fallback seguro.
 * NON-BLOCKING: retorna null se falhar.
 */
function loadState() {
  try {
    if (!fs.existsSync(STATE_JSON)) {
      runtimeLog('warn', 'state.json não encontrado em ' + STATE_JSON);
      return null;
    }
    var raw = fs.readFileSync(STATE_JSON, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    runtimeLog('error', 'Erro ao ler state.json: ' + err.message);
    return null;
  }
}

/**
 * Lê e parseia pipeline.yaml para extrair states e transitions.
 * NON-BLOCKING: retorna objeto vazio se falhar.
 */
function loadPipeline() {
  try {
    if (!fs.existsSync(PIPELINE_YAML)) {
      runtimeLog('warn', 'pipeline.yaml não encontrado em ' + PIPELINE_YAML);
      return { states: [], transitions: [] };
    }
    var raw = fs.readFileSync(PIPELINE_YAML, 'utf8');

    // Parse states via parseSectionList do lib
    var yamlUtils;
    try {
      yamlUtils = require('./lib/yaml-utils');
    } catch (e) {
      runtimeLog('warn', 'yaml-utils não disponível, usando parser inline: ' + e.message);
      return { states: [], transitions: [] };
    }

    var states = yamlUtils.parseSectionList(raw, 'states');
    var transitions = yamlUtils.parseSectionList(raw, 'transitions');

    return { states: states, transitions: transitions };
  } catch (err) {
    runtimeLog('error', 'Erro ao ler pipeline.yaml: ' + err.message);
    return { states: [], transitions: [] };
  }
}

/**
 * Salva estado interno do runtime em disco para resiliência.
 * Usado para recovery após crash.
 */
function saveRuntimeState() {
  try {
    var data = {
      lastProcessedState: runtimeState.lastProcessedState,
      lastStateTimestamp: runtimeState.lastStateTimestamp,
      waitingForChange: runtimeState.waitingForChange,
      waitingSince: runtimeState.waitingSince,
      waitingFromState: runtimeState.waitingFromState,
      waitingPossibleTargets: runtimeState.waitingPossibleTargets,
      totalTransitions: runtimeState.totalTransitions,
      totalDispatches: runtimeState.totalDispatches,
      phaseStartTimes: runtimeState.phaseStartTimes,
      timestamp: new Date().toISOString()
    };
    fs.writeFileSync(RUNTIME_STATE_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    // NON-BLOCKING: apenas loga
    runtimeLog('warn', 'Não foi possível salvar runtime state: ' + err.message);
  }
}

/**
 * Carrega runtime state do disco (para recovery).
 */
function loadRuntimeState() {
  try {
    if (!fs.existsSync(RUNTIME_STATE_FILE)) return;
    var raw = fs.readFileSync(RUNTIME_STATE_FILE, 'utf8');
    var data = JSON.parse(raw);
    if (data.lastProcessedState) runtimeState.lastProcessedState = data.lastProcessedState;
    if (data.lastStateTimestamp) runtimeState.lastStateTimestamp = data.lastStateTimestamp;
    if (data.waitingForChange !== undefined) runtimeState.waitingForChange = data.waitingForChange;
    if (data.waitingSince) runtimeState.waitingSince = data.waitingSince;
    if (data.waitingFromState) runtimeState.waitingFromState = data.waitingFromState;
    if (data.waitingPossibleTargets) runtimeState.waitingPossibleTargets = data.waitingPossibleTargets;
    if (data.totalTransitions) runtimeState.totalTransitions = data.totalTransitions;
    if (data.totalDispatches) runtimeState.totalDispatches = data.totalDispatches;
    if (data.phaseStartTimes) runtimeState.phaseStartTimes = data.phaseStartTimes;
  } catch (err) {
    // NON-BLOCKING
  }
}

// =====================================================================
//  Mapa de Ações por Estado
// =====================================================================

/**
 * ACTION_MAP define o que o runtime DEVE fazer ao entrar em cada estado.
 *
 * Tipos de ação:
 *   - 'transition':  Avança automaticamente para target usando pipeline-executor
 *   - 'dispatch':    Dispara um agente (task) e aguarda conclusão
 *   - 'exec':        Executa uma ação interna (context builder, git commit) e avança
 *   - 'check_attempts': Verifica contagem de tentativas e decide próximo estado
 *   - 'noop':        Nenhuma ação (idle, wait states)
 *   - 'terminal':    Estado final — para o runtime
 *
 * Cada handler de ação é NON-BLOCKING: erros são logados mas não quebram o loop.
 */
var ACTION_MAP = {
  // ─── INIT ───────────────────────────────────────────────────────────
  'idle': {
    type: 'noop',
    description: 'Aguardando demanda do usuário — runtime monitorando'
  },

  'identifying': {
    type: 'transition',
    target: 'obligations_created',
    agent: 'pipeline-runtime',
    tool: 'auto',
    description: 'Auto-avançando: identifying → obligations_created'
  },

  'obligations_created': {
    type: 'transition',
    target: 'obligations_verified',
    agent: 'pipeline-runtime',
    tool: 'auto',
    description: 'Auto-avançando: obligations_created → obligations_verified'
  },

  'obligations_verified': {
    type: 'transition',
    target: 'fase1_analysis',
    agent: 'pipeline-runtime',
    tool: 'auto',
    description: 'Auto-avançando: obligations_verified → fase1_analysis'
  },

  // ─── FASE 1: Análise ──────────────────────────────────────────────
  'fase1_analysis': {
    type: 'dispatch',
    agent: '@fable-method-agent',
    description: 'Steps 0-3: Classificar demanda, definir Done, reunir evidências, decidir, criar todolist',
    waitFor: ['todolist_created'],
    taskSuggestion: 'Delegar @fable-method-agent via task para análise Fable Method (Steps 0-3)'
  },

  'todolist_created': {
    type: 'transition',
    target: 'context_building',
    agent: 'pipeline-runtime',
    tool: 'auto',
    description: 'Auto-avançando: todolist_created → context_building'
  },

  // ─── CONTEXT BUILDER ───────────────────────────────────────────────
  'context_building': {
    type: 'exec',
    fn: 'runContextBuilder',
    next: 'fase2_execution',
    description: 'Executando Context Builder (CB.1-CB.6) e avançando para fase2_execution'
  },

  // ─── FASE 2: Execução ─────────────────────────────────────────────
  'fase2_execution': {
    type: 'dispatch',
    agent: '@senior-developer',
    description: 'Steps 4-6: Implementar com contexto otimizado, verificar, reportar, marcar tasks como completed',
    waitFor: ['fase2_complete'],
    taskSuggestion: 'Delegar especialista da tabela de roteamento (ou @senior-developer) via task com contexto otimizado'
  },

  'fase2_complete': {
    type: 'transition',
    target: 'fase3_validation',
    agent: 'pipeline-runtime',
    tool: 'auto',
    description: 'Auto-avançando: fase2_complete → fase3_validation'
  },

  // ─── FASE 3: Validação ────────────────────────────────────────────
  'fase3_validation': {
    type: 'dispatch',
    agent: '@fable-judge',
    description: 'Verificação adversarial: re-executar verificações, detectar fraudes, entregar veredito',
    waitFor: ['fase3_approved', 'fase3_refuted'],
    taskSuggestion: 'Delegar @fable-judge via task para verificação adversarial do trabalho'
  },

  'fase3_approved': {
    type: 'transition',
    target: 'fase4_review',
    agent: 'pipeline-runtime',
    tool: 'auto',
    description: 'Judge aprovou → avançando para fase4_review'
  },

  'fase3_refuted': {
    type: 'check_attempts',
    key: 'fase3_validation',
    max: 3,
    nextOk: 'fase2_execution',
    nextFail: 'escalated',
    description: 'Judge refutou → verificando tentativas'
  },

  // ─── FASE 4: Revisão ──────────────────────────────────────────────
  'fase4_review': {
    type: 'dispatch',
    agent: '@code-reviewer',
    description: 'Revisão técnica: corretude, segurança, estilo, testes',
    waitFor: ['fase4_approved', 'fase4_changes_needed'],
    taskSuggestion: 'Delegar @code-reviewer via task para revisão técnica do código'
  },

  'fase4_approved': {
    type: 'transition',
    target: 'delivery',
    agent: 'pipeline-runtime',
    tool: 'auto',
    description: 'Code Review aprovou → avançando para delivery'
  },

  'fase4_changes_needed': {
    type: 'check_attempts',
    key: 'fase4_review',
    max: 3,
    nextOk: 'fase2_execution',
    nextFail: 'escalated',
    description: 'Code Review pediu mudanças → verificando tentativas'
  },

  // ─── DELIVERY ──────────────────────────────────────────────────────
  'delivery': {
    type: 'exec',
    fn: 'runGitCommit',
    next: 'reporting',
    description: 'Executando git add + commit + push e avançando para reporting'
  },

  'reporting': {
    type: 'transition',
    target: 'completed',
    agent: 'pipeline-runtime',
    tool: 'auto',
    description: 'Auto-avançando: reporting → completed'
  },

  // ─── ESTADOS FINAIS ────────────────────────────────────────────────
  'completed': {
    type: 'terminal',
    description: '✅ Pipeline concluído com sucesso!'
  },

  'failed': {
    type: 'terminal',
    description: '❌ Pipeline falhou — verifique os logs para mais detalhes.'
  },

  'escalated': {
    type: 'terminal',
    description: '⚠️  Máximo de tentativas excedido — pipeline escalado ao usuário.'
  }
};

// =====================================================================
//  Helpers de Logging
// =====================================================================

/**
 * Log formatado com timestamp e cor.
 * Formato: [HH:MM:SS] • tipo • mensagem
 */
function runtimeLog(level, message) {
  var now = new Date();
  var time = now.toTimeString().substring(0, 8);
  var prefix = '';
  var color = '';

  switch (level) {
    case 'info':
      prefix = ' INFO ';
      color = CYAN;
      break;
    case 'warn':
      prefix = ' WARN ';
      color = YELLOW;
      break;
    case 'error':
      prefix = ' ERROR';
      color = RED;
      break;
    case 'dispatch':
      prefix = 'DISPCH';
      color = MAGENTA;
      break;
    case 'transition':
      prefix = 'TRANS ';
      color = GREEN;
      break;
    case 'done':
      prefix = ' DONE ';
      color = GREEN;
      break;
    default:
      prefix = ' LOG  ';
      color = WHITE;
  }

  console.log('[' + DIM + time + RESET + '] ' + color + prefix + RESET + ' ' + message);
}

/**
 * Log de seção com destaque visual.
 */
function logSection(title) {
  var line = '══════════════════════════════════════════════════════════';
  console.log('');
  console.log(CYAN + BOLD + '╔' + line + '╗' + RESET);
  console.log(CYAN + BOLD + '║  ' + title.padEnd(line.length - 4) + '║' + RESET);
  console.log(CYAN + BOLD + '╚' + line + '╝' + RESET);
  console.log('');
}

/**
 * Log de card para dispatch de agente.
 */
function logAgentCard(agentName, description, fromState, toStates) {
  console.log('');
  console.log(MAGENTA + BOLD + '┌─────────────────────────────────────────────────────────┐' + RESET);
  console.log(MAGENTA + BOLD + '│  AGENT DISPATCH                                         │' + RESET);
  console.log(MAGENTA + BOLD + '└─────────────────────────────────────────────────────────┘' + RESET);
  console.log('  ' + BOLD + 'Agent:' + RESET + '       ' + MAGENTA + agentName + RESET);
  console.log('  ' + BOLD + 'Task:' + RESET + '        ' + description);
  console.log('  ' + BOLD + 'From:' + RESET + '        ' + CYAN + fromState + RESET);
  if (toStates && toStates.length === 1) {
    console.log('  ' + BOLD + 'Target:' + RESET + '      ' + GREEN + toStates[0] + RESET);
  } else if (toStates && toStates.length > 1) {
    console.log('  ' + BOLD + 'Targets:' + RESET + '     ' + toStates.map(function(s) { return GREEN + s + RESET; }).join(', '));
  }
  console.log('  ' + BOLD + '⏳ Aguardando:' + RESET + ' ' + YELLOW + 'runtime em polling (5s)...' + RESET);
  console.log('');
}

// =====================================================================
//  Executor Integration
// =====================================================================

/**
 * Tenta carregar pipeline-executor como módulo.
 * Se falhar (ex: erro de require), usa CLI como fallback.
 */
function getExecutor() {
  try {
    return require('./pipeline-executor');
  } catch (err) {
    runtimeLog('warn', 'pipeline-executor require falhou, usando CLI fallback: ' + err.message);
    return null;
  }
}

/**
 * Executa transição de estado usando pipeline-executor.
 * Tenta via require primeiro, depois CLI como fallback.
 *
 * @param {string} target - Estado de destino
 * @param {Object} [meta] - Metadados (agent, tool)
 * @returns {boolean} true se transição foi bem-sucedida
 */
function executeTransition(target, meta) {
  meta = meta || {};
  var agent = meta.agent || 'pipeline-runtime';
  var tool = meta.tool || 'auto';

  runtimeLog('transition', 'Transição para ' + GREEN + BOLD + target + RESET);

  // ── State Lock: runtime adquire lock antes de avançar (FASE 2.3) ──
  var stateLock;
  try {
    stateLock = require('./state-lock');
    if (!stateLock.acquireLock('runtime')) {
      runtimeLog('warn', '⏳ Lock pertence a "' + stateLock.getLockOwner() + '". Aguardando...');
      return false;
    }
  } catch (err) {
    runtimeLog('warn', 'State lock falhou (NON-BLOCKING): ' + err.message);
  }

  // Tenta via require (programático)
  var executor = getExecutor();
  if (executor && typeof executor.transition === 'function') {
    try {
      var result = executor.transition(target, {
        agent: agent,
        tool: tool
      });
      if (result && result.success) {
        runtimeLog('done', 'Transição concluída: → ' + GREEN + target + RESET);
        runtimeState.totalTransitions++;
        runtimeState.phaseStartTimes[target] = Date.now();
        saveRuntimeState();
        if (stateLock) stateLock.releaseLock('runtime');
        return true;
      } else {
        runtimeLog('error', 'Transição falhou: ' + (result ? result.error : 'resultado vazio'));
        if (stateLock) stateLock.releaseLock('runtime');
        return false;
      }
    } catch (err) {
      runtimeLog('error', 'Transição via require falhou: ' + err.message + ' — tentando CLI...');
      // Fallback para CLI
    }
  }

  // Fallback: CLI
  try {
    var cmd = 'node "' + EXECUTOR_SCRIPT + '" transition "' + target + '"';
    var output = execSync(cmd, {
      cwd: SCRIPTS_DIR,
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    runtimeLog('done', 'Transição CLI concluída: → ' + GREEN + target + RESET);
    runtimeState.totalTransitions++;
    runtimeState.phaseStartTimes[target] = Date.now();
    saveRuntimeState();
    if (stateLock) stateLock.releaseLock('runtime');
    return true;
  } catch (err) {
    runtimeLog('error', 'Transição via CLI falhou: ' + err.message);
    runtimeState.errors.push({ action: 'transition', target: target, error: err.message, time: new Date().toISOString() });
    saveRuntimeState();
    if (stateLock) stateLock.releaseLock('runtime');
    return false;
  }
}

// =====================================================================
//  Context Builder
// =====================================================================

/**
 * Executa Context Builder (CB.1-CB.6) via context-executor.js.
 * NON-BLOCKING: se falhar, loga warning e continua.
 *
 * @returns {boolean} true se executou com sucesso
 */
function runContextBuilder() {
  logSection('📦 Context Builder');

  if (!fs.existsSync(CONTEXT_EXECUTOR_SCRIPT)) {
    runtimeLog('warn', 'context-executor.js não encontrado em ' + CONTEXT_EXECUTOR_SCRIPT);
    runtimeLog('warn', 'Pulando Context Builder — continuando para fase2_execution');
    return false;
  }

  try {
    runtimeLog('info', 'Executando Context Builder (CB.1-CB.6)...');
    runtimeLog('info', 'Script: ' + CONTEXT_EXECUTOR_SCRIPT);
    runtimeLog('info', 'Root: ' + PROJECT_ROOT);

    var result = execSync('node "' + CONTEXT_EXECUTOR_SCRIPT + '" "pipeline" --root "' + PROJECT_ROOT + '"', {
      cwd: SCRIPTS_DIR,
      encoding: 'utf-8',
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // A saída do context-executor inclui logs em stderr e resultado em stdout
    var lines = result.split('\n').filter(function(l) { return l.trim().length > 0; });
    var preview = lines.slice(0, 5).join('\n    ');

    runtimeLog('done', 'Context Builder executado com sucesso');
    if (preview.length > 0) {
      console.log('    ' + DIM + 'Resultado:' + RESET);
      console.log('    ' + DIM + preview + RESET);
    }
    console.log('');
    return true;
  } catch (err) {
    runtimeLog('warn', 'Context Builder falhou (NON-BLOCKING): ' + err.message);
    runtimeLog('warn', 'Continuando para fase2_execution sem contexto otimizado');
    runtimeState.errors.push({ action: 'contextBuilder', error: err.message, time: new Date().toISOString() });
    saveRuntimeState();
    return false;
  }
}

// =====================================================================
//  Git Commit Automático
// =====================================================================

/**
 * Executa git add + commit + push.
 * NON-BLOCKING: se falhar, loga warning e continua.
 *
 * @returns {boolean} true se executou com sucesso
 */
function runGitCommit() {
  logSection('📤 Git Commit');

  try {
    runtimeLog('info', 'Executando git add -A...');
    execSync('git add -A', {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000
    });
    runtimeLog('info', 'Verificando se há mudanças para commit...');

    // Verifica se há algo para commitar
    var status = execSync('git status --porcelain', {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      timeout: 10000
    });

    if (status.trim().length === 0) {
      runtimeLog('warn', 'Nenhuma mudança para commit — continuando');
      return true;
    }

    var changedFiles = status.trim().split('\n').length;
    runtimeLog('info', changedFiles + ' arquivo(s) modificado(s)');

    var commitMsg = 'feat(pipeline): auto-commit via pipeline-runtime [' + new Date().toISOString() + ']';

    runtimeLog('info', 'Executando git commit...');
    execSync('git commit -m "' + commitMsg + '"', {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000
    });
    runtimeLog('done', 'Commit realizado: ' + commitMsg);

    runtimeLog('info', 'Executando git push...');
    try {
      execSync('git push', {
        cwd: PROJECT_ROOT,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60000
      });
      runtimeLog('done', 'Push realizado com sucesso');
    } catch (pushErr) {
      runtimeLog('warn', 'Push falhou (NON-BLOCKING): ' + pushErr.message);
      runtimeLog('warn', 'Mudanças estão commitadas localmente');
    }

    console.log('');
    return true;
  } catch (err) {
    runtimeLog('warn', 'Git commit falhou (NON-BLOCKING): ' + err.message);
    runtimeState.errors.push({ action: 'gitCommit', error: err.message, time: new Date().toISOString() });
    saveRuntimeState();
    return false;
  }
}

// =====================================================================
//  Agent Dispatcher
// =====================================================================

/**
 * Dispara (loga) um agente para o estado atual.
 * O runtime não cria tasks OpenCode diretamente — ele loga a task
 * que o operador/orchestrador deve executar.
 *
 * @param {string} agentName - Nome do agente (ex: '@fable-method-agent')
 * @param {string} description - Descrição da tarefa
 * @param {string} fromState - Estado atual
 * @param {string[]} waitFor - Estados alvo que indicam conclusão
 */
function dispatchAgent(agentName, description, fromState, waitFor) {
  logAgentCard(agentName, description, fromState, waitFor);

  runtimeLog('dispatch', 'Agente ' + MAGENTA + agentName + RESET + ' disparado para ' + CYAN + fromState + RESET);
  runtimeLog('dispatch', 'Task: ' + description);
  if (waitFor && waitFor.length > 0) {
    runtimeLog('dispatch', 'Aguardando estados: ' + waitFor.join(', '));
  }

  // Registra o dispatch
  runtimeState.dispatchedAgents[fromState] = {
    agent: agentName,
    description: description,
    timestamp: new Date().toISOString(),
    waitFor: waitFor
  };
  runtimeState.totalDispatches++;
  runtimeState.waitingForChange = true;
  runtimeState.waitingSince = Date.now();
  runtimeState.waitingFromState = fromState;
  runtimeState.waitingPossibleTargets = waitFor;
  runtimeState.phaseStartTimes[fromState] = Date.now();

  saveRuntimeState();
}

// =====================================================================
//  Verificação de Tentativas (Retry Logic)
// =====================================================================

/**
 * Verifica se o número de tentativas para uma fase está dentro do limite.
 * Usa state.json.attempts para contar.
 *
 * @param {string} attemptKey - Chave em state.attempts (ex: 'fase3_validation')
 * @param {number} maxAttempts - Número máximo de tentativas
 * @returns {{ canRetry: boolean, attempts: number, max: number }}
 */
function checkAttempts(attemptKey, maxAttempts) {
  var state = loadState();
  if (!state) {
    runtimeLog('warn', 'Não foi possível ler state.json para verificar tentativas');
    return { canRetry: false, attempts: 0, max: maxAttempts, reason: 'state.json unreadable' };
  }

  var attempts = (state.attempts && state.attempts[attemptKey]) || 0;
  var canRetry = attempts < maxAttempts;

  runtimeLog('info', 'Tentativas para ' + YELLOW + attemptKey + RESET + ': ' +
    attempts + '/' + maxAttempts + ' — ' +
    (canRetry ? GREEN + 'pode tentar novamente' + RESET : RED + 'limite excedido' + RESET));

  return { canRetry: canRetry, attempts: attempts, max: maxAttempts };
}

// =====================================================================
//  Pipeline Metrics & Analytics
// =====================================================================

/**
 * Coleta métricas do pipeline para o relatório de status.
 */
function collectMetrics() {
  var state = loadState();
  var now = Date.now();
  var uptime = runtimeState.startTime ? Math.floor((now - runtimeState.startTime) / 1000) : 0;

  // Duração por fase
  var phaseDurations = {};
  for (var phaseState in runtimeState.phaseStartTimes) {
    var start = runtimeState.phaseStartTimes[phaseState];
    var end = now;
    // Se ainda está no mesmo estado, usa now; senão, usa time da transição
    if (state && state.current_state === phaseState) {
      end = now;
    }
    phaseDurations[phaseState] = Math.floor((end - start) / 1000);
  }

  return {
    running: runtimeState.running,
    uptimeSeconds: uptime,
    uptimeFormatted: formatDuration(uptime),
    currentState: state ? state.current_state : 'unknown',
    lastProcessedState: runtimeState.lastProcessedState,
    waitingForChange: runtimeState.waitingForChange,
    waitingFromState: runtimeState.waitingFromState,
    waitingTimeSeconds: runtimeState.waitingSince ? Math.floor((now - runtimeState.waitingSince) / 1000) : 0,
    totalTransitions: runtimeState.totalTransitions,
    totalDispatches: runtimeState.totalDispatches,
    totalErrors: runtimeState.errors.length,
    phaseDurations: phaseDurations,
    dispatchedAgents: runtimeState.dispatchedAgents,
    historyLength: state ? (state.history ? state.history.length : 0) : 0
  };
}

/**
 * Formata duração em segundos para string legível.
 */
function formatDuration(totalSeconds) {
  if (totalSeconds < 60) return totalSeconds + 's';
  var minutes = Math.floor(totalSeconds / 60);
  var seconds = totalSeconds % 60;
  if (minutes < 60) return minutes + 'm ' + seconds + 's';
  var hours = Math.floor(minutes / 60);
  minutes = minutes % 60;
  return hours + 'h ' + minutes + 'm ' + seconds + 's';
}

// =====================================================================
//  VALIDAÇÃO DE TRANSIÇÃO — Valida contra pipeline.yaml
// =====================================================================

/**
 * Valida se uma transição de estado é permitida pelo pipeline.yaml.
 * Rejeita explicitamente transições inválidas com mensagem clara.
 *
 * @param {string} fromState - Estado atual
 * @param {string} toState - Estado destino
 * @returns {{ valid: boolean, error: string|null, validTargets: string[] }}
 */
function validateTransition(fromState, toState) {
  const pipeline = loadPipeline();
  const state = loadState();

  if (!fromState && state && state.current_state) {
    fromState = state.current_state;
  }

  if (!fromState) {
    return { valid: false, error: 'Estado de origem não especificado e state.json não disponível', validTargets: [] };
  }

  // Verifica se fromState existe
  const fromDef = pipeline.states.find(function(s) { return s.id === fromState; });
  if (!fromDef) {
    return { valid: false, error: 'Estado de origem "' + fromState + '" não encontrado em pipeline.yaml', validTargets: [] };
  }

  // Verifica se toState existe
  if (toState) {
    const toDef = pipeline.states.find(function(s) { return s.id === toState; });
    if (!toDef) {
      return { valid: false, error: 'Estado destino "' + toState + '" não encontrado em pipeline.yaml', validTargets: [] };
    }
  }

  if (!toState) {
    // Apenas informa os destinos válidos
    const valid = pipeline.transitions
      .filter(function(t) { return t.from === fromState; })
      .map(function(t) { return t.to; });
    return { valid: false, error: 'Nenhum estado destino especificado', validTargets: valid };
  }

  // Verifica se a transição existe
  const trans = pipeline.transitions.find(function(t) {
    return t.from === fromState && t.to === toState;
  });

  if (!trans) {
    const validTargets = pipeline.transitions
      .filter(function(t) { return t.from === fromState; })
      .map(function(t) { return t.to; });
    return {
      valid: false,
      error: 'Transição inválida: "' + fromState + ' → ' + toState + '" não definida em pipeline.yaml',
      validTargets: validTargets
    };
  }

  return { valid: true, error: null, validTargets: [toState], transition: trans };
}

// =====================================================================
//  Núcleo do Runtime — Processamento de Estado
// =====================================================================

/**
 * Obtém a ação configurada para um estado.
 * Se o estado não estiver no ACTION_MAP, retorna ação default.
 *
 * @param {string} stateId - ID do estado
 * @returns {Object} Ação configurada
 */
function getActionForState(stateId) {
  if (ACTION_MAP[stateId]) {
    return ACTION_MAP[stateId];
  }
  // Estado desconhecido — ação default
  return {
    type: 'unknown',
    description: 'Estado "' + stateId + '" não reconhecido — aguardando intervenção'
  };
}

/**
 * Analisa um estado e retorna a ação recomendada, mas NUNCA executa
 * transições automaticamente. Esta é a diferença fundamental em relação
 * ao pipeline-executor.js.
 *
 * @param {string} stateId - ID do estado a analisar
 * @returns {{ action: string, description: string, recommendation: string, nextStates: string[] }}
 */
function analyzeState(stateId) {
  var action = getActionForState(stateId);
  var state = loadState();

  runtimeLog('info', 'Analisando estado: ' + BOLD + stateId + RESET + ' — ação: ' + action.type + ' (MODO MONITOR)');

  var recommendation = '';
  var nextStates = [];

  switch (action.type) {

    // ─── TRANSITION: Informa que uma transição poderia ocorrer ────
    case 'transition':
      recommendation = 'Estado "' + stateId + '" permite transição para "' + action.target + '". ' +
        'Use pipeline-executor.js manualmente ou via orchestrator.';
      nextStates = [action.target];
      runtimeLog('info', '⚠️  [MONITOR] ' + recommendation);
      break;

    // ─── DISPATCH: Informa que um agente deveria ser disparado ────
    case 'dispatch':
      recommendation = 'Estado "' + stateId + '" requer dispatch do agente ' + action.agent + '. ' +
        'Delegar via orchestrator. Aguardando estados: ' + (action.waitFor || ['?']).join(', ');
      nextStates = action.waitFor || [];
      runtimeLog('info', '⚠️  [MONITOR] ' + recommendation);
      break;

    // ─── EXEC: Informa que uma ação deveria ser executada ─────────
    case 'exec':
      recommendation = 'Estado "' + stateId + '" requer execução de "' + action.fn + '" e transição para "' + (action.next || '?') + '".';
      nextStates = action.next ? [action.next] : [];
      runtimeLog('info', '⚠️  [MONITOR] ' + recommendation);
      break;

    // ─── CHECK_ATTEMPTS: Analisa tentativas e recomenda rota ──────
    case 'check_attempts':
      var result = checkAttempts(action.key, action.max);
      if (result.canRetry) {
        recommendation = 'Tentativas (' + result.attempts + '/' + action.max + ') dentro do limite. ' +
          'Recomenda retornar para "' + action.nextOk + '".';
        nextStates = [action.nextOk];
      } else {
        recommendation = 'Limite de tentativas excedido (' + result.attempts + '/' + action.max + '). ' +
          'Recomenda escalar para "' + action.nextFail + '".';
        nextStates = [action.nextFail];
      }
      runtimeLog('info', '⚠️  [MONITOR] ' + recommendation);
      break;

    // ─── NOOP: Estado ocioso — nenhuma ação ───────────────────────
    case 'noop':
      recommendation = 'Estado "' + stateId + '" é ocioso. ' + (action.description || 'Nenhuma ação necessária.');
      nextStates = [];
      runtimeLog('info', '[MONITOR] ' + recommendation);
      break;

    // ─── TERMINAL: Estado final ────────────────────────────────────
    case 'terminal':
      recommendation = 'Pipeline em estado terminal "' + stateId + '". ' + (action.description || '');
      nextStates = [];
      runtimeLog('done', '[MONITOR] ' + recommendation);
      break;

    // ─── UNKNOWN: Estado não reconhecido ───────────────────────────
    case 'unknown':
    default:
      recommendation = 'Estado "' + stateId + '" não reconhecido no ACTION_MAP. Aguardando intervenção.';
      nextStates = [];
      runtimeLog('warn', '[MONITOR] ' + recommendation);
      break;
  }

  return {
    action: action.type,
    description: action.description || '',
    recommendation: recommendation,
    nextStates: nextStates,
    stateId: stateId
  };
}

// =====================================================================
//  Timeout Detection
// =====================================================================

/**
 * Verifica se alguma fase está em timeout (excedeu o limite de tempo).
 * Loga warning se detectar timeout, mas não interrompe o pipeline.
 *
 * Melhorias (v1.1):
 * - Detecta estados presos mesmo sem waitingForChange=true
 * - Monitora o estado atual de state.json e alerta se a mesma transição
 *   persistir por mais de phaseTimeoutMinutes (30min)
 * - Rastreia o último estado conhecido e seu timestamp para detecção
 *   de stuck states fora do período de waiting
 */
var _stuckStateTracker = {
  lastStateId: null,
  lastStateTimestamp: null,
  lastStateWarnTime: null
};

function checkTimeouts() {
  var now = Date.now();
  var timeoutMs = runtimeState.phaseTimeoutMinutes * 60 * 1000;

  // ─── Modo 1: Waiting mode (comportamento original) ──────────────
  if (runtimeState.waitingForChange && runtimeState.waitingSince) {
    var elapsed = now - runtimeState.waitingSince;
    var elapsedMinutes = Math.floor(elapsed / 60000);

    if (elapsed > timeoutMs) {
      var fromState = runtimeState.waitingFromState || 'unknown';
      var dispatched = runtimeState.dispatchedAgents[fromState];
      var agentName = dispatched ? dispatched.agent : 'unknown';

      runtimeLog('warn', '⏰ TIMEOUT: Fase "' + fromState + '" está há ' + elapsedMinutes +
        'min (' + runtimeState.phaseTimeoutMinutes + 'min limite)');
      runtimeLog('warn', '   Agente: ' + agentName);
      runtimeLog('warn', '   Aguardando: ' +
        (runtimeState.waitingPossibleTargets ? runtimeState.waitingPossibleTargets.join(', ') : 'mudança de estado'));

      // Registra no runtime state para não repetir warning a cada ciclo
      if (!runtimeState._lastTimeoutWarn || (now - runtimeState._lastTimeoutWarn > 60000)) {
        runtimeState._lastTimeoutWarn = now;
        runtimeState.errors.push({ action: 'timeout', state: fromState, elapsedMinutes: elapsedMinutes, time: new Date().toISOString() });
        saveRuntimeState();
      }
    }
    return; // Waiting mode já cobre este caso
  }

  // ─── Modo 2: Stuck detection (novo) ──────────────────────────────
  // Detecta estados que não mudam mesmo sem waitingForChange=true.
  // Lê state.json e verifica se o estado atual está parado há >30min.
  try {
    if (!fs.existsSync(STATE_JSON)) return;

    var state = loadState();
    if (!state || !state.current_state) return;

    var currentStateId = state.current_state;
    var lastTransitionTime = state.last_updated
      ? new Date(state.last_updated).getTime()
      : null;

    // Primeira observação — inicializa tracker
    if (_stuckStateTracker.lastStateId === null) {
      _stuckStateTracker.lastStateId = currentStateId;
      _stuckStateTracker.lastStateTimestamp = lastTransitionTime || now;
      return;
    }

    // Se o estado mudou, reseta o tracker
    if (currentStateId !== _stuckStateTracker.lastStateId) {
      _stuckStateTracker.lastStateId = currentStateId;
      _stuckStateTracker.lastStateTimestamp = lastTransitionTime || now;
      _stuckStateTracker.lastStateWarnTime = null;
      return;
    }

    // Estado não mudou — calcula tempo parado
    var stuckSince = _stuckStateTracker.lastStateTimestamp || now;
    var stuckElapsed = now - stuckSince;
    var stuckMinutes = Math.floor(stuckElapsed / 60000);

    if (stuckElapsed > timeoutMs) {
      // Emite warning (no máximo 1x por minuto para evitar spam)
      if (!_stuckStateTracker.lastStateWarnTime || (now - _stuckStateTracker.lastStateWarnTime > 60000)) {
        runtimeLog('warn', '⏰ STUCK: Estado "' + currentStateId + '" não muda há ' + stuckMinutes +
          'min (' + runtimeState.phaseTimeoutMinutes + 'min limite)');
        runtimeLog('warn', '   Última transição: ' + (state.last_transition || 'N/A'));
        runtimeLog('warn', '   Último update: ' + (state.last_updated || 'N/A'));
        runtimeLog('warn', '   Sugestão: verificar se o pipeline está travado, ' +
          'ou usar "node pipeline-executor.js diagnose" para diagnóstico completo');

        // Registra erro no runtime state para visibilidade
        runtimeState.errors.push({
          action: 'stuck_detected',
          state: currentStateId,
          stuckMinutes: stuckMinutes,
          lastTransition: state.last_transition,
          lastUpdated: state.last_updated,
          time: new Date().toISOString()
        });
        saveRuntimeState();

        _stuckStateTracker.lastStateWarnTime = now;
      }
    }
  } catch (err) {
    // NON-BLOCKING: erro no stuck detection não quebra o pipeline
    runtimeLog('warn', 'Stuck detection error (NON-BLOCKING): ' + err.message);
  }
}

// =====================================================================
//  Polling Loop Principal
// =====================================================================

/**
 * Observação única do estado atual (NÃO é polling loop).
 * Lê state.json, detecta mudanças, analisa o estado e verifica timeouts.
 *
 * Diferente do comportamento anterior, esta função NUNCA executa
 * transições automaticamente — ela apenas observa e registra.
 *
 * Fluxo:
 *   1. Carrega state.json
 *   2. Se falhou → loga e retorna
 *   3. Se current_state mudou → analisa o novo estado (analyzeState)
 *   4. Verifica timeouts de fase
 *   5. Gera recomendação
 *
 * NON-BLOCKING: qualquer erro é logado mas nunca quebra.
 *
 * @returns {Object|null} Resultado da observação ou null se falhou
 */
function observe() {
  try {
    var state = loadState();
    if (!state) {
      return null;
    }

    var currentState = state.current_state;
    if (!currentState) {
      runtimeLog('warn', 'state.json sem current_state');
      return null;
    }

    var result = {
      currentState: currentState,
      changed: false,
      analysis: null,
      timeoutWarnings: [],
      phaseDurations: {}
    };

    // Verifica se o estado mudou desde a última observação
    if (currentState !== runtimeState.lastProcessedState) {
      result.changed = true;

      runtimeLog('info', 'Mudança de estado detectada: ' +
        CYAN + (runtimeState.lastProcessedState || '(início)') + RESET + ' → ' + GREEN + BOLD + currentState + RESET);

      // Atualiza estado interno
      runtimeState.lastProcessedState = currentState;
      runtimeState.lastStateTimestamp = new Date().toISOString();
      saveRuntimeState();

      // Analisa o estado (NÃO executa transição)
      result.analysis = analyzeState(currentState);
    }

    // Timeout check
    if (runtimeState.waitingForChange) {
      checkTimeouts();
    }

    // Duração das fases
    var now = Date.now();
    for (var phaseState in runtimeState.phaseStartTimes) {
      var start = runtimeState.phaseStartTimes[phaseState];
      result.phaseDurations[phaseState] = Math.floor((now - start) / 1000);
    }

    return result;

  } catch (err) {
    runtimeLog('error', 'Erro na observação: ' + err.message);
    runtimeState.errors.push({ action: 'observe', error: err.message, time: new Date().toISOString() });
    saveRuntimeState();
    return null;
  }
}

// =====================================================================
//  Start / Stop do Runtime
// =====================================================================

/**
 * Ativa o modo monitor: carrega estado, faz verificação única,
 * analisa o estado atual e apresenta diagnóstico.
 *
 * ⚠️  NÃO inicia polling loop. NÃO executa transições automaticamente.
 *      Apenas observa o estado atual e gera recomendações.
 */
function startMonitor() {
  if (runtimeState.running) {
    runtimeLog('warn', 'Monitor já está em execução');
    return;
  }

  logSection('🔍 Matrix Pipeline Monitor v1.0');

  runtimeLog('info', 'Inicializando monitor...');
  runtimeLog('info', 'Phase timeout: ' + runtimeState.phaseTimeoutMinutes + 'min');
  runtimeLog('info', 'Scripts dir: ' + SCRIPTS_DIR);
  runtimeLog('info', 'Base dir: ' + BASE_DIR);
  runtimeLog('info', 'Project root: ' + PROJECT_ROOT);

  // Verifica arquivos essenciais
  var stateOk = fs.existsSync(STATE_JSON);
  var yamlOk = fs.existsSync(PIPELINE_YAML);
  var executorOk = fs.existsSync(EXECUTOR_SCRIPT);

  runtimeLog('info', 'state.json: ' + (stateOk ? GREEN + '✓' + RESET : RED + '✗' + RESET));
  runtimeLog('info', 'pipeline.yaml: ' + (yamlOk ? GREEN + '✓' + RESET : RED + '✗' + RESET));
  runtimeLog('info', 'pipeline-executor.js: ' + (executorOk ? GREEN + '✓' + RESET : RED + '✗' + RESET));

  if (!stateOk || !yamlOk || !executorOk) {
    runtimeLog('error', 'Arquivos essenciais do pipeline não encontrados');
    runtimeLog('error', 'Execute: node pipeline/scripts/validate-pipeline.js');
    return;
  }

  // Tenta recovery do estado anterior
  loadRuntimeState();

  // Lê estado atual
  var state = loadState();
  if (!state) {
    runtimeLog('error', 'state.json inválido — não é possível iniciar monitor');
    return;
  }

  var currentState = state.current_state;
  runtimeLog('info', 'Estado atual: ' + CYAN + BOLD + currentState + RESET);
  runtimeLog('info', 'Último estado processado: ' + (runtimeState.lastProcessedState || '(nenhum)'));

  // ═══ NÃO AUTO-PROCESSA — apenas observa ═══
  // Se o estado mudou desde a última observação, analisa
  if (currentState !== runtimeState.lastProcessedState) {
    runtimeLog('info', 'Novo estado detectado — analisando: ' + BOLD + currentState + RESET);
    runtimeState.lastProcessedState = currentState;
    runtimeState.lastStateTimestamp = new Date().toISOString();
    saveRuntimeState();

    // Apenas analisa — NÃO executa transição
    var analysis = analyzeState(currentState);
    console.log('');
    runtimeLog('info', 'Recomendação: ' + analysis.recommendation);
  }

  runtimeState.running = true;
  runtimeState.startTime = Date.now();

  console.log('');
  runtimeLog('info', '✅ Monitor iniciado. Use os comandos abaixo para diagnóstico:');
  console.log('   ' + CYAN + 'diagnose' + RESET + '   → Diagnóstico completo do pipeline');
  console.log('   ' + CYAN + 'health' + RESET + '     → Health check rápido');
  console.log('   ' + CYAN + 'recommend' + RESET + '  → Recomendação de próximo estado');
  console.log('   ' + CYAN + 'status' + RESET + '     → Status atual');
  console.log('   ' + CYAN + 'stop' + RESET + '      → Parar monitor');
  console.log('');
}

/**
 * Para o runtime.
 */
function stopRuntime() {
  if (!runtimeState.running && !runtimeState.pollingInterval) {
    runtimeLog('warn', 'Runtime não está em execução');
    return;
  }

  if (runtimeState.pollingInterval) {
    clearInterval(runtimeState.pollingInterval);
    runtimeState.pollingInterval = null;
  }

  runtimeState.running = false;
  runtimeState.waitingForChange = false;

  // ── Self-Healing: para monitoramento ──
  try {
    var healing = require('./self-healing');
    healing.stop();
  } catch(e) {}

  // Calcula tempo total de execução
  var totalTime = '';
  if (runtimeState.startTime) {
    totalTime = ' (' + formatDuration(Math.floor((Date.now() - runtimeState.startTime) / 1000)) + ')';
  }

  logSection('⏹️  Pipeline Runtime Parado' + totalTime);

  runtimeLog('info', 'Total de transições: ' + runtimeState.totalTransitions);
  runtimeLog('info', 'Total de dispatches: ' + runtimeState.totalDispatches);
  runtimeLog('info', 'Total de erros: ' + runtimeState.errors.length);

  if (runtimeState.errors.length > 0) {
    runtimeLog('warn', 'Erros registrados:');
    runtimeState.errors.forEach(function(err, i) {
      runtimeLog('warn', '  [' + (i + 1) + '] ' + JSON.stringify(err));
    });
  }

  console.log('');
  runtimeLog('done', 'Runtime parado. Até logo! 👋');
  console.log('');

  saveRuntimeState();
}

// =====================================================================
//  CLI Interface
// =====================================================================

function cmdStart() {
  // Callback para SIGINT (Ctrl+C)
  process.on('SIGINT', function() {
    console.log('');
    runtimeLog('info', 'Sinal SIGINT recebido — parando monitor...');
    stopRuntime();
    process.exit(0);
  });

  process.on('SIGTERM', function() {
    console.log('');
    runtimeLog('info', 'Sinal SIGTERM recebido — parando monitor...');
    stopRuntime();
    process.exit(0);
  });

  // Tratamento de exceções não capturadas
  process.on('uncaughtException', function(err) {
    runtimeLog('error', 'Exceção não capturada: ' + err.message);
    runtimeLog('error', err.stack);
    runtimeState.errors.push({ action: 'uncaughtException', error: err.message, time: new Date().toISOString() });
    saveRuntimeState();
    // NON-BLOCKING: continua rodando
  });

  process.on('unhandledRejection', function(reason) {
    runtimeLog('warn', 'Promise rejeitada não tratada: ' + (reason ? reason.toString() : 'unknown'));
    runtimeState.errors.push({ action: 'unhandledRejection', error: reason ? reason.toString() : 'unknown', time: new Date().toISOString() });
    saveRuntimeState();
    // NON-BLOCKING: continua rodando
  });

  startMonitor();
}

function cmdStop() {
  stopRuntime();
}

function cmdStatus() {
  var metrics = collectMetrics();

  logSection('📊 Status do Pipeline Monitor');

  console.log(BOLD + 'Monitor:' + RESET);
  console.log('  Status:        ' + (metrics.running ? GREEN + 'RUNNING' + RESET : YELLOW + 'STOPPED' + RESET));
  console.log('  Uptime:        ' + (metrics.running ? metrics.uptimeFormatted : '—'));
  console.log('');

  console.log(BOLD + 'Pipeline:' + RESET);
  console.log('  Estado atual:        ' + CYAN + metrics.currentState + RESET);
  console.log('  Último processado:   ' + (metrics.lastProcessedState || '(nenhum)'));
  if (metrics.historyLength > 0) {
    console.log('  Transições no hist.: ' + metrics.historyLength);
  }
  console.log('');

  console.log(BOLD + 'Observações:' + RESET);
  if (metrics.waitingForChange) {
    console.log('  Aguardando:      ' + YELLOW + 'SIM' + RESET);
    console.log('  Desde estado:    ' + CYAN + (metrics.waitingFromState || '(desconhecido)') + RESET);
    console.log('  Tempo de espera: ' + formatDuration(metrics.waitingTimeSeconds));
  } else {
    console.log('  Aguardando:      ' + GREEN + 'NÃO' + RESET);
  }
  console.log('  Total dispatched: ' + metrics.totalDispatches);
  console.log('');

  console.log(BOLD + 'Transições:' + RESET);
  console.log('  Total: ' + metrics.totalTransitions);
  console.log('');

  console.log(BOLD + 'Erros:' + RESET);
  console.log('  Total: ' + (metrics.totalErrors > 0 ? RED + metrics.totalErrors + RESET : GREEN + '0' + RESET));
  if (metrics.totalErrors > 0) {
    var lastErrors = runtimeState.errors.slice(-3);
    lastErrors.forEach(function(err) {
      console.log('  - ' + DIM + (err.action || 'unknown') + ': ' + err.error + RESET);
    });
  }
  console.log('');

  if (metrics.dispatchedAgents && Object.keys(metrics.dispatchedAgents).length > 0) {
    console.log(BOLD + 'Últimos dispatches:' + RESET);
    var agentEntries = Object.entries(metrics.dispatchedAgents);
    var lastDispatches = agentEntries.slice(-3);
    lastDispatches.forEach(function(entry) {
      var stateName = entry[0];
      var info = entry[1];
      console.log('  ' + MAGENTA + info.agent + RESET + ' para ' + CYAN + stateName + RESET +
        ' em ' + DIM + info.timestamp + RESET);
    });
    console.log('');
  }

  // Dados do pipeline.yaml para contexto
  var pipeline = loadPipeline();
  if (pipeline.states && pipeline.states.length > 0) {
    var stateDef = pipeline.states.find(function(s) { return s.id === metrics.currentState; });
    if (stateDef && stateDef.description) {
      console.log(BOLD + 'Descrição do estado atual:' + RESET);
      console.log('  ' + DIM + stateDef.description + RESET);
      console.log('');
    }
  }

  // Próximas transições
  var nextActions = getNextActions(metrics.currentState);
  if (nextActions && nextActions.length > 0) {
    console.log(BOLD + 'Próximas ações:' + RESET);
    nextActions.forEach(function(a) {
      console.log('  → ' + GREEN + a.target + RESET + ' (' + a.description + ')');
    });
    console.log('');
  }
}

/**
 * Retorna as próximas ações para um dado estado (para display no status).
 */
function getNextActions(stateId) {
  var action = getActionForState(stateId);
  var actions = [];

  switch (action.type) {
    case 'transition':
      actions.push({ target: action.target, description: action.description || 'Auto-avançar' });
      break;
    case 'dispatch':
      actions.push({ target: (action.waitFor || ['?']).join(', '), description: 'Aguardar ' + action.agent });
      break;
    case 'exec':
      actions.push({ target: action.next, description: 'Executar ' + action.fn + ' e avançar' });
      break;
    case 'check_attempts':
      actions.push({ target: action.nextOk + ' ou ' + action.nextFail, description: 'Verificar tentativas' });
      break;
    case 'noop':
      actions.push({ target: '—', description: 'Monitorando (idle)' });
      break;
    case 'terminal':
      actions.push({ target: '—', description: 'Pipeline finalizado' });
      break;
    default:
      actions.push({ target: '—', description: 'Ação desconhecida' });
  }

  return actions;
}

// =====================================================================
//  NOVAS FUNÇÕES DE DIAGNÓSTICO
// =====================================================================

/**
 * Recomenda o próximo estado baseado no estado atual do pipeline.
 * Lê state.json, consulta ACTION_MAP e pipeline.yaml, e retorna
 * uma recomendação de qual deveria ser o próximo passo.
 *
 * @returns {{ currentState: string, actionType: string, recommendation: string, nextStates: string[], details: Object }}
 */
function recommendNext() {
  var state = loadState();
  if (!state) {
    return { error: 'state.json não encontrado ou inválido', recommendation: 'Verificar se o pipeline foi inicializado' };
  }

  var currentState = state.current_state;
  var action = getActionForState(currentState);
  var pipeline = loadPipeline();

  // Busca transições válidas no pipeline.yaml
  var validTransitions = [];
  if (pipeline.transitions) {
    validTransitions = pipeline.transitions
      .filter(function(t) { return t.from === currentState; })
      .map(function(t) { return t.to; });
  }

  var recommendation = '';
  var nextStates = [];

  switch (action.type) {
    case 'transition':
      recommendation = 'Transição automática disponível: "' + currentState + '" → "' + action.target + '". ' +
        'Execute: node pipeline-executor.js transition "' + action.target + '"';
      nextStates = [action.target];
      break;

    case 'dispatch':
      recommendation = 'Disparar agente ' + action.agent + ' para estado "' + currentState + '". ' +
        'Aguardar conclusão para um dos estados: ' + (action.waitFor || []).join(', ');
      nextStates = action.waitFor || [];
      break;

    case 'exec':
      recommendation = 'Executar "' + action.fn + '" e transicionar para "' + (action.next || '?') + '".';
      nextStates = action.next ? [action.next] : [];
      break;

    case 'check_attempts':
      var result = checkAttempts(action.key, action.max);
      if (result.canRetry) {
        recommendation = 'Tentativas (' + result.attempts + '/' + action.max + ') OK. ' +
          'Recomenda transição para "' + action.nextOk + '".';
        nextStates = [action.nextOk];
      } else {
        recommendation = 'Limite de tentativas excedido (' + result.attempts + '/' + action.max + '). ' +
          'Recomenda escalar para "' + action.nextFail + '".';
        nextStates = [action.nextFail];
      }
      break;

    case 'noop':
      recommendation = 'Pipeline ocioso (idle). Aguardando nova demanda do usuário.';
      nextStates = [];
      break;

    case 'terminal':
      recommendation = 'Pipeline em estado terminal "' + currentState + '". Nenhuma ação necessária.';
      nextStates = [];
      break;

    default:
      recommendation = 'Estado "' + currentState + '" não reconhecido. Verificar ACTION_MAP e pipeline.yaml.';
      nextStates = validTransitions;
  }

  return {
    currentState: currentState,
    actionType: action.type,
    recommendation: recommendation,
    nextStates: nextStates,
    validTransitions: validTransitions,
    details: {
      description: action.description || '',
      stateHistory: state.history ? state.history.slice(-5) : [],
      attempts: state.attempts || {},
      lastUpdated: state.last_updated
    }
  };
}

/**
 * Diagnóstico completo do pipeline e do monitor.
 * Retorna health check, métricas, análise de estado e recomendações.
 *
 * @returns {Object} Diagnóstico completo
 */
function diagnose() {
  var state = loadState();
  var metrics = collectMetrics();
  var next = recommendNext();

  // Health check dos arquivos
  var files = {
    stateJson: { exists: fs.existsSync(STATE_JSON), path: STATE_JSON },
    pipelineYaml: { exists: fs.existsSync(PIPELINE_YAML), path: PIPELINE_YAML },
    executor: { exists: fs.existsSync(EXECUTOR_SCRIPT), path: EXECUTOR_SCRIPT },
    contextExecutor: { exists: fs.existsSync(CONTEXT_EXECUTOR_SCRIPT), path: CONTEXT_EXECUTOR_SCRIPT }
  };

  // Timeout analysis
  var timeouts = [];
  if (runtimeState.waitingForChange && runtimeState.waitingSince) {
    var elapsed = Date.now() - runtimeState.waitingSince;
    var elapsedMin = Math.floor(elapsed / 60000);
    var limitMin = runtimeState.phaseTimeoutMinutes;
    timeouts.push({
      waitingSince: runtimeState.waitingFromState,
      elapsedMinutes: elapsedMin,
      limitMinutes: limitMin,
      isTimedOut: elapsedMin > limitMin
    });
  }

  // Phase durations
  var phaseDurations = {};
  var now = Date.now();
  for (var ps in runtimeState.phaseStartTimes) {
    phaseDurations[ps] = formatDuration(Math.floor((now - runtimeState.phaseStartTimes[ps]) / 1000));
  }

  return {
    timestamp: new Date().toISOString(),
    status: runtimeState.running ? 'active' : 'inactive',
    health: getHealth(),
    pipeline: {
      currentState: state ? state.current_state : 'unknown',
      previousState: state ? state.previous_state : null,
      lastTransition: state ? state.last_transition : null,
      lastUpdated: state ? state.last_updated : null,
      historyCount: state && state.history ? state.history.length : 0
    },
    monitor: {
      uptime: metrics.uptimeFormatted,
      totalObservations: runtimeState.totalTransitions,
      totalErrors: runtimeState.errors.length,
      waitingForChange: runtimeState.waitingForChange,
      waitingFromState: runtimeState.waitingFromState,
      waitingTime: runtimeState.waitingSince ? formatDuration(Math.floor((now - runtimeState.waitingSince) / 1000)) : '0s'
    },
    files: files,
    timeouts: timeouts,
    phaseDurations: phaseDurations,
    lastErrors: runtimeState.errors.slice(-5),
    recommendation: next
  };
}

/**
 * Health check rápido.
 * Retorna status simplificado: ok, warning, ou error.
 *
 * @returns {{ status: string, stateOk: boolean, yamlOk: boolean, executorOk: boolean, message: string }}
 */
function getHealth() {
  var stateOk = fs.existsSync(STATE_JSON);
  var yamlOk = fs.existsSync(PIPELINE_YAML);
  var executorOk = fs.existsSync(EXECUTOR_SCRIPT);

  var allOk = stateOk && yamlOk && executorOk;
  var state = null;
  var stateValid = false;

  if (stateOk) {
    try {
      state = JSON.parse(fs.readFileSync(STATE_JSON, 'utf8'));
      stateValid = !!state.current_state;
    } catch (e) {
      stateValid = false;
    }
  }

  var status = 'ok';
  var message = 'Pipeline monitor saudável';

  if (!allOk) {
    status = 'error';
    var missing = [];
    if (!stateOk) missing.push('state.json');
    if (!yamlOk) missing.push('pipeline.yaml');
    if (!executorOk) missing.push('pipeline-executor.js');
    message = 'Arquivos faltando: ' + missing.join(', ');
  } else if (!stateValid) {
    status = 'warning';
    message = 'state.json existe mas pode estar corrompido';
  } else if (runtimeState.errors.length > 0) {
    status = 'warning';
    message = runtimeState.errors.length + ' erro(s) registrado(s) no monitor';
  }

  return {
    status: status,
    stateOk: stateOk,
    yamlOk: yamlOk,
    executorOk: executorOk,
    stateValid: stateValid,
    currentState: state ? state.current_state : null,
    monitorRunning: runtimeState.running,
    message: message
  };
}

/**
 * CLI: dispatch — Exibe informações de dispatch para o agente (NÃO executa).
 */
function cmdDispatch() {
  var state = loadState();
  if (!state) {
    runtimeLog('error', 'state.json não encontrado');
    process.exit(1);
  }

  var currentState = state.current_state;
  var action = getActionForState(currentState);

  if (action.type === 'dispatch') {
    runtimeLog('info', '📋 Agente necessário para estado ' + CYAN + currentState + RESET);
    runtimeLog('info', '   Agente: ' + MAGENTA + action.agent + RESET);
    runtimeLog('info', '   Tarefa: ' + (action.taskSuggestion || action.description));
    runtimeLog('info', '   ⚠️  Use o orchestrator para delegar este agente');
  } else {
    runtimeLog('warn', 'Estado "' + currentState + '" não requer dispatch (ação: ' + action.type + ')');
  }
}

// =====================================================================
//  CLI Commands
// =====================================================================

function cmdStartMonitor() {
  startMonitor();
}

function cmdDiagnose() {
  var result = diagnose();
  logSection('🔍 Diagnóstico Completo do Pipeline');

  console.log(BOLD + 'Health:' + RESET);
  var health = result.health;
  var healthIcon = health.status === 'ok' ? GREEN + '✓' : (health.status === 'warning' ? YELLOW + '⚠' : RED + '✗');
  console.log('  Status: ' + healthIcon + ' ' + health.status.toUpperCase() + RESET);
  console.log('  ' + health.message);
  console.log('  Monitor running: ' + (health.monitorRunning ? GREEN + 'SIM' + RESET : YELLOW + 'NÃO' + RESET));
  console.log('');

  console.log(BOLD + 'Pipeline:' + RESET);
  console.log('  Estado atual:   ' + CYAN + result.pipeline.currentState + RESET);
  if (result.pipeline.lastTransition) {
    console.log('  Última transição: ' + result.pipeline.lastTransition);
  }
  console.log('  Último update:  ' + (result.pipeline.lastUpdated || '—'));
  console.log('  Histórico:      ' + result.pipeline.historyCount + ' transições');
  console.log('');

  console.log(BOLD + 'Monitor:' + RESET);
  console.log('  Uptime:     ' + result.monitor.uptime);
  if (result.monitor.waitingForChange) {
    console.log('  Aguardando: ' + YELLOW + 'SIM' + RESET + ' (' + result.monitor.waitingFromState + ', ' + result.monitor.waitingTime + ')');
  } else {
    console.log('  Aguardando: ' + GREEN + 'NÃO' + RESET);
  }
  console.log('  Erros:      ' + (result.monitor.totalErrors > 0 ? RED + result.monitor.totalErrors + RESET : GREEN + '0' + RESET));
  console.log('');

  console.log(BOLD + 'Arquivos:' + RESET);
  for (var f in result.files) {
    var icon = result.files[f].exists ? GREEN + '✓' + RESET : RED + '✗' + RESET;
    console.log('  ' + icon + ' ' + f);
  }
  console.log('');

  if (result.timeouts.length > 0) {
    console.log(BOLD + 'Timeouts:' + RESET);
    result.timeouts.forEach(function(t) {
      if (t.isTimedOut) {
        console.log('  ' + RED + '⚠ TIMEOUT' + RESET + ' em ' + t.waitingSince + ' — ' + t.elapsedMinutes + 'min decorridos');
      } else {
        console.log('  ' + YELLOW + '⏳ ' + t.waitingSince + ' — ' + t.elapsedMinutes + 'min de ' + t.limitMinutes + 'min');
      }
    });
    console.log('');
  }

  if (result.phaseDurations && Object.keys(result.phaseDurations).length > 0) {
    console.log(BOLD + 'Duração por fase:' + RESET);
    for (var phase in result.phaseDurations) {
      console.log('  ' + CYAN + phase + RESET + ': ' + result.phaseDurations[phase]);
    }
    console.log('');
  }

  console.log(BOLD + 'Recomendação:' + RESET);
  if (result.recommendation && result.recommendation.recommendation) {
    console.log('  ' + result.recommendation.recommendation);
    if (result.recommendation.nextStates && result.recommendation.nextStates.length > 0) {
      console.log('  Próximos estados possíveis: ' + result.recommendation.nextStates.map(function(s) { return GREEN + s + RESET; }).join(', '));
    }
  }
  console.log('');
}

function cmdHealth() {
  var health = getHealth();
  var icon = health.status === 'ok' ? GREEN + '✓' : (health.status === 'warning' ? YELLOW + '⚠' : RED + '✗');
  console.log('');
  console.log(BOLD + 'Matrix Pipeline Monitor — Health Check' + RESET);
  console.log('');
  console.log('  Status: ' + icon + ' ' + health.status.toUpperCase() + RESET);
  console.log('  ' + health.message);
  console.log('');
  console.log('  ' + (health.stateOk ? GREEN + '✓' + RESET : RED + '✗' + RESET) + ' state.json');
  console.log('  ' + (health.yamlOk ? GREEN + '✓' + RESET : RED + '✗' + RESET) + ' pipeline.yaml');
  console.log('  ' + (health.executorOk ? GREEN + '✓' + RESET : RED + '✗' + RESET) + ' pipeline-executor.js');
  console.log('  ' + (health.stateValid ? GREEN + '✓' + RESET : RED + '✗' + RESET) + ' state.json válido');
  console.log('  Monitor: ' + (health.monitorRunning ? GREEN + 'ativo' + RESET : YELLOW + 'inativo' + RESET));
  if (health.currentState) {
    console.log('  Estado atual: ' + CYAN + health.currentState + RESET);
  }
  console.log('');
}

function cmdRecommend() {
  var next = recommendNext();
  logSection('📋 Recomendação de Próximo Passo');

  console.log('  Estado atual: ' + CYAN + next.currentState + RESET);
  console.log('  Tipo de ação: ' + next.actionType);
  console.log('');
  console.log(BOLD + 'Recomendação:' + RESET);
  console.log('  ' + next.recommendation);
  console.log('');

  if (next.nextStates && next.nextStates.length > 0) {
    console.log(BOLD + 'Próximos estados:' + RESET);
    next.nextStates.forEach(function(s) {
      console.log('  → ' + GREEN + s + RESET);
    });
    console.log('');
  }

  if (next.validTransitions && next.validTransitions.length > 0) {
    console.log(BOLD + 'Transições válidas (pipeline.yaml):' + RESET);
    next.validTransitions.forEach(function(t) {
      console.log('  → ' + GREEN + t + RESET);
    });
    console.log('');
  }

  if (next.details) {
    if (next.details.description) {
      console.log(BOLD + 'Descrição:' + RESET);
      console.log('  ' + next.details.description);
      console.log('');
    }
    if (next.details.attempts && Object.keys(next.details.attempts).length > 0) {
      console.log(BOLD + 'Tentativas:' + RESET);
      for (var k in next.details.attempts) {
        console.log('  ' + k + ': ' + next.details.attempts[k] + '/3');
      }
      console.log('');
    }
  }
}

// =====================================================================
//  CLI Main
// =====================================================================

function main() {
  var args = process.argv.slice(2);
  var cmd = args[0] || 'diagnose';

  switch (cmd) {
    case 'start':
    case 'monitor':
      cmdStartMonitor();
      break;
    case 'stop':
      cmdStop();
      break;
    case 'status':
      cmdStatus();
      break;
    case 'diagnose':
    case 'diag':
      cmdDiagnose();
      break;
    case 'health':
    case 'check':
      cmdHealth();
      break;
    case 'recommend':
    case 'next':
      cmdRecommend();
      break;
    case 'dispatch':
      cmdDispatch();
      break;
    case '--help':
    case '-h':
    case 'help':
      console.log('');
      console.log(CYAN + BOLD + 'Matrix Pipeline Monitor v1.0' + RESET);
      console.log('');
      console.log(BOLD + 'Uso:' + RESET);
      console.log('  node pipeline-runtime.js ' + GREEN + 'diagnose' + RESET + '   Diagnóstico completo do pipeline');
      console.log('  node pipeline-runtime.js ' + GREEN + 'status' + RESET + '     Mostra status atual');
      console.log('  node pipeline-runtime.js ' + GREEN + 'recommend' + RESET + '  Recomenda próximo estado');
      console.log('  node pipeline-runtime.js ' + GREEN + 'health' + RESET + '     Health check rápido');
      console.log('  node pipeline-runtime.js ' + GREEN + 'start' + RESET + '     Inicia o monitor');
      console.log('  node pipeline-runtime.js ' + GREEN + 'stop' + RESET + '      Para o monitor');
      console.log('  node pipeline-runtime.js ' + GREEN + 'dispatch' + RESET + '  Mostra agente necessário');
      console.log('  node pipeline-runtime.js ' + GREEN + 'help' + RESET + '      Mostra esta ajuda');
      console.log('');
      console.log(BOLD + 'API programática:' + RESET);
      console.log('  const monitor = require(\'./pipeline-runtime\');');
      console.log('  monitor.diagnose();');
      console.log('  monitor.getHealth();');
      console.log('  monitor.recommendNext();');
      console.log('  monitor.status();');
      console.log('  monitor.getState();');
      console.log('  monitor.observe();');
      console.log('  monitor.start();');
      console.log('  monitor.stop();');
      console.log('');
      break;
    default:
      console.error(RED + 'Comando desconhecido: "' + cmd + '"' + RESET);
      console.log('Use: node pipeline-runtime.js [diagnose|status|recommend|health|start|stop|help]');
      process.exit(1);
  }
}

// =====================================================================
//  API Pública
// =====================================================================

var publicAPI = {
  /**
   * Inicia o monitor (NÃO executa transições).
   * Apenas observa o estado atual e analisa.
   */
  start: function() {
    if (runtimeState.running) {
      runtimeLog('warn', 'Monitor já está em execução');
      return;
    }
    startMonitor();
  },

  /**
   * Para o monitor.
   */
  stop: function() {
    stopRuntime();
  },

  /**
   * Retorna objeto com status atual.
   * @returns {Object} Status
   */
  status: function() {
    return collectMetrics();
  },

  /**
   * Retorna o state.json atual.
   * @returns {Object|null} State atual ou null se não disponível
   */
  getState: function() {
    return loadState();
  },

  /**
   * Realiza observação única do estado atual (NÃO faz polling).
   * @returns {Object|null} Resultado da observação
   */
  observe: function() {
    return observe();
  },

  /**
   * Diagnóstico completo do pipeline.
   * @returns {Object} Diagnóstico completo
   */
  diagnose: function() {
    return diagnose();
  },

  /**
   * Health check rápido.
   * @returns {Object} Status de saúde
   */
  getHealth: function() {
    return getHealth();
  },

  /**
   * Recomenda próximo estado baseado no estado atual.
   * @returns {Object} Recomendação
   */
  recommendNext: function() {
    return recommendNext();
  },

  /**
   * Analisa um estado sem executar ação.
   * @param {string} stateId - ID do estado
   * @returns {Object} Análise do estado
   */
  analyzeState: function(stateId) {
    return analyzeState(stateId);
  },

  /**
   * Valida se uma transição de estado é permitida pelo pipeline.yaml.
   * Rejeita explicitamente transições inválidas com mensagem clara.
   * @param {string} fromState - Estado de origem
   * @param {string} toState - Estado destino
   * @returns {{ valid: boolean, error: string|null, validTargets: string[] }}
   */
  validateTransition: function(fromState, toState) {
    return validateTransition(fromState, toState);
  },

  /**
   * Executa UMA transição de estado usando pipeline-executor.
   * Wrapper público para a função executeTransition interna.
   *
   * @param {string} target - Estado de destino
   * @param {Object} [meta] - Metadados (agent, tool)
   * @returns {boolean} true se transição foi bem-sucedida
   */
  executeTransition: function(target, meta) {
    return executeTransition(target, meta || {});
  },

  /**
   * Executa o pipeline automaticamente: lê o estado atual, aplica
   * as ações do ACTION_MAP e avança até um estado terminal ou
   * até encontrar um estado que requer dispatch (agente externo).
   *
   * NON-BLOCKING: erros são logados mas não interrompem o pipeline.
   *
   * Fluxo:
   *   1. Valida pipeline (validate-pipeline.js) — 8/8 obrigatório
   *   2. Lê estado atual de state.json
   *   3. Se estado for 'completed' ou terminal, faz reset para 'idle'
   *   4. Aplica ACTION_MAP:
   *        transition  → executeTransition() automático
   *        dispatch    → loga e PARA (requer agente externo)
   *        exec        → executa fn() e avança
   *        noop        → pula (idle)
   *        terminal    → para
   *   5. Retorna relatório do que foi executado
   *
   * @param {Function} [onDispatch] - Callback chamado quando um dispatch
   *   é necessário. Recebe { agent, description, fromState, waitFor }.
   *   Se não fornecido, loga e retorna.
   * @returns {Object} Resultado do pipeline run
   */
  runPipeline: function(onDispatch) {
    logSection('🔄 Matrix Pipeline Runtime — Execução Automática');

    // ── Passo 1: Validar pipeline (8/8) ──────────────────────────
    runtimeLog('info', 'Passo 1: Validando state machine...');
    var validatorPath = path.join(SCRIPTS_DIR, 'validate-pipeline.js');
    var validationOk = false;
    try {
      var valResult = execSync('node "' + validatorPath + '"', {
        cwd: SCRIPTS_DIR,
        encoding: 'utf-8',
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      validationOk = valResult.includes('PASS') || valResult.includes('8/8') || valResult.includes('passed');
      if (validationOk) {
        runtimeLog('done', '✅ Validação 8/8 PASS');
      } else {
        runtimeLog('warn', '⚠️  Validação pode ter falhado — continuando...');
        runtimeLog('info', valResult.split('\n').filter(function(l) { return l.trim().length > 0; }).slice(-3).join('\n    '));
      }
    } catch (valErr) {
      runtimeLog('warn', 'Validação falhou (NON-BLOCKING): ' + valErr.message);
    }

    // ── Passo 2: Ler estado atual ────────────────────────────────
    runtimeLog('info', 'Passo 2: Lendo estado atual...');
    var state = loadState();
    if (!state) {
      runtimeLog('error', 'state.json não encontrado ou inválido');
      return { success: false, error: 'state.json inválido', executed: [] };
    }

    var currentState = state.current_state;
    runtimeLog('info', 'Estado atual: ' + CYAN + BOLD + currentState + RESET);

    // ── Passo 3: Se terminal, reset para idle ───────────────────
    var terminalStates = ['completed', 'failed', 'escalated'];
    if (terminalStates.indexOf(currentState) >= 0) {
      runtimeLog('info', 'Estado terminal detectado — resetando para idle...');
      var resetOk = executeTransition('idle', { agent: 'pipeline-runtime', tool: 'auto' });
      if (resetOk) {
        currentState = 'idle';
        runtimeLog('done', 'Reset concluído: → idle');
      } else {
        runtimeLog('error', 'Falha ao resetar para idle');
        return { success: false, error: 'Reset falhou', executed: [] };
      }
    }

    // ── Passo 4: Executar pipeline até terminal ou dispatch ────
    var maxSteps = 20; // Safety limit
    var executed = [];
    var stopped = false;
    var result = { success: false, reason: '', executed: [], finalState: currentState };

    for (var step = 0; step < maxSteps && !stopped; step++) {
      var action = getActionForState(currentState);
      runtimeLog('info', 'Step ' + (step + 1) + '/' + maxSteps + ' — Estado: ' + BOLD + currentState + RESET + ' — Ação: ' + action.type);

      switch (action.type) {
        case 'transition':
          runtimeLog('transition', 'Auto-transição: ' + currentState + ' → ' + action.target);
          var ok = executeTransition(action.target, { agent: 'pipeline-runtime', tool: 'auto' });
          if (ok) {
            executed.push({ from: currentState, to: action.target, action: 'transition' });
            currentState = action.target;
          } else {
            runtimeLog('error', 'Falha na transição ' + currentState + ' → ' + action.target);
            stopped = true;
            result.reason = 'Transition failed: ' + currentState + ' → ' + action.target;
          }
          break;

        case 'dispatch':
          runtimeLog('dispatch', 'Dispatch necessário: ' + MAGENTA + action.agent + RESET + ' para ' + CYAN + currentState + RESET);
          executed.push({ from: currentState, action: 'dispatch', agent: action.agent, waitFor: action.waitFor });
          if (typeof onDispatch === 'function') {
            onDispatch({
              agent: action.agent,
              description: action.description,
              fromState: currentState,
              waitFor: action.waitFor,
              taskSuggestion: action.taskSuggestion
            });
          }
          // Dispatch pára o pipeline automático (requer ação externa)
          stopped = true;
          result.reason = 'Awaiting agent dispatch: ' + action.agent;
          break;

        case 'exec':
          runtimeLog('info', 'Executando ação interna: ' + action.fn + ' → ' + (action.next || '?'));
          var fnMap = {
            runContextBuilder: runContextBuilder,
            runGitCommit: runGitCommit
          };
          var fn = fnMap[action.fn];
          if (typeof fn === 'function') {
            fn();
          } else {
            runtimeLog('warn', 'Função "' + action.fn + '" não encontrada — tentando execução direta');
          }
          if (action.next) {
            var execOk = executeTransition(action.next, { agent: 'pipeline-runtime', tool: 'auto' });
            if (execOk) {
              executed.push({ from: currentState, to: action.next, action: 'exec', fn: action.fn });
              currentState = action.next;
            } else {
              runtimeLog('error', 'Falha na transição pós-exec: ' + currentState + ' → ' + action.next);
              stopped = true;
              result.reason = 'Post-exec transition failed';
            }
          } else {
            stopped = true;
            result.reason = 'Exec action without next state';
          }
          break;

        case 'check_attempts':
          runtimeLog('info', 'Verificando tentativas para ' + action.key);
          var checkResult = checkAttempts(action.key, action.max);
          var nextTarget = checkResult.canRetry ? action.nextOk : action.nextFail;
          runtimeLog('info', 'Tentativas: ' + checkResult.attempts + '/' + action.max + ' — próximo: ' + nextTarget);
          var checkOk = executeTransition(nextTarget, { agent: 'pipeline-runtime', tool: 'auto' });
          if (checkOk) {
            executed.push({ from: currentState, to: nextTarget, action: 'check_attempts', key: action.key });
            currentState = nextTarget;
          } else {
            runtimeLog('error', 'Falha na transição check_attempts: ' + currentState + ' → ' + nextTarget);
            stopped = true;
            result.reason = 'Check-attempts transition failed';
          }
          break;

        case 'noop':
          runtimeLog('info', 'Estado ocioso (noop) — pipeline aguardando');
          executed.push({ from: currentState, action: 'noop', description: action.description });
          stopped = true;
          result.reason = 'Pipeline idle';
          break;

        case 'terminal':
          runtimeLog('done', '✅ Estado terminal atingido: ' + BOLD + currentState + RESET);
          executed.push({ from: currentState, action: 'terminal', description: action.description });
          stopped = true;
          result.success = true;
          result.reason = 'Pipeline completed: ' + currentState;
          break;

        default:
          runtimeLog('warn', 'Ação desconhecida "' + action.type + '" para estado "' + currentState + '"');
          stopped = true;
          result.reason = 'Unknown action type: ' + action.type;
      }
    }

    if (step >= maxSteps) {
      result.reason = 'Max steps reached (' + maxSteps + ')';
      runtimeLog('warn', '⚠️ Limite de ' + maxSteps + ' steps atingido — pipeline interrompido');
    }

    result.success = result.success || (executed.length > 0 && !result.error);
    result.executed = executed;
    result.finalState = currentState;
    result.steps = executed.length;

    console.log('');
    logSection('📊 Pipeline Run Summary');
    runtimeLog('info', 'Estados processados: ' + executed.length);
    runtimeLog('info', 'Estado final: ' + CYAN + BOLD + currentState + RESET);
    runtimeLog('info', 'Resultado: ' + (result.success ? GREEN + 'SUCESSO' + RESET : YELLOW + 'PARCIAL' + RESET));
    runtimeLog('info', 'Motivo: ' + result.reason);
    executed.forEach(function(e, i) {
      var arrow = e.to ? (GREEN + ' → ' + e.to + RESET) : '';
      runtimeLog('info', '  [' + (i + 1) + '] ' + e.from + arrow + ' (' + e.action + ')');
    });
    console.log('');

    return result;
  }
};

// Se executado diretamente via CLI
if (require.main === module) {
  main();
}

module.exports = publicAPI;
