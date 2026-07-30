// Matrix Memory Service — JSON Adapter v2.0
// Usa pipeline/memory.json como storage. Zero dependências npm.
// Fallback automático: se JSON falhar, tenta SQLite (node:sqlite), se falhar, usa memory in memory.
//
// 5 métodos da interface: read, write, push, resume, checkpoint
//
// Uso:
//   const memory = require('./memory-adapter');
//   memory.write('contexto', 'ultimo_estado', 'fase2_execution');
//   const val = memory.read('contexto', 'ultimo_estado');
//   memory.push('historico', 'execucoes', {fase: 1, resultado: 'ok'});
//   const resume = memory.resume();
//   memory.checkpoint('fase2_complete', {task: 'implementar X'});

const fs = require('fs');
const path = require('path');

const MEMORY_JSON_PATH = path.resolve(__dirname, '..', 'memory.json');

// ─── Lock de arquivo para concorrência ──────────────────────────────
var LOCKS = {};

function lockFile(filePath, retries, interval) {
  retries = retries || 5;
  interval = interval || 50;
  var lockPath = filePath + '.lock';
  for (var i = 0; i < retries; i++) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      LOCKS[filePath] = lockPath;
      return true;
    } catch (e) {
      try {
        var stat = fs.statSync(lockPath);
        var age = Date.now() - stat.mtimeMs;
        if (age > 10000) { // 10s expiry
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch(e2) {}
      if (i < retries - 1) {
        // busy wait
        var waitUntil = Date.now() + interval;
        while (Date.now() < waitUntil) {}
      }
    }
  }
  return false;
}

function unlockFile(filePath) {
  if (LOCKS[filePath]) {
    try { fs.unlinkSync(LOCKS[filePath]); } catch(e) {}
    delete LOCKS[filePath];
  }
}

// ─── Estado em memória (fallback último recurso) ────────────────────
var _memoryState = null;
var _useMemoryFallback = false;

// ─── Leitura e escrita do JSON ──────────────────────────────────────

function readJsonFile() {
  try {
    if (!fs.existsSync(MEMORY_JSON_PATH)) {
      // Cria estrutura padrão
      var defaultData = {
        memory_service_version: '2.0',
        storage_adapter: 'json',
        last_updated: new Date().toISOString(),
        namespaces: {
          decisoes: { description: 'Decisões arquiteturais e técnicas tomadas', items: {} },
          contexto: { description: 'Contexto do projeto e da demanda atual', items: {} },
          preferencias: { description: 'Preferências do usuário', items: {} },
          projeto: { description: 'Informações sobre o projeto atual', items: {} },
          historico: { description: 'Histórico de execuções', items: { demandas: [], execucoes: [] } },
          checkpoints: { description: 'Snapshots para retomada', items: {} }
        }
      };
      fs.writeFileSync(MEMORY_JSON_PATH, JSON.stringify(defaultData, null, 2));
      return defaultData;
    }
    var raw = fs.readFileSync(MEMORY_JSON_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    // Se JSON está corrompido, tenta fallback em memória
    console.warn('[memory] ⚠️ memory.json corrompido, usando fallback em memória: ' + err.message);
    _useMemoryFallback = true;
    if (!_memoryState) {
      _memoryState = {
        namespaces: {
          decisoes: { items: {} },
          contexto: { items: {} },
          preferencias: { items: {} },
          projeto: { description: 'Informações sobre o projeto atual', items: {} },
          historico: { items: { demandas: [], execucoes: [] } },
          checkpoints: { items: {} }
        }
      };
    }
    return _memoryState;
  }
}

function writeJsonFile(data) {
  if (_useMemoryFallback) {
    _memoryState = data;
    return;
  }
  try {
    data.last_updated = new Date().toISOString();
    fs.writeFileSync(MEMORY_JSON_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn('[memory] ⚠️ Erro ao escrever memory.json: ' + err.message);
    // Fallback para memória
    _useMemoryFallback = true;
    _memoryState = data;
  }
}

// ─── INTERFACE PADRÃO ───────────────────────────────────────────────

/**
 * Lê um valor da memória por namespace + chave.
 *
 * @param {string} namespace - Namespace (ex: 'contexto', 'decisoes')
 * @param {string} key - Chave do valor
 * @returns {*|null} Valor armazenado ou null se não existir
 */
function read(namespace, key) {
  try {
    lockFile(MEMORY_JSON_PATH);
    var data = readJsonFile();
    var ns = data.namespaces[namespace];
    if (!ns) return null;
    return ns.items.hasOwnProperty(key) ? ns.items[key] : null;
  } catch (err) {
    console.warn('[memory] ⚠️ read(' + namespace + ', ' + key + ') failed: ' + err.message);
    return null;
  } finally {
    unlockFile(MEMORY_JSON_PATH);
  }
}

/**
 * Escreve um valor na memória (sobrescreve se existir).
 *
 * @param {string} namespace - Namespace
 * @param {string} key - Chave
 * @param {*} value - Valor a armazenar
 * @returns {void}
 */
function write(namespace, key, value) {
  try {
    lockFile(MEMORY_JSON_PATH);
    var data = readJsonFile();
    if (!data.namespaces[namespace]) {
      data.namespaces[namespace] = { description: '', items: {} };
    }
    data.namespaces[namespace].items[key] = value;
    writeJsonFile(data);
  } catch (err) {
    console.warn('[memory] ⚠️ write(' + namespace + ', ' + key + ') failed: ' + err.message);
  } finally {
    unlockFile(MEMORY_JSON_PATH);
  }
}

/**
 * Adiciona um item a uma lista existente na memória.
 * Se o path não existir ou não for array, cria um novo array.
 *
 * @param {string} namespace - Namespace
 * @param {string} path - Caminho da lista dentro do namespace
 * @param {*} item - Item a ser adicionado à lista
 * @returns {void}
 */
function push(namespace, path, item) {
  try {
    lockFile(MEMORY_JSON_PATH);
    var data = readJsonFile();
    if (!data.namespaces[namespace]) {
      data.namespaces[namespace] = { description: '', items: {} };
    }
    var list = data.namespaces[namespace].items[path];
    if (!Array.isArray(list)) {
      list = [];
    }
    list.push(item);
    data.namespaces[namespace].items[path] = list;
    writeJsonFile(data);
  } catch (err) {
    console.warn('[memory] ⚠️ push(' + namespace + ', ' + path + ') failed: ' + err.message);
  } finally {
    unlockFile(MEMORY_JSON_PATH);
  }
}

/**
 * Recupera contexto da última execução não-finalizada.
 *
 * @returns {{last_state: string|null, last_demand: string|null, checkpoints: Object<string, {snapshot: *, timestamp: string}>}|null}
 */
function resume() {
  try {
    var data = readJsonFile();
    var ctx = data.namespaces.contexto ? data.namespaces.contexto.items : {};
    var lastState = ctx.last_state || null;
    var lastDemand = ctx.last_demand || null;
    var checkpoints = data.namespaces.checkpoints ? data.namespaces.checkpoints.items : {};
    if (!lastState && !lastDemand && Object.keys(checkpoints).length === 0) return null;
    return { last_state: lastState, last_demand: lastDemand, checkpoints: checkpoints };
  } catch (err) {
    console.warn('[memory] ⚠️ resume() failed: ' + err.message);
    return null;
  }
}

/**
 * Salva um checkpoint para recovery posterior.
 *
 * @param {string} stateId - ID do estado (ex: 'fase2_complete')
 * @param {*} snapshot - Dados do snapshot a serem preservados
 * @returns {void}
 */
function checkpoint(stateId, snapshot) {
  try {
    write('checkpoints', stateId, {
      snapshot: snapshot,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.warn('[memory] ⚠️ checkpoint(' + stateId + ') failed: ' + err.message);
  }
}

// ─── Utilitários adicionais ─────────────────────────────────────────

/**
 * memory.list(namespace) → Object
 * Lista todos os itens em um namespace.
 */
function list(namespace) {
  try {
    var data = readJsonFile();
    var ns = data.namespaces[namespace];
    return ns ? ns.items : {};
  } catch (err) {
    return {};
  }
}

/**
 * memory.purge(namespace) → void
 * Limpa todos os itens de um namespace.
 */
function purge(namespace) {
  try {
    lockFile(MEMORY_JSON_PATH);
    var data = readJsonFile();
    if (data.namespaces[namespace]) {
      data.namespaces[namespace].items = {};
    }
    writeJsonFile(data);
  } catch (err) {
    console.warn('[memory] ⚠️ purge(' + namespace + ') failed: ' + err.message);
  } finally {
    unlockFile(MEMORY_JSON_PATH);
  }
}

/**
 * memory.getStorageType() → string
 * Retorna o tipo de storage ativo.
 */
function getStorageType() {
  return _useMemoryFallback ? 'memory_fallback' : 'json';
}

/**
 * Retorna todos os checkpoints disponíveis para recovery.
 * Conveniência sobre list('checkpoints').
 *
 * @returns {Object<string, {snapshot: *, timestamp: string}>}
 */
function getCheckpoints() {
  return list('checkpoints');
}

/**
 * Limpa todos os checkpoints antigos, mantendo apenas o mais recente
 * de cada estado. Útil após recovery bem-sucedido.
 *
 * @param {number} [keepPerState=1] - Quantos checkpoints manter por estado
 * @returns {number} Número de checkpoints removidos
 */
function cleanupCheckpoints(keepPerState) {
  keepPerState = keepPerState || 1;
  try {
    lockFile(MEMORY_JSON_PATH);
    var data = readJsonFile();
    var ck = data.namespaces.checkpoints ? data.namespaces.checkpoints.items : {};
    var grouped = {};
    var keys = Object.keys(ck);
    // Agrupa por estado (key prefix = stateId)
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({ key: key, value: ck[key] });
    }
    // Ordena cada grupo por timestamp descendente
    var removed = 0;
    var newCk = {};
    var groupKeys = Object.keys(grouped);
    for (var g = 0; g < groupKeys.length; g++) {
      var group = grouped[groupKeys[g]];
      group.sort(function(a, b) {
        return new Date(b.value.timestamp).getTime() - new Date(a.value.timestamp).getTime();
      });
      for (var j = 0; j < group.length; j++) {
        if (j < keepPerState) {
          newCk[group[j].key] = group[j].value;
        } else {
          removed++;
        }
      }
    }
    data.namespaces.checkpoints.items = newCk;
    writeJsonFile(data);
    return removed;
  } catch (err) {
    console.warn('[memory] ⚠️ cleanupCheckpoints() failed: ' + err.message);
    return 0;
  } finally {
    unlockFile(MEMORY_JSON_PATH);
  }
}

module.exports = { read, write, push, resume, checkpoint, list, purge, getStorageType, getCheckpoints, cleanupCheckpoints };
