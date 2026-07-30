#!/usr/bin/env node
/**
 * Matrix Pipeline Executor v2.0 — Modularizado
 * Motor central que automatiza o fluxo do pipeline Matrix.
 *
 * v2.0: Refatorado para modularização — state-machine.js, observability.js,
 *       memory-operations.js, cli-commands.js.
 *
 * Pure Node.js — zero npm dependencies.
 * CommonJS module format (require, não import).
 *
 * Uso CLI:
 *   node pipeline-executor.js status              → Mostra estado atual
 *   node pipeline-executor.js transition <estado>  → Executa 1 transição
 *   node pipeline-executor.js history              → Mostra histórico de transições
 *   node pipeline-executor.js validate             → Roda validate-pipeline.js
 *   node pipeline-executor.js check                → System health check completo
 *   node pipeline-executor.js modules              → Mostra status dos módulos auxiliares
 *   node pipeline-executor.js query-rag <pergunta>  → Consulta índice RAG
 *   node pipeline-executor.js rag-query <pergunta>  → Consulta índice RAG (alias)
 *
 * Uso programático:
 *   const executor = require('./pipeline-executor');
 *   executor.transition('fase2_complete', { agent: '@especialista', tool: 'task' });
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { parseSectionList, stripQuotes } = require('./lib/yaml-utils');

// ─── Módulos extraídos ────────────────────────────────────────────────
const sm = require('./state-machine');
// UNIFIED: state-machine.js agora inclui engine (state-machine-engine.js removido)
const obs = require('./observability');
const mem = require('./memory-operations');
const cmds = require('./cli-commands');
const securityEnforcer = require('./security-enforcer');
const agentRouter = require('./agent-router');
const modelRouter = require('./model-router');
const toolRouter = require('./tool-router');

// ─── Fase Mapping ────────────────────────────────────────────────────
const fases = require('./lib/fases');

// ─── Paths Absolutos ─────────────────────────────────────────────────
const BASE_DIR = sm.getBaseDir();

// ─── Cores para Terminal ──────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

// =====================================================================
//  CONFIG — Flags de Configuração (v3.0 — simplificado)
// =====================================================================

/**
 * Flags globais de configuração do pipeline executor.
 * Removido: siemEnabled, votingEnabled, prEnabled (nunca implementados)
 */
const CONFIG = {
  sandboxEnabled: true,
  contextEnabled: true,
  modelRoutingEnabled: true,
  agentRoutingEnabled: true,
  autoCommit: true,
  rollbackEnabled: true,
  parallelEnabled: true,
  forceNewSession: false
};

// =====================================================================
//  Auth Gate (simplificado v3.0 — apenas RBAC interno)
// =====================================================================

  /**
   * Gate de autenticação simplificado.
   * Apenas RBAC interno (JWT/OAuth2 removido por não ser utilizado).
   */
  function pipelineAuthGate() {
    return { active: false, provider: 'internal', authenticated: false, user: null, blocking: false, error: null };
  }

// =====================================================================
//  Model Selection (simplificado v3.0 — delegado ao model-router)
// =====================================================================

/**
 * Seleciona modelo de IA via model-router.
 * Model Voting removido (nunca foi utilizado, adicionava complexidade sem benefício).
 */
function selectModel(taskType, complexity) {
  try {
    return modelRouter.selectModel(taskType, complexity || 1);
  } catch (err) {
    console.warn(`${YELLOW}⚠️  [MODEL ROUTER] Fallback: ${err.message} — usando deepseek-v4-flash-free${RESET}`);
    return { model: 'oc/deepseek-v4-flash-free', costPer1KTokens: 0.0, tier: 'free', reason: 'fallback' };
  }
}

// =====================================================================
//  Tool Routing
// =====================================================================

/**
 * Retorna ferramentas recomendadas para um tipo de tarefa e complexidade.
 */
function getTools(taskType, complexity, options) {
  try {
    const router = (AUX.tools && typeof AUX.tools.getTools === 'function')
      ? AUX.tools
      : toolRouter;

    const result = router.getTools(taskType, complexity, options);

    // Cache do router para próximas chamadas
    AUX.tools = router;

    console.log(`   ${CYAN}[TOOL ROUTER]${RESET} getTools("${taskType}", ${complexity}) → ${result.route || 'no-route'} (${result.tools ? result.tools.length : 0} tools)`);

    return result;
  } catch (err) {
    // Fallback mínimo: apenas se tool-router falhar completamente
    console.warn(`${YELLOW}⚠️  [TOOL ROUTER] Fallback: router falhou (${err.message}) — retornando tool list vazia${RESET}`);
    const type = (taskType || '').toLowerCase().trim();
    return {
      tools: [
        { name: 'read', category: 'leitura', description: 'Leitura de arquivos', restricted: false },
        { name: 'bash', category: 'execucao', description: 'Execução de comandos', restricted: false }
      ],
      route: null,
      taskType: type,
      reason: 'tool-router unavailable, returning minimal fallback'
    };
  }
}

// =====================================================================
//  Agent Routing
// =====================================================================

function selectAgent(taskType, complexity, domain, keywords) {
  // QC6: Agent Router é GATE OBRIGATÓRIO
  if (!CONFIG.agentRoutingEnabled) {
    throw new Error('QC6 VIOLATION: Agent Routing is disabled. Set agentRoutingEnabled=true.');
  }

  try {
    const router = (AUX.agentRouter && typeof AUX.agentRouter.selectAgent === 'function')
      ? AUX.agentRouter
      : agentRouter;

    const result = router.selectAgent(taskType, complexity, domain, keywords);

    if (!result || !result.agent) {
      throw new Error(`QC6 VIOLATION: Agent Router retornou resultado inválido para taskType="${taskType}"`);
    }

    AUX.agentRouter = router;
    console.log(`   ${CYAN}[AGENT ROUTER]${RESET} selectAgent("${taskType}", ${complexity}) → ${result.agent}${result.reason ? ' (' + result.reason + ')' : ''}`);
    return result;
  } catch (err) {
    if (err.message && err.message.startsWith('QC6 VIOLATION')) throw err;
    console.error(`${RED}❌ [QC6 VIOLATION] Agent Router falhou: ${err.message}${RESET}`);
    throw new Error(`QC6 VIOLATION: Agent Router unavailable — ${err.message}`);
  }
}

function getAgentInfo(agentName) {
  try {
    if (AUX.agentRouter && typeof AUX.agentRouter.getAgentInfo === 'function') {
      return AUX.agentRouter.getAgentInfo(agentName);
    }
    const router = require('./agent-router');
    AUX.agentRouter = router;
    return router.getAgentInfo(agentName);
  } catch (err) {
    return null;
  }
}

function findAgentByKeywords(keywords) {
  try {
    if (AUX.agentRouter && typeof AUX.agentRouter.findAgentByKeywords === 'function') {
      return AUX.agentRouter.findAgentByKeywords(keywords);
    }
    const router = require('./agent-router');
    AUX.agentRouter = router;
    return router.findAgentByKeywords(keywords);
  } catch (err) {
    return null;
  }
}

function routeTask(taskDescription, options) {
  try {
    if (AUX.tools && typeof AUX.tools.routeTask === 'function') {
      return AUX.tools.routeTask(taskDescription, options);
    }
    const router = require('./tool-router');
    AUX.tools = router;
    return router.routeTask(taskDescription, options);
  } catch (err) {
    const tools = getTools('read', 1, options);
    return {
      tools: tools.tools,
      route: null,
      taskType: 'unknown',
      complexity: 1,
      reason: 'routeTask unavailable, using getTools fallback',
      summary: '⚠️ Roteamento indisponível. Usando fallback.'
    };
  }
}

function getToolInfo(toolName) {
  try {
    if (AUX.tools && typeof AUX.tools.getToolInfo === 'function') {
      return AUX.tools.getToolInfo(toolName);
    }
    const router = require('./tool-router');
    AUX.tools = router;
    return router.getToolInfo(toolName);
  } catch (err) {
    return null;
  }
}

// =====================================================================
//  Auto-Commit
// =====================================================================

function autoCommit(message, fromState, toState) {
  try {
    if (!message) {
      if (toState === 'delivery' || toState === 'reporting') {
        message = 'feat(pipeline): implementação concluída e aprovada';
      } else if (toState === 'fase3_refuted') {
        message = 'fix(pipeline): correção após validação do judge';
      } else if (toState === 'fase4_changes_needed') {
        message = 'fix(pipeline): correção após code review';
      } else if (toState === 'fase2_execution' && (fromState === 'fase3_refuted' || fromState === 'fase4_changes_needed')) {
        message = 'fix(pipeline): retry de implementação após revisão';
      } else {
        message = 'chore(pipeline): atualização automática';
      }
    }

    // ── Verificar se há mudanças para commitar ────────────────────────
    // Security check antes do git status (NON-BLOCKING)
    const secCheckStatus = securityCheck('git status --porcelain', { actionType: 'git_read' });
    if (!secCheckStatus.allowed) {
      console.warn(`${YELLOW}🔒 git status bloqueado pelo security enforcer — pulando auto-commit${RESET}`);
      return;
    }

    try {
      const statusOutput = execSync('git status --porcelain', {
        cwd: BASE_DIR,
        encoding: 'utf-8',
        stdio: 'pipe'
      }).toString().trim();
      if (!statusOutput) {
        console.log(`   ${DIM}📭 Nenhuma mudança para commitar — pulando auto-commit${RESET}`);
        return;
      }
    } catch (statusErr) {
      console.warn(`${YELLOW}⚠️  git status falhou (NON-BLOCKING): ${statusErr.message}${RESET}`);
      console.warn(`   ${YELLOW}   Tentando commit mesmo assim...${RESET}`);
    }

    // ── Secrets scan automático antes do commit ───────────────────────
    preCommitSecretsScan(BASE_DIR);

    // Security check antes do git commit (NON-BLOCKING)
    const secCheckCommit = securityCheck('git add -A && git commit', { actionType: 'git_push' });
    if (!secCheckCommit.allowed) {
      console.warn(`${YELLOW}🔒 git commit bloqueado pelo security enforcer — pulando auto-commit${RESET}`);
      return;
    }

    console.log(`${BOLD}📤 Auto-commit: git add -A && git commit...${RESET}`);
    execSync(`git add -A && git commit -m "${message}"`, {
      cwd: BASE_DIR,
      stdio: 'pipe'
    });
    console.log(`${GREEN}✓ Auto-commit: ${message}${RESET}`);
  } catch (e) {
    console.warn(`${YELLOW}⚠️  Auto-commit falhou (NON-BLOCKING): ${e.message}${RESET}`);
  }
}

// =====================================================================
//  Fase Helper
// =====================================================================

function getFaseFromState(stateId) {
  return fases.getFaseFromState(stateId);
}

// =====================================================================
//  Módulos Auxiliares (v3.0 — simplificado, sem módulos fantasmas)
// =====================================================================

const AUX = {};

function initAuxModules() {
  // Apenas módulos REALMENTE implementados e utilizados
  AUX.agentRouter = require('./agent-router');
  try { AUX.tools = require('./tool-router'); } catch(e) { /* optional */ }
  try { AUX.contextBuilder = require('./context-executor'); } catch(e) { /* optional */ }
  try { AUX.smEngine = sm.loadFromFile(); } catch(e) { /* NON-BLOCKING */ }
  try { AUX.rollback = require('./rollback-manager'); } catch(e) { /* optional */ }
  try { AUX.tokens = require('./token-tracker'); } catch(e) { /* optional */ }
}

function getModuleStatus() {
  return {
    tokens: !!AUX.tokens,
    contextBuilder: !!AUX.contextBuilder,
    tools: !!AUX.tools,
    agentRouter: !!AUX.agentRouter,
    rollback: !!AUX.rollback,
    smEngine: !!AUX.smEngine,
    parallelEnabled: CONFIG.parallelEnabled
  };
}

// ─── Cleanup Audit Counter ─────────────────────────────────────────
/**
 * Contador incremental de transições para throttle do cleanup audit.
 * O cleanup-audit.js roda a cada N transições (N=10).
 * @type {number}
 */
var _transitionCounter = 0;

// Inicializar módulos auxiliares no load
initAuxModules();

// Startup: verificar state.json recovery (NON-BLOCKING)
try {
  var recoveryResult = sm.recoverState();
  if (recoveryResult.recovered) {
    console.log(`   ${GREEN}✓${RESET} State recovery: ${recoveryResult.message}`);
  }
} catch (e) {
  console.warn(`${YELLOW}⚠️  State recovery check falhou (NON-BLOCKING): ${e.message}${RESET}`);
}

// Startup: verificar sessão pendente via memory (simplificado v3.0)
try {
  var memStartup = require('./memory-adapter');
  var resumeData = memStartup.resume();
  if (resumeData) {
    console.log(`   ${CYAN}♻️  Sessão anterior detectada — último estado: ${resumeData.last_state || 'desconhecido'}${RESET}`);
    if (CONFIG.forceNewSession) {
      memStartup.purge('contexto');
      memStartup.purge('checkpoints');
      console.log(`   ${YELLOW}♻️  --force-new-session: sessão anterior limpa${RESET}`);
    }
  }
} catch (e) {
  // NON-BLOCKING
}

/**
 * Session Recovery Startup — versão simplificada v3.0.
 * Apenas verifica memory.resume().
 */
function sessionRecoveryStartup() {
  try {
    var memory = require('./memory-adapter');
    var resumeData = memory.resume();
    return {
      pending: !!resumeData,
      demand: resumeData ? resumeData.last_demand : null,
      lastState: resumeData ? resumeData.last_state : null,
      checkpointCount: resumeData && resumeData.checkpoints ? Object.keys(resumeData.checkpoints).length : 0,
      sessionId: null,
      resumeData: resumeData
    };
  } catch (err) {
    return { pending: false, demand: null, lastState: null, checkpointCount: 0, sessionId: null, resumeData: null };
  }
}

// =====================================================================
//  Parallel Execution
// =====================================================================

function executeTasksInParallel(tasks, options) {
  options = options || {};
  const maxWorkers = options.maxWorkers || 4;
  if (AUX.parallel && typeof AUX.parallel.executeParallel === 'function') {
    console.log(`   ⚡ executeTasksInParallel: usando parallel-executor (${tasks.length} tasks, max ${maxWorkers} workers)`);
    // Passa TODAS as tasks para o parallel-executor — ele gerencia
    // tasks script-based (child_process) e function-based (Promise)
    return AUX.parallel.executeParallel(tasks, {
      maxWorkers: maxWorkers,
      timeout: options.timeout || 30000
    });
  }

  console.log('   ⚡ executeTasksInParallel: fallback sequencial (' + tasks.length + ' tasks)');
  const results = [];
  for (let i = 0; i < tasks.length; i++) {
    try {
      const task = tasks[i];
      const result = (typeof task.fn === 'function') ? task.fn() : null;
      results.push({ task: task.name || 'task-' + (i + 1), result: result, error: null });
    } catch (err) {
      results.push({ task: task.name || 'task-' + (i + 1), result: null, error: err.message });
    }
  }
  return results;
}

// =====================================================================
//  Sandbox Integration
// =====================================================================

function validateWithSandbox(command) {
  if (!CONFIG.sandboxEnabled) {
    console.warn(`${YELLOW}⚠️  Sandbox desabilitado — permitindo comando sem validação${RESET}`);
    return { allowed: true, reason: 'sandbox disabled by config' };
  }

  try {
    const sandbox = require('./sandbox-run');
    const config = sandbox.loadConfig();
    const validation = sandbox.validateCommand(command, config);

    if (!validation.allowed) {
      console.error(`${RED}🔒 SANDBOX: Comando rejeitado — ${validation.reason}${RESET}`);
      console.error(`   Comando: ${command}`);
    }

    return validation;
  } catch (err) {
    console.warn(`${YELLOW}⚠️  Sandbox validation falhou (NON-BLOCKING): ${err.message}${RESET}`);
    console.warn('   Permitindo comando sem validação de sandbox');
    return { allowed: true, reason: `sandbox unavailable: ${err.message}` };
  }
}

// =====================================================================
//  Security Enforcer Integration
// =====================================================================

/**
 * Security Check Unificado — Middleware de Segurança Runtime.
 * Integra sandbox + RBAC + secrets scan em uma única chamada.
 *
 * @param {string} command - Comando a verificar
 * @param {object} [options] - Opções de contexto
 * @param {string} [options.userId] - ID do usuário para RBAC
 * @param {string} [options.actionType] - Tipo de ação (execute, code_write, git_push, config_write)
 * @param {string} [options.workingDir] - Diretório de trabalho
 * @param {boolean} [options.useWhitelist=true] - Usar whitelist do sandbox
 * @returns {{ allowed: boolean, reason: string, checks: Array }}
 *
 * NON-BLOCKING: falha retorna { allowed: true } com warning.
 */
function securityCheck(command, options) {
  options = options || {};

  if (!CONFIG.sandboxEnabled) {
    return { allowed: true, reason: 'Security check desabilitado por configuração', checks: [] };
  }

  if (!command || typeof command !== 'string' || command.trim().length === 0) {
    return { allowed: true, reason: 'Comando vazio — sem verificação necessária', checks: [] };
  }

  try {
    const context = {
      userId: options.userId || process.env.Matrix_USER || 'pipeline-default',
      actionType: options.actionType || 'execute',
      workingDir: options.workingDir || process.cwd(),
      useWhitelist: options.useWhitelist !== false
    };

    const result = securityEnforcer.enforceAll(command, context);

    if (!result.allowed) {
      console.error(`${RED}🔒 SECURITY CHECK: Comando rejeitado${RESET}`);
      console.error(`   Comando: ${command}`);
      if (result.checks) {
        result.checks.forEach(function(check) {
          if (!check.allowed) {
            console.error(`   ${RED}[${check.check.toUpperCase()}]${RESET} ${check.reason}`);
          }
        });
      }
    }

    return result;
  } catch (err) {
    console.warn(`${YELLOW}⚠️  Security check falhou (NON-BLOCKING): ${err.message}${RESET}`);
    console.warn('   Permitindo comando sem verificação de segurança');
    return { allowed: true, reason: 'security check unavailable: ' + err.message, checks: [] };
  }
}

/**
 * Executa secrets scan antes de commit.
 * NON-BLOCKING: apenas avisa, nunca bloqueia.
 */
function preCommitSecretsScan(directory) {
  try {
    const result = securityEnforcer.scanForSecrets(directory || process.cwd());
    if (result.error) {
      console.warn(`   ${YELLOW}🔍 Secrets scan: ${result.error}${RESET}`);
    } else if (!result.safe) {
      console.warn(`   ${YELLOW}🔍 Secrets scan: ${result.count} potenciais secrets encontrados${RESET}`);
      console.warn(`   ${YELLOW}   Revise antes do push. NON-BLOCKING.${RESET}`);
      if (result.secrets && result.secrets.length > 0) {
        result.secrets.slice(0, 5).forEach(function(s) {
          console.warn(`   ${YELLOW}   → [${s.pattern}] ${s.file}${RESET}`);
        });
        if (result.secrets.length > 5) {
          console.warn(`   ${YELLOW}   ... e mais ${result.secrets.length - 5} ocorrências${RESET}`);
        }
      }
    } else {
      console.log(`   ${GREEN}🔍 Secrets scan: nenhum secret encontrado${RESET}`);
    }
  } catch (err) {
    console.warn(`   ${YELLOW}🔍 Secrets scan indisponível (NON-BLOCKING): ${err.message}${RESET}`);
  }
}

// =====================================================================
//  RAG Integration
// =====================================================================

function queryRag(question, topK) {
  if (!CONFIG.ragEnabled) {
    console.warn(`${YELLOW}⚠️  RAG desabilitado — retornando resultados vazios${RESET}`);
    return [];
  }

  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    console.warn(`${YELLOW}⚠️  RAG query ignorada — pergunta vazia${RESET}`);
    return [];
  }

  try {
    const rag = require('./rag-query');
    const results = rag.query(question, typeof topK === 'number' ? topK : 3);

    // Token tracking: RAG queries consomem tokens de embedding/busca
    if (AUX && AUX.tokens) {
      try {
        const queryTokens = Math.max(50, Math.ceil(question.length / 3.5));
        AUX.tokens.trackUsageReal('rag-embedding', queryTokens, Math.round(queryTokens * 0.3));
      } catch(tt) { /* NON-BLOCKING */ }
    }

    return results;
  } catch (err) {
    console.warn(`${YELLOW}⚠️  RAG query falhou (NON-BLOCKING): ${err.message}${RESET}`);
    return [];
  }
}

// =====================================================================
//  Context Builder Integration
// =====================================================================

function autoContextBuilder(keywords, options) {
  if (!CONFIG.contextEnabled) {
    console.warn(`${YELLOW}⚠️  Context Builder desabilitado (--context-enabled=false)${RESET}`);
    return null;
  }

  if (!keywords || (Array.isArray(keywords) && keywords.length === 0) || (typeof keywords === 'string' && keywords.trim().length === 0)) {
    console.warn(`${YELLOW}⚠️  autoContextBuilder: keywords vazias, pulando${RESET}`);
    return null;
  }

  if (typeof keywords === 'string') {
    keywords = keywords.split(/[,\s]+/).filter(Boolean);
  }

  options = options || {};
  const rootDir = options.rootDir || process.cwd();

  // ── OTEL: Context Building Span ──────────────────────────────────
  var _otelCtxSpan = null;
  if (AUX.otel && AUX.otel.isEnabled()) {
    _otelCtxSpan = AUX.otel.traceContextBuilding(keywords);
  }

  try {
    let contextBuilder;
    try {
      contextBuilder = require('./context-executor');
    } catch (e) {
      if (_otelCtxSpan) {
        AUX.otel.addEvent('context_building.unavailable', { error: 'context-executor not found' }, _otelCtxSpan);
        AUX.otel.setStatus(_otelCtxSpan, 'error', 'context-executor not available');
        AUX.otel.endSpan(_otelCtxSpan);
      }
      console.warn(`${YELLOW}⚠️  autoContextBuilder: context-executor não disponível (NON-BLOCKING)${RESET}`);
      return null;
    }

    console.log(`${CYAN}${BOLD}🔍 Executando Context Builder automático...${RESET}`);
    console.log(`   Keywords: ${keywords.join(', ')}`);
    console.log(`   Root dir: ${rootDir}`);

    const outputJson = options.jsonOutput === true;
    const execSync = require('child_process').execSync;
    const contextScript = path.join(__dirname, 'context-executor.js');

    let cliArgs = keywords.join(',');
    if (outputJson) cliArgs += ' --json';
    cliArgs += ` --root "${rootDir}"`;

    // Security check antes do context-executor (NON-BLOCKING)
    const secCheckCtx = securityCheck('node context-executor.js', { actionType: 'execute' });
    if (!secCheckCtx.allowed) {
      console.warn(`${YELLOW}🔒 Context-executor bloqueado pelo security enforcer${RESET}`);
      return null;
    }

    const result = execSync(`node "${contextScript}" ${cliArgs}`, {
      encoding: 'utf-8',
      timeout: 30000,
      cwd: __dirname,
      maxBuffer: 10 * 1024 * 1024
    });

    // ── OTEL: Context building concluído ────────────────────────────
    if (_otelCtxSpan) {
      AUX.otel.addEvent('context_building.success', { output_size: result.length }, _otelCtxSpan);
      AUX.otel.setAttribute('context_building.success', true, _otelCtxSpan);
      AUX.otel.setAttribute('context_building.output_size', result.length, _otelCtxSpan);
      AUX.otel.setStatus(_otelCtxSpan, 'ok');
      AUX.otel.endSpan(_otelCtxSpan);
    }

    console.log(`${GREEN}✓${RESET} Context Builder executado com sucesso`);

    // Token tracking: Context Builder processa arquivos e gera contexto
    if (AUX && AUX.tokens) {
      try {
        const cbTokens = Math.max(200, Math.round(result.length * 0.15));
        AUX.tokens.trackUsageReal('context-builder', cbTokens, Math.round(cbTokens * 0.2));
      } catch(tt) { /* NON-BLOCKING */ }
    }

    if (outputJson) {
      try {
        return JSON.parse(result);
      } catch (e) {
        return result;
      }
    }

    return result;
  } catch (err) {
    // ── OTEL: Marca span como erro ──────────────────────────────────
    if (_otelCtxSpan) {
      AUX.otel.addEvent('context_building.error', { 'error.message': err.message, 'error.type': err.name }, _otelCtxSpan);
      AUX.otel.setAttribute('context_building.success', false, _otelCtxSpan);
      AUX.otel.setStatus(_otelCtxSpan, 'error', err.message);
      AUX.otel.endSpan(_otelCtxSpan, err);
    }

    console.warn(`${YELLOW}⚠️  autoContextBuilder falhou (NON-BLOCKING): ${err.message}${RESET}`);
    return null;
  }
}

// =====================================================================
//  Dashboard Notification
// =====================================================================

// NOTA: Dashboard removido no v3.0 — nunca foi utilizado.
// Se precisar de dashboard no futuro, implementar via events.log + metrics.json.

// =====================================================================
//  TRANSITION — Função Principal
// =====================================================================

function transition(targetState, options) {
  options = options || {};
  const actionCallback = options.actionCallback || null;
  // Agente e ferramenta: aceita do options, mas com fallbacks inteligentes
  // para garantir que metrics.json sempre tenha dados significativos.
  let agent = options.agent || null;
  let tool = options.tool || null;

  // Fallback para agent: se não foi passado, tenta detectar do caller
  if (!agent) {
    try {
      // Tenta detectar pelo stack trace — quem chamou transition()
      const stackLines = new Error().stack ? new Error().stack.split('\n') : [];
      for (let si = 0; si < stackLines.length; si++) {
        const sl = stackLines[si];
        if (sl.indexOf('pipeline-executor.js') !== -1) continue;
        if (sl.indexOf('observability.js') !== -1) continue;
        if (sl.indexOf('cli-commands.js') !== -1) { agent = 'pipeline-executor (CLI)'; break; }
        if (sl.indexOf('node:internal') !== -1) continue;
        const callerMatch = sl.match(/([a-zA-Z0-9_-]+)\.js/);
        if (callerMatch && callerMatch[1] !== 'pipeline-executor') {
          agent = callerMatch[1];
          break;
        }
      }
    } catch (_) { /* NON-BLOCKING */ }
  }

  // Fallback para tool: se não foi passado, detecta do argv ou caller
  if (!tool) {
    try {
      // Procura --tool= nos args
      for (let ti = 0; ti < process.argv.length; ti++) {
        if (process.argv[ti].startsWith('--tool=')) {
          tool = process.argv[ti].substring(7);
          break;
        }
      }
      // Se ainda não tem, tenta detectar pelo main module
      if (!tool && require.main && require.main.filename) {
        const mainName = require.main.filename.split(/[\\/]/).pop().replace(/\.\w+$/, '');
        const toolFallbackMap = {
          'pipeline-executor': 'cli',
          'pipeline-start': 'cli',
          'orchestrator': 'pipeline'
        };
        tool = toolFallbackMap[mainName] || 'auto';
      }
      if (!tool) tool = 'auto';
    } catch (_) {
      tool = 'auto';
    }
  }

  const demand = options.demand || null;

  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Matrix Pipeline Executor v2.0 — Transição               ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');

  // ── Debug trace ──────────────────────────────────────────────────
  if (AUX.debug && AUX.debug.isEnabled()) {
    AUX.debug.trace('transition', `Iniciando transição: ${currentState} → ${targetState}`, { agent, tool });
  }

  // ── Timing ────────────────────────────────────────────────────────
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (AUX.debug && AUX.debug.isEnabled()) {
    AUX.debug.trace('timing', 'Início do timing da transição');
  }

  // ── Auth Gate (BLOQUEANTE para providers externos) ────────────────
  console.log(`${BOLD}🔐 Verificando gate de autenticação...${RESET}`);
  const authGateResult = pipelineAuthGate();
  if (authGateResult.blocking) {
    if (_otelTransitionSpan) {
      AUX.otel.addEvent('pipeline.transition.error', { error: 'auth_gate_blocked', reason: authGateResult.error }, _otelTransitionSpan);
      AUX.otel.setAttribute('pipeline.transition.success', false, _otelTransitionSpan);
      AUX.otel.setStatus(_otelTransitionSpan, 'error', 'Auth Gate bloqueou: ' + authGateResult.error);
      AUX.otel.endSpan(_otelTransitionSpan);
    }
    console.error(`${RED}❌ Gate de autenticação BLOQUEANTE — pipeline interrompido${RESET}`);
    console.error(`   Motivo: ${authGateResult.error}${RESET}`);
    console.log('');
    return { success: false, error: `Auth Gate bloqueou pipeline: ${authGateResult.error}` };
  }
  if (authGateResult.active) {
    console.log(`   Gate: ${authGateResult.authenticated ? `${GREEN}✅ autenticado${RESET}` : `${DIM}inativo (RBAC interno)${RESET}`}`);
  } else {
    console.log(`   Gate: ${DIM}inativo (RBAC interno)${RESET}`);
  }
  console.log('');

  // ── Validação de arquivos ─────────────────────────────────────────
  console.log(`${BOLD}🔍 Validando arquivos do pipeline...${RESET}`);
  if (!sm.validateStateFile()) {
    if (_otelTransitionSpan) {
      AUX.otel.addEvent('pipeline.transition.error', { error: 'state.json inválido' }, _otelTransitionSpan);
      AUX.otel.setAttribute('pipeline.transition.success', false, _otelTransitionSpan);
      AUX.otel.setStatus(_otelTransitionSpan, 'error', 'state.json inválido');
      AUX.otel.endSpan(_otelTransitionSpan);
    }
    console.error(`${RED}❌ state.json inválido — não é possível continuar${RESET}`);
    if (AUX.healer) { try { AUX.healer.heal('state_corrupted'); } catch(e) { /* NON-BLOCKING */ } }
    return { success: false, error: 'state.json inválido ou não encontrado' };
  }
  if (!sm.validateYamlFile()) {
    if (_otelTransitionSpan) {
      AUX.otel.addEvent('pipeline.transition.error', { error: 'pipeline.yaml inválido' }, _otelTransitionSpan);
      AUX.otel.setAttribute('pipeline.transition.success', false, _otelTransitionSpan);
      AUX.otel.setStatus(_otelTransitionSpan, 'error', 'pipeline.yaml inválido');
      AUX.otel.endSpan(_otelTransitionSpan);
    }
    console.error(`${RED}❌ pipeline.yaml inválido — não é possível continuar${RESET}`);
    if (AUX.healer) { try { AUX.healer.heal('--all'); } catch(e) { /* NON-BLOCKING */ } }
    return { success: false, error: 'pipeline.yaml inválido ou não encontrado' };
  }
  console.log(`   ${GREEN}✓${RESET} Arquivos do pipeline válidos`);
  if (_otelTransitionSpan) {
    AUX.otel.addEvent('pipeline.transition.files_validated', {}, _otelTransitionSpan);
  }
  if (AUX.debug && AUX.debug.isEnabled()) {
    AUX.debug.trace('validation', 'Arquivos do pipeline validados com sucesso');
  }
  console.log('');

  // ── State Lock ──────────────────────────────────────────────────
  try {
    const stateLock = require('./state-lock');
    if (!stateLock.acquireLock('llm')) {
      const lockOwner = stateLock.getLockOwner();
      if (_otelTransitionSpan) {
        AUX.otel.addEvent('pipeline.transition.error', { error: 'state_lock_held', owner: lockOwner }, _otelTransitionSpan);
        AUX.otel.setAttribute('pipeline.transition.success', false, _otelTransitionSpan);
        AUX.otel.setStatus(_otelTransitionSpan, 'error', 'State lock held by ' + lockOwner);
        AUX.otel.endSpan(_otelTransitionSpan);
      }
      console.error(`${RED}🔒 State lock pertence a "${lockOwner}". Pipeline em execução.${RESET}`);
      return { success: false, error: `State lock held by ${lockOwner}` };
    }
  } catch (err) {
    console.log(`   ${YELLOW}⚠️  State lock falhou (NON-BLOCKING): ${err.message}${RESET}`);
  }

  // ── Step 1: Ler estado atual ─────────────────────────────────────
  console.log(`${BOLD}📖 Lendo state.json...${RESET}`);
  const state = sm.loadState();
  const currentState = state.current_state;
  console.log(`   Estado atual: ${CYAN}${currentState}${RESET}`);
  console.log(`   Target:       ${CYAN}${targetState}${RESET}`);
  if (AUX.debug && AUX.debug.isEnabled()) {
    AUX.debug.trace('state', 'State.json carregado', { currentState, targetState });
  }

  // ── Debug trace inicial ──────────────────────────────────────────
  if (AUX.debug && AUX.debug.isEnabled()) {
    AUX.debug.trace('transition', `Iniciando transição: ${currentState} → ${targetState}`, { agent, tool });
  }

  // ── Idempotency check ────────────────────────────────────────────
  if (currentState === targetState) {
    if (_otelTransitionSpan) {
      AUX.otel.addEvent('pipeline.transition.skipped', { reason: 'idempotent', state: targetState }, _otelTransitionSpan);
      AUX.otel.setAttribute('pipeline.transition.skipped', true, _otelTransitionSpan);
      AUX.otel.setStatus(_otelTransitionSpan, 'ok');
      AUX.otel.endSpan(_otelTransitionSpan);
    }
    console.log(`${YELLOW}⚠️  Estado já é '${targetState}'. Nenhuma transição necessária.${RESET}`);
    console.log('');
    return { success: true, from: currentState, to: targetState, skipped: true };
  }

  // ── Step 2: Validar transição (State Machine Engine — determinística) ─
  if (AUX.smEngine) {
    console.log(`${BOLD}🔍 Validando transição via State Machine Engine (determinística)...${RESET}`);
    try {
      const contextAttempts = (state.attempts ? state.attempts.fase3_validation || state.attempts.fase4_review || 0 : 0);
      const engineResult = AUX.smEngine.canTransition(currentState, targetState, {
        attempts: contextAttempts
      });

      if (!engineResult.valid) {
        console.log(`   ${YELLOW}⚠️  State Machine Engine: ${engineResult.reason}${RESET}`);
        console.log(`   ${YELLOW}   NON-BLOCKING — usando validação tradicional como fallback${RESET}`);
        // ENGINE REJECTION IS NON-BLOCKING: falls through to traditional validation
      }

      console.log(`   ${GREEN}✓${RESET} Engine: ${engineResult.reason}`);
      if (engineResult.transition) {
        console.log(`   Gatilho: ${engineResult.transition.trigger || '(não definido)'}`);
      }
    } catch (engErr) {
      console.log(`   ${YELLOW}⚠️  State Machine Engine validation falhou (NON-BLOCKING): ${engErr.message}${RESET}`);
      console.log(`   ${YELLOW}   Usando validação tradicional como fallback${RESET}`);
    }
    console.log('');
  } else {
    console.log(`${DIM}🔍 State Machine Engine não disponível — usando validação tradicional${RESET}`);
    console.log('');
  }

  // ── Step 2b: Validar transição (tradicional) ─────────────────────
  console.log(`${BOLD}📖 Validando transição em pipeline.yaml...${RESET}`);
  const pipeline = sm.loadPipeline();

  const currentStateDef = pipeline.states.find(s => s.id === currentState);
  if (!currentStateDef) {
    console.error(`${RED}❌ Estado atual '${currentState}' não encontrado em pipeline.yaml${RESET}`);
    return { success: false, error: `Estado atual '${currentState}' não definido em pipeline.yaml` };
  }

  const targetStateDef = pipeline.states.find(s => s.id === targetState);
  if (!targetStateDef) {
    console.error(`${RED}❌ Estado target '${targetState}' não encontrado em pipeline.yaml${RESET}`);
    return { success: false, error: `Estado target '${targetState}' não definido em pipeline.yaml` };
  }

  if (!sm.isTransitionValid(currentState, targetState, pipeline.transitions)) {
    const validTargets = sm.findValidTransitions(currentState, pipeline.transitions).map(t => t.to);
    console.error(`${RED}❌ Transição inválida: ${currentState} → ${targetState}${RESET}`);
    console.log(`   Transições válidas de '${currentState}':`);
    if (validTargets.length === 0) {
      console.log(`   ${YELLOW}(nenhuma — estado terminal)${RESET}`);
    } else {
      validTargets.forEach(t => {
        console.log(`   → ${GREEN}${t}${RESET}`);
      });
    }
    console.log('');
    return { success: false, error: `Transição inválida: ${currentState} → ${targetState}` };
  }

  const trans = sm.findTransition(currentState, targetState, pipeline.transitions);
  console.log(`   ${GREEN}✓${RESET} Transição válida: ${currentState} → ${targetState}`);
  if (trans && trans.trigger) {
    console.log(`   Gatilho: ${trans.trigger}`);
  }
  // ── OTEL: Transição validada + atualiza trigger ──────────────────
  if (_otelTransitionSpan) {
    AUX.otel.addEvent('pipeline.transition.validated', {
      from: currentState,
      to: targetState,
      trigger: (trans && trans.trigger) || ''
    }, _otelTransitionSpan);
    if (trans && trans.trigger) {
      AUX.otel.setAttribute('pipeline.trigger', trans.trigger, _otelTransitionSpan);
    }
  }
  if (AUX.debug && AUX.debug.isEnabled()) {
    AUX.debug.trace('validation', 'Transição validada em pipeline.yaml', {
      from: currentState,
      to: targetState,
      trigger: trans ? trans.trigger : null
    });
  }
  console.log('');

  // ── Pre-Transition Checkpoint (recovery) ──────────────────────────
  // Salva checkpoint ANTES de alterar o estado, para recovery em caso
  // de interrupção durante a transição.
  console.log(`${BOLD}💾 Salvando pre-transition checkpoint (recovery)...${RESET}`);
  try {
    var preCheckpointMemory = require('./memory-adapter');
    var preCheckpointSnapshot = {
      from: currentState,
      to: targetState,
      timestamp: new Date().toISOString(),
      fase: getFaseFromState(targetState),
      agent: agent,
      demand: demand || (state.metadata ? state.metadata.last_demand : null),
      sessionId: null,
      checkpointType: 'pre-transition',
      attempts: state.attempts || {},
      metadata: state.metadata || {}
    };
    // Tenta associar sessão ativa, se disponível
    if (AUX.sessions && typeof AUX.sessions.getActiveDemand === 'function') {
      try {
        var activeSess = AUX.sessions.getActiveDemand();
        if (activeSess) {
          preCheckpointSnapshot.sessionId = activeSess.id;
        }
      } catch (sessErr) { /* NON-BLOCKING */ }
    }
    preCheckpointMemory.checkpoint('pre-' + targetState, preCheckpointSnapshot);
    // Também salva no contexto de "último checkpoint antes da transição"
    preCheckpointMemory.write('contexto', 'pre_transition_checkpoint', preCheckpointSnapshot);
    console.log(`   ${GREEN}✓${RESET} Pre-transition checkpoint salvo: pre-${targetState}`);
  } catch (ckErr) {
    console.log(`   ${YELLOW}⚠️  Pre-transition checkpoint falhou (NON-BLOCKING): ${ckErr.message}${RESET}`);
  }
  console.log('');

  // ── Rollback automático (seletivo: apenas estados que alteram código) ──
  if (CONFIG.rollbackEnabled) {
    const codeChangingStates = ['fase2_execution', 'delivery', 'fase4_changes_needed'];
    if (codeChangingStates.includes(targetState)) {
      try {
        // Sincroniza dados do tenant para o diretório global antes do rollback
        // para que o rollback-manager (com caminhos hardcoded) capture os dados corretos
        try {
          if (AUX.tenant && activeTenant && typeof AUX.tenant.syncTenantDataToGlobal === 'function') {
            AUX.tenant.syncTenantDataToGlobal(activeTenant);
          }
        } catch (syncErr) { /* NON-BLOCKING */ }

        const rollback = AUX.rollback || require('./rollback-manager');
        const snapshotLabel = 'auto-' + currentState + '-to-' + targetState + '-' + Date.now();
        var snapResult = rollback.createSnapshot(snapshotLabel);
        console.log('   ' + GREEN + '✓' + RESET + ' Rollback snapshot: ' + snapshotLabel);

        // Copia snapshot recém-criado para o diretório isolado do tenant
        try {
          if (snapResult && snapResult.dir && AUX.tenant && activeTenant && typeof AUX.tenant.getTenantSnapshotsDir === 'function') {
            var tenantSnapDir = AUX.tenant.getTenantSnapshotsDir(activeTenant);
            if (tenantSnapDir) {
              if (!fs.existsSync(tenantSnapDir)) {
                fs.mkdirSync(tenantSnapDir, { recursive: true });
              }
              var destSnapshotDir = path.join(tenantSnapDir, snapResult.id);
              if (!fs.existsSync(destSnapshotDir)) {
                copyDirectorySync(snapResult.dir, destSnapshotDir);
                // Atualiza index.json do tenant
                var tenantIndexPath = path.join(tenantSnapDir, 'index.json');
                var tenantIndex = [];
                try {
                  if (fs.existsSync(tenantIndexPath)) {
                    tenantIndex = JSON.parse(fs.readFileSync(tenantIndexPath, 'utf8'));
                  }
                } catch (e) { /* NON-BLOCKING */ }
                tenantIndex.push({
                  id: snapResult.id,
                  label: snapResult.label,
                  timestamp: snapResult.timestamp || new Date().toISOString(),
                  branch: snapResult.branch || '',
                  commit: snapResult.commit || '',
                  status: 'active'
                });
                if (tenantIndex.length > 50) tenantIndex = tenantIndex.slice(-50);
                fs.writeFileSync(tenantIndexPath, JSON.stringify(tenantIndex, null, 2), 'utf8');
                console.log('   ' + GREEN + '✓' + RESET + ' Snapshot copiado para tenant: ' + snapResult.id);
              }
            }
          }
        } catch (snapCopyErr) {
          console.log('   ' + YELLOW + '⚠️  Cópia de snapshot para tenant falhou (NON-BLOCKING): ' + snapCopyErr.message + RESET);
        }

        // Persiste o snapshot ID no state.json para recovery
        try {
          const state = sm.loadState();
          if (state) {
            state.last_snapshot = snapshotLabel;
            state.last_snapshot_time = new Date().toISOString();
            sm.saveState(state);
          }
        } catch (e) { /* NON-BLOCKING */ }
      } catch (err) {
        console.log('   ' + YELLOW + '⚠️  Rollback snapshot falhou (NON-BLOCKING): ' + err.message + RESET);
        // NON-BLOCKING: rollback não deve impedir transição
      }
    } else {
      console.log('   ' + DIM + 'ℹ️  Rollback snapshot pulado — transição "' + targetState + '" não altera código' + RESET);
    }
  } else {
    console.log('   ' + YELLOW + '⚠️  Rollback desabilitado (--rollback-enabled=false) — snapshots NÃO serão criados' + RESET);
  }

  // ── Step 3: Plugin hooks — beforeTransition ──────────────────────
  console.log(`${BOLD}🔌 Plugin hooks: beforeTransition...${RESET}`);
  if (AUX.plugins && typeof AUX.plugins.callHook === 'function') {
    try {
      const beforeResults = AUX.plugins.callHook('beforeTransition', { from: currentState, to: targetState, agent, tool });
      console.log(`   ${GREEN}✓${RESET} beforeTransition hooks executados (${beforeResults.length} plugins)`);
    } catch (err) {
      console.log(`   ${YELLOW}⚠️  beforeTransition hook falhou (NON-BLOCKING): ${err.message}${RESET}`);
    }
  } else {
    console.log(`   ${YELLOW}⚠️  Plugin system não disponível (NON-BLOCKING)${RESET}`);
  }
  console.log('');

  // ── Step 4: Executar action callback ─────────────────────────────
  if (typeof actionCallback === 'function') {
    console.log(`${BOLD}⚡ Executando action callback...${RESET}`);
    try {
      actionCallback(state, trans);
      console.log(`   ${GREEN}✓${RESET} Action callback executado`);
    } catch (err) {
      if (_otelTransitionSpan) {
        AUX.otel.addEvent('pipeline.transition.error', { error: 'action_callback_failed', message: err.message }, _otelTransitionSpan);
        AUX.otel.setAttribute('pipeline.transition.success', false, _otelTransitionSpan);
        AUX.otel.setStatus(_otelTransitionSpan, 'error', 'Action callback: ' + err.message);
        AUX.otel.endSpan(_otelTransitionSpan);
      }
      console.error(`${RED}❌ Action callback falhou: ${err.message}${RESET}`);
      return { success: false, error: `Action callback failed: ${err.message}` };
    }
    console.log('');
  }

  // ── Step 4: Atualizar state.json ────────────────────────────────
  console.log(`${BOLD}💾 Atualizando state.json...${RESET}`);
  if (AUX.debug && AUX.debug.isEnabled()) {
    AUX.debug.trace('state', `Atualizando state.json: ${currentState} → ${targetState}`);
  }
  const updatedState = sm.updateState(currentState, targetState);
  console.log(`   ${GREEN}✓${RESET} ${currentState} → ${targetState}`);
  // ── OTEL: State atualizado ────────────────────────────────────────
  if (_otelTransitionSpan) {
    AUX.otel.addEvent('pipeline.transition.state_updated', {
      from: currentState,
      to: targetState
    }, _otelTransitionSpan);
    AUX.otel.setAttribute('pipeline.transition.success', true, _otelTransitionSpan);
  }
  if (AUX.debug && AUX.debug.isEnabled()) {
    AUX.debug.trace('state', 'State.json atualizado', { from: currentState, to: targetState });
  }
  console.log('');

  // ── Step 4.5: Parallel execution para tasks independentes (NON-BLOCKING) ──
  if (CONFIG.parallelEnabled && targetState === 'fase2_execution' && AUX.parallel) {
    console.log(`${BOLD}⚡ Parallel execution: detectando tasks independentes...${RESET}`);
    try {
      // Usa todolist.json isolado do tenant ativo
      var todolistPath = path.join(BASE_DIR, 'todolist.json');
      try {
        if (AUX.tenant && activeTenant && typeof AUX.tenant.getTenantTodolistPath === 'function') {
          var tenantTodoPath = AUX.tenant.getTenantTodolistPath(activeTenant);
          if (tenantTodoPath && fs.existsSync(tenantTodoPath)) {
            todolistPath = tenantTodoPath;
          }
        }
      } catch (e) { /* NON-BLOCKING — fallback para global */ }
      if (fs.existsSync(todolistPath)) {
        const todolist = JSON.parse(fs.readFileSync(todolistPath, 'utf8'));
        var parallelTasks = [];
        if (todolist.fases) {
          for (var f = 0; f < todolist.fases.length; f++) {
            var curFase = todolist.fases[f];
            if (curFase.tasks && curFase.especialista) {
              for (var t = 0; t < curFase.tasks.length; t++) {
                var task = curFase.tasks[t];
                if (task.independent !== false) {
                  parallelTasks.push(task);
                }
              }
            }
          }
        }
        if (parallelTasks.length > 1) {
          console.log(`   ⚡ ${parallelTasks.length} tasks independentes detectadas — executando em paralelo`);
          AUX.parallel.executeParallel(parallelTasks, { maxWorkers: 4 });
        } else {
          console.log(`   ${DIM}ℹ️  Menos de 2 tasks independentes — execução sequencial padrão${RESET}`);
        }
      } else {
        console.log(`   ${DIM}ℹ️  todolist.json não encontrado — pulando paralelismo${RESET}`);
      }
    } catch(e) {
      console.log(`   ${YELLOW}⚠️  Parallel execution check falhou (NON-BLOCKING): ${e.message}${RESET}`);
    }
    console.log('');
  }

  // ── Step 4.6: Context Builder automático ─────────────────────────
  // Chama autoContextBuilder na transição para context_building,
  // usando keywords extraídas da demanda atual.
  if (targetState === 'context_building' && CONFIG.contextEnabled) {
    console.log(`${BOLD}🔍 Context Builder: preparando contexto...${RESET}`);
    const demandKeywords = (state && state.metadata && state.metadata.last_demand)
      ? state.metadata.last_demand.split(/[,\s]+/).filter(Boolean)
      : [];
    if (demandKeywords.length > 0) {
      const cbResult = autoContextBuilder(demandKeywords, {
        rootDir: BASE_DIR,
        jsonOutput: false
      });
      if (cbResult) {
        console.log(`   ${GREEN}✓${RESET} Context Builder concluído (${demandKeywords.length} keywords)`);
      }
    } else {
      console.log(`   ${YELLOW}⚠️  Sem keywords disponíveis — pulando Context Builder${RESET}`);
    }
    console.log('');
  }

  // ── Step 4.7: Auto-commit ────────────────────────────────────────
  if (CONFIG.autoCommit && (targetState === 'delivery' || targetState === 'fase3_refuted' || targetState === 'fase4_changes_needed')) {
    console.log(`${BOLD}📤 Auto-commit habilitado — executando git commit...${RESET}`);
    autoCommit(null, currentState, targetState);
    console.log('');

    if (CONFIG.prEnabled && targetState === 'delivery' && AUX.pr) {
      console.log(`${BOLD}🔄 Criando Pull Request no GitHub...${RESET}`);
      try {
        const prMetadata = {
          agent: agent || 'pipeline-executor',
          tool: tool || 'auto',
          trigger: 'delivery-transition',
          timestamp: new Date().toISOString()
        };
        const prResult = AUX.pr.createPR(updatedState, prMetadata);
        if (prResult && prResult.url) {
          console.log(`   ${GREEN}✓${RESET} PR #${prResult.number} criado: ${prResult.url}`);
        }
      } catch (err) {
        console.log(`   ${YELLOW}⚠️  PR creation falhou (NON-BLOCKING): ${err.message}${RESET}`);
      }
      console.log('');
    }
  }

  // ── Step 5: Memory checkpoint ────────────────────────────────────
  console.log(`${BOLD}🧠 Memory checkpoint...${RESET}`);
  if (AUX.debug && AUX.debug.isEnabled()) {
    AUX.debug.trace('memory', 'Iniciando memory checkpoint', { fase: getFaseFromState(targetState) });
  }

  const fase = getFaseFromState(targetState);

  const memSnapshot = {
    from: currentState,
    to: targetState,
    timestamp: new Date().toISOString(),
    fase: fase,
    agent: agent,
    demand: demand || (state.metadata ? state.metadata.last_demand : null),
    attempts: updatedState.attempts || {},
    metadata: updatedState.metadata || {}
  };
  const memOk = mem.memoryCheckpoint(targetState, memSnapshot);

  // ── Popula memória ───────────────────────────────────────────────
  try {
    const memory = require('./memory-adapter');
    memory.write('contexto', 'last_state', targetState);
    memory.write('contexto', 'last_from_state', currentState);
    memory.write('contexto', 'last_agent', agent || 'pipeline');
    memory.write('contexto', 'last_tool', tool || 'auto');
    memory.write('contexto', 'fase', fase);
    if (demand) memory.write('contexto', 'last_demand', demand);
    memory.push('historico', 'execucoes', {
      from: currentState,
      to: targetState,
      timestamp: new Date().toISOString(),
      agent,
      tool,
      durationMs,
      fase
    });
    if (targetState === 'completed') {
      if (state && state.metadata && state.metadata.last_demand) {
        memory.push('historico', 'demandas', {
          demanda: state.metadata.last_demand,
          status: 'completed',
          timestamp: new Date().toISOString(),
          durationMs,
          attempts: updatedState.attempts || {}
        });
      }
    }
  } catch (err) { /* NON-BLOCKING */ }

  if (memOk) {
    console.log(`   ${GREEN}✓${RESET} Checkpoint salvo e memória populada`);
  } else {
    console.log(`   ${YELLOW}⚠️  Checkpoint não salvo (NON-BLOCKING)${RESET}`);
  }
  console.log('');

  // ── Timing ───────────────────────────────────────────────────────
  const durationMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime);

  // ── Step 6: events.log ───────────────────────────────────────────
  console.log(`${BOLD}📊 Registrando evento em events.log...${RESET}`);
  if (obs.isObservabilityEnabled()) {
    let retryCount = 0;
    if (updatedState.attempts) {
      if (targetState === 'fase3_refuted') retryCount = updatedState.attempts.fase3_validation || 0;
      if (targetState === 'fase4_changes_needed') retryCount = updatedState.attempts.fase4_review || 0;
    }
    const event = {
      timestamp: new Date().toISOString(),
      event_type: 'transition',
      state: { from: currentState, to: targetState },
      agent: agent,
      tool: tool,
      duration_ms: durationMs,
      retry_count: retryCount,
      success: true
    };
    obs.appendEvent(event);
    console.log(`   ${GREEN}✓${RESET} Evento registrado em events.log`);
  } else {
    console.log(`   ${YELLOW}⚠️  Observabilidade desligada${RESET}`);
  }
  console.log('');

  // ── Step 7: metrics.json ─────────────────────────────────────────
  console.log(`${BOLD}📈 Atualizando metrics.json...${RESET}`);
  if (obs.isObservabilityEnabled()) {
    const metrics = obs.updateMetrics(currentState, targetState, { agent, tool, durationMs });
    if (metrics) {
      console.log(`   ${GREEN}✓${RESET} Métricas atualizadas`);
      console.log(`   Events count: ${metrics.events_count}`);
    } else {
      console.log(`   ${YELLOW}⚠️  Métricas não atualizadas (NON-BLOCKING)${RESET}`);
    }
  } else {
    console.log(`   ${YELLOW}⚠️  Observabilidade desligada${RESET}`);
  }
  console.log('');

  // ── Step 9: Summary ──────────────────────────────────────────────
  console.log(`${GREEN}${BOLD}✅ Transição concluída: ${currentState} → ${targetState}${RESET}`);
  console.log(`   Timestamp: ${new Date().toISOString()}`);
  if (agent) console.log(`   Agent: ${agent}`);
  if (tool) console.log(`   Tool: ${tool}`);
  if (durationMs) console.log(`   ⏱️  Duração: ${durationMs}ms`);
  console.log('');

  return { success: true, from: currentState, to: targetState, state: updatedState };
}

// =====================================================================
//  Injetar dependências no módulo de CLI commands
// =====================================================================
cmds.setDependencies({
  transition,
  AUX,
  CONFIG,
  getModuleStatus,
  getFaseFromState,
  securityCheck,
  preCommitSecretsScan,
  autoContextBuilder,
  selectModel,
  getTools,
  getToolInfo,
  selectAgent,
  getAgentInfo,
  autoCommit,
  memoryCheckpoint: mem.memoryCheckpoint,
  memoryWrite: mem.memoryWrite,
  memoryPush: mem.memoryPush
});

// =====================================================================
//  Tenant Directory Ensurer
// =====================================================================

// NOTA: Tenants removidos no v3.0 — sem multi-tenancy.
// ensureTenantDir e copyDirectorySync simplificados como no-ops.
function ensureTenantDir() { return null; }
function copyDirectorySync(src, dst) { /* no-op */ }

// =====================================================================
//  CLI Dispatcher
// =====================================================================

function parseCliFlags() {
  const args = process.argv.slice(2);
  const nonFlagArgs = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      let flagName, flagValue;

      if (eqIdx > -1) {
        flagName = arg.substring(2, eqIdx);
        flagValue = arg.substring(eqIdx + 1);
      } else {
        flagName = arg.substring(2);
        flagValue = 'true';
      }

      switch (flagName) {
        case 'sandbox-enabled':
          CONFIG.sandboxEnabled = flagValue === 'true' || flagValue === '1';
          break;
        case 'rag-enabled':
          CONFIG.ragEnabled = flagValue === 'true' || flagValue === '1';
          break;
        case 'context-enabled':
          CONFIG.contextEnabled = flagValue === 'true' || flagValue === '1';
          break;
        case 'model-routing-enabled':
          CONFIG.modelRoutingEnabled = flagValue === 'true' || flagValue === '1';
          break;
        case 'auto-commit':
          CONFIG.autoCommit = flagValue === 'true' || flagValue === '1';
          break;
        case 'rollback-enabled':
          CONFIG.rollbackEnabled = flagValue === 'true' || flagValue === '1';
          break;
        case 'pr-enabled':
          CONFIG.prEnabled = flagValue === 'true' || flagValue === '1';
          break;
        case 'siem-enabled':
          CONFIG.siemEnabled = flagValue === 'true' || flagValue === '1';
          break;
        case 'agent':
          // --agent é tratado pelo cmdTransition para propagar nome real do agente
          // Não é flag de configuração, passa como arg não-flag
          nonFlagArgs.push(arg);
          break;
        case 'tool':
          // --tool é tratado pelo cmdTransition para propagar ferramenta real
          nonFlagArgs.push(arg);
          break;
        case 'force-new-session':
          CONFIG.forceNewSession = true;
          break;
        case 'help':
        case 'h':
          nonFlagArgs.push('--help');
          break;
        default:
          nonFlagArgs.push(arg);
      }
    } else {
      nonFlagArgs.push(arg);
    }
  }

  return nonFlagArgs;
}

if (require.main === module) {
  const nonFlagArgs = parseCliFlags();
  const cmd = nonFlagArgs[0];
  const arg = nonFlagArgs.slice(1).join(' ');

  switch (cmd) {
    case '--help':
    case '-h':
      cmds.printHelp();
      break;
    case 'status':
      cmds.cmdStatus();
      break;
    case 'transition':
      cmds.cmdTransition(nonFlagArgs[1]);
      break;
    case 'history':
      cmds.cmdHistory();
      break;
    case 'check':
      cmds.cmdSystemCheck();
      break;
    case 'validate':
      cmds.cmdValidate();
      break;
    case 'validate-command':
      cmds.cmdValidateCommand(arg);
      break;
    case 'query-rag':
      cmds.cmdQueryRag(arg);
      break;
    case 'rag-query':
      cmds.cmdQueryRag(arg);
      break;
    case 'modules':
      cmds.cmdModules();
      break;
    case 'setup-pg-memory':
      cmds.cmdSetupPgMemory();
      break;
    case 'select-model':
      cmds.cmdSelectModel(nonFlagArgs[1], nonFlagArgs[2]);
      break;
    case 'tools':
      cmds.cmdGetTools(nonFlagArgs[1], nonFlagArgs[2]);
      break;
    case 'route-task':
      cmds.cmdRouteTask(nonFlagArgs.slice(1).join(' '));
      break;
    case 'tool-info':
      cmds.cmdToolInfo(nonFlagArgs[1]);
      break;
    case 'run-rag-index':
      cmds.cmdRunRagIndex(nonFlagArgs[1] || BASE_DIR);
      break;
    case 'setup-rag':
      cmds.cmdSetupRag();
      break;
    case 'select-agent':
      cmds.cmdSelectAgent(nonFlagArgs[1], nonFlagArgs[2], nonFlagArgs[3]);
      break;
    case 'agent-info':
      cmds.cmdAgentInfo(nonFlagArgs[1]);
      break;
    case 'agent-list':
      cmds.cmdAgentList(nonFlagArgs[1]);
      break;
    case 'rollback':
      cmds.cmdRollback(nonFlagArgs.slice(1));
      break;
    default:
      cmds.printHelp();
      process.exit(1);
  }
}

// =====================================================================
//  Programmatic API — v3.0 simplificado
// =====================================================================

module.exports = {
  transition,
  pipelineAuthGate,
  CONFIG,
  initAuxModules,
  getModuleStatus,
  getFaseFromState,
  autoCommit,
  selectModel,
  selectAgent,
  getTools,
  getToolInfo,
  routeTask,
  securityCheck,
  preCommitSecretsScan,
  autoContextBuilder,
};
