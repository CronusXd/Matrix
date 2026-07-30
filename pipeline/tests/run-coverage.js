#!/usr/bin/env node
/**
 * Coverage Runner — usa require() direto para nyc instrumentar
 *
 * Em vez de execSync(), este runner carrega cada módulo de teste
 * diretamente via require(), permitindo que o nyc instrumente o código.
 *
 * Para lidar com testes que chamam process.exit(), sobrescrevemos
 * temporariamente a função.
 */

'use strict';

var path = require('path');
var TESTS_DIR = __dirname;

// ─── Override process.exit para não matar nyc ──────────────────────
var originalExit = process.exit;
var shouldExit = false;
var exitCode = 0;

process.exit = function(code) {
  exitCode = code || 0;
  shouldExit = true;
  // Não mata o processo — deixa o runner continuar
};

// ─── Lista de testes a executar ────────────────────────────────────
var tests = [
  // Testes existentes (compatíveis com require direto)
  'test-libs',
  'test-memory-adapter',
  'test-context-cache',
  'test-sandbox-run',
  'test-rag-index',
  'test-rag-query',
  'test-validate-pipeline',
  'test-pipeline-executor',
  'test-pipeline-integration',
  'test-cache-distributed',
  'test-cost-monitor',
  'test-schema-drift',
  'test-agent-router',
  'test-pr-generator',
  'test-new-modules-integration',

  // Testes adicionais (previnem execução automática)
  'test-ci-run',

  // Teste de cobertura massivo (TODOS os scripts)
  'test-coverage-bulk',

  // Testes de snapshot e dashboard (simulação segura)
  'test-snapshot-state',
  'test-dashboard-deploy',
  'test-parallel-executor',
  'test-session-manager',
  'test-code-search',

  // Testes de migração e audit
  'test-migrate-pipeline-v2',
  'test-audit-trail',

  // === NOVOS TESTES: Elevação de cobertura ===
  'test-coverage-summary',
  'test-self-healing-activator',
  'test-secrets-scanner',
  'test-siem-exporter',

  // === TESTES EXPANDIDOS: 9 scripts >90% ===
  'test-auth-provider',
  'test-model-router',
  'test-token-tracker',
  'test-rollback-manager',

  // === FASE 4: 5 scripts com cobertura >80% (siem >90%) ===
  'test-dashboard-server',
  'test-browser-support',
  'test-docker-support',
  'test-pr-generator',
  'test-siem-exporter',

  // === FASE 3 (2a wave): Elevação de cobertura — 6 scripts MASSIVE ===
  'test-pipeline-executor-utils',   // pipeline-executor.js (4205 linhas) — funções PURAS extraídas
  'test-context-executor',          // context-executor.js (736 linhas) — patternToTest, cb3Elimination, formatRepoStructure
  'test-self-healing',              // self-healing.js (1376 linhas) — diagnose puro, checkStateFile, getHealth
  'test-pipeline-runtime',          // pipeline-runtime.js (1834 linhas) — ACTION_MAP, classifiers, recommendNext
  'test-plugin-system',             // plugin-system.js (304 linhas) — validatePlugin, callHookPure, listPluginsPure
  'test-context-compressor',        // context-compressor.js (656 linhas) — TODAS as estratégias de compressão
];

var passed = 0;
var failed = 0;
var skipped = 0;

tests.forEach(function(t) {
  var filePath = path.join(TESTS_DIR, t + '.js');
  var fs = require('fs');

  if (!fs.existsSync(filePath)) {
    skipped++;
    console.log('⚠️  ' + t + '.js não encontrado, pulando.');
    return;
  }

  // Reseta flag de exit e código
  shouldExit = false;
  exitCode = 0;

  try {
    // Limpa cache do módulo
    delete require.cache[require.resolve(filePath)];
    require(filePath);

    // Se o teste chamou process.exit com código != 0, conta como falha
    if (shouldExit && exitCode !== 0) {
      failed++;
      console.log('❌', t, '(exit code', exitCode + ')');
    } else {
      passed++;
      console.log('✅', t);
    }
  } catch(e) {
    failed++;
    console.log('❌', t + ':', e.message);
    if (e.stack) {
      console.log('   Stack:', e.stack.split('\n').slice(1, 4).join('\n   '));
    }
  }
});

// ─── Summary ────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════════════');
console.log('📊 Resultado: ' + passed + '/' + (passed + failed + skipped) + ' testes');
console.log('   ✅ Passaram: ' + passed);
console.log('   ❌ Falharam: ' + failed);
console.log('   ⚠️  Pulados: ' + skipped);
console.log('════════════════════════════════════════════════════════════\n');

// Restaura process.exit original e sai
process.exit = originalExit;
process.exit(failed > 0 ? 1 : 0);
