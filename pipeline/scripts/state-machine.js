#!/usr/bin/env node
/**
 * Matrix State Machine Module v2.0 — UNIFIED
 * Lógica central da state machine: carregar, validar, persistir estado.
 * Unificado com state-machine-engine.js (engine de validação formal).
 *
 * Pure Node.js — zero npm dependencies.
 * CommonJS module format.
 *
 * Uso:
 *   const sm = require('./state-machine');
 *   const state = sm.loadState();
 *   sm.updateState('idle', 'fase1_analysis');
 *   const engine = sm.loadFromFile();  // engine methods: canTransition, getValidTransitions
 */

const fs = require('fs');
const path = require('path');
const { parseSectionList } = require('./lib/yaml-utils');

// ─── Paths Absolutos (relativos ao diretório do script) ───────────────
const BASE_DIR = path.resolve(__dirname, '..');
const STATE_JSON = path.join(BASE_DIR, 'state.json');
const PIPELINE_YAML = path.join(BASE_DIR, 'pipeline.yaml');
const EVENTS_LOG = path.join(BASE_DIR, 'events.log');
const METRICS_JSON = path.join(BASE_DIR, 'metrics.json');
const OBSERVABILITY_YAML = path.join(BASE_DIR, 'observability.yaml');

// ─── Cores para Terminal ──────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

// ─── File Locking ─────────────────────────────────────────────────────
const LOCKS = {};

/**
 * Obtém lock exclusivo para um arquivo usando lock file.
 * Abordagem baseada em "lock file" com expiração de 30s.
 *
 * @param {string} filePath - Caminho do arquivo a ser lockado
 * @param {number} [retries=10] - Número de tentativas
 * @param {number} [interval=100] - Intervalo entre tentativas (ms)
 * @returns {boolean} true se lock obtido, false se falhou
 */
function lockFile(filePath, retries, interval) {
  retries = retries || 10;
  interval = interval || 100;
  const lockPath = filePath + '.lock';
  for (let i = 0; i < retries; i++) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      LOCKS[filePath] = lockPath;
      return true;
    } catch (e) {
      // Verificar se o lock expirou (> 30s)
      try {
        const stat = fs.statSync(lockPath);
        const age = Date.now() - stat.mtimeMs;
        if (age > 30000) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch (e2) { /* ignore */ }
      if (i < retries - 1) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, interval);
      }
    }
  }
  console.warn(`${YELLOW}⚠️  Não foi possível obter lock para ${filePath}${RESET}`);
  return false;
}

/**
 * Libera o lock de um arquivo.
 *
 * @param {string} filePath - Caminho do arquivo lockado
 */
function unlockFile(filePath) {
  if (LOCKS[filePath]) {
    try { fs.unlinkSync(LOCKS[filePath]); } catch (e) { /* ignore */ }
    delete LOCKS[filePath];
  }
}

// ─── Paths Accessors ─────────────────────────────────────────────────

/** @returns {string} Caminho do state.json */
function getStatePath() { return STATE_JSON; }

/** @returns {string} Caminho do pipeline.yaml */
function getPipelinePath() { return PIPELINE_YAML; }

/** @returns {string} Caminho do metrics.json */
function getMetricsPath() { return METRICS_JSON; }

/** @returns {string} Caminho do events.log */
function getEventsLogPath() { return EVENTS_LOG; }

/** @returns {string} Caminho do observability.yaml */
function getObservabilityPath() { return OBSERVABILITY_YAML; }

/** @returns {string} Caminho base do pipeline */
function getBaseDir() { return BASE_DIR; }

// ─── Utilitários ──────────────────────────────────────────────────────

/**
 * Lê e faz parse de um arquivo JSON.
 */
function loadJSON(filePath, label) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`${RED}❌ Erro ao ler ${label}: ${err.message}${RESET}`);
    process.exit(1);
  }
}

/**
 * JSON.parse com fallback seguro.
 * Se o parse falhar, retorna o fallback.
 *
 * @param {string} str - String JSON a ser parseada
 * @param {*} fallback - Valor de fallback (default: null)
 * @returns {*} Objeto parseado ou fallback
 */
function safeJsonParse(str, fallback) {
  if (typeof str !== 'string' || str.trim().length === 0) return fallback;
  try {
    return JSON.parse(str);
  } catch (e) {
    console.warn(`${YELLOW}⚠️  safeJsonParse: JSON inválido, usando fallback${RESET}`);
    return fallback;
  }
}

// ─── State Loading ────────────────────────────────────────────────────

/**
 * @returns {{current_state: string, previous_state: string|null, last_transition: string|null, last_updated: string, attempts: Object<string, number>, history: Array<{from:string, to:string, timestamp:string}>, pipeline_version: string, metadata?: Object}}
 */
function loadState() {
  lockFile(STATE_JSON);
  try {
    var raw;
    try {
      raw = fs.readFileSync(STATE_JSON, 'utf8');
    } catch (e) {
      raw = '';
    }
    var parsed = safeJsonParse(raw, null);
    if (parsed && parsed.current_state) {
      return parsed;
    }
    // state.json inválido — executar recovery
    console.warn(`${YELLOW}⚠️  state.json inválido — executando recovery...${RESET}`);
    var result = recoverState();
    return result.state;
  } finally {
    unlockFile(STATE_JSON);
  }
}

/**
 * Lê e parseia pipeline.yaml — extrai states e transitions.
 */
function loadPipeline() {
  try {
    const raw = fs.readFileSync(PIPELINE_YAML, 'utf8');
    const states = parseSectionList(raw, 'states');
    const transitions = parseSectionList(raw, 'transitions');
    return { states, transitions };
  } catch (err) {
    console.error(`${RED}❌ Erro ao ler pipeline.yaml: ${err.message}${RESET}`);
    process.exit(1);
  }
}

/**
 * Lê metrics.json.
 */
function loadMetrics() {
  return loadJSON(METRICS_JSON, 'metrics.json');
}

// ─── Validação de Arquivos ────────────────────────────────────────────

/**
 * Valida se state.json existe e é parseável.
 * Se não existir ou for inválido, cria um novo state.json padrão.
 *
 * @returns {boolean} true se state.json é válido
 */
function validateStateFile() {
  try {
    if (!fs.existsSync(STATE_JSON)) {
      console.warn(`${YELLOW}⚠️  state.json não encontrado. Criando state.json padrão...${RESET}`);
      const defaultState = {
        current_state: 'idle',
        previous_state: null,
        last_transition: null,
        last_updated: new Date().toISOString(),
        attempts: { fase3_validation: 0, fase4_review: 0 },
        history: [],
        pipeline_version: '1.0',
        metadata: {}
      };
      fs.writeFileSync(STATE_JSON, `${JSON.stringify(defaultState, null, 2)}\n`);
      console.log(`${GREEN}✓ state.json criado com estado idle${RESET}`);
      return true;
    }
    const raw = fs.readFileSync(STATE_JSON, 'utf8');
    const parsed = safeJsonParse(raw, null);
    if (!parsed || !parsed.current_state) {
      console.warn(`${YELLOW}⚠️  state.json inválido ou sem current_state. Resetando...${RESET}`);
      const resetState = {
        current_state: 'idle',
        previous_state: null,
        last_transition: null,
        last_updated: new Date().toISOString(),
        attempts: { fase3_validation: 0, fase4_review: 0 },
        history: [],
        pipeline_version: '1.0',
        metadata: {}
      };
      fs.writeFileSync(STATE_JSON, `${JSON.stringify(resetState, null, 2)}\n`);
      return true;
    }
    return true;
  } catch (err) {
    console.error(`${RED}❌ state.json validation failed: ${err.message}${RESET}`);
    return false;
  }
}

/**
 * Tenta recuperar state.json corrompido.
 * NON-BLOCKING: se não conseguir recuperar, retorna estado idle.
 *
 * @returns {{ recovered: boolean, message: string, state: Object|null }}
 */
function recoverState() {
  try {
    // 1. Tenta ler state.json
    if (!fs.existsSync(STATE_JSON)) {
      var defaultState = {
        current_state: 'idle',
        previous_state: null,
        last_transition: null,
        last_updated: new Date().toISOString(),
        attempts: { fase3_validation: 0, fase4_review: 0 },
        history: [],
        pipeline_version: '1.0',
        metadata: {}
      };
      fs.writeFileSync(STATE_JSON, JSON.stringify(defaultState, null, 2) + '\n');
      console.log(`${YELLOW}⚠️  state.json não existia — criado novo com estado idle${RESET}`);
      return { recovered: true, message: 'state.json não existia — criado novo', state: defaultState };
    }

    // 2. Tenta fazer parse com safeJsonParse
    var raw = fs.readFileSync(STATE_JSON, 'utf8');
    var parsed = safeJsonParse(raw, null);

    if (parsed && parsed.current_state) {
      return { recovered: false, message: 'state.json já está válido', state: parsed };
    }

    // 3. JSON inválido — buscar último snapshot em snapshots/index.json
    console.warn(`${YELLOW}⚠️  state.json corrompido — tentando recuperar de snapshot...${RESET}`);

    var snapshotsIndex = path.join(BASE_DIR, 'snapshots', 'index.json');
    if (fs.existsSync(snapshotsIndex)) {
      try {
        var indexRaw = fs.readFileSync(snapshotsIndex, 'utf8');
        var index = safeJsonParse(indexRaw, null);
        if (index && Array.isArray(index) && index.length > 0) {
          var lastSnapshot = index[index.length - 1];
          if (lastSnapshot && lastSnapshot.dir) {
            var snapshotStateFile = path.join(lastSnapshot.dir, 'state.json');
            if (fs.existsSync(snapshotStateFile)) {
              var snapRaw = fs.readFileSync(snapshotStateFile, 'utf8');
              var snapState = safeJsonParse(snapRaw, null);
              if (snapState && snapState.current_state) {
                // 4. Restaura do snapshot
                fs.writeFileSync(STATE_JSON, JSON.stringify(snapState, null, 2) + '\n');
                console.log(`${GREEN}✓ state.json recuperado do snapshot: ${lastSnapshot.id}${RESET}`);
                return { recovered: true, message: 'Recuperado do snapshot: ' + lastSnapshot.id, state: snapState };
              }
            }
          }
        }
      } catch (snapErr) {
        console.warn(`${YELLOW}⚠️  Falha ao ler snapshot: ${snapErr.message}${RESET}`);
      }
    }

    // 5. Sem snapshot — criar novo state.json com estado idle
    console.warn(`${YELLOW}⚠️  Nenhum snapshot disponível — criando novo state.json com estado idle${RESET}`);
    var newState = {
      current_state: 'idle',
      previous_state: null,
      last_transition: null,
      last_updated: new Date().toISOString(),
      attempts: { fase3_validation: 0, fase4_review: 0 },
      history: [],
      pipeline_version: '1.0',
      metadata: {}
    };
    fs.writeFileSync(STATE_JSON, JSON.stringify(newState, null, 2) + '\n');
    // 6. Loga a recuperação
    console.log(`${YELLOW}⚠️  state.json recriado: idle (sem snapshot disponível)${RESET}`);
    return { recovered: true, message: 'state.json recriado com estado idle (sem snapshot)', state: newState };
  } catch (err) {
    console.warn(`${YELLOW}⚠️  recoverState falhou (NON-BLOCKING): ${err.message}${RESET}`);
    return { recovered: false, message: 'Falha no recovery: ' + err.message, state: null };
  }
}

/**
 * Valida se pipeline.yaml existe e tem conteúdo YAML parseável.
 *
 * @returns {boolean} true se pipeline.yaml é válido
 */
function validateYamlFile() {
  try {
    if (!fs.existsSync(PIPELINE_YAML)) {
      console.error(`${RED}❌ pipeline.yaml não encontrado em ${PIPELINE_YAML}${RESET}`);
      return false;
    }
    const raw = fs.readFileSync(PIPELINE_YAML, 'utf8');
    if (raw.trim().length === 0) {
      console.error(`${RED}❌ pipeline.yaml está vazio${RESET}`);
      return false;
    }
    // Verifica se tem pelo menos a seção states
    if (!raw.includes('states:') || !raw.includes('transitions:')) {
      console.error(`${RED}❌ pipeline.yaml não contém seções states e/ou transitions${RESET}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`${RED}❌ pipeline.yaml validation failed: ${err.message}${RESET}`);
    return false;
  }
}

// ─── State Machine Validation ─────────────────────────────────────────

/**
 * Retorna todas as transições válidas a partir de um estado.
 * @param {string} from
 * @param {Array<{from:string, to:string}>} transitions
 * @returns {Array<{from:string, to:string}>}
 */
function findValidTransitions(from, transitions) {
  return transitions.filter(t => t.from === from);
}

/**
 * Verifica se uma transição de from → to é válida.
 * @param {string} from
 * @param {string} to
 * @param {Array<{from:string, to:string}>} transitions
 * @returns {boolean}
 */
function isTransitionValid(from, to, transitions) {
  return transitions.some(t => t.from === from && t.to === to);
}

/**
 * Retorna o objeto de transição de from → to, ou null.
 * @param {string} from
 * @param {string} to
 * @param {Array<{from:string, to:string}>} transitions
 * @returns {Object|null}
 */
function findTransition(from, to, transitions) {
  return transitions.find(t => t.from === from && t.to === to) || null;
}

// ─── Persistência ─────────────────────────────────────────────────────

/**
 * Persiste state.json no disco (com file locking para concorrência).
 * @param {Object} state
 */
function saveState(state) {
  lockFile(STATE_JSON);
  try {
    fs.writeFileSync(STATE_JSON, `${JSON.stringify(state, null, 2)}\n`);
  } finally {
    unlockFile(STATE_JSON);
  }
}

/**
 * Atualiza state.json com nova transição.
 *
 * @param {string} from - Estado anterior
 * @param {string} to - Novo estado
 * @param {Object} [options] - Opções adicionais
 * @returns {Object} state atualizado
 */
function updateState(from, to, options) {
  const state = loadState();
  const timestamp = new Date().toISOString();

  state.previous_state = from;
  state.current_state = to;
  state.last_transition = `${from} → ${to}`;
  state.last_updated = timestamp;

  // History — append
  state.history.push({ from: from, to: to, timestamp: timestamp });

  // Attempts tracking para retries
  if (to === 'fase3_refuted' || to === 'fase4_changes_needed') {
    const attemptKey = to === 'fase3_refuted' ? 'fase3_validation' : 'fase4_review';
    if (!state.attempts) state.attempts = {};
    if (typeof state.attempts[attemptKey] !== 'number') state.attempts[attemptKey] = 0;
    state.attempts[attemptKey]++;
  }

  saveState(state);
  return state;
}

// ═══════════════════════════════════════════════════════════════════════
//  ENGINE — Pure State Machine Validation (merged from state-machine-engine.js)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Faz parse da seção states do YAML.
 * @param {string} yamlText
 * @returns {Array<{id:string, phase:string, description:string}>}
 */
function parseStatesSection(yamlText) {
  const lines = yamlText.split('\n');
  const states = [];
  let inStates = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('states:')) {
      inStates = true;
      continue;
    }

    if (inStates) {
      // Sai da seção states quando encontrar próxima seção top-level
      if (trimmed.startsWith('transitions:') || trimmed.startsWith('phases:') || (trimmed.length > 0 && !trimmed.startsWith('-') && !trimmed.startsWith('  '))) {
        if (trimmed.startsWith('transitions:') || trimmed.startsWith('phases:')) {
          break;
        }
      }

      if (trimmed.startsWith('- id:')) {
        const idMatch = trimmed.match(/- id:\s*"([^"]+)"\s*/);
        const stateId = idMatch ? idMatch[1] : '-';
        // Pula para pegar phase e description
        let phase = '';
        let description = '';
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j].trim();
          if (nextLine.startsWith('- id:')) break;
          if (nextLine.startsWith('phase:')) {
            phase = nextLine.replace('phase:', '').trim().replace(/"/g, '');
          }
          if (nextLine.startsWith('description:')) {
            description = nextLine.replace('description:', '').trim().replace(/"/g, '');
          }
          j++;
        }
        states.push({ id: stateId, phase, description });
      }
    }
  }
  return states;
}

/**
 * Faz parse da seção transitions do YAML.
 * @param {string} yamlText
 * @returns {Array<{from:string, to:string, trigger:string, action:string}>}
 */
function parseTransitionsSection(yamlText) {
  const lines = yamlText.split('\n');
  const transitions = [];
  let inTransitions = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('transitions:')) {
      inTransitions = true;
      continue;
    }

    if (inTransitions) {
      if (trimmed.startsWith('phases:') || (trimmed.length > 0 && !trimmed.startsWith('-') && !trimmed.startsWith('  '))) {
        if (trimmed.startsWith('phases:')) break;
      }

      if (trimmed.startsWith('- from:')) {
        const fromMatch = trimmed.match(/- from:\s*"([^"]+)"\s*/);
        const fromState = fromMatch ? fromMatch[1] : '';
        let to = '';
        let trigger = '';
        let action = '';
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j].trim();
          if (nextLine.startsWith('- from:')) break;
          if (nextLine.startsWith('to:')) {
            to = nextLine.replace('to:', '').trim().replace(/"/g, '');
          }
          if (nextLine.startsWith('trigger:')) {
            trigger = nextLine.replace('trigger:', '').trim().replace(/"/g, '');
          }
          if (nextLine.startsWith('action:')) {
            action = nextLine.replace('action:', '').trim().replace(/"/g, '');
          }
          j++;
        }
        transitions.push({ from: fromState, to, trigger, action });
      }
    }
  }
  return transitions;
}

/**
 * Parseia config principal do pipeline.
 * @param {string} yamlText
 * @returns {{name:string, version:string, startState:string, endStates:string[]}}
 */
function parsePipelineConfig(yamlText) {
  const result = { name: '', version: '', startState: '', endStates: [] };
  const lines = yamlText.split('\n');
  const endStateMatch = yamlText.match(/end_states:\s*\[([^\]]+)\]/);
  if (endStateMatch) {
    result.endStates = endStateMatch[1].split(',').map(s => s.trim().replace(/"/g, ''));
  }
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('name:')) result.name = t.replace('name:', '').trim().replace(/"/g, '');
    if (t.startsWith('start_state:')) result.startState = t.replace('start_state:', '').trim().replace(/"/g, '');
  }
  return result;
}

/**
 * Cria uma State Machine a partir de texto YAML.
 * @param {string} yamlText
 * @returns {Object} stateMachine object with methods
 */
function createFromYaml(yamlText) {
  if (!yamlText || typeof yamlText !== 'string') {
    throw new Error('yamlText must be a non-empty string');
  }
  const normalizedYaml = yamlText.replace(/\r\n/g, '\n');
  const pipelineConfig = parsePipelineConfig(normalizedYaml);
  const states = parseStatesSection(normalizedYaml);
  const allTransitions = parseTransitionsSection(normalizedYaml);

  const statesMap = new Map();
  for (const s of states) statesMap.set(s.id, s);

  const transitionsByFrom = new Map();
  const transitionsByTo = new Map();
  for (const t of allTransitions) {
    if (!transitionsByFrom.has(t.from)) transitionsByFrom.set(t.from, []);
    transitionsByFrom.get(t.from).push(t);
    if (!transitionsByTo.has(t.to)) transitionsByTo.set(t.to, []);
    transitionsByTo.get(t.to).push(t);
  }

  const sm = {
    name: pipelineConfig.name,
    version: pipelineConfig.version,
    startState: pipelineConfig.startState,
    endStates: pipelineConfig.endStates,
    states: statesMap,
    transitionsByFrom,
    transitionsByTo,
    allTransitions,

    getStates() { return Array.from(this.states.values()); },
    getState(stateId) { return this.states.get(stateId) || null; },
    hasState(stateId) { return this.states.has(stateId); },
    getPhase(stateId) { const s = this.states.get(stateId); return s ? s.phase : null; },

    getValidTransitions(fromState) {
      if (!this.states.has(fromState)) {
        return { valid: false, reason: `Estado '${fromState}' não existe`, transition: null, validTargets: [] };
      }
      const trans = this.transitionsByFrom.get(fromState) || [];
      if (trans.length === 0) {
        if (this.endStates.includes(fromState)) {
          return { valid: true, reason: `Estado '${fromState}' é terminal`, transition: null, validTargets: [] };
        }
        return { valid: true, reason: `Nenhuma transição de '${fromState}'`, transition: null, validTargets: [] };
      }
      return {
        valid: true,
        reason: `${trans.length} transição(ões) disponível(is)`,
        transition: trans.length === 1 ? trans[0] : null,
        validTargets: trans.map(t => ({ to: t.to, trigger: t.trigger }))
      };
    },

    canTransition(fromState, toState, opts) {
      opts = opts || {};
      if (!this.states.has(fromState)) {
        return { allowed: false, reason: `Estado '${fromState}' não existe` };
      }
      if (toState && !this.states.has(toState)) {
        return { allowed: false, reason: `Estado '${toState}' não existe` };
      }
      if (!toState) {
        const valid = this.getValidTransitions(fromState);
        return { allowed: valid.valid, reason: valid.reason, validTargets: valid.validTargets };
      }
      const transition = this.allTransitions.find(t => t.from === fromState && t.to === toState);
      if (!transition) {
        return { allowed: false, reason: `Transição '${fromState}' → '${toState}' não definida` };
      }
      // Validação de tentativas (retry)
      if (opts.attempts !== undefined && opts.maxAttempts !== undefined) {
        if (opts.attempts >= opts.maxAttempts) {
          return { allowed: false, reason: `Máx tentativas excedido (${opts.attempts}/${opts.maxAttempts})`, transition };
        }
      }
      return { allowed: true, reason: 'Transição permitida', transition };
    }
  };
  return sm;
}

/**
 * Carrega state machine de um arquivo YAML.
 * @param {string} [filePath]
 * @returns {Object} stateMachine object
 */
function loadFromFile(filePath) {
  if (!filePath) filePath = PIPELINE_YAML;
  if (!fs.existsSync(filePath)) throw new Error(`pipeline.yaml não encontrado em: ${filePath}`);
  const yamlText = fs.readFileSync(filePath, 'utf-8');
  return createFromYaml(yamlText);
}

/**
 * Valida integridade completa da state machine.
 * @param {Object} sm
 * @returns {{valid:boolean, issues:string[], warnings:string[]}}
 */
function validateIntegrity(sm) {
  const issues = [];
  const warnings = [];
  if (sm.startState && !sm.states.has(sm.startState)) issues.push(`start_state '${sm.startState}' não existe`);
  for (const endState of sm.endStates) {
    if (!sm.states.has(endState)) issues.push(`end_state '${endState}' não existe`);
  }
  for (const t of sm.allTransitions) {
    if (!sm.states.has(t.from)) issues.push(`Transição: from '${t.from}' não existe`);
    if (!sm.states.has(t.to)) issues.push(`Transição: to '${t.to}' não existe`);
  }
  for (const [stateId] of sm.states) {
    if (!sm.transitionsByFrom.has(stateId) && !sm.endStates.includes(stateId) && stateId !== sm.startState) {
      warnings.push(`Estado '${stateId}' não tem transições de saída e não é end state`);
    }
  }
  return { valid: issues.length === 0, issues, warnings };
}

module.exports = {
  // Paths (state-machine.js)
  getStatePath, getPipelinePath, getMetricsPath, getEventsLogPath, getObservabilityPath, getBaseDir,

  // File locking
  lockFile, unlockFile,

  // Utilitários
  loadJSON, safeJsonParse,

  // State loading
  loadState, loadPipeline, loadMetrics,

  // Recovery
  recoverState,

  // Validação de arquivos
  validateStateFile, validateYamlFile,

  // State machine (original)
  findValidTransitions, isTransitionValid, findTransition,

  // Persistência
  saveState, updateState,

  // ENGINE (merged from state-machine-engine.js)
  createFromYaml, loadFromFile, validateIntegrity,
  parseStatesSection, parseTransitionsSection, parsePipelineConfig,
};
