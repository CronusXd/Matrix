#!/usr/bin/env node
/**
 * Matrix Memory Operations Module v1.0
 * Wrapper sobre memory-adapter.js para operações de memória.
 *
 * Pure Node.js — zero npm dependencies.
 * CommonJS module format.
 *
 * Uso:
 *   const mem = require('./memory-operations');
 *   mem.memoryCheckpoint('fase2_complete', { from: 'fase2_execution', to: 'fase2_complete' });
 *   mem.memoryWrite('contexto', 'last_state', 'fase2_complete');
 *   const val = mem.memoryRead('contexto', 'last_state');
 */

const path = require('path');

// ─── Cores para Terminal ──────────────────────────────────────────────
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

// ─── Import de funções de state-machine ───────────────────────────────
const { getBaseDir } = require('./state-machine');

/**
 * Wrapper: carrega o memory-adapter com fallback.
 * NON-BLOCKING: se falhar, retorna null.
 * @returns {Object|null}
 */
function _loadMemory() {
  try {
    return require('./memory-adapter');
  } catch (err) {
    return null;
  }
}

/**
 * Chama memory.checkpoint() com o snapshot da transição.
 * NON-BLOCKING: se falhar (ex: SQLite não disponível), loga warning e continua.
 *
 * @param {string} stateId - ID do estado atual
 * @param {Object} meta - Metadados do checkpoint
 * @returns {boolean} true se checkpoint foi salvo, false se falhou
 */
function memoryCheckpoint(stateId, meta) {
  try {
    const memory = _loadMemory();
    if (!memory || typeof memory.checkpoint !== 'function') {
      console.warn(`${YELLOW}⚠️  memory-adapter.checkpoint não disponível (NON-BLOCKING)${RESET}`);
      return false;
    }
    memory.checkpoint(stateId, meta);
    return true;
  } catch (err) {
    console.warn(`${YELLOW}⚠️  memory.checkpoint(${stateId}) falhou (NON-BLOCKING): ${err.message}${RESET}`);
    return false;
  }
}

/**
 * Lê um valor da memória do pipeline.
 * NON-BLOCKING: se falhar, retorna null.
 *
 * @param {string} namespace - Namespace (ex: 'contexto', 'decisoes')
 * @param {string} key - Chave do valor
 * @returns {*} Valor armazenado ou null
 */
function memoryRead(namespace, key) {
  try {
    const memory = _loadMemory();
    if (!memory || typeof memory.read !== 'function') return null;
    return memory.read(namespace, key);
  } catch (err) {
    return null;
  }
}

/**
 * Escreve um valor na memória do pipeline.
 * NON-BLOCKING: se falhar, loga warning e continua.
 *
 * @param {string} namespace - Namespace (ex: 'contexto')
 * @param {string} key - Chave do valor
 * @param {*} value - Valor a armazenar
 * @returns {boolean} true se escrita foi bem-sucedida
 */
function memoryWrite(namespace, key, value) {
  try {
    const memory = _loadMemory();
    if (!memory || typeof memory.write !== 'function') return false;
    memory.write(namespace, key, value);
    return true;
  } catch (err) {
    console.warn(`${YELLOW}⚠️  memory.write(${namespace}, ${key}) falhou (NON-BLOCKING): ${err.message}${RESET}`);
    return false;
  }
}

/**
 * Adiciona um item a uma lista na memória.
 * NON-BLOCKING: se falhar, loga warning e continua.
 *
 * @param {string} namespace - Namespace (ex: 'historico')
 * @param {string} key - Chave da lista
 * @param {*} item - Item a adicionar
 * @returns {boolean} true se push foi bem-sucedido
 */
function memoryPush(namespace, key, item) {
  try {
    const memory = _loadMemory();
    if (!memory || typeof memory.push !== 'function') return false;
    memory.push(namespace, key, item);
    return true;
  } catch (err) {
    console.warn(`${YELLOW}⚠️  memory.push(${namespace}, ${key}) falhou (NON-BLOCKING): ${err.message}${RESET}`);
    return false;
  }
}

/**
 * Lê o contexto de retomada (resume) da memória.
 * NON-BLOCKING: se falhar, retorna null.
 *
 * @returns {Object|null} Contexto de retomada ou null
 */
function memoryResume() {
  try {
    const memory = _loadMemory();
    if (!memory || typeof memory.resume !== 'function') return null;
    return memory.resume();
  } catch (err) {
    return null;
  }
}

module.exports = {
  memoryCheckpoint,
  memoryRead,
  memoryWrite,
  memoryPush,
  memoryResume,
};
