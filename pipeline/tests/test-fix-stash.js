#!/usr/bin/env node
/**
 * Test: git stash NÃO reverte alterações não commitadas (FIX)
 *
 * Valida que o pipeline-executor, ao executar transições, não faz git stash
 * (nem nenhuma operação que descarte alterações não commitadas).
 *
 * O rollback-manager.js foi corrigido para NÃO fazer stash — apenas avisar.
 * Este teste verifica que um arquivo temporário não commitado sobrevive
 * a uma transição de pipeline.
 *
 * Cenário:
 *   1. Cria arquivo temporário NÃO commitado (.fix-stash-test-*)
 *   2. Executa uma transição de estado no pipeline
 *   3. Verifica que o arquivo temporário ainda existe
 *   4. Remove arquivo temporário e restaura state.json
 *
 * Exit code: 0 (pass) | 1 (fail)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Paths ────────────────────────────────────────────────────────────────
const PIPELINE_DIR = path.resolve(__dirname, '..');
const SCRIPTS_DIR = path.join(PIPELINE_DIR, 'scripts');
const STATE_JSON = path.join(PIPELINE_DIR, 'state.json');
const STATE_BAK = STATE_JSON + '.stash-test-bak';

// ─── Colors ───────────────────────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// ─── Test framework ───────────────────────────────────────────────────────
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ${GREEN}✅ ${name}${RESET}`);
    testsPassed++;
  } catch (err) {
    console.log(`  ${RED}❌ ${name}: ${err.message}${RESET}`);
    testsFailed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Obtém um nome de arquivo temporário único dentro do pipeline dir.
 * Usa timestamp + random para evitar colisões.
 */
function getTempFileName() {
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 100000);
  return path.join(PIPELINE_DIR, `.fix-stash-test-${ts}-${rand}.tmp`);
}

/**
 * Cria um arquivo temporário não commitado e retorna seu caminho.
 */
function createTempFile() {
  const filePath = getTempFileName();
  const content = `stash-test-file-${Date.now()}\n`;
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

/**
 * Verifica se um arquivo existe.
 */
function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Remove arquivo temporário.
 */
function removeTempFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    // NON-BLOCKING
  }
}

/**
 * Backup do state.json.
 */
function backupState() {
  if (fs.existsSync(STATE_JSON)) {
    fs.copyFileSync(STATE_JSON, STATE_BAK);
  }
}

/**
 * Restaura state.json do backup.
 */
function restoreState() {
  if (fs.existsSync(STATE_BAK)) {
    fs.copyFileSync(STATE_BAK, STATE_JSON);
    fs.unlinkSync(STATE_BAK);
  }
}

/**
 * Lê o state.json para saber o estado atual.
 */
function getCurrentState() {
  try {
    const raw = fs.readFileSync(STATE_JSON, 'utf8');
    return JSON.parse(raw).current_state;
  } catch (err) {
    return null;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

console.log('');
console.log(`${CYAN}${BOLD}════════════════════════════════════════════════════════════${RESET}`);
console.log(`${CYAN}${BOLD}  🧪 Test: git stash NÃO reverte alterações não commitadas${RESET}`);
console.log(`${CYAN}${BOLD}════════════════════════════════════════════════════════════${RESET}`);
console.log('');

// Backup
console.log(`  ${BOLD}📦 Backup do state.json...${RESET}`);
backupState();
console.log(`  ${GREEN}✓${RESET} Backup criado`);

// Variáveis globais para cleanup
let tempFilePath = null;
let executor = null;
let exitCode = 0;

try {
  // ── Load pipeline executor ──────────────────────────────────────────────
  console.log(`\n  ${BOLD}📦 Carregando pipeline-executor...${RESET}`);
  const executorPath = path.join(SCRIPTS_DIR, 'pipeline-executor.js');
  delete require.cache[executorPath];
  executor = require(executorPath);
  console.log(`  ${GREEN}✓${RESET} Pipeline executor carregado`);

  // ── Determinar estado atual para transição idempotente ──────────────────
  const currentState = getCurrentState();
  console.log(`\n  ${BOLD}📖 Estado atual:${RESET} ${currentState || 'desconhecido'}`);

  if (!currentState) {
    console.log(`  ${YELLOW}⚠${RESET} state.json não encontrado ou inválido`);
    console.log(`  ${YELLOW}⚠${RESET} Criando estado idle para teste...`);

    // Cria state.json com estado idle
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
    fs.writeFileSync(STATE_JSON, JSON.stringify(defaultState, null, 2) + '\n');

    // Recarregar executor após criar state
    delete require.cache[executorPath];
    executor = require(executorPath);
  }

  // ═════════════════════════════════════════════════════════════════════
  //  TEST 1: Criar arquivo temporário não commitado
  // ═════════════════════════════════════════════════════════════════════
  test('criação de arquivo temporário não commitado', () => {
    tempFilePath = createTempFile();
    console.log(`\n     📄 Arquivo: ${tempFilePath}`);
    assert(fileExists(tempFilePath), 'arquivo temporário deve existir');
  });

  // ═════════════════════════════════════════════════════════════════════
  //  TEST 2: Executar transição (idempotente — mesmo estado)
  // ═════════════════════════════════════════════════════════════════════
  const stateAfterCreation = getCurrentState();
  test(`transição idempotente: ${stateAfterCreation} → ${stateAfterCreation}`, () => {
    const result = executor.transition(stateAfterCreation, {
      agent: 'stash-test',
      tool: 'test',
      durationMs: 1
    });

    // A transição pode ser skipped (idempotent) ou success
    assert(result.success, `transição deve ser bem-sucedida: ${result.error || ''}`);
    console.log(`     ${result.skipped ? '⚠ skipped (idempotent)' : '✓ concluída'}`);
  });

  // ═════════════════════════════════════════════════════════════════════
  //  TEST 3: Arquivo temporário SOBREVIVEU à transição (ANTI-STASH)
  // ═════════════════════════════════════════════════════════════════════
  test('arquivo temporário sobreviveu à transição (anti-stash)', () => {
    assert(fileExists(tempFilePath), `arquivo temporário ${tempFilePath} deve existir após transição`);
  });

  // ═════════════════════════════════════════════════════════════════════
  //  TEST 4: Verificar git status — arquivo ainda aparece como untracked
  // ═════════════════════════════════════════════════════════════════════
  test('git status: arquivo temporário ainda aparece como untracked', () => {
    const { execSync } = require('child_process');
    const gitOutput = execSync('git status --porcelain', {
      encoding: 'utf-8',
      cwd: PIPELINE_DIR,
      timeout: 10000
    });

    // Verifica se o arquivo temporário aparece no git status
    const relPath = path.relative(PIPELINE_DIR, tempFilePath).replace(/\\/g, '/');
    const lines = gitOutput.split('\n').filter(l => l.includes(relPath));
    assert(lines.length > 0, `git status deve mostrar o arquivo temporário (${relPath})`);
  });

  // ═════════════════════════════════════════════════════════════════════
  //  SUMMARY
  // ═════════════════════════════════════════════════════════════════════
  const total = testsPassed + testsFailed;
  console.log('');
  console.log(`${BOLD}${CYAN}────────────────────────────────────────────────────────────${RESET}`);
  const color = testsFailed === 0 ? GREEN : RED;
  console.log(`  ${color}${BOLD}${testsPassed}/${total} testes passaram, ${testsFailed} falharam${RESET}`);
  console.log('');

  if (testsFailed > 0) {
    exitCode = 1;
  }

} catch (err) {
  console.error(`\n  ${RED}❌ Erro fatal: ${err.message}${RESET}`);
  console.error(err.stack);
  exitCode = 1;
} finally {
  // ── Cleanup ─────────────────────────────────────────────────────────────
  console.log(`  ${BOLD}🧹 Limpeza...${RESET}`);

  if (tempFilePath) {
    removeTempFile(tempFilePath);
    console.log(`  ${GREEN}✓${RESET} Arquivo temporário removido`);
  }

  restoreState();
  console.log(`  ${GREEN}✓${RESET} state.json restaurado`);

  console.log('');
  console.log(`${BOLD}Resultado:${RESET} ${exitCode === 0 ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`}`);
  console.log('');
}

process.exit(exitCode);
