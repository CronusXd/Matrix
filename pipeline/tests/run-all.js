#!/usr/bin/env node
/**
 * Matrix Test Suite Runner
 * Executa todos os testes unitários sequencialmente e reporta resultado agregado.
 *
 * Uso: node run-all.js
 * Exit code: 0 se TODOS passarem, 1 se algum falhar
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const TESTS_DIR = __dirname;

// Lista de arquivos de teste a executar (em ordem)
const TEST_FILES = [
  'test-libs.js',
  'test-memory-adapter.js',
  'test-context-cache.js',
  'test-sandbox-run.js',
  'test-rag-index.js',
  'test-rag-query.js',
  'test-validate-pipeline.js',
  'test-pipeline-executor.js',
  'test-pipeline-integration.js',
  'test-cache-distributed.js',
  'test-cost-monitor.js',
  'test-schema-drift.js',
  'test-agent-router.js',
  'test-pr-generator.js',
  'test-new-modules-integration.js',
  'test-state-machine-full.js',
  // ─── Novos testes (Fase 2) ──────────────────────────────────────
  'test-security-enforcer.js',
  'test-self-healing-service.js',
  'test-release-pipeline.js'
];

function runTest(testFile) {
  const filePath = path.join(TESTS_DIR, testFile);

  if (!fs.existsSync(filePath)) {
    console.log(`\n${YELLOW}⚠️  ${testFile} não encontrado, pulando.${RESET}\n`);
    return { passed: false, skipped: true };
  }

  console.log(`${CYAN}${BOLD}════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}${BOLD}  🧪 ${testFile}${RESET}`);
  console.log(`${CYAN}${BOLD}════════════════════════════════════════════════════════════${RESET}`);

  try {
    const output = execSync(`node "${filePath}"`, {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    // O teste pode ter exit 0 (passou) ou exit 1 (falhou)
    // Se chegou aqui sem exceção, exit foi 0
    // Mas o output pode conter falhas
    const lines = output.split('\n');
    const resultLine = lines.find(l => l.includes('Resultado:'));
    console.log(output);
    return { passed: true, exitCode: 0 };
  } catch (err) {
    // Teste retornou exit code != 0
    const output = err.stdout || '';
    const stderr = err.stderr || '';
    console.log(output);
    if (stderr) console.log(stderr);
    return { passed: false, exitCode: err.status };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────
console.log('');
console.log(`${BOLD}${CYAN}╔════════════════════════════════════════════════════════════╗${RESET}`);
console.log(`${BOLD}${CYAN}║       Matrix Pipeline — Suite de Testes Unitários         ║${RESET}`);
console.log(`${BOLD}${CYAN}╚════════════════════════════════════════════════════════════╝${RESET}`);
console.log('');

const results = [];
let totalPassed = 0;
let totalFailed = 0;
let totalSkipped = 0;

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

// ─── Summary ──────────────────────────────────────────────────────────
console.log('');
console.log(`${BOLD}${CYAN}════════════════════════════════════════════════════════════${RESET}`);
console.log(`${BOLD}           RESUMO GERAL${RESET}`);
console.log(`${CYAN}════════════════════════════════════════════════════════════${RESET}`);
console.log('');

for (const r of results) {
  const status = r.skipped
    ? `${YELLOW}⚠️  SKIPPED${RESET}`
    : r.passed
      ? `${GREEN}✅ PASS${RESET}`
      : `${RED}❌ FAIL${RESET}`;
  console.log(`  ${status} — ${r.file}`);
}

console.log('');
const total = totalPassed + totalFailed;
const color = totalFailed === 0 ? GREEN : RED;
console.log(`${color}${BOLD}  ${totalPassed}/${total + totalSkipped} testes passaram, ${totalFailed} falharam, ${totalSkipped} pulados${RESET}`);
console.log('');

process.exit(totalFailed > 0 ? 1 : 0);
