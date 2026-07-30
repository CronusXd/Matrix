#!/usr/bin/env node
/**
 * Matrix CLI Commands Module v1.0
 * Todos os comandos de linha de comando do pipeline executor.
 *
 * Para evitar dependência circular com pipeline-executor.js, o módulo
 * exporta funções factory que recebem as dependências necessárias.
 *
 * Uso: (indireto — via pipeline-executor.js)
 *   const cmds = require('./cli-commands');
 *   cmds.cmdStatus();
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const sm = require('./state-machine');
const obs = require('./observability');

// ─── Cores para Terminal ──────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

// ─── Referências para dependências do executor (setadas externamente) ──
let _transition = null;
let _AUX = null;
let _CONFIG = null;
let _getModuleStatus = null;
let _getFaseFromState = null;
let _validateWithSandbox = null;
let _securityCheck = null;
let _preCommitSecretsScan = null;
let _queryRag = null;
let _autoContextBuilder = null;
let _selectModel = null;
let _selectModelWithVoting = null;
let _getTools = null;
let _routeTask = null;
let _getToolInfo = null;
let _selectAgent = null;
let _getAgentInfo = null;
let _findAgentByKeywords = null;
let _createSession = null;
let _listSessions = null;
let _executeTasksInParallel = null;
let _autoCommit = null;
let _memoryCheckpoint = null;
let _memoryWrite = null;
let _memoryPush = null;
let _notifyDashboard = null;
let _setupRag = null;
let _cmdSetupPgMemory = null;

/**
 * Configura as referências para dependências do pipeline-executor.js.
 * Chamado pelo executor após carregar todos os módulos.
 *
 * @param {Object} deps
 */
function setDependencies(deps) {
  _transition = deps.transition;
  _AUX = deps.AUX;
  _CONFIG = deps.CONFIG;
  _getModuleStatus = deps.getModuleStatus;
  _getFaseFromState = deps.getFaseFromState;
  _validateWithSandbox = deps.validateWithSandbox;
  _securityCheck = deps.securityCheck;
  _preCommitSecretsScan = deps.preCommitSecretsScan;
  _queryRag = deps.queryRag;
  _autoContextBuilder = deps.autoContextBuilder;
  _selectModel = deps.selectModel;
  _selectModelWithVoting = deps.selectModelWithVoting;
  _getTools = deps.getTools;
  _routeTask = deps.routeTask;
  _getToolInfo = deps.getToolInfo;
  _selectAgent = deps.selectAgent;
  _getAgentInfo = deps.getAgentInfo;
  _findAgentByKeywords = deps.findAgentByKeywords;
  _createSession = deps.createSession;
  _listSessions = deps.listSessions;
  _executeTasksInParallel = deps.executeTasksInParallel;
  _autoCommit = deps.autoCommit;
  _memoryCheckpoint = deps.memoryCheckpoint;
  _memoryWrite = deps.memoryWrite;
  _memoryPush = deps.memoryPush;
  _notifyDashboard = deps.notifyDashboard;
  _setupRag = deps.setupRag;
  _cmdSetupPgMemory = deps.cmdSetupPgMemory;
}

// =====================================================================
//  CLI: status
// =====================================================================

/**
 * Mostra estado atual formatado.
 */
function cmdStatus() {
  const state = sm.loadState();
  const pipeline = sm.loadPipeline();

  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Matrix Pipeline — Status                               ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');

  console.log(`${BOLD}📌 Estado atual:${RESET} ${GREEN}${state.current_state}${RESET}`);
  console.log(`${BOLD}📌 Estado anterior:${RESET} ${state.previous_state || '(nenhum)'}`);
  console.log(`${BOLD}📌 Última transição:${RESET} ${state.last_transition || '(nenhuma)'}`);
  console.log(`${BOLD}📌 Última atualização:${RESET} ${state.last_updated || '(nenhuma)'}`);

  const stateDef = pipeline.states.find(s => s.id === state.current_state);
  if (stateDef) {
    console.log(`${BOLD}📌 Descrição:${RESET} ${stateDef.description || '(sem descrição)'}`);
  }

  // Transições válidas
  const validTransitions = sm.findValidTransitions(state.current_state, pipeline.transitions);
  console.log('');
  console.log(`${BOLD}➡️  Transições válidas:${RESET}`);
  if (validTransitions.length === 0) {
    console.log(`   ${YELLOW}(estado terminal)${RESET}`);
  } else {
    validTransitions.forEach(t => {
      const triggerInfo = t.trigger ? ` (${t.trigger})` : '';
      console.log(`   → ${GREEN}${t.to}${RESET}${triggerInfo}`);
    });
  }

  // Histórico
  console.log('');
  console.log(`${BOLD}📋 Histórico:${RESET} ${state.history.length} transições registradas`);

  // Attempts
  if (state.attempts) {
    const activeAttempts = Object.keys(state.attempts).filter(k => state.attempts[k] > 0);
    if (activeAttempts.length > 0) {
      console.log('');
      console.log(`${BOLD}🔄 Tentativas:${RESET}`);
      activeAttempts.forEach(key => {
        console.log(`   ${key}: ${state.attempts[key]}`);
      });
    }
  }

  // Metadata
  if (state.metadata) {
    console.log('');
    console.log(`${BOLD}📦 Metadata:${RESET}`);
    if (state.metadata.last_demand) console.log(`   Última demanda: ${state.metadata.last_demand}`);
    if (state.metadata.last_especialista) console.log(`   Último especialista: ${state.metadata.last_especialista}`);
  }

  console.log('');
  console.log(`${CYAN}Pipeline version: ${state.pipeline_version || '1.0'}${RESET}`);
  console.log('');
}

// =====================================================================
//  CLI: transition
// =====================================================================

/**
 * Executa uma transição de estado.
 * @param {string} targetState
 */
function cmdTransition(targetState) {
  if (!targetState) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js transition <novo_estado> [--agent=@nome] [--tool=nome]${RESET}`);
    console.log('   Ex: node pipeline-executor.js transition fase2_complete --agent=@senior-developer --tool=code');
    process.exit(1);
  }

  // Parse --agent e --tool dos argumentos CLI (para propagar agente real)
  let agent = null;
  let tool = null;
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--agent=')) {
      agent = arg.substring(8);
    } else if (arg.startsWith('--tool=')) {
      tool = arg.substring(7);
    }
  }
  // Se não especificado, usa defaults descritivos
  if (!agent) agent = 'pipeline-executor (CLI)';
  if (!tool) tool = 'cli';

  // Estados válidos para autocomplete na mensagem de erro
  const pipeline = sm.loadPipeline();
  const validIds = pipeline.states.map(s => s.id);
  if (!validIds.includes(targetState)) {
    console.error(`${RED}❌ Estado '${targetState}' não encontrado em pipeline.yaml${RESET}`);
    console.log(`   Estados válidos: [${validIds.join(', ')}]`);
    process.exit(1);
  }

  const result = _transition(targetState, {
    agent: agent,
    tool: tool
  });

  if (!result.success) {
    process.exit(1);
  }
}

// =====================================================================
//  CLI: history
// =====================================================================

/**
 * Mostra histórico de transições.
 */
function cmdHistory() {
  const state = sm.loadState();

  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Matrix Pipeline — Histórico de Transições               ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');

  if (!state.history || state.history.length === 0) {
    console.log(`   ${YELLOW}Nenhuma transição registrada.${RESET}`);
    console.log('');
    return;
  }

  for (let i = 0; i < state.history.length; i++) {
    const h = state.history[i];
    const isCurrent = (h.to === state.current_state);
    const marker = isCurrent ? `${GREEN} ◄${RESET}` : '  ';
    const num = (i + 1).toString().padStart(2, ' ');
    console.log(` ${num}.${marker} ${h.from} ${CYAN}→${RESET} ${BOLD}${h.to}${RESET}  ${YELLOW}(${h.timestamp})${RESET}`);
  }

  console.log('');
  console.log(`${BOLD}Total:${RESET} ${state.history.length} transições`);
  console.log(`${BOLD}Estado atual:${RESET} ${GREEN}${state.current_state}${RESET}`);
  console.log('');
}

// =====================================================================
//  CLI: check — System Health Check
// =====================================================================

/**
 * Verifica integridade de todos os componentes do pipeline.
 */
function cmdSystemCheck() {
  const EVENTS_LOG = sm.getEventsLogPath();
  const METRICS_JSON = sm.getMetricsPath();

  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Matrix Pipeline — System Health Check                   ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');

  let allOk = true;
  const checks = [];

  // 1. state.json
  try {
    const s = sm.loadJSON(sm.getStatePath(), 'state.json');
    checks.push({ name: 'state.json', status: s && s.current_state ? 'OK' : 'INVALIDO', state: s ? s.current_state : '—' });
    if (!s || !s.current_state) allOk = false;
  } catch (e) {
    checks.push({ name: 'state.json', status: 'AUSENTE', error: e.message });
    allOk = false;
  }

  // 2. pipeline.yaml
  try {
    const p = sm.loadPipeline();
    checks.push({ name: 'pipeline.yaml', status: 'OK', details: `${p.states.length} estados, ${p.transitions.length} transicoes` });
  } catch (e) {
    checks.push({ name: 'pipeline.yaml', status: 'INVALIDO', error: e.message });
    allOk = false;
  }

  // 3. events.log
  try {
    if (fs.existsSync(EVENTS_LOG)) {
      const raw = fs.readFileSync(EVENTS_LOG, 'utf8');
      const lines = raw.trim().split('\n').filter(Boolean);
      checks.push({ name: 'events.log', status: 'OK', details: `${lines.length} eventos` });
    } else {
      checks.push({ name: 'events.log', status: 'AUSENTE' });
    }
  } catch (e) {
    checks.push({ name: 'events.log', status: 'ERRO', error: e.message });
  }

  // 4. metrics.json
  try {
    const m = sm.loadJSON(METRICS_JSON, 'metrics.json');
    checks.push({ name: 'metrics.json', status: 'OK', details: `${m.events_count} eventos registrados` });
  } catch (e) {
    checks.push({ name: 'metrics.json', status: 'AUSENTE', error: e.message });
    allOk = false;
  }

  // 5. Memory
  try {
    const mem = require('./memory-adapter');
    const ctx = mem.read('contexto', 'ultimo_estado');
    checks.push({ name: 'memory (JSON)', status: ctx ? 'OK' : 'ATIVO', details: ctx ? `ultimo estado: ${ctx}` : 'vazio (normal em primeiro uso)' });
  } catch (e) {
    checks.push({ name: 'memory (JSON)', status: 'ERRO', error: e.message });
  }

  // 6. Sandbox
  try {
    if (fs.existsSync(path.resolve(sm.getBaseDir(), 'sandbox.yaml'))) {
      checks.push({ name: 'sandbox.yaml', status: 'OK' });
    } else {
      checks.push({ name: 'sandbox.yaml', status: 'AUSENTE' });
    }
  } catch (e) {
    checks.push({ name: 'sandbox.yaml', status: 'ERRO', error: e.message });
  }

  // Output
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i];
    const icon = c.status === 'OK' ? `${GREEN}✓` : (c.status === 'ATIVO' ? `${YELLOW}⚠` : `${RED}✗`);
    console.log(` ${icon}${RESET} ${BOLD}${c.name}${RESET}`);
    if (c.details) console.log(`    ${c.details}`);
    if (c.state) console.log(`    Estado: ${c.state}`);
    if (c.error) console.log(`    ${RED}${c.error}${RESET}`);
  }

  console.log('');
  if (allOk) {
    console.log(`${GREEN}${BOLD}✅ System health: OK${RESET}`);
  } else {
    console.log(`${YELLOW}${BOLD}⚠️  System health: ALGUNS COMPONENTES COM PROBLEMAS${RESET}`);
  }
  console.log('');
}

// =====================================================================
//  CLI: validate
// =====================================================================

/**
 * Executa validate-pipeline.js e mostra resultado.
 */
function cmdValidate() {
  const validateScript = path.join(__dirname, 'validate-pipeline.js');

  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Matrix Pipeline — Validação da State Machine            ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');

  try {
    execSync(`node "${validateScript}"`, {
      cwd: path.dirname(validateScript),
      stdio: 'inherit'
    });
  } catch (err) {
    process.exit(err.status || 1);
  }
}

// =====================================================================
//  CLI: validate-command
// =====================================================================

/**
 * Valida comando contra sandbox.yaml.
 * @param {string} command
 */
function cmdValidateCommand(command) {
  if (!command) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js [--sandbox-enabled=true] validate-command "<comando>"${RESET}`);
    console.log('   Ex: node pipeline-executor.js validate-command "rm -rf /"');
    process.exit(1);
  }

  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Sandbox — Validação de Comando                        ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');
  console.log(`${BOLD}🔒 Comando:${RESET} ${command}`);
  console.log(`${BOLD}⚙️  Sandbox:${RESET} ${_CONFIG.sandboxEnabled ? `${GREEN}habilitado${RESET}` : `${YELLOW}desabilitado${RESET}`}`);
  console.log('');

  const result = _validateWithSandbox(command);

  if (result.allowed) {
    console.log(`${GREEN}${BOLD}✅ COMANDO PERMITIDO${RESET}`);
    if (result.reason) {
      console.log(`   Motivo: ${result.reason}`);
    }
    console.log('');
    process.exit(0);
  } else {
    console.error(`${RED}${BOLD}❌ COMANDO BLOQUEADO${RESET}`);
    console.error(`   Motivo: ${result.reason}`);
    console.error('');
    process.exit(1);
  }
}

// =====================================================================
//  CLI: security-check
// =====================================================================

/**
 * Executa verificação de segurança multi-camada em um comando.
 * Integra sandbox + RBAC + file access em uma única validação.
 *
 * @param {string} command - Comando a ser verificado
 *
 * Uso: node pipeline-executor.js security-check "<comando>"
 *      node pipeline-executor.js security-check "<comando>" --userId=<id> --action=<action>
 */
function cmdSecurityCheck(command) {
  if (!command) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js security-check "<comando>" [--userId=<id>] [--action=<action>]${RESET}`);
    console.log('   Ex: node pipeline-executor.js security-check "rm -rf /"');
    console.log('   Ex: node pipeline-executor.js security-check "git push" --userId=joao --action=git_push');
    process.exit(1);
  }

  // Extrai flags do command (que contém tudo após 'security-check')
  let userId = null;
  let actionType = null;
  let actualCommand = command;

  // Parse --userId e --action do final do comando
  const cmdParts = command.split(/\s+/);
  const filteredParts = [];
  for (let i = 0; i < cmdParts.length; i++) {
    const part = cmdParts[i];
    if (part.startsWith('--userId=')) {
      userId = part.split('=')[1];
    } else if (part.startsWith('--action=')) {
      actionType = part.split('=')[1];
    } else if (part.startsWith('--user-id=')) {
      userId = part.split('=')[1];
    } else if (part.startsWith('--action-type=')) {
      actionType = part.split('=')[1];
    } else {
      filteredParts.push(part);
    }
  }
  actualCommand = filteredParts.join(' ');

  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Matrix Security Check — Validação Multi-Camada          ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');
  console.log(`${BOLD}🔒 Comando:${RESET} ${actualCommand}`);
  if (userId) console.log(`${BOLD}👤 Usuário:${RESET} ${userId}`);
  if (actionType) console.log(`${BOLD}🎯 Ação:${RESET} ${actionType}`);
  console.log(`${BOLD}⚙️  Sandbox:${RESET} ${_CONFIG.sandboxEnabled ? `${GREEN}habilitado${RESET}` : `${YELLOW}desabilitado${RESET}`}`);
  console.log('');

  const result = _securityCheck(actualCommand, {
    userId: userId || process.env.Matrix_USER || 'pipeline-default',
    actionType: actionType || 'execute',
    workingDir: process.cwd()
  });

  // Mostra cada verificação
  if (result.checks && result.checks.length > 0) {
    console.log(`${BOLD}   Verificações:${RESET}`);
    result.checks.forEach(function(check) {
      const icon = check.allowed ? `${GREEN}✅` : `${RED}❌`;
      const checkName = (check.check || 'unknown').toUpperCase();
      console.log(`   ${icon}${RESET} [${checkName}] ${check.reason}`);
      if (check.role) console.log(`       Papel: ${check.role}`);
    });
    console.log('');
  }

  if (result.allowed) {
    console.log(`${GREEN}${BOLD}✅ VEREDICTO: COMANDO PERMITIDO${RESET}`);
    if (result.reason) {
      console.log(`   ${result.reason}`);
    }
    console.log('');
    process.exit(0);
  } else {
    console.error(`${RED}${BOLD}❌ VEREDICTO: COMANDO BLOQUEADO${RESET}`);
    console.error(`   ${result.reason}`);
    console.error('');
    process.exit(1);
  }
}

// =====================================================================
//  CLI: query-rag
// =====================================================================

/**
 * Consulta índice RAG.
 * @param {string} question
 */
function cmdQueryRag(question) {
  if (!question) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js [--rag-enabled=true] query-rag "<pergunta>"${RESET}`);
    console.log('   Ex: node pipeline-executor.js query-rag "Como funciona a state machine?"');
    console.log('   Ex: node pipeline-executor.js rag-query "state machine"');
    process.exit(1);
  }

  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   RAG — Consulta ao Índice                               ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');
  console.log(`${BOLD}🔍 Pergunta:${RESET} ${question}`);
  console.log(`${BOLD}⚙️  RAG:${RESET} ${_CONFIG.ragEnabled ? `${GREEN}habilitado${RESET}` : `${YELLOW}desabilitado${RESET}`}`);
  console.log('');

  if (!_CONFIG.ragEnabled) {
    console.log(`${YELLOW}   RAG desabilitado via --rag-enabled=false. Habilite para consultar.${RESET}`);
    console.log('');
    return;
  }

  try {
    const ragScript = path.join(__dirname, 'rag-query.js');
    const escapedQuestion = question.replace(/"/g, '\\"');
    const result = execSync(`node "${ragScript}" "${escapedQuestion}" --json`, {
      cwd: __dirname,
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024
    });

    const results = JSON.parse(result.trim());

    if (!results || results.length === 0) {
      console.log(`${YELLOW}   Nenhum resultado relevante encontrado.${RESET}`);
    } else {
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const score = r.combinedScore !== undefined ? r.combinedScore : (r.score || 0);
        const pct = (score * 100).toFixed(0);
        const bar = '█'.repeat(Math.min(Math.round(score * 30), 30));

        console.log(`   ${'─'.repeat(50)}`);
        console.log(`   ${BOLD}[#${i + 1}]${RESET} ${bar} ${pct}% relevante`);

        // Show detailed scores for hybrid mode
        if (r.tfidfScore !== undefined && r.embScore !== undefined) {
          const tfidfPct = (r.tfidfScore * 100).toFixed(0);
          const embPct = (r.embScore * 100).toFixed(0);
          console.log(`   📊 TF-IDF: ${tfidfPct}% | Embedding: ${embPct}% | Combinado: ${pct}%`);
        }

        console.log(`   📄 ${r.file} (chunk ${r.chunk})`);
        console.log(`   ${r.content || '(sem conteúdo)'}`);
        console.log('');
      }
    }

    console.log(`   ${'─'.repeat(50)}`);
    console.log('');
  } catch (err) {
    const message = err.message || 'erro desconhecido';
    console.error(`${RED}❌ RAG query falhou: ${message}${RESET}`);
    console.log(`   ${YELLOW}Certifique-se de que o índice RAG foi gerado:`);
    console.log(`   ${YELLOW}node pipeline-executor.js run-rag-index${RESET}`);
    console.log('');
  }
}

// =====================================================================
//  CLI: modules
// =====================================================================

/**
 * Mostra status dos módulos auxiliares.
 */
function cmdModules() {
  const status = _getModuleStatus();
  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Matrix Pipeline — Módulos Auxiliares                    ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');
  let anyLoaded = false;
  for (const mod in status) {
    const val = status[mod];
    if (val === true) {
      console.log(`   ${GREEN}✅ ${mod}${RESET}`);
      anyLoaded = true;
    } else if (mod === 'distCacheRedis' && val === true) {
      console.log(`   ${GREEN}   └─ Redis: conectado${RESET}`);
    } else if (mod === 'distCacheRedis' && _AUX.distCache) {
      console.log(`   ${YELLOW}   └─ Redis: não disponível (fallback JSON)${RESET}`);
    } else if (val === false || val === undefined) {
      console.log(`   ${YELLOW}⬜ ${mod}${RESET} (não carregado)`);
    }
  }
  if (!anyLoaded) {
    console.log(`   ${YELLOW}(todos opcionais — nenhum módulo auxiliar carregado)${RESET}`);
  }
  console.log('');
}

// =====================================================================
//  CLI: Schema Detect
// =====================================================================

/**
 * Detecta drifts de schema.
 * @param {string} [source]
 * @param {string} [target]
 */
function cmdSchemaDetect(source, target) {
  if (!_AUX.schemaDrift) {
    console.error(`${RED}❌ Schema Drift Detector não disponível (módulo opcional não carregado)${RESET}`);
    console.log(`   Verifique se schema-drift.js existe em: ${__dirname}`);
    return;
  }

  if (source && target) {
    const drifts = _AUX.schemaDrift.detectDrift(source, target);
    console.log('');
    console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
    console.log(`${CYAN}${BOLD}   Schema Drift — ${source} ↔ ${target}${RESET}`);
    console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
    console.log('');
    if (drifts.length === 0) {
      console.log(`   ${GREEN}✓ Nenhum drift detectado${RESET}`);
    } else {
      drifts.forEach(d => {
        const sevColor = d.severity === 'critical' ? RED : (d.severity === 'warning' ? YELLOW : DIM);
        const fixMark = d.fixable ? ` ${GREEN}[fixável]${RESET}` : '';
        console.log(`   ${sevColor}[${d.severity.toUpperCase()}]${RESET} ${d.message}${fixMark}`);
      });
    }
    console.log('');
    console.log(`   Total: ${drifts.length} drift(s)`);
    console.log('');
  } else {
    const allDrifts = _AUX.schemaDrift.detectAll();
    console.log('');
    console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
    console.log(`${CYAN}${BOLD}   Schema Drift — Detecção Completa                      ${RESET}`);
    console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
    console.log('');

    if (allDrifts.length === 0) {
      console.log(`   ${GREEN}${BOLD}✅ Nenhum drift detectado — todos os schemas consistentes${RESET}`);
    } else {
      const groups = {};
      allDrifts.forEach(d => {
        if (!groups[d.schema]) groups[d.schema] = [];
        groups[d.schema].push(d);
      });

      Object.keys(groups).forEach(schema => {
        console.log(`${BOLD}  📁 ${schema}${RESET} (${groups[schema].length})`);
        groups[schema].forEach(d => {
          const sevColor = d.severity === 'critical' ? RED : (d.severity === 'warning' ? YELLOW : DIM);
          const fixMark = d.fixable ? `${GREEN} [fixável]${RESET}` : '';
          console.log(`     ${sevColor}[${d.severity.toUpperCase()}]${RESET} ${d.message}${fixMark}`);
        });
        console.log('');
      });

      const critical = allDrifts.filter(d => d.severity === 'critical').length;
      const warnings = allDrifts.filter(d => d.severity === 'warning').length;
      const infos = allDrifts.filter(d => d.severity === 'info').length;
      const fixable = allDrifts.filter(d => d.fixable).length;

      console.log(`${BOLD}📊 Sumário:${RESET}`);
      console.log(`   Total:    ${allDrifts.length}`);
      console.log(`   ${critical > 0 ? RED : GREEN} Critical: ${critical}${RESET}`);
      console.log(`   ${warnings > 0 ? YELLOW : GREEN} Warnings: ${warnings}${RESET}`);
      console.log(`   Info:     ${infos}`);
      console.log(`   ${fixable > 0 ? GREEN : DIM} Fixáveis: ${fixable}${RESET}`);
      console.log('');
    }
  }
}

// =====================================================================
//  CLI: Schema Fix
// =====================================================================

/**
 * Corrige drift entre schemas.
 * @param {string} source
 * @param {string} target
 */
function cmdSchemaFix(source, target) {
  if (!_AUX.schemaDrift) {
    console.error(`${RED}❌ Schema Drift Detector não disponível${RESET}`);
    return;
  }

  if (!source || !target) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js schema-fix <source> <target>${RESET}`);
    console.log('   Ex: node pipeline-executor.js schema-fix pipeline.yaml state.json');
    return;
  }

  const result = _AUX.schemaDrift.fixDrift(source, target);
  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Schema Drift — Correção                               ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');
  console.log(`   Source: ${source}`);
  console.log(`   Target: ${target}`);
  console.log('');
  if (result.success) {
    console.log(`   ${GREEN}✅ ${result.details}${RESET}`);
  } else {
    console.log(`   ${RED}❌ ${result.details}${RESET}`);
  }
  if (result.errors && result.errors.length > 0) {
    console.log('');
    console.log(`   ${YELLOW}Erros:${RESET}`);
    result.errors.forEach(e => {
      console.log(`     ${RED}• ${e}${RESET}`);
    });
  }
  if (result.action === 'none') {
    console.log(`   ${GREEN}Nenhuma ação necessária${RESET}`);
  }
  console.log('');
}

// =====================================================================
//  CLI: Schema Report
// =====================================================================

/**
 * Relatório completo de drift.
 */
function cmdSchemaReport() {
  if (!_AUX.schemaDrift) {
    console.error(`${RED}❌ Schema Drift Detector não disponível${RESET}`);
    return;
  }

  const reportData = _AUX.schemaDrift.report();
  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Schema Drift — Relatório Completo                     ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');
  console.log(`   Timestamp: ${reportData.timestamp}`);
  console.log(`   Total drifts: ${reportData.total}`);
  console.log(`   Fixáveis: ${reportData.fixable}`);
  console.log('');
  console.log(`${BOLD}   Por severidade:${RESET}`);
  console.log(`     ${reportData.bySeverity.critical > 0 ? RED : GREEN} Critical: ${reportData.bySeverity.critical}${RESET}`);
  console.log(`     ${reportData.bySeverity.warning > 0 ? YELLOW : GREEN} Warning:  ${reportData.bySeverity.warning}${RESET}`);
  console.log(`     Info:     ${reportData.bySeverity.info}`);
  console.log('');

  if (reportData.drifts.length > 0) {
    console.log(`${BOLD}   Drifts:${RESET}`);
    reportData.drifts.forEach(d => {
      const sevColor = d.severity === 'critical' ? RED : (d.severity === 'warning' ? YELLOW : DIM);
      console.log(`     ${sevColor}[${d.severity.toUpperCase()}]${RESET} ${d.message}`);
    });
    console.log('');
  }

  console.log(`${BOLD}   Recomendações:${RESET}`);
  reportData.recommendations.forEach(rec => {
    const isCritical = rec.startsWith('[CRITICAL]');
    console.log(`     ${isCritical ? RED : YELLOW}→${RESET} ${rec}`);
  });
  console.log('');
}

// =====================================================================
//  CLI: Cache Stats
// =====================================================================

/**
 * Mostra estatísticas do cache distribuído.
 */
function cmdCacheStats() {
  if (!_AUX.distCache) {
    console.error(`${RED}❌ Cache distribuído não disponível${RESET}`);
    console.log(`   Verifique se cache-distributed.js existe em: ${__dirname}`);
    process.exit(0);
  }

  const s = _AUX.distCache.stats();

  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Matrix Distributed Cache — Estatísticas                  ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');

  const redisStatus = s.redisAvailable ? `${GREEN}✅ Conectado${RESET}` : `${YELLOW}⬜ Indisponível${RESET}`;
  console.log(`${BOLD}  📀 Redis:${RESET} ${redisStatus}`);
  if (s.redisLibrary) console.log(`     Lib: ${s.redisLibrary}`);
  console.log(`     Fallback: ${s.fallbackOnly ? `${YELLOW}apenas JSON${RESET}` : `${GREEN}Redis + JSON${RESET}`}`);

  console.log('');
  console.log(`${BOLD}  ⚙️  Config:${RESET}`);
  console.log(`     Host:         ${s.config.host}:${s.config.port}`);
  console.log(`     TTL padrão:   ${s.config.ttl_seconds}s`);
  console.log(`     Prefixo:      "${s.config.key_prefix}"`);
  console.log(`     Timeout:      ${s.config.connect_timeout}ms`);

  console.log('');
  console.log(`${BOLD}  📊 Operações:${RESET}`);
  console.log(`     Gets:         ${s.counters.gets}`);
  console.log(`     Sets:         ${s.counters.sets}`);
  console.log(`     Dels:         ${s.counters.dels}`);
  console.log(`     Clears:       ${s.counters.clears}`);
  console.log(`     Redis hits:   ${s.counters.redisHits}`);
  console.log(`     Redis misses: ${s.counters.redisMisses}`);
  console.log(`     JSON hits:    ${s.counters.fallbackHits}`);
  console.log(`     JSON misses:  ${s.counters.fallbackMisses}`);
  console.log(`     Erros:        ${s.counters.errors}`);
  console.log(`     Total:        ${s.counters.totalOperations}`);

  console.log('');
  console.log(`${BOLD}  📁 Cache JSON:${RESET}`);
  console.log(`     Arquivo: ${s.jsonCache.file}`);
  console.log(`     Entradas: ${s.jsonCache.entries}`);
  console.log(`     Tamanho: ${(s.jsonCache.sizeBytes / 1024).toFixed(1)} KB`);

  console.log('');
  console.log(`${BOLD}  ⏱️  Uptime:${RESET} ${s.uptime}`);
  if (s.lastError) {
    console.log(`${YELLOW}  ⚠️  Último erro: ${s.lastError}${RESET}`);
  }

  console.log('');
}

// =====================================================================
//  CLI: Debug Commands
// =====================================================================

function cmdDebugEnable(level) {
  if (!_AUX.debug) {
    console.error(`${RED}❌ Debugger não disponível (pipeline-debug.js não encontrado)${RESET}`);
    process.exit(1);
  }
  const result = _AUX.debug.enable(level || 'info');
  if (!result) process.exit(1);
}

function cmdDebugDisable() {
  if (!_AUX.debug) {
    console.error(`${RED}❌ Debugger não disponível${RESET}`);
    process.exit(1);
  }
  _AUX.debug.disable();
}

function cmdDebugStatus() {
  if (!_AUX.debug) {
    console.error(`${RED}❌ Debugger não disponível${RESET}`);
    process.exit(1);
  }
  const state = _AUX.debug.getState();
  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Matrix Pipeline Debugger — Status                       ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');
  console.log(`${BOLD}  🎯 Ativo:${RESET} ${state.enabled ? `${GREEN}SIM${RESET}` : `${YELLOW}NÃO${RESET}`}`);
  console.log(`${BOLD}  📊 Nível:${RESET} ${state.level}`);
  console.log(`${BOLD}  🕐 Início:${RESET} ${state.sessionStart || 'N/A'}`);
  console.log(`${BOLD}  📝 Entradas:${RESET} ${state.totalEntries}`);
  console.log(`${BOLD}  🧩 Módulos:${RESET} ${state.modulesActive}`);
  console.log(`${BOLD}  💾 Buffer:${RESET} ${state.bufferSize}/${state.maxBufferSize}`);
  console.log(`${BOLD}  📄 Log:${RESET} ${state.logFile || 'N/A'}`);
  console.log('');
  if (state.enabled && state.levelCounters) {
    console.log(`${BOLD}  Contadores por nível:${RESET}`);
    for (const lvl in state.levelCounters) {
      console.log(`    ${(_AUX.debug && _AUX.debug.LEVEL_COLORS ? _AUX.debug.LEVEL_COLORS[lvl] : '') || ''}${lvl}${RESET}: ${state.levelCounters[lvl]}`);
    }
    console.log('');
  }
}

function cmdDebugDump() {
  if (!_AUX.debug) {
    console.error(`${RED}❌ Debugger não disponível${RESET}`);
    process.exit(1);
  }
  _AUX.debug.dumpSession();
}

function cmdDebugClear() {
  if (!_AUX.debug) {
    console.error(`${RED}❌ Debugger não disponível${RESET}`);
    process.exit(1);
  }
  _AUX.debug.clearBuffer();
}

function cmdDebugTrace(module, message) {
  if (!_AUX.debug) {
    console.error(`${RED}❌ Debugger não disponível${RESET}`);
    process.exit(1);
  }
  if (!module || !message) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js debug trace <module> <message>${RESET}`);
    process.exit(1);
  }
  const result = _AUX.debug.trace(module, message);
  if (result) {
    console.log(`${GREEN}✓${RESET} Trace registrado: [${module}] ${message}`);
  }
}

function cmdDebug(subcmd, arg1, arg2) {
  if (!_AUX.debug) {
    console.error(`${RED}❌ Debugger não disponível. Verifique pipeline-debug.js em: ${__dirname}${RESET}`);
    process.exit(1);
  }

  switch (subcmd) {
    case 'enable':
      cmdDebugEnable(arg1);
      break;
    case 'disable':
      cmdDebugDisable();
      break;
    case 'status':
      cmdDebugStatus();
      break;
    case 'dump':
      cmdDebugDump();
      break;
    case 'clear':
      cmdDebugClear();
      break;
    case 'trace':
      cmdDebugTrace(arg1, arg2);
      break;
    default:
      console.error(`${RED}❌ Subcomando debug desconhecido: "${subcmd}"${RESET}`);
      console.log('   Use: enable [level], disable, status, dump, clear, trace <module> <message>');
      process.exit(1);
  }
}

// =====================================================================
//  CLI: Dashboard
// =====================================================================

/**
 * Inicia o servidor do dashboard de observabilidade.
 */
function cmdDashboard() {
  const dashboardScript = path.join(__dirname, 'dashboard-server.js');

  if (!fs.existsSync(dashboardScript)) {
    console.error(`${RED}❌ dashboard-server.js não encontrado em: ${dashboardScript}${RESET}`);
    process.exit(1);
  }

  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Matrix Pipeline — Dashboard Server                     ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');

  let port = 3001;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--port=')) {
      port = parseInt(args[i].split('=')[1], 10) || 3001;
    }
  }

  try {
    const child = spawn('node', [dashboardScript, `--port=${port}`], {
      cwd: __dirname,
      stdio: 'inherit',
      detached: false
    });

    console.log(`   📊 Dashboard server iniciado em http://localhost:${port}`);
    console.log('   ⏹  Ctrl+C para parar');
    console.log('');

    child.on('error', function (err) {
      console.error(`${RED}❌ Erro ao iniciar dashboard: ${err.message}${RESET}`);
      process.exit(1);
    });

    child.on('exit', function (code) {
      console.log(`${YELLOW}   Dashboard server encerrado (código: ${code})${RESET}`);
      process.exit(code);
    });
  } catch (err) {
    console.error(`${RED}❌ Erro ao iniciar dashboard: ${err.message}${RESET}`);
    process.exit(1);
  }
}

// =====================================================================
//  CLI: select-model
// =====================================================================

function cmdSelectModel(taskType, complexityStr) {
  if (!taskType) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js select-model <tipo> [complexidade]${RESET}`);
    console.log('   Tipos: query, translation, formatting, categorization, extraction, summary, greeting (simples)');
    console.log('          refactoring, documentation, testing, debugging (médio)');
    console.log('          code, analysis, planning, architecture, reasoning, creative (complexo)');
    console.log('          architecture-review, security-audit, complex-reasoning, strategic-planning (thinking)');
    console.log('   Complexidade: 1 (mínima) a 5 (máxima). Default: 1');
    process.exit(1);
  }

  const complexity = complexityStr ? parseInt(complexityStr, 10) : 1;
  const comp = isNaN(complexity) || complexity < 1 ? 1 : (complexity > 5 ? 5 : complexity);

  const result = _selectModel(taskType, comp);

  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Cost-Aware Model Selection                             ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');
  console.log(`   Task type:    ${taskType}`);
  console.log(`   Complexity:   ${comp}`);
  console.log(`   Selected:     ${GREEN}${result.model}${RESET} (${result.tier})`);
  console.log(`   Cost/1K tok:  $${result.costPer1KTokens.toFixed(5)}`);
  console.log(`   Reason:       ${result.reason}`);
  console.log('');
}

// =====================================================================
//  CLI: tools
// =====================================================================

function cmdGetTools(taskType, complexityStr) {
  if (!taskType) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js tools <tipo> [complexidade]${RESET}`);
    console.log('   Tipos: read, view, edit, write, create, research, search, execute, run, etc.');
    process.exit(1);
  }

  const complexity = complexityStr ? parseInt(complexityStr, 10) : 1;
  const comp = isNaN(complexity) || complexity < 1 ? 1 : (complexity > 5 ? 5 : complexity);

  const result = _getTools(taskType, comp, { role: 'cli' });

  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Tool Router — Ferramentas Recomendadas                  ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');
  console.log(`   Task type:    ${taskType}`);
  console.log(`   Complexity:   ${comp}`);
  console.log(`   Route:        ${result.route || 'fallback'}`);
  console.log(`   Reason:       ${result.reason}`);
  console.log('');
  console.log(`${BOLD}   Ferramentas:${RESET}`);

  if (result.tools.length === 0) {
    console.log(`   ${YELLOW}(nenhuma ferramenta disponível)${RESET}`);
  } else {
    result.tools.forEach((t, i) => {
      const restrictedMark = t.restricted ? `${RED} 🔒${RESET}` : '';
      console.log(`   ${i + 1}. ${GREEN}${t.name}${RESET}${restrictedMark} — ${t.description}`);
    });
  }
  console.log('');
}

// =====================================================================
//  CLI: tool-info
// =====================================================================

function cmdToolInfo(toolName) {
  if (!toolName) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js tool-info <nome>${RESET}`);
    process.exit(1);
  }

  const info = _getToolInfo(toolName);
  if (!info) {
    console.error(`${RED}❌ Ferramenta "${toolName}" não encontrada${RESET}`);
    process.exit(1);
  }

  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Tool Router — Informações da Ferramenta                ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');
  console.log(`   Name:         ${GREEN}${info.name}${RESET}`);
  console.log(`   Description:  ${info.description}`);
  console.log(`   Category:     ${info.category}`);
  console.log(`   Restricted:   ${info.restricted ? `${RED}SIM 🔒${RESET}` : `${GREEN}Não${RESET}`}`);
  console.log(`   Max complex:  ${info.complexityMax}`);
  console.log(`   Aliases:      ${info.aliases.join(', ')}`);
  console.log('');
}

// =====================================================================
//  CLI: route-task
// =====================================================================

function cmdRouteTask(description) {
  if (!description) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js route-task "<descrição da tarefa>"${RESET}`);
    process.exit(1);
  }

  const result = _routeTask(description, { role: 'cli' });

  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Tool Router — Roteamento de Tarefa                      ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');
  console.log(`   ${result.summary.replace(/\n/g, '\n   ')}`);
  console.log('');
  console.log(`${BOLD}   Ferramentas recomendadas:${RESET}`);

  if (result.tools.length === 0) {
    console.log(`   ${YELLOW}(nenhuma)${RESET}`);
  } else {
    result.tools.forEach((t, i) => {
      const restrictedMark = t.restricted ? ` ${RED}🔒${RESET}` : '';
      console.log(`   ${i + 1}. ${GREEN}${t.name}${RESET}${restrictedMark}`);
    });
  }
  console.log('');
}

// =====================================================================
//  CLI: select-agent
// =====================================================================

function cmdSelectAgent(taskType, complexityStr, domain) {
  if (!taskType) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js select-agent <tipo> [complexidade] [dominio]${RESET}`);
    console.log('   Tipos: code, backend, frontend, design, test, database, security, devops, etc.');
    console.log('   Domínios: engineering, design, dados, cms, devops, marketing, produto, qualidade, suporte');
    console.log('   Complexidade: 1 (mínima) a 5 (máxima). Default: 1');
    process.exit(1);
  }

  const complexity = complexityStr ? parseInt(complexityStr, 10) : 1;
  const comp = isNaN(complexity) || complexity < 1 ? 1 : (complexity > 5 ? 5 : complexity);

  const result = _selectAgent(taskType, comp, domain || null);
  const agentInfo = _getAgentInfo(result.agent);

  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Agent Router — Seleção de Especialista                  ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');
  console.log(`   Task type:    ${taskType}`);
  console.log(`   Complexity:   ${comp}`);
  if (domain) console.log(`   Domain:       ${domain}`);
  console.log(`   Selected:     ${GREEN}@${result.agent}${RESET}`);
  console.log(`   Category:     ${CYAN}${result.category}${RESET}`);
  console.log(`   Seniority:    ${result.seniority}`);
  console.log(`   Mode:         ${result.mode}`);
  if (agentInfo && agentInfo.description) {
    console.log(`   Description:  ${agentInfo.description}`);
  }
  console.log(`   Reason:       ${result.reason}`);
  console.log('');
}

// =====================================================================
//  CLI: agent-info
// =====================================================================

function cmdAgentInfo(agentName) {
  if (!agentName) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js agent-info <agentName>${RESET}`);
    console.log('   Ex: node pipeline-executor.js agent-info backend-architect');
    process.exit(1);
  }

  const info = _getAgentInfo(agentName);
  if (!info) {
    console.error(`${RED}❌ Agente "${agentName}" não encontrado${RESET}`);
    console.log('   Use "node pipeline-executor.js agent-list" para ver todos os agentes.');
    process.exit(0);
  }

  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Agent Router — Informações do Agente                    ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');
  console.log(`   Name:         ${GREEN}@${info.name}${RESET}`);
  console.log(`   Description:  ${info.description}`);
  console.log(`   Categories:   ${(info.categories || []).join(', ')}`);
  console.log(`   Mode:         ${info.mode}`);
  console.log(`   Seniority:    ${info.seniority}`);
  console.log(`   Max complex:  ${info.complexityMax}`);
  console.log(`   Task types:   ${(info.taskTypes || []).join(', ')}`);
  console.log(`   Keywords:     ${(info.keywords || []).join(', ')}`);
  console.log('');
}

// =====================================================================
//  CLI: agent-list
// =====================================================================

function cmdAgentList(category) {
  try {
    const router = _AUX.agentRouter || require('./agent-router');
    if (category) {
      const agents = router.listAgentsByCategory(category);
      if (!agents || agents.length === 0) {
        console.log(`${YELLOW}Nenhum agente encontrado na categoria "${category}"${RESET}`);
        console.log(`   Categorias disponíveis: ${router.listCategories().join(', ')}`);
        return;
      }
      console.log('');
      console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
      console.log(`${CYAN}${BOLD}   Agent Router — Agentes na categoria "${category}"${RESET}`);
      console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
      console.log('');
      agents.forEach((a, i) => {
        console.log(`   ${i + 1}. ${GREEN}@${a.name || a}${RESET}${a.description ? ` — ${a.description}` : ''}`);
      });
      console.log('');
    } else {
      const categories = router.listCategories();
      const catNames = Object.keys(categories).sort();
      console.log('');
      console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
      console.log(`${CYAN}${BOLD}   Agent Router — Todos os Agentes (${router.getAgentCount()})${RESET}`);
      console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
      console.log('');
      catNames.forEach(cat => {
        const catData = categories[cat];
        if (catData && catData.agents && catData.agents.length > 0) {
          console.log(`${BOLD}  ${cat.toUpperCase()}${RESET} (${catData.count}):`);
          catData.agents.forEach(agentName => {
            console.log(`    ${GREEN}@${agentName}${RESET}`);
          });
          console.log('');
        }
      });
    }
  } catch (err) {
    console.error(`${RED}❌ Erro ao listar agentes: ${err.message}${RESET}`);
  }
}

// =====================================================================
//  CLI: run-rag-index
// =====================================================================

function cmdRunRagIndex(dir) {
  const targetDir = dir || sm.getBaseDir();
  const ragScript = path.join(__dirname, 'rag-index.js');

  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   RAG Indexer — Indexação Completa                       ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');
  console.log(`   Diretório: ${targetDir}`);
  console.log('');

  try {
    execSync(`node "${ragScript}" "${targetDir}"`, {
      cwd: __dirname,
      stdio: 'inherit'
    });
  } catch (err) {
    console.error(`${RED}❌ RAG indexing falhou${RESET}`);
    process.exit(1);
  }
}

// =====================================================================
//  CLI: setup-rag
// =====================================================================

/**
 * Configura o RAG: testa API key, ajusta modo, executa index.
 * Delega para setup-rag.js que é o script especialista.
 */
function cmdSetupRag() {
  const setupScript = path.join(__dirname, 'setup-rag.js');

  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   RAG Setup — Configuração Automática                    ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');

  try {
    execSync(`node "${setupScript}"`, {
      cwd: __dirname,
      stdio: 'inherit',
      timeout: 120000
    });
  } catch (err) {
    // setup-rag.js já mostra seus erros
    if (err.status && err.status !== 0) {
      console.error(`${RED}❌ RAG setup falhou (exit code: ${err.status})${RESET}`);
      process.exit(err.status);
    }
  }
}

// =====================================================================
//  CLI: cost-report
// =====================================================================

function cmdCostReport() {
  if (!_AUX.costMonitor) {
    console.error(`${RED}❌ Cost monitor não disponível (cost-monitor.js não encontrado)${RESET}`);
    process.exit(1);
  }

  const report = _AUX.costMonitor.getDailyReport();

  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Matrix Pipeline — Cost Report (Daily)                  ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');
  console.log(`  Data:       ${report.date}`);
  console.log(`  Gasto hoje: ${GREEN}$${report.totalSpent.toFixed(6)}${RESET}`);
  if (report.budgetMonthly > 0) {
    console.log(`  Budget:     $${report.budgetMonthly.toFixed(2)}`);
    console.log(`  Restante:   $${report.budgetRemaining.toFixed(6)}`);
    console.log(`  Usado:      ${report.percentUsed > 80 ? RED : (report.percentUsed > 50 ? YELLOW : GREEN)}${report.percentUsed}%${RESET}`);
  } else {
    console.log(`  Budget:     ${YELLOW}Não definido${RESET}`);
  }
  console.log(`  Modelos:    ${report.modelCount}`);

  if (report.modelCount > 0) {
    console.log('');
    console.log(`${BOLD}  Breakdown por modelo:${RESET}`);
    const mNames = Object.keys(report.models);
    for (let mi = 0; mi < mNames.length; mi++) {
      const mn = mNames[mi];
      const md = report.models[mn];
      console.log(`    ${mi + 1}. ${CYAN}${mn}${RESET}`);
      console.log(`       Tokens: ${md.total_tokens || 0} | Custo: $${(md.total_cost || 0).toFixed(6)} | Calls: ${md.calls || 0}`);
    }
  }

  try {
    const checkResult = _AUX.costMonitor.checkThresholds();
    if (!checkResult.safe && checkResult.alerts.length > 0) {
      console.log('');
      console.log(`${YELLOW}${BOLD}  ⚠️  Alertas ativos:${RESET}`);
      for (let ai = 0; ai < checkResult.alerts.length; ai++) {
        const a = checkResult.alerts[ai];
        const aColor = a.level === 'CRITICAL' ? RED : YELLOW;
        console.log(`    ${aColor}[${a.level}]${RESET} ${a.message.substring(0, 100)}`);
      }
    }
  } catch (e) { /* NON-BLOCKING */ }

  console.log('');
}

// =====================================================================
//  CLI: cost-forecast
// =====================================================================

function cmdCostForecast() {
  if (!_AUX.costMonitor) {
    console.error(`${RED}❌ Cost monitor não disponível (cost-monitor.js não encontrado)${RESET}`);
    process.exit(1);
  }

  const forecast = _AUX.costMonitor.getWeeklyForecast();

  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Matrix Pipeline — Cost Forecast (Weekly)               ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');
  console.log(`  Gasto atual:      $${forecast.currentSpend.toFixed(6)}`);
  console.log(`  Média diária:     ${GREEN}$${forecast.dailyAverage.toFixed(6)}${RESET}`);
  console.log(`  Dias decorridos:  ${forecast.daysElapsed} de ${forecast.daysInMonth}`);
  console.log(`  Dias restantes:   ${forecast.daysRemaining}`);
  console.log('');
  console.log(`${BOLD}  Projeção mensal:${RESET}  $${forecast.projection.toFixed(4)}`);

  if (forecast.monthlyBudget > 0) {
    console.log(`  Budget mensal:    $${forecast.monthlyBudget.toFixed(2)}`);
    console.log(`  % do budget:      ${forecast.projectedPercentOfBudget > 100 ? RED : (forecast.projectedPercentOfBudget > 80 ? YELLOW : GREEN)}${forecast.projectedPercentOfBudget}%${RESET}`);

    if (forecast.atRisk) {
      console.log(`  ${RED}${BOLD}  🚨 PROJEÇÃO EXCEDE BUDGET!${RESET}`);
      console.log(`  ${RED}  Excedente estimado: $${(forecast.projection - forecast.monthlyBudget).toFixed(4)}${RESET}`);
    } else if (forecast.projectedPercentOfBudget >= 80) {
      console.log(`  ${YELLOW}  ⚠️ Projeção próxima do limite${RESET}`);
    }
  }

  console.log('');
  console.log(`  Projeção próx. 7 dias: $${forecast.weeklyProjection.toFixed(6)}`);
  console.log('');
}

// =====================================================================
//  CLI: cost-alert-history
// =====================================================================

function cmdCostAlertHistory(limitStr) {
  if (!_AUX.costMonitor) {
    console.error(`${RED}❌ Cost monitor não disponível (cost-monitor.js não encontrado)${RESET}`);
    process.exit(1);
  }

  let limit = limitStr ? parseInt(limitStr, 10) : 20;
  if (isNaN(limit) || limit < 1) limit = 20;

  const history = _AUX.costMonitor.getAlertHistory(limit);

  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Matrix Pipeline — Cost Alert History                    ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');

  if (history.length === 0) {
    console.log(`  ${YELLOW}Nenhum alerta registrado.${RESET}`);
  } else {
    console.log(`  Últimos ${history.length} alertas:`);
    console.log('');
    for (let hi = 0; hi < history.length; hi++) {
      const a = history[hi];
      const aColor = a.level === 'CRITICAL' ? RED : (a.level === 'WARNING' ? YELLOW : CYAN);
      const aIcon = a.level === 'CRITICAL' ? '🚨' : (a.level === 'WARNING' ? '⚠️' : 'ℹ️');
      console.log(`  ${aColor}${aIcon} [${a.level}]${RESET} ${(a.message || '(sem mensagem)').substring(0, 120)}`);
      console.log(`     ${YELLOW}${a.timestamp || ''}${RESET}`);
    }
  }
  console.log('');
}

// =====================================================================
//  CLI: release
// =====================================================================

/**
 * Executa o release pipeline completo.
 * Delega para release-integration.js que lê release-pipeline.yaml
 * e release-config.yaml para executar o fluxo:
 *   version_bump → changelog → tag → build → deploy
 *
 * @param {string} versionType - "patch" | "minor" | "major"
 */
function cmdRelease(versionType) {
  const releasePath = path.join(__dirname, 'release-integration.js');

  if (!fs.existsSync(releasePath)) {
    console.error(`${RED}❌ release-integration.js não encontrado em: ${releasePath}${RESET}`);
    process.exit(1);
  }

  if (!versionType) {
    versionType = 'patch';
  }

  const validTypes = ['patch', 'minor', 'major'];
  if (validTypes.indexOf(versionType) < 0) {
    console.error(`${RED}❌ Tipo de versão inválido: "${versionType}"${RESET}`);
    console.log(`   Use: ${GREEN}patch${RESET}, ${GREEN}minor${RESET} ou ${GREEN}major${RESET}`);
    process.exit(1);
  }

  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Release Pipeline via Pipeline Executor                ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  console.log(`   Tipo: ${GREEN}${versionType}${RESET}`);
  console.log(`   Módulo: ${DIM}release-integration.js${RESET}`);
  console.log('');

  try {
    const release = require(releasePath);
    const result = release.triggerRelease(versionType);

    if (!result.success) {
      console.error(`${RED}❌ Release falhou: ${result.error || 'erro desconhecido'}${RESET}`);
      if (result.details) {
        console.error(`   Detalhes: ${result.details}`);
      }
      process.exit(1);
    }

    process.exit(0);
  } catch (err) {
    console.error(`${RED}❌ Erro ao executar release: ${err.message}${RESET}`);
    process.exit(1);
  }
}

/**
 * Exibe o status do release pipeline.
 */
function cmdReleaseStatus() {
  const releasePath = path.join(__dirname, 'release-integration.js');

  if (!fs.existsSync(releasePath)) {
    console.error(`${RED}❌ release-integration.js não encontrado em: ${releasePath}${RESET}`);
    process.exit(1);
  }

  try {
    const release = require(releasePath);
    const status = release.releaseStatus();

    console.log('');
    console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
    console.log(`${CYAN}${BOLD}║   Release Pipeline — Status                             ║${RESET}`);
    console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
    console.log('');
    console.log(`   Estado atual:   ${GREEN}${status.state}${RESET}`);
    if (status.description) console.log(`   Descrição:      ${status.description}`);
    if (status.lastTransition) console.log(`   Última transição: ${status.lastTransition}`);
    if (status.lastUpdated) console.log(`   Última atualização: ${status.lastUpdated}`);
    if (status.lastRelease) console.log(`   Última release:  ${status.lastRelease}`);
    if (status.config) {
      console.log('');
      console.log(`   Config:`);
      console.log(`     version_file:  ${status.config.version_file}`);
      console.log(`     tag_prefix:    ${status.config.tag_prefix}`);
      console.log(`     auto_increment: ${status.config.auto_increment}`);
    }
    console.log('');
  } catch (err) {
    console.error(`${RED}❌ Erro ao obter status do release: ${err.message}${RESET}`);
    process.exit(1);
  }
}

/**
 * Lista o histórico de releases.
 */
function cmdReleaseHistory() {
  const releasePath = path.join(__dirname, 'release-integration.js');

  if (!fs.existsSync(releasePath)) {
    console.error(`${RED}❌ release-integration.js não encontrado em: ${releasePath}${RESET}`);
    process.exit(1);
  }

  try {
    const release = require(releasePath);
    const releases = release.listReleases();

    console.log('');
    console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
    console.log(`${CYAN}${BOLD}║   Release Pipeline — Histórico                          ║${RESET}`);
    console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
    console.log('');

    if (releases.length === 0) {
      console.log(`   ${YELLOW}(nenhuma release encontrada)${RESET}`);
    } else {
      console.log(`   Total: ${releases.length} releases`);
      console.log('');
      releases.forEach(function (r) {
        const icon = r.status === 'completed' ? '✅' : '❌';
        console.log(`   ${icon} ${BOLD}${r.version}${RESET} (${r.type})`);
        console.log(`      Tag:  ${r.tag}`);
        console.log(`      Data: ${r.timestamp}`);
        console.log(`      Status: ${r.status}`);
        console.log('');
      });
    }
  } catch (err) {
    console.error(`${RED}❌ Erro ao listar releases: ${err.message}${RESET}`);
    process.exit(1);
  }
}

// =====================================================================
//  CLI: create-pr
// =====================================================================

function cmdCreatePR(extra) {
  if (!_AUX.pr) {
    console.error(`${RED}❌ PR Generator não disponível (módulo opcional não carregado)${RESET}`);
    console.log(`   Verifique se pr-generator.js existe em: ${__dirname}`);
    process.exit(0);
  }

  const isDryRun = extra === 'dry-run' || extra === '--dry-run';

  // Parse --agent e --tool dos argumentos CLI (para propagar agente real)
  let agent = 'pipeline-executor (CLI)';
  let tool = 'cli';
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--agent=')) {
      agent = arg.substring(8);
    } else if (arg.startsWith('--tool=')) {
      tool = arg.substring(7);
    }
  }

  const state = sm.loadState();
  const metadata = {
    agent: agent,
    tool: tool,
    trigger: 'manual',
    timestamp: new Date().toISOString()
  };

  if (isDryRun) {
    _AUX.pr.dryRun(state, metadata);
  } else {
    console.log('');
    console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
    console.log(`${CYAN}${BOLD}║   Matrix Pipeline — Criando Pull Request                 ║${RESET}`);
    console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
    console.log('');
    const result = _AUX.pr.createPR(state, metadata);
    if (result && result.url) {
      console.log(`${GREEN}✅ PR #${result.number} criado com sucesso!${RESET}`);
      console.log(`   URL: ${result.url}`);
    } else {
      console.log(`${YELLOW}⚠️  PR não foi criado (NON-BLOCKING — verifique gh auth e remote)${RESET}`);
    }
    console.log('');
  }
}

function cmdPRStatus() {
  if (!_AUX.pr) {
    console.error(`${RED}❌ PR Generator não disponível${RESET}`);
    process.exit(0);
  }
  _AUX.pr.cmdStatus();
}

function cmdPRDryRun() {
  cmdCreatePR('dry-run');
}

// =====================================================================
//  CLI: voting-status
// =====================================================================

function cmdVotingStatus() {
  const votingHistoryPath = path.resolve(__dirname, '..', 'voting-history.json');

  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Matrix Pipeline — Model Voting Status                     ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');

  // 1. Lê último voto da memória
  try {
    const mem = require('./memory-adapter');
    const ultimoVoto = mem.read('decisoes', 'ultimo_voto');

    if (ultimoVoto) {
      console.log(`${BOLD}  📌 Última votação (memória):${RESET}`);
      console.log(`     Timestamp:    ${ultimoVoto.timestamp || 'N/A'}`);
      console.log(`     Task:        ${ultimoVoto.taskDescription || 'N/A'}`);
      console.log(`     Tipo:        ${ultimoVoto.taskType || 'N/A'}`);
      console.log(`     Winner:      ${ultimoVoto.winnerModel || 'N/A'} (${ultimoVoto.winnerTier || '?'})`);
      console.log(`     Consenso:    ${(ultimoVoto.consensus * 100).toFixed(1) || 'N/A'}% (${ultimoVoto.consensusLabel || 'N/A'})`);
      console.log(`     Método:      ${ultimoVoto.method || 'N/A'}`);
      if (ultimoVoto.fromState && ultimoVoto.toState) {
        console.log(`     Transição:   ${ultimoVoto.fromState} → ${ultimoVoto.toState}`);
      }
      console.log('');
    } else {
      console.log(`  ${YELLOW}⚠️  Nenhum voto encontrado na memória.${RESET} (Execute uma transição com model-voting ativo primeiro)`);
      console.log('');
    }
  } catch (memErr) {
    console.log(`  ${YELLOW}⚠️  Erro ao ler memória (NON-BLOCKING): ${memErr.message}${RESET}`);
    console.log('');
  }

  // 2. Lê histórico completo
  try {
    if (fs.existsSync(votingHistoryPath)) {
      const raw = fs.readFileSync(votingHistoryPath, 'utf8');
      const history = JSON.parse(raw);

      if (Array.isArray(history) && history.length > 0) {
        console.log(`${BOLD}  📊 Histórico completo (${history.length} votações):${RESET}`);
        console.log('');

        const maxDisplay = Math.min(history.length, 10);
        const slice = history.slice(-maxDisplay);

        slice.forEach((v, i) => {
          const idx = history.length - maxDisplay + i + 1;
          const ts = v.timestamp ? v.timestamp.substring(0, 19).replace('T', ' ') : 'N/A';
          const model = v.winner ? v.winner.model : 'N/A';
          const tier = v.winner ? v.winner.tier : '?';
          const consensus = v.consensus !== undefined ? `${(v.consensus * 100).toFixed(1)}%` : 'N/A';
          const taskType = v.task ? v.task.type : 'N/A';

          const color = v.consensus >= 0.8 ? GREEN : (v.consensus >= 0.5 ? YELLOW : RED);

          console.log(`  ${CYAN}#${idx}${RESET}` +
            ` [${ts}]` +
            ` ${color}${consensus}${RESET}` +
            ` ${BOLD}${model}${RESET}` +
            ` (${tier})` +
            `${DIM} — ${taskType}${RESET}`);
        });

        if (history.length > maxDisplay) {
          console.log(`${DIM}     ... e mais ${history.length - maxDisplay} votações${RESET}`);
        }
        console.log('');
      } else {
        console.log(`  ${YELLOW}⚠️  Nenhum voto encontrado no histórico.${RESET}`);
        console.log('');
      }
    } else {
      console.log(`  ${YELLOW}⚠️  Arquivo voting-history.json não encontrado.${RESET}`);
      console.log(`     Caminho esperado: ${votingHistoryPath}`);
      console.log('');
    }
  } catch (fileErr) {
    console.log(`  ${YELLOW}⚠️  Erro ao ler voting-history.json (NON-BLOCKING): ${fileErr.message}${RESET}`);
    console.log('');
  }
}

// =====================================================================
//  CLI: tenant
// =====================================================================

function cmdTenant(args) {
  if (!_AUX.tenant) {
    console.error(`${RED}❌ Tenant Router não disponível (módulo opcional não carregado)${RESET}`);
    return;
  }

  const subcmd = args && args[0];
  const subargs = args ? args.slice(1) : [];

  switch (subcmd) {
    case 'create':
      cmdTenantCreate(subargs);
      break;
    case 'delete':
      cmdTenantDelete(subargs);
      break;
    case 'list':
      cmdTenantList();
      break;
    case 'switch':
      cmdTenantSwitch(subargs);
      break;
    case 'status':
      cmdTenantStatus(subargs);
      break;
    case 'migrate':
      cmdTenantMigrate(subargs);
      break;
    case 'isolate':
      cmdTenantIsolate(subargs);
      break;
    default:
      cmdTenantHelp();
  }
}

function cmdTenantCreate(subargs) {
  const tenantId = subargs[0];
  if (!tenantId) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js tenant create <id> [--name <name>] [--desc <desc>]${RESET}`);
    return;
  }
  const nameIdx = subargs.indexOf('--name');
  const descIdx = subargs.indexOf('--desc');
  const config = {};
  if (nameIdx !== -1 && subargs[nameIdx + 1]) config.name = subargs[nameIdx + 1];
  if (descIdx !== -1 && subargs[descIdx + 1]) config.description = subargs[descIdx + 1];

  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Matrix Pipeline — Criar Tenant                        ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  console.log(`   ID:     ${tenantId}`);
  if (config.name) console.log(`   Nome:   ${config.name}`);
  if (config.description) console.log(`   Desc:   ${config.description}`);
  console.log('');

  const result = _AUX.tenant.createTenant(tenantId, config);
  if (result) {
    console.log(`${GREEN}✅ Tenant "${tenantId}" criado com sucesso!${RESET}`);
    console.log(`   Path: ${result.path}`);
    console.log('');
  } else {
    console.error(`${RED}❌ Falha ao criar tenant "${tenantId}"${RESET}`);
    console.log('');
  }
}

function cmdTenantDelete(subargs) {
  const delId = subargs[0];
  const delFiles = subargs.indexOf('--files') !== -1;
  if (!delId) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js tenant delete <id> [--files]${RESET}`);
    return;
  }
  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Matrix Pipeline — Remover Tenant                      ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  console.log(`   ID:     ${delId}`);
  console.log(`   Remover arquivos: ${delFiles ? `${GREEN}SIM${RESET}` : `${YELLOW}NÃO (apenas registro)${RESET}`}`);
  console.log('');

  if (_AUX.tenant.deleteTenant(delId, delFiles)) {
    console.log(`${GREEN}✅ Tenant "${delId}" removido${RESET}`);
  } else {
    console.error(`${RED}❌ Falha ao remover tenant "${delId}"${RESET}`);
  }
  console.log('');
}

function cmdTenantList() {
  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Matrix Pipeline — Lista de Tenants                    ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');

  const tenants = _AUX.tenant.listTenants();
  if (tenants.length === 0) {
    console.log(`   ${YELLOW}Nenhum tenant registrado.${RESET}`);
    console.log('   Crie um com: node pipeline-executor.js tenant create <id>');
  } else {
    console.log(`   ${BOLD}Tenants registrados: ${tenants.length}${RESET}`);
    console.log('');
    tenants.forEach(t => {
      const activeMark = t.isActive ? `${GREEN} 🟢${RESET}` : '';
      console.log(`   ${t.isActive ? '▶' : ' '}  ${t.id}${activeMark}`);
      console.log(`      Nome:    ${t.name || t.id}`);
      console.log(`      Estado:  ${t.state.current_state}`);
      console.log('');
    });
  }
}

function cmdTenantSwitch(subargs) {
  const switchId = subargs[0];
  if (!switchId) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js tenant switch <id>${RESET}`);
    return;
  }
  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Matrix Pipeline — Alternar Tenant                     ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');

  if (_AUX.tenant.switchTenant(switchId)) {
    const active = _AUX.tenant.getActiveTenant();
    console.log(`${GREEN}✅ Tenant ativo: ${switchId}${RESET}`);
    if (active) {
      console.log(`   Path: ${active.path}`);
      console.log(`   State: ${active.state ? active.state.current_state : 'N/A'}`);
    }
  } else {
    console.error(`${RED}❌ Tenant "${switchId}" não encontrado${RESET}`);
  }
  console.log('');
}

function cmdTenantStatus(subargs) {
  const statusId = subargs[0];

  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Matrix Pipeline — Status Multi-Tenant                 ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');

  if (statusId) {
    const config = _AUX.tenant.getTenantConfig(statusId);
    if (!config) {
      console.error(`${RED}❌ Tenant "${statusId}" não encontrado${RESET}`);
      console.log('');
      return;
    }
    console.log(`   ID:          ${config.id}`);
    console.log(`   Nome:        ${config.name || config.id}`);
    console.log(`   Descrição:   ${config.description || '—'}`);
    console.log(`   Ativo:       ${config.isActive ? `${GREEN}SIM${RESET}` : 'NÃO'}`);
    console.log(`   Criado em:   ${config.createdAt}`);
    console.log(`   Diretório:   ${config.path}`);
    console.log(`   state.json:  ${config.stateFile ? `${GREEN}✅${RESET}` : `${RED}❌${RESET}`}`);
    console.log(`   memory.json: ${config.memoryFile ? `${GREEN}✅${RESET}` : `${RED}❌${RESET}`}`);
    console.log(`   events.log:  ${config.eventsFile ? `${GREEN}✅${RESET}` : `${RED}❌${RESET}`}`);
    console.log(`   metrics.json:${config.metricsFile ? `${GREEN}✅${RESET}` : `${RED}❌${RESET}`}`);
    if (config.state) console.log(`   Estado pipe: ${config.state.current_state}`);
  } else {
    const status = _AUX.tenant.tenantStatus();
    console.log(`   ${BOLD}Status Geral${RESET}`);
    console.log('');
    console.log(`   Tenant ativo: ${status.active ? `${GREEN}${status.active}${RESET}` : `${YELLOW}nenhum${RESET}`}`);
    console.log(`   Total:        ${status.total} tenants`);
    console.log('');
    if (status.tenants && status.tenants.length > 0) {
      console.log(`   ${BOLD}Tenants:${RESET}`);
      status.tenants.forEach(t => {
        const icon = t.active ? '🟢' : '⚪';
        console.log(`     ${icon} ${t.id} — ${t.state}`);
      });
    }
  }
  console.log('');
}

function cmdTenantMigrate(subargs) {
  const fromId = subargs[0];
  const toId = subargs[1];
  const overwrite = subargs.indexOf('--overwrite') !== -1;
  if (!fromId || !toId) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js tenant migrate <fromId> <toId> [--overwrite]${RESET}`);
    return;
  }
  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Matrix Pipeline — Migrar Tenant                       ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  console.log(`   Origem:  ${fromId}`);
  console.log(`   Destino: ${toId}`);
  if (overwrite) console.log(`   Modo:    ${YELLOW}overwrite (sobrescrever existentes)${RESET}`);
  console.log('');

  _AUX.tenant.migrateTenantData(fromId, toId, { overwrite: overwrite });
  console.log('');
}

function cmdTenantIsolate(subargs) {
  const isolateId = subargs[0];
  if (!isolateId) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js tenant isolate <id>${RESET}`);
    return;
  }
  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Matrix Pipeline — Isolar Dados do Tenant              ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  console.log(`   ID: ${isolateId}`);
  console.log('');

  const s = _AUX.tenant.isolateState(isolateId);
  const m = _AUX.tenant.isolateMemory(isolateId);
  const e = _AUX.tenant.isolateEvents(isolateId);

  if (s && m && e) {
    console.log(`${GREEN}✅ Isolamento completo para: ${isolateId}${RESET}`);
  } else {
    console.log(`${YELLOW}⚠️  Isolamento parcial para: ${isolateId}${RESET}`);
    if (!s) console.log(`     state.json: ${RED}falhou${RESET}`);
    if (!m) console.log(`     memory.json: ${RED}falhou${RESET}`);
    if (!e) console.log(`     events.log: ${RED}falhou${RESET}`);
  }
  console.log('');
}

function cmdTenantHelp() {
  console.log('');
  console.log(`${CYAN}${BOLD}Matrix Tenant Management${RESET}`);
  console.log(`${YELLOW}Uso: node pipeline-executor.js tenant <subcomando> [args]${RESET}`);
  console.log('');
  console.log('Subcomandos:');
  console.log(`  ${GREEN}create <id>${RESET}              Cria novo tenant com dados isolados`);
  console.log(`  ${GREEN}delete <id>${RESET}              Remove tenant (--files para remover dados)`);
  console.log(`  ${GREEN}list${RESET}                     Lista todos os tenants`);
  console.log(`  ${GREEN}switch <id>${RESET}              Alterna tenant ativo`);
  console.log(`  ${GREEN}status [id]${RESET}              Status do tenant ou geral`);
  console.log(`  ${GREEN}migrate <from> <to>${RESET}      Migra dados entre tenants`);
  console.log(`  ${GREEN}isolate <id>${RESET}             Isola state/memory/events do tenant`);
  console.log('');
  console.log('  --overwrite   Sobrescrever arquivos existentes (com migrate)');
  console.log('');
}

// =====================================================================
//  CLI: auth
// =====================================================================

function cmdAuth(args) {
  if (!_AUX.auth) {
    console.error(`${RED}❌ Auth Provider não disponível (auth-provider.js não encontrado)${RESET}`);
    return;
  }

  const subcmd = args && args[0];
  const subargs = args ? args.slice(1) : [];

  switch (subcmd) {
    case 'check':
      cmdAuthCheck();
      break;
    case 'verify':
      cmdAuthVerify(subargs);
      break;
    case 'userinfo':
      cmdAuthUserinfo(subargs);
      break;
    case 'status':
      cmdAuthStatus();
      break;
    case 'token':
      cmdAuthToken(subargs);
      break;
    case 'github-login':
      cmdAuthGithubLogin(subargs);
      break;
    case 'github-callback':
      cmdAuthGithubCallback(subargs);
      break;
    default:
      cmdAuthHelp();
  }
}

function cmdAuthCheck() {
  const authStatus = _AUX.auth.getStatus();
  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Matrix Auth — Health Check (via Pipeline Executor)    ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');

  // 1. Module availability
  console.log(`  ${BOLD}1. Module${RESET}`);
  console.log(`     Available: ${GREEN}✅ auth-provider.js${RESET}`);
  console.log(`     Initialized: ${authStatus.initialized ? `${GREEN}✅ SIM${RESET}` : `${RED}❌ NÃO${RESET}`}`);

  // 2. Config
  console.log('');
  console.log(`  ${BOLD}2. Config${RESET}`);
  console.log(`     File: ${DIM}pipeline/auth-config.yaml${RESET}`);
  console.log(`     Provider: ${CYAN}${authStatus.provider}${RESET}`);

  // 3. JWT
  console.log('');
  console.log(`  ${BOLD}3. JWT${RESET}`);
  console.log(`     Secret: ${authStatus.jwtSecretConfigured ? `${GREEN}✅ configurada${RESET}` : `${RED}❌ NÃO configurada${RESET}`}`);
  console.log(`     Lib:    ${authStatus.jwtLibAvailable ? `${GREEN}✅ jsonwebtoken${RESET}` : `${YELLOW}⬜ nativa (HMAC)${RESET}`}`);

  // 4. RBAC
  console.log('');
  console.log(`  ${BOLD}4. RBAC${RESET}`);
  console.log(`     Available: ${authStatus.rbacAvailable ? `${GREEN}✅${RESET}` : `${RED}❌${RESET}`}`);
  console.log(`     Fallback:  ${authStatus.rbacFallback ? `${GREEN}✅ ativado${RESET}` : `${YELLOW}⚠️  desativado${RESET}`}`);

  // 5. GitHub
  console.log('');
  console.log(`  ${BOLD}5. GitHub OAuth${RESET}`);
  console.log(`     Configured: ${authStatus.github.configured ? `${GREEN}✅${RESET}` : `${YELLOW}⬜${RESET}`}`);

  // 6. Cache
  console.log('');
  console.log(`  ${BOLD}6. Token Cache${RESET}`);
  console.log(`     Size: ${authStatus.tokenCacheSize} entries`);

  // 7. Overall
  const healthy = authStatus.initialized && (authStatus.rbacAvailable || authStatus.rbacFallback);
  console.log('');
  console.log(`  ${BOLD}7. Overall Health${RESET}`);
  console.log(`     Status: ${healthy ? `${GREEN}✅ HEALTHY${RESET}` : `${RED}❌ DEGRADED${RESET}`}`);
  console.log('');
}

function cmdAuthVerify(subargs) {
  const token = subargs.join(' ');
  if (!token) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js auth verify <token>${RESET}`);
    return;
  }
  const authVerify = _AUX.auth.authenticate(token);
  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Matrix Auth — Verify Token (via Pipeline Executor)    ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');

  if (authVerify.authenticated) {
    console.log(`  ${GREEN}✅ Token VÁLIDO — Autenticado${RESET}`);
    console.log('');
    console.log(`  ${BOLD}Usuário:${RESET}    ${authVerify.user.userId}`);
    if (authVerify.user.name) console.log(`  ${BOLD}Nome:${RESET}      ${authVerify.user.name}`);
    if (authVerify.user.email) console.log(`  ${BOLD}Email:${RESET}     ${authVerify.user.email}`);
    if (authVerify.user.role) console.log(`  ${BOLD}Papel:${RESET}     ${authVerify.user.role}`);
    if (authVerify.user.groups && authVerify.user.groups.length > 0) {
      console.log(`  ${BOLD}Grupos:${RESET}    ${authVerify.user.groups.join(', ')}`);
    }
    console.log('');
  } else {
    console.log(`  ${RED}❌ Token INVÁLIDO${RESET}`);
    console.log(`  ${BOLD}Erro:${RESET} ${authVerify.error}`);
    console.log('');
  }
}

function cmdAuthUserinfo(subargs) {
  const infoToken = subargs.join(' ');
  if (!infoToken) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js auth userinfo <token>${RESET}`);
    return;
  }
  const identity = _AUX.auth.getIdentity(infoToken);
  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Matrix Auth — Identity Info                            ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');

  if (identity.error) {
    console.log(`  ${YELLOW}⚠️  ${identity.error}${RESET}`);
  } else {
    console.log(`  ${BOLD}userId:${RESET}  ${identity.userId}`);
    console.log(`  ${BOLD}name:${RESET}    ${identity.name || '(não informado)'}`);
    console.log(`  ${BOLD}email:${RESET}   ${identity.email || '(não informado)'}`);
    console.log(`  ${BOLD}role:${RESET}    ${identity.role || '(não informado)'}`);
    if (identity.groups && identity.groups.length > 0) {
      console.log(`  ${BOLD}groups:${RESET}  ${identity.groups.join(', ')}`);
    }
  }
  console.log('');
}

function cmdAuthStatus() {
  const authStatus = _AUX.auth.getStatus();
  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Matrix Auth Provider — Status                         ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  console.log(`  ${BOLD}Provider:${RESET}       ${CYAN}${authStatus.provider}${RESET}`);
  console.log(`  ${BOLD}Inicializado:${RESET}   ${authStatus.initialized ? `${GREEN}SIM${RESET}` : `${RED}NÃO${RESET}`}`);
  console.log(`  ${BOLD}RBAC Fallback:${RESET}  ${authStatus.rbacFallback ? `${GREEN}SIM${RESET}` : `${YELLOW}NÃO${RESET}`}`);
  console.log('');
  console.log(`  ${BOLD}Módulos:${RESET}`);
  console.log(`    jsonwebtoken: ${authStatus.jwtLibAvailable ? `${GREEN}✅${RESET}` : `${YELLOW}⬜ (não instalado)${RESET}`}`);
  console.log(`    RBAC:         ${authStatus.rbacAvailable ? `${GREEN}✅${RESET}` : `${RED}❌${RESET}`}`);
  console.log('');
  console.log(`  ${BOLD}JWT Secret:${RESET}`);
  console.log(`    Configurada: ${authStatus.jwtSecretConfigured ? `${GREEN}✅${RESET}` : `${RED}❌${RESET}`}`);
  console.log(`    Cache tokens: ${authStatus.tokenCacheSize} entrada(s)`);
  console.log('');
  console.log(`  ${BOLD}Provedores:${RESET} ${authStatus.supportedProviders.join(', ')}`);
  console.log('');
}

function cmdAuthToken(subargs) {
  const tUserId = subargs[0];
  const tRole = subargs[1];
  const tName = subargs[2];
  if (!tUserId || !tRole) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js auth token <userId> <role> [name]${RESET}`);
    return;
  }
  const tPayload = { sub: tUserId, name: tName || tUserId, role: tRole };
  const newToken = _AUX.auth.createToken(tPayload);
  if (!newToken) {
    console.error(`${RED}❌ Falha ao criar token — JWT secret não configurada${RESET}`);
    console.log('   Defina Matrix_JWT_SECRET no ambiente ou configure auth-config.yaml');
    return;
  }
  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Matrix Auth — Token Criado                            ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  console.log(`  ${BOLD}Token JWT:${RESET}`);
  console.log(`  ${DIM}${newToken}${RESET}`);
  console.log('');
  console.log(`  ${BOLD}Claims:${RESET}`);
  console.log(`    userId: ${tUserId}`);
  console.log(`    role:   ${tRole}`);
  console.log(`    name:   ${tName || tUserId}`);
  console.log('');
  console.log(`  ${BOLD}Teste:${RESET}`);
  console.log(`  node pipeline-executor.js auth verify "${newToken.substring(0, 60)}..."`);
  console.log('');
}

function cmdAuthGithubLogin(subargs) {
  const ghRedirectUri = subargs[0] || null;
  if (!_AUX.auth.getGithubAuthUrl) {
    console.log(`${RED}❌ GitHub OAuth não disponível nesta versão do auth-provider.js${RESET}`);
    return;
  }
  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Matrix Auth — GitHub OAuth Login                      ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');

  const ghAuthUrl = _AUX.auth.getGithubAuthUrl(ghRedirectUri);
  if (!ghAuthUrl) {
    console.log(`  ${RED}❌ GitHub OAuth não configurado.${RESET}`);
    console.log('');
    console.log(`  ${BOLD}Para configurar:${RESET}`);
    console.log('    1. Crie um OAuth App em: https://github.com/settings/developers');
    console.log('    2. Defina as variáveis de ambiente:');
    console.log('       set Matrix_GITHUB_CLIENT_ID=seu_client_id');
    console.log('       set Matrix_GITHUB_CLIENT_SECRET=seu_client_secret');
    console.log('');
  } else {
    console.log(`  ${BOLD}URL de Autorização GitHub:${RESET}`);
    console.log(`  ${CYAN}${ghAuthUrl}${RESET}`);
    console.log('');
    console.log(`  ${YELLOW}⚠️  Abra esta URL no navegador para autorizar.${RESET}`);
    console.log('');
    console.log(`  ${BOLD}Após autorizar, use o código recebido:${RESET}`);
    console.log('  node pipeline-executor.js auth github-callback <codigo>');
    console.log('');
  }
}

function cmdAuthGithubCallback(subargs) {
  const ghCode = subargs[0];
  if (!ghCode) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js auth github-callback <code>${RESET}`);
    return;
  }
  if (!_AUX.auth.authenticateWithGithub) {
    console.log(`${RED}❌ GitHub OAuth não disponível nesta versão do auth-provider.js${RESET}`);
    return;
  }
  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Matrix Auth — GitHub OAuth Callback                   ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  console.log(`  ${DIM}🔄 Trocando código por token...${RESET}`);
  console.log('');

  (async function() {
    try {
      const ghResult = await _AUX.auth.authenticateWithGithub(ghCode);
      if (ghResult.authenticated) {
        console.log(`  ${GREEN}✅ Autenticação GitHub bem-sucedida!${RESET}`);
        console.log('');
        console.log(`  ${BOLD}Usuário:${RESET}    ${ghResult.user.userId}`);
        console.log(`  ${BOLD}Nome:${RESET}      ${ghResult.user.name}`);
        console.log(`  ${BOLD}Email:${RESET}     ${ghResult.user.email || '(não público)'}`);
        console.log(`  ${BOLD}Papel RBAC:${RESET} ${ghResult.user.role}`);
        if (ghResult.user.profileUrl) {
          console.log(`  ${BOLD}Perfil:${RESET}    ${ghResult.user.profileUrl}`);
        }
        console.log('');
        console.log(`  ${BOLD}Token de Acesso:${RESET}`);
        console.log(`  ${DIM}${ghResult.token}${RESET}`);
        console.log('');
      } else {
        console.log(`  ${RED}❌ Falha na autenticação GitHub${RESET}`);
        console.log(`  ${BOLD}Erro:${RESET} ${ghResult.error}`);
        console.log('');
      }
    } catch (asyncErr) {
      console.log(`  ${RED}❌ Erro: ${asyncErr.message}${RESET}`);
      console.log('');
    }
  })();
}

function cmdAuthHelp() {
  console.log('');
  console.log(`${CYAN}${BOLD}Matrix Auth Provider${RESET}`);
  console.log(`${YELLOW}Uso: node pipeline-executor.js auth <subcomando> [args]${RESET}`);
  console.log('');
  console.log('Subcomandos:');
  console.log(`  ${GREEN}check${RESET}                      Verificação completa de saúde`);
  console.log(`  ${GREEN}verify <token>${RESET}            Valida token JWT e mostra dados do usuário`);
  console.log(`  ${GREEN}userinfo <token>${RESET}           Extrai identidade do token (sem validar)`);
  console.log(`  ${GREEN}status${RESET}                     Mostra status do Auth Provider`);
  console.log(`  ${GREEN}token <id> <role>${RESET}          Cria token JWT de teste`);
  console.log(`  ${GREEN}github-login [redirect_uri]${RESET} Gera URL para login GitHub OAuth`);
  console.log(`  ${GREEN}github-callback <code>${RESET}     Troca código GitHub por token`);
  console.log('');
}

// =====================================================================
//  CLI: browser
// =====================================================================

function cmdBrowser(args) {
  if (!_AUX.browser) {
    console.error(`${RED}❌ Browser Support não disponível (módulo opcional não carregado)${RESET}`);
    return;
  }

  const subcmd = args && args[0];
  const subargs = args ? args.slice(1) : [];

  switch (subcmd) {
    case 'check':
      cmdBrowserCheck();
      break;
    case 'open':
      cmdBrowserOpen(subargs);
      break;
    case 'fetch':
      cmdBrowserFetch(subargs);
      break;
    case 'browsers':
      cmdBrowserList();
      break;
    default:
      cmdBrowserHelp();
  }
}

function cmdBrowserCheck() {
  const avail = _AUX.browser.isBrowserAvailable();
  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Browser Support — Verificação                         ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  console.log(`   ${avail ? `${GREEN}✅ Browser disponível` : `${RED}❌ Nenhum browser detectado`}${RESET}`);
  if (avail) {
    const browsers = _AUX.browser.getAvailableBrowsers();
    const available = browsers.filter(b => b.available);
    console.log(`   Browsers encontrados: ${available.length}`);
    available.forEach(b => {
      console.log(`     ${GREEN}✓${RESET} ${b.name} (${b.path})`);
    });
  }
  console.log('');
}

function cmdBrowserOpen(subargs) {
  const url = subargs.join(' ');
  if (!url) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js browser open <url>${RESET}`);
    return;
  }
  _AUX.browser.openUrl(url);
}

function cmdBrowserFetch(subargs) {
  const fetchUrl = subargs.join(' ');
  if (!fetchUrl) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js browser fetch <url>${RESET}`);
    return;
  }
  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Browser Support — Fetch de Conteúdo                   ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  console.log(`   URL: ${fetchUrl}`);
  console.log('');
  (async function () {
    const content = await _AUX.browser.fetchPageContent(fetchUrl);
    if (content) {
      console.log(`${BOLD}Conteúdo (${content.length} bytes):${RESET}`);
      console.log(content.substring(0, 2000) + (content.length > 2000 ? '\n... (truncado)' : ''));
    } else {
      console.log(`${YELLOW}⚠️  Nenhum conteúdo obtido${RESET}`);
    }
    console.log('');
  })();
}

function cmdBrowserList() {
  const list = _AUX.browser.getAvailableBrowsers();
  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Browser Support — Browsers Instalados                 ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    const icon = b.available ? `${GREEN}✓` : `${YELLOW}⬜`;
    const pathInfo = b.path ? ` (${b.path})` : '';
    console.log(`   ${icon}${RESET} ${b.name}${pathInfo}`);
  }
  console.log('');
}

function cmdBrowserHelp() {
  console.log('');
  console.log(`${CYAN}${BOLD}Matrix Browser Support${RESET}`);
  console.log(`${YELLOW}Uso: node pipeline-executor.js browser <subcomando> [args]${RESET}`);
  console.log('');
  console.log('Subcomandos:');
  console.log(`  ${GREEN}check${RESET}                   Verifica disponibilidade de browsers`);
  console.log(`  ${GREEN}open <url>${RESET}              Abre URL no browser padrão`);
  console.log(`  ${GREEN}fetch <url>${RESET}             Fetch de conteúdo web`);
  console.log(`  ${GREEN}browsers${RESET}                Lista browsers instalados`);
  console.log('');
}

// =====================================================================
//  CLI: docker
// =====================================================================

function cmdDocker(args) {
  if (!_AUX.docker) {
    console.error(`${RED}❌ Docker Support não disponível (módulo opcional não carregado)${RESET}`);
    return;
  }

  const subcmd = args && args[0];
  const subargs = args ? args.slice(1) : [];

  switch (subcmd) {
    case 'check':
      cmdDockerCheck();
      break;
    case 'run':
      cmdDockerRun(subargs);
      break;
    case 'ps':
      cmdDockerPs(subargs);
      break;
    case 'info':
      cmdDockerInfo();
      break;
    case 'build':
      cmdDockerBuild(subargs);
      break;
    default:
      cmdDockerHelp();
  }
}

function cmdDockerCheck() {
  const avail = _AUX.docker.isDockerAvailable();
  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Docker Support — Verificação                          ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  console.log(`   ${avail ? `${GREEN}✅ Docker disponível` : `${RED}❌ Docker não detectado`}${RESET}`);
  if (avail) {
    const info = _AUX.docker.getDockerInfo();
    console.log(`   Containers: ${info.containers.running} rodando, ${info.containers.total} total`);
  }
  console.log('');
}

function cmdDockerRun(subargs) {
  const image = subargs[0];
  const command = subargs.slice(1).join(' ');
  if (!image || !command) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js docker run <imagem> <comando>${RESET}`);
    return;
  }
  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Docker Support — Executando Container                 ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  console.log(`   Imagem:  ${image}`);
  console.log(`   Comando: ${command}`);
  console.log('');
  const result = _AUX.docker.runContainer(image, command);
  if (result.success) {
    console.log(`${GREEN}✅ Execução concluída${RESET}`);
    if (result.output) {
      console.log('');
      console.log(`${BOLD}Saída:${RESET}`);
      console.log(result.output);
    }
  } else {
    console.error(`${RED}❌ Erro: ${result.error}${RESET}`);
  }
  console.log('');
}

function cmdDockerPs(subargs) {
  const allFlag = subargs.indexOf('--all') > -1 || subargs.indexOf('-a') > -1;
  const containers = _AUX.docker.listContainers({ all: allFlag });
  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Docker Support — Containers                           ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  if (containers.length === 0) {
    console.log(`   ${YELLOW}Nenhum container ${allFlag ? '' : 'ativo '}encontrado.${RESET}`);
  } else {
    for (let i = 0; i < containers.length; i++) {
      const c = containers[i];
      const shortId = c.id.substring(0, 8);
      const imageName = (c.image || '').substring(0, 20).padEnd(20, ' ');
      const status = (c.status || '').substring(0, 15).padEnd(15, ' ');
      console.log(`   ${shortId}  ${imageName} ${status} ${c.names}`);
    }
  }
  console.log('');
}

function cmdDockerInfo() {
  const dinfo = _AUX.docker.getDockerInfo();
  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Docker Support — Informações                          ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  console.log(`   Disponível:    ${dinfo.available ? `${GREEN}SIM${RESET}` : `${RED}NÃO${RESET}`}`);
  if (dinfo.available) {
    console.log(`   Versão CLI:    ${dinfo.version || 'N/A'}`);
    console.log(`   Server:        ${dinfo.serverVersion || 'N/A'}`);
    console.log(`   Containers:    ${dinfo.containers.running} running, ${dinfo.containers.paused} paused, ${dinfo.containers.stopped} stopped`);
  }
  console.log('');
}

function cmdDockerBuild(subargs) {
  const buildPath = subargs[0];
  if (!buildPath) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js docker build <caminho> [--tag=<tag>]${RESET}`);
    return;
  }
  const buildOptions = {};
  for (let k = 0; k < subargs.length; k++) {
    if (subargs[k].startsWith('--tag=')) {
      buildOptions.tag = subargs[k].substring(6);
    }
    if (subargs[k] === '--no-cache') {
      buildOptions.noCache = true;
    }
  }
  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Docker Support — Build de Imagem                      ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  console.log(`   Caminho:  ${buildPath}`);
  if (buildOptions.tag) console.log(`   Tag:      ${buildOptions.tag}`);
  console.log('');
  const buildResult = _AUX.docker.buildImage(buildPath, buildOptions);
  if (buildResult.success) {
    console.log(`${GREEN}✅ Build concluído${RESET}`);
    if (buildResult.imageId) {
      console.log(`   Image ID: ${buildResult.imageId}`);
    }
  } else {
    console.error(`${RED}❌ Erro no build: ${buildResult.error}${RESET}`);
  }
  console.log('');
}

function cmdDockerHelp() {
  console.log('');
  console.log(`${CYAN}${BOLD}Matrix Docker Support${RESET}`);
  console.log(`${YELLOW}Uso: node pipeline-executor.js docker <subcomando> [args]${RESET}`);
  console.log('');
  console.log('Subcomandos:');
  console.log(`  ${GREEN}check${RESET}                   Verifica disponibilidade do Docker`);
  console.log(`  ${GREEN}run <imagem> <cmd>${RESET}     Executa comando em container`);
  console.log(`  ${GREEN}ps [--all]${RESET}             Lista containers`);
  console.log(`  ${GREEN}info${RESET}                  Informações do Docker`);
  console.log(`  ${GREEN}build <caminho>${RESET}        Build de imagem Docker`);
  console.log('');
}

// =====================================================================
//  CLI: setup-pg-memory
// =====================================================================

/**
 * Testa conexão PostgreSQL, cria a tabela memories e reporta status.
 * NON-BLOCKING: se falhar, pipeline continua com fallback JSON.
 *
 * Uso: node pipeline-executor.js setup-pg-memory
 */
function cmdSetupPgMemory() {
  const setupScript = path.join(__dirname, 'setup-pg-memory.js');

  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Matrix Pipeline — PostgreSQL Memory Setup              ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');

  try {
    execSync(`node "${setupScript}"`, {
      cwd: path.dirname(setupScript),
      stdio: 'inherit'
    });
  } catch (err) {
    // NON-BLOCKING: sempre exit 0 do setup-pg-memory.js
    console.log(`${YELLOW}⚠️  Setup PostgreSQL falhou (NON-BLOCKING — pipeline continua com JSON)${RESET}`);
    console.log('');
    process.exit(0);
  }
}

// =====================================================================
//  CLI: rollback
// =====================================================================

function cmdRollbackCreate(label) {
  if (!_AUX.rollback) {
    console.error(`${RED}❌ Rollback Manager não disponível (módulo opcional não carregado)${RESET}`);
    return;
  }
  if (!label) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js rollback create "<label>"${RESET}`);
    return;
  }
  _AUX.rollback.createSnapshot(label);
}

function cmdRollbackList() {
  if (!_AUX.rollback) {
    console.error(`${RED}❌ Rollback Manager não disponível${RESET}`);
    return;
  }
  const snapshots = _AUX.rollback.listSnapshots();
  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   Rollback Manager — Snapshots                          ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');
  if (snapshots.length === 0) {
    console.log(`   ${YELLOW}(nenhum snapshot)${RESET}`);
  } else {
    snapshots.forEach(function(s) {
      const statusIcon = s.status === 'active' ? `${GREEN}🟢${RESET}` : `${YELLOW}🔵${RESET}`;
      console.log(`   ${statusIcon} ${s.id}`);
      console.log(`      Label:  ${s.label}`);
      console.log(`      Branch: ${s.branch} @ ${s.commit ? s.commit.substring(0, 8) : 'N/A'}`);
      console.log(`      Data:   ${s.timestamp}`);
      console.log(`      Status: ${s.status}`);
      console.log('');
    });
  }
  console.log(`   Total: ${snapshots.length} snapshot(s)`);
  console.log('');
}

function cmdRollbackRollback(snapshotId) {
  if (!_AUX.rollback) {
    console.error(`${RED}❌ Rollback Manager não disponível${RESET}`);
    return;
  }
  if (!snapshotId) {
    console.error(`${RED}❌ Uso: node pipeline-executor.js rollback rollback <snapshotId>${RESET}`);
    return;
  }
  _AUX.rollback.rollback(snapshotId);
}

function cmdRollbackCleanup(maxAgeStr) {
  if (!_AUX.rollback) {
    console.error(`${RED}❌ Rollback Manager não disponível${RESET}`);
    return;
  }
  const maxAge = maxAgeStr ? parseInt(maxAgeStr, 10) : 30;
  _AUX.rollback.cleanup(isNaN(maxAge) || maxAge < 1 ? 30 : maxAge);
}

function cmdRollback(args) {
  const subcmd = args && args[0];
  const subargs = args ? args.slice(1) : [];

  switch (subcmd) {
    case 'create':
      cmdRollbackCreate(subargs.join(' '));
      break;
    case 'list':
      cmdRollbackList();
      break;
    case 'rollback':
      cmdRollbackRollback(subargs[0]);
      break;
    case 'cleanup':
      cmdRollbackCleanup(subargs[0]);
      break;
    default:
      console.log('');
      console.log(`${CYAN}${BOLD}Matrix Rollback Manager${RESET}`);
      console.log(`${YELLOW}Uso: node pipeline-executor.js rollback <subcomando> [args]${RESET}`);
      console.log('');
      console.log('Subcomandos:');
      console.log(`  ${GREEN}create "<label>"${RESET}     Cria snapshot de rollback`);
      console.log(`  ${GREEN}list${RESET}                 Lista snapshots disponíveis`);
      console.log(`  ${GREEN}rollback <id>${RESET}        Restaura snapshot`);
      console.log(`  ${GREEN}cleanup [maxAge]${RESET}     Limpa snapshots antigos (padrão: 30 dias)`);
      console.log('');
  }
}

// =====================================================================
//  Queue Commands
// =====================================================================

function cmdQueueEnqueue(args) {
  var name = args && args[0];
  var taskArgs = args ? args.slice(1).join(' ') : '';

  if (!name) {
    console.log('');
    console.log(CYAN + BOLD + 'Matrix Task Queue — Enqueue' + RESET);
    console.log('');
    console.log('Uso: node pipeline-executor.js queue enqueue "<nome>" [args]');
    console.log('  node pipeline-executor.js queue enqueue "validate"');
    console.log('  node pipeline-executor.js queue enqueue "index-rag"');
    console.log('');
    return;
  }

  if (!_AUX || !_AUX.queue) {
    console.log(YELLOW + '⚠️  Queue system não disponível' + RESET);
    return;
  }

  var taskFn = function() {
    switch (name) {
      case 'validate':
        var validateMod = require('./validate-pipeline');
        return 'validate concluído';
      case 'index-rag':
        var child = require('child_process');
        child.execSync('node "' + __dirname + '\\setup-rag.js"', { stdio: 'pipe', timeout: 60000 });
        return 'RAG indexado';
      case 'snapshot':
        var snapshotMod = require('./snapshot-state');
        snapshotMod.createSnapshot(taskArgs || 'queue-automation');
        return 'Snapshot criado';
      default:
        if (name.endsWith('.js')) {
          var child2 = require('child_process');
          var output = child2.execSync('node "' + name + '" ' + taskArgs, { stdio: 'pipe', timeout: 30000 });
          return output.toString().trim();
        }
        return 'Tarefa desconhecida: ' + name;
    }
  };

  var taskId = _AUX.queue.enqueue(name, taskFn, { retries: 1 });
  console.log(GREEN + '✓' + RESET + ' Tarefa enfileirada: ' + name + ' (ID: ' + taskId + ')');
}

function cmdQueueProcess() {
  if (!_AUX || !_AUX.queue) {
    console.log(YELLOW + '⚠️  Queue system não disponível' + RESET);
    return;
  }

  var queueSize = _AUX.queue.size();
  if (queueSize === 0) {
    console.log('   Fila vazia — nada a processar');
    return;
  }

  console.log('');
  console.log(CYAN + BOLD + 'Matrix Task Queue — Processing' + RESET);
  console.log('   ' + queueSize + ' tarefa(s) na fila');
  console.log('');

  _AUX.queue.processQueue().then(function(results) {
    results.forEach(function(r) {
      if (r.success) {
        console.log('   ' + GREEN + '✓' + RESET + ' ' + r.task + ': concluído');
      } else {
        console.log('   ' + RED + '✗' + RESET + ' ' + r.task + ': ' + r.error);
      }
    });
    console.log('');
    console.log(GREEN + '✓' + RESET + ' Fila processada (' + results.length + ' tarefas)');
  }).catch(function(err) {
    console.log(RED + '✗' + RESET + ' Erro ao processar fila: ' + err.message);
  });
}

function cmdQueueStatus() {
  console.log('');
  console.log(CYAN + BOLD + 'Matrix Task Queue — Status' + RESET);
  console.log('');

  if (!_AUX || !_AUX.queue) {
    console.log('  ' + YELLOW + '⚠️  Queue system não disponível (módulo não carregado)' + RESET);
    console.log('');
    return;
  }

  var qsize = _AUX.queue.size();
  console.log('  Tamanho da fila: ' + (qsize > 0 ? YELLOW + qsize + RESET : GREEN + '0' + RESET));
  console.log('  Queue disponível: ' + GREEN + 'SIM' + RESET);
  console.log('');
  console.log('Comandos disponíveis:');
  console.log('  ' + CYAN + 'queue enqueue <nome>' + RESET + '  Adiciona tarefa à fila');
  console.log('  ' + CYAN + 'queue process' + RESET + '       Processa a fila');
  console.log('  ' + CYAN + 'queue status' + RESET + '        Status da fila');
  console.log('');
}

function cmdQueue(args) {
  var subcmd = args && args[0];
  var subargs = args ? args.slice(1) : [];

  switch (subcmd) {
    case 'enqueue':
    case 'add':
      cmdQueueEnqueue(subargs);
      break;
    case 'process':
    case 'run':
      cmdQueueProcess();
      break;
    case 'status':
    case 'info':
      cmdQueueStatus();
      break;
    default:
      cmdQueueStatus();
  }
}

// =====================================================================
//  CLI: siem
// =====================================================================

function cmdSiemStatus() {
  console.log('');
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}   SIEM Exporter — Status                                ${RESET}`);
  console.log(`${CYAN}${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log('');

  if (!_AUX.siem) {
    console.log(`   ${YELLOW}⬜ SIEM Exporter não carregado (desabilitado via --siem-enabled=false ou módulo ausente)${RESET}`);
    console.log('');
    return;
  }

  const autoExportStatus = _AUX.siem.getAutoExportStatus();
  console.log(`   ${autoExportStatus.active ? `${GREEN}✅ Auto-export: ATIVO${RESET}` : `${YELLOW}⬜ Auto-export: INATIVO${RESET}`}`);
  if (autoExportStatus.intervalMs) {
    const intervalMin = (autoExportStatus.intervalMs / 1000 / 60).toFixed(0);
    console.log(`   Intervalo: ${intervalMin} min`);
  }
  console.log(`   Diretório de export: ${_AUX.siem.EXPORTS_DIR || '(N/A)'}`);
  console.log(`   Formatos: ${_AUX.siem.SUPPORTED_FORMATS ? _AUX.siem.SUPPORTED_FORMATS.join(', ') : 'json, syslog, cef'}`);
  console.log('');
}

function cmdSiemStart(intervalStr) {
  if (!_AUX.siem) {
    console.error(`${RED}❌ SIEM Exporter não disponível (--siem-enabled=true ou verifique siem-exporter.js)${RESET}`);
    return;
  }
  const intervalMs = intervalStr ? parseInt(intervalStr, 10) : 3600000;
  _AUX.siem.startAutoExport(isNaN(intervalMs) || intervalMs < 60000 ? 3600000 : intervalMs);
  console.log(`   ${GREEN}✅ SIEM auto-export iniciado${RESET}`);
  console.log('');
}

function cmdSiemStop() {
  if (!_AUX.siem) {
    console.error(`${RED}❌ SIEM Exporter não disponível${RESET}`);
    return;
  }
  _AUX.siem.stopAutoExport();
  console.log(`   ${GREEN}✅ SIEM auto-export parado${RESET}`);
  console.log('');
}

function cmdSiem(args) {
  const subcmd = args && args[0];
  const subargs = args ? args.slice(1) : [];

  switch (subcmd) {
    case 'status':
      cmdSiemStatus();
      break;
    case 'start':
      cmdSiemStart(subargs[0]);
      break;
    case 'stop':
      cmdSiemStop();
      break;
    default:
      console.log('');
      console.log(`${CYAN}${BOLD}Matrix SIEM Exporter${RESET}`);
      console.log(`${YELLOW}Uso: node pipeline-executor.js siem <subcomando> [args]${RESET}`);
      console.log('');
      console.log('Subcomandos:');
      console.log(`  ${GREEN}status${RESET}               Status do auto-export SIEM`);
      console.log(`  ${GREEN}start [intervalMs]${RESET}   Inicia auto-export (padrão: 3600000ms = 1h)`);
      console.log(`  ${GREEN}stop${RESET}                 Para auto-export SIEM`);
      console.log('');
  }
}

// =====================================================================
//  Help
// =====================================================================

/**
 * Exibe o menu de ajuda do pipeline executor.
 */
function printHelp() {
  console.log('');
  console.log(`${CYAN}${BOLD}Matrix Pipeline Executor v1.0 — Modularizado${RESET}`);
  console.log(`${YELLOW}Uso: node pipeline-executor.js [flags] <comando> [argumentos]${RESET}`);
  console.log('');
  console.log('Flags:');
  console.log(`  ${GREEN}--sandbox-enabled=<true|false>${RESET}  Habilita/desabilita validação sandbox (default: true)`);
  console.log(`  ${GREEN}--rag-enabled=<true|false>${RESET}       Habilita/desabilita consulta RAG (default: true)`);
  console.log(`  ${GREEN}--context-enabled=<true|false>${RESET}  Habilita/desabilita Context Builder (default: true)`);
  console.log(`  ${GREEN}--model-routing-enabled=<true|false>${RESET} Ativa roteamento cost-aware (default: true)`);
  console.log(`  ${GREEN}--auto-commit=<true|false>${RESET}      Auto-commit ao atingir delivery (default: false)`);
  console.log(`  ${GREEN}--rollback-enabled=<true|false>${RESET} Habilita/desabilita snapshots de rollback (default: true)`);
  console.log(`  ${GREEN}--pr-enabled=<true|false>${RESET}       Habilita/desabilita criação de PR no delivery (default: true)`);
  console.log(`  ${GREEN}--siem-enabled=<true|false>${RESET}     Habilita/desabilita exportação SIEM (default: true)`);
  console.log(`  ${GREEN}--port=<number>${RESET}               Porta do dashboard server (default: 3001)`);
  console.log(`  ${GREEN}--help, -h${RESET}                     Exibe esta mensagem de ajuda`);
  console.log('');
  console.log('Comandos:');
  console.log(`  ${GREEN}status${RESET}                  Mostra estado atual do pipeline`);
  console.log(`  ${GREEN}transition <estado>${RESET}      Executa 1 transição de estado`);
  console.log(`  ${GREEN}history${RESET}                 Mostra histórico de transições`);
  console.log(`  ${GREEN}validate${RESET}                Executa validação da state machine`);
  console.log(`  ${GREEN}validate-command <cmd>${RESET}  Valida comando contra sandbox.yaml`);
  console.log(`  ${GREEN}security-check <cmd>${RESET}    Valida segurança multi-camada (sandbox + RBAC + file access)`);
  console.log(`  ${YELLOW}       --userId=<id>${RESET}        Usuário para verificação RBAC`);
  console.log(`  ${YELLOW}       --action=<action>${RESET}    Ação RBAC (code_write, git_push, config_write, execute)`);
  console.log(`  ${GREEN}query-rag <pergunta>${RESET}     Consulta índice RAG por similaridade`);
  console.log(`  ${GREEN}rag-query <pergunta>${RESET}     Consulta índice RAG (alias de query-rag)`);
  console.log(`  ${GREEN}select-agent <tipo> [complexidade] [dominio]${RESET} Seleciona agente especialista (agent-router)`);
  console.log(`  ${GREEN}agent-info <agentName>${RESET}          Informações detalhadas de um agente`);
  console.log(`  ${GREEN}agent-list [categoria]${RESET}          Lista agentes disponíveis (agent-router)`);
  console.log(`  ${GREEN}select-model <tipo> [complexidade]${RESET} Seleciona modelo via cost-aware routing`);
  console.log(`  ${GREEN}tools <tipo> [complexidade]${RESET}    Retorna ferramentas recomendadas (tool-router)`);
  console.log(`  ${GREEN}tool-info <nome>${RESET}              Informações detalhadas de uma ferramenta`);
  console.log(`  ${GREEN}route-task "<descrição>"${RESET}       Roteamento completo de descrição de tarefa`);
  console.log(`  ${GREEN}run-rag-index [diretório]${RESET}  Executa RAG indexing completo`);
  console.log(`  ${GREEN}init-pipeline${RESET}           Inicializa/verifica todos os serviços: PostgreSQL, RAG, Redis + health check`);
  console.log(`  ${GREEN}setup-rag${RESET}                Configura RAG: testa API key, ajusta modo híbrido/TF-IDF, indexa`);
  console.log(`  ${GREEN}setup-pg-memory${RESET}        Testa conexão PostgreSQL e cria tabela memories (NON-BLOCKING — fallback JSON automático)`);
  console.log(`  ${GREEN}modules${RESET}                Mostra status dos módulos auxiliares`);
  console.log(`  ${GREEN}schema-detect [src] [tgt]${RESET}  Detecta drifts de schema`);
  console.log(`  ${GREEN}schema-fix <src> <tgt>${RESET}    Corrige drift entre schemas`);
  console.log(`  ${GREEN}schema-report${RESET}            Relatório completo de drift`);
  console.log(`  ${GREEN}session create|list${RESET}    Gerencia sessões multi-pipeline`);
  console.log(`  ${GREEN}dashboard [--port=3001]${RESET}   Inicia servidor do dashboard`);
  console.log(`  ${GREEN}create-pr [dry-run]${RESET}      Cria Pull Request no GitHub (ou --dry-run)`);
  console.log(`  ${GREEN}pr-status${RESET}               Status do PR Generator (gh, remote)`);
  console.log(`  ${GREEN}pr-dry-run${RESET}              Simula criação de PR sem criar (alias)`);
  console.log(`  ${GREEN}voting-status${RESET}           Mostra status do Model Voting (último voto + histórico)`);
  console.log(`  ${GREEN}cache-stats${RESET}             Estatísticas do cache distribuído (Redis + JSON)`);
  console.log(`  ${GREEN}cache-clear${RESET}              Limpa cache distribuído (Redis + JSON)`);
  console.log(`  ${GREEN}cost-report${RESET}             Relatório de custos do dia`);
  console.log(`  ${GREEN}cost-forecast${RESET}          Projeção semanal de custos`);
  console.log(`  ${GREEN}cost-alert-history [limit]${RESET}  Histórico de alertas de custos`);
  console.log(`  ${GREEN}release <patch|minor|major>${RESET}  Executa o release pipeline completo (version bump → changelog → tag → build → deploy)`);
  console.log(`  ${GREEN}release-status${RESET}           Mostra status do release pipeline`);
  console.log(`  ${GREEN}release-history${RESET}          Mostra histórico de releases`);
  console.log(`  ${GREEN}browser <subcmd>${RESET}         Comandos de navegação web (check|open|fetch|browsers)`);
  console.log(`  ${GREEN}docker <subcmd>${RESET}          Comandos de container (check|run|ps|info|build)`);
  console.log(`  ${GREEN}auth <subcmd>${RESET}            Autenticação via Auth Provider (verify|userinfo|status|token)`);
  console.log(`  ${GREEN}tenant <subcmd>${RESET}          Gerencia tenants multi-tenant (create|delete|list|switch|status|migrate|isolate)`);
  console.log(`  ${GREEN}rollback <subcmd>${RESET}        Rollback Manager (create|list|rollback|cleanup)`);
  console.log(`  ${GREEN}queue <subcmd>${RESET}           Task Queue (enqueue|process|status)`);
  console.log(`  ${GREEN}siem <subcmd>${RESET}            SIEM Exporter (status|start|stop)`);
  console.log(`  ${GREEN}debug <subcmd>${RESET}           Debug runtime do pipeline`);
  console.log(`  ${YELLOW}       debug enable [level]${RESET}    Ativa debug (trace|debug|info|warn|error)`);
  console.log(`  ${YELLOW}       debug disable${RESET}           Desativa debug`);
  console.log(`  ${YELLOW}       debug status${RESET}            Mostra estado do debugger`);
  console.log(`  ${YELLOW}       debug dump${RESET}              Gera relatório formatado da sessão`);
  console.log(`  ${YELLOW}       debug clear${RESET}             Limpa buffer de debug`);
  console.log(`  ${YELLOW}       debug trace <mod> <msg>${RESET}  Registra trace manual`);
  console.log('');
  console.log('Exemplos:');
  console.log('  node pipeline-executor.js --sandbox-enabled=true validate-command "rm -rf /"');
  console.log('  node pipeline-executor.js security-check "rm -rf /"');
  console.log('  node pipeline-executor.js security-check "node script.js"');
  console.log('  node pipeline-executor.js security-check "git push" --userId=readonly --action=git_push');
  console.log('  node pipeline-executor.js --rag-enabled=true query-rag "Como funciona a state machine?"');
  console.log('  node pipeline-executor.js rag-query "state machine"                            # Alias');
  console.log('  node pipeline-executor.js --sandbox-enabled=false validate');
  console.log('  node pipeline-executor.js --auto-commit=true transition delivery');
  console.log('  node pipeline-executor.js select-model code 4');
  console.log('  node pipeline-executor.js select-agent code 3');
  console.log('  node pipeline-executor.js agent-info backend-architect');
  console.log('  node pipeline-executor.js agent-list');
  console.log('  node pipeline-executor.js agent-list design');
  console.log('  node pipeline-executor.js dashboard');
  console.log('  node pipeline-executor.js --port=8080 dashboard');
  console.log('  node pipeline-executor.js create-pr              # Cria PR manualmente');
  console.log('  node pipeline-executor.js pr-dry-run             # Simula PR sem criar');
  console.log('  node pipeline-executor.js pr-status              # Status do sistema');
  console.log('  node pipeline-executor.js browser check           # Verifica browsers instalados');
  console.log('  node pipeline-executor.js browser open https://example.com  # Abre URL');
  console.log('  node pipeline-executor.js browser fetch https://...  # Fetch de conteúdo web');
  console.log('  node pipeline-executor.js docker check            # Verifica Docker');
  console.log('  node pipeline-executor.js docker run node:18 node --version');
  console.log('  node pipeline-executor.js docker ps               # Lista containers');
  console.log('  node pipeline-executor.js auth status              # Status do Auth Provider');
  console.log('  node pipeline-executor.js auth verify <token>      # Valida token JWT');
  console.log('  node pipeline-executor.js debug enable trace      # Ativa debug modo trace');
  console.log('  node pipeline-executor.js debug status            # Status do debugger');
  console.log('  node pipeline-executor.js debug dump              # Relatório da sessão de debug');
  console.log('  node pipeline-executor.js release patch           # Release patch (1.0.0 → 1.0.1)');
  console.log('  node pipeline-executor.js queue status             # Status da fila de tarefas');
  console.log('  node pipeline-executor.js queue enqueue validate   # Adiciona validacao a fila');
  console.log('  node pipeline-executor.js queue process            # Processa a fila');
  console.log('  node pipeline-executor.js release minor           # Release minor (1.0.0 → 1.1.0)');
  console.log('  node pipeline-executor.js release major           # Release major (1.0.0 → 2.0.0)');
  console.log('  node pipeline-executor.js release-status          # Status do release pipeline');
  console.log('  node pipeline-executor.js release-history         # Histórico de releases');
  console.log('');
}

module.exports = {
  setDependencies,
  printHelp,
  cmdStatus,
  cmdTransition,
  cmdHistory,
  cmdSystemCheck,
  cmdValidate,
  cmdValidateCommand,
  cmdSecurityCheck,
  cmdQueryRag,
  cmdModules,
  cmdSchemaDetect,
  cmdSchemaFix,
  cmdSchemaReport,
  cmdCacheStats,
  cmdDebugEnable,
  cmdDebugDisable,
  cmdDebugStatus,
  cmdDebugDump,
  cmdDebugClear,
  cmdDebugTrace,
  cmdDebug,
  cmdDashboard,
  cmdSelectModel,
  cmdGetTools,
  cmdToolInfo,
  cmdRouteTask,
  cmdSelectAgent,
  cmdAgentInfo,
  cmdAgentList,
  cmdRunRagIndex,
  cmdSetupRag,
  cmdRollback,
  cmdRollbackCreate,
  cmdRollbackList,
  cmdRollbackRollback,
  cmdRollbackCleanup,
};
