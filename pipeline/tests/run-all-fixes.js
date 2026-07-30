#!/usr/bin/env node
/**
 * Matrix Test Runner — Correções (Fixes)
 *
 * Executa todos os testes de verificação de correções do pipeline Matrix.
 * Cada teste é executado sequencialmente e o resultado agregado é reportado.
 *
 * Testes incluídos:
 *   1. test-fix-rbac.js        — RBAC auto-registro de pipeline-default
 *   2. test-fix-stash.js       — Git stash NÃO reverte alterações não commitadas
 *   3. test-fix-model-voting.js — Model voting não crasha sem API
 *
 * Uso:
 *   node run-all-fixes.js
 *
 * Exit code: 0 se TODOS passarem, 1 se algum falhar
 *
 * Zero dependências npm — apenas módulos nativos do Node.js.
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ─── Colors ───────────────────────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const BG_RED = '\x1b[41m';
const BG_GREEN = '\x1b[42m';

// ─── Paths ────────────────────────────────────────────────────────────────
const TESTS_DIR = __dirname;

// Lista de testes de correção a executar (em ordem)
const TEST_FILES = [
  'test-fix-rbac.js',
  'test-fix-stash.js',
  'test-fix-model-voting.js'
];

// ─── Colors para status ───────────────────────────────────────────────────
const PASS_ICON = `${GREEN}✅${RESET}`;
const FAIL_ICON = `${RED}❌${RESET}`;
const SKIP_ICON = `${YELLOW}⚠️${RESET}`;

/**
 * Executa um arquivo de teste via child_process.
 * Captura stdout e stderr.
 *
 * @param {string} testFile - Nome do arquivo de teste
 * @returns {{ passed: boolean, skipped: boolean, exitCode: number, output: string }}
 */
function runTest(testFile) {
  const filePath = path.join(TESTS_DIR, testFile);

  if (!fs.existsSync(filePath)) {
    console.log(`\n${YELLOW}⚠️  ${testFile} não encontrado, pulando.${RESET}\n`);
    return { passed: false, skipped: true, exitCode: null, output: '' };
  }

  console.log(`\n${CYAN}${BOLD}════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}  🧪 ${testFile}${RESET}`);
  console.log(`${CYAN}${BOLD}════════════════════════════════════════════════════════════${RESET}`);
  console.log('');

  try {
    const output = execSync(`node "${filePath}"`, {
      encoding: 'utf-8',
      timeout: 60000,  // 60s para testes que fazem chamadas async
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: TESTS_DIR,
      maxBuffer: 10 * 1024 * 1024  // 10MB
    });

    // Se chegou aqui sem exceção, exit foi 0
    // Mostra a saída do teste
    console.log(output);

    return { passed: true, skipped: false, exitCode: 0, output };

  } catch (err) {
    // Teste retornou exit code != 0 ou timeout
    const output = err.stdout || '';
    const stderr = err.stderr || '';

    // Mostra a saída mesmo em caso de falha
    if (output) console.log(output);
    if (stderr) {
      // stderr pode conter warnings que não são erros
      const lines = stderr.split('\n').filter(l => l.trim());
      for (const line of lines) {
        // Ignora warnings de depreciação do Node.js
        if (line.includes('DeprecationWarning') || line.includes('ExperimentalWarning')) continue;
        // Ignora erros de pipeline-executor que são esperados
        if (line.includes('NON-BLOCKING') || line.includes('falhou')) {
          console.log(`  ${YELLOW}⚠${RESET} ${line.trim()}`);
          continue;
        }
        console.error(`  ${RED}${line.trim()}${RESET}`);
      }
    }

    // Determina se foi timeout vs erro real
    if (err.killed || err.signal === 'SIGTERM') {
      console.log(`\n  ${YELLOW}⚠️  Teste excedeu timeout de 60s${RESET}\n`);
    }

    return { passed: false, skipped: false, exitCode: err.status, output };
  }
}

/**
 * Formata um separador visual.
 */
function separator(char, length) {
  return char.repeat(length || 60);
}

// ─── Main ─────────────────────────────────────────────────────────────────

console.log('');
console.log(`${BOLD}${CYAN}╔════════════════════════════════════════════════════════════╗${RESET}`);
console.log(`${BOLD}${CYAN}║     Matrix Pipeline — Testes de Correção (Fixes)           ║${RESET}`);
console.log(`${BOLD}${CYAN}╚════════════════════════════════════════════════════════════╝${RESET}`);
console.log('');
console.log(`  ${BOLD}Data:${RESET} ${new Date().toISOString()}`);
console.log(`  ${BOLD}Node:${RESET} ${process.version}`);
console.log(`  ${BOLD}Tests:${RESET} ${TEST_FILES.length} arquivos de teste`);
console.log('');

const results = [];
let totalPassed = 0;
let totalFailed = 0;
let totalSkipped = 0;

// Executa cada teste sequencialmente
for (const testFile of TEST_FILES) {
  const result = runTest(testFile);
  results.push({ file: testFile, ...result });

  if (result.skipped) {
    totalSkipped++;
  } else if (result.passed) {
    totalPassed++;
  } else {
    totalFailed++;
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('');
console.log(`${BOLD}${CYAN}════════════════════════════════════════════════════════════${RESET}`);
console.log(`${BOLD}           RESUMO — Testes de Correção${RESET}`);
console.log(`${CYAN}════════════════════════════════════════════════════════════${RESET}`);
console.log('');

for (const r of results) {
  let status;
  if (r.skipped) {
    status = `${SKIP_ICON} SKIPPED`;
  } else if (r.passed) {
    status = `${PASS_ICON} PASS`;
  } else {
    status = `${FAIL_ICON} FAIL (exit code: ${r.exitCode})`;
  }
  console.log(`  ${status} — ${r.file}`);
}

console.log('');
const total = totalPassed + totalFailed;
const overallColor = totalFailed === 0 ? GREEN : RED;
const overallBg = totalFailed === 0 ? `${BG_GREEN}${BOLD}` : `${BG_RED}${BOLD}`;

console.log(`  ${overallBg}${' '.repeat(48)}${RESET}`);
if (totalFailed === 0 && totalSkipped === 0) {
  console.log(`  ${overallBg}  ${GREEN}✅ TODOS OS ${total} TESTES PASSARAM${' '.repeat(21)}${RESET}`);
} else if (totalFailed === 0 && totalSkipped > 0) {
  console.log(`  ${overallBg}  ${GREEN}✅ ${totalPassed}/${total + totalSkipped} passaram, ${totalSkipped} pulados${' '.repeat(12)}${RESET}`);
} else {
  console.log(`  ${overallBg}  ${RED}❌ ${totalPassed}/${total} passaram, ${totalFailed} falharam${' '.repeat(18)}${RESET}`);
}
console.log(`  ${overallBg}${' '.repeat(48)}${RESET}`);
console.log('');

// Fix descriptions
console.log(`${BOLD}Correções validadas:${RESET}`);
console.log('');
const fixDescriptions = [
  ['RBAC auto-registro',   'pipeline-default é registrado como admin automaticamente',         results[0]?.passed ? '✓' : (results[0]?.skipped ? '⚠' : '✗')],
  ['Anti-stash',           'Alterações não commitadas sobrevivem a transições',                results[1]?.passed ? '✓' : (results[1]?.skipped ? '⚠' : '✗')],
  ['Model voting sem API', 'Model voting não crasha quando Matrix_API_URL não está definido',   results[2]?.passed ? '✓' : (results[2]?.skipped ? '⚠' : '✗')]
];

for (const [fix, desc, status] of fixDescriptions) {
  const color = status === '✓' ? GREEN : (status === '⚠' ? YELLOW : RED);
  console.log(`  ${color}${status}${RESET} ${BOLD}${fix}${RESET}: ${desc}`);
}

console.log('');

process.exit(totalFailed > 0 ? 1 : 0);
