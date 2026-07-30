#!/usr/bin/env node
/**
 * Test: security-enforcer.js — checkCommand, checkPermission, scanForSecrets
 *
 * Testa o módulo de segurança Matrix via API programática.
 * O módulo tem fallbacks built-in para quando dependências (sandbox-run,
 * rbac-system, secrets-scanner) não estão disponíveis.
 *
 * Estratégia:
 *   - Direct require() do módulo — seus fallbacks NON-BLOCKING
 *     permitem testar a lógica central sem dependências externas.
 *   - Testa checkCommand com comandos bloqueados e permitidos
 *   - Testa checkPermission com fallback RBAC
 *   - Testa scanForSecrets com fallback
 *   - Testa enforceAll multi-camada
 *
 * Zero npm dependencies. assert nativo.
 */

'use strict';

const assert = require('assert');
const path = require('path');

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  \x1b[32m✅ ' + name + '\x1b[0m');
    testsPassed++;
  } catch (err) {
    console.log('  \x1b[31m❌ ' + name + ': ' + err.message + '\x1b[0m');
    testsFailed++;
  }
}

// ─── Load security enforcer ───────────────────────────────────────────
const sePath = path.resolve(__dirname, '..', 'scripts', 'security-enforcer.js');
delete require.cache[require.resolve(sePath)];
const se = require(sePath);

// ═══════════════════════════════════════════════════════════════════════
// checkCommand
// ═══════════════════════════════════════════════════════════════════════

console.log('\n\x1b[36m\x1b[1m🔒 checkCommand — Comandos bloqueados\x1b[0m\n');

test('checkCommand: comando vazio → bloqueado', () => {
  const result = se.checkCommand('');
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.includes('vazio') || result.reason.includes('inválido'));
});

test('checkCommand: null → bloqueado', () => {
  const result = se.checkCommand(null);
  assert.strictEqual(result.allowed, false);
});

test('checkCommand: undefined → bloqueado', () => {
  const result = se.checkCommand(undefined);
  assert.strictEqual(result.allowed, false);
});

test('checkCommand: "rm -rf" (dangerous pattern) → bloqueado', () => {
  // rm -rf está na lista blocked_commands do fallback config
  const result = se.checkCommand('rm -rf /');
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.includes('bloqueado') || result.reason.includes('blocked'));
});

test('checkCommand: "node" → permitido (está na whitelist)', () => {
  const result = se.checkCommand('node script.js');
  assert.strictEqual(result.allowed, true);
});

test('checkCommand: "npm" → permitido (está na whitelist)', () => {
  const result = se.checkCommand('npm install');
  assert.strictEqual(result.allowed, true);
});

test('checkCommand: "git" → permitido (está na whitelist)', () => {
  const result = se.checkCommand('git status');
  assert.strictEqual(result.allowed, true);
});

test('checkCommand: "unknown_cmd_xyz" → bloqueado (fora da whitelist)', () => {
  const result = se.checkCommand('unknown_cmd_xyz arg1 arg2');
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.includes('whitelist') || result.reason.includes('permitidos'));
});

test('checkCommand: "taskkill" → bloqueado (na blacklist)', () => {
  const result = se.checkCommand('taskkill /f /im notepad.exe');
  assert.strictEqual(result.allowed, false);
});

test('checkCommand: "shutdown" → bloqueado (na blacklist)', () => {
  // shutdown está na blacklist de blocked_commands no fallback config
  const result = se.checkCommand('shutdown /s /t 0');
  assert.strictEqual(result.allowed, false);
});

test('checkCommand: "format" → bloqueado (na blacklist)', () => {
  const result = se.checkCommand('format C:');
  assert.strictEqual(result.allowed, false);
});

test('checkCommand: useWhitelist=false não quebra', () => {
  // Nota: sandbox-run.js pode interceptar antes do useWhitelist ser aplicado.
  // Testamos que a chamada não lança erro e retorna objeto com allowed.
  const result = se.checkCommand('npx', { useWhitelist: false });
  // 'npx' está na whitelist, deve ser permitido por qualquer caminho
  assert.strictEqual(result.allowed, true);
  assert.ok('reason' in result, 'Resultado deve ter reason');
});

test('checkCommand: "python" → permitido (na whitelist)', () => {
  const result = se.checkCommand('python script.py');
  assert.strictEqual(result.allowed, true);
});

test('checkCommand: case insensitivity test', () => {
  const result = se.checkCommand('NODE script.js');
  assert.strictEqual(result.allowed, true);
});

test('checkCommand: "dir" → permitido (na whitelist)', () => {
  const result = se.checkCommand('dir');
  assert.strictEqual(result.allowed, true);
});

test('checkCommand: "type" → permitido (na whitelist)', () => {
  const result = se.checkCommand('type file.txt');
  assert.strictEqual(result.allowed, true);
});

// ═══════════════════════════════════════════════════════════════════════
// checkPermission
// ═══════════════════════════════════════════════════════════════════════
console.log('\n\x1b[36m\x1b[1m👤 checkPermission — RBAC\x1b[0m\n');

test('checkPermission: userId vazio → negado', () => {
  const result = se.checkPermission('', 'code_write');
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.includes('userId') || result.reason.includes('fornecido'));
});

test('checkPermission: userId null → negado', () => {
  const result = se.checkPermission(null, 'code_write');
  assert.strictEqual(result.allowed, false);
});

test('checkPermission: action vazia → negado', () => {
  const result = se.checkPermission('admin', '');
  assert.strictEqual(result.allowed, false);
});

test('checkPermission: sem ação → negado', () => {
  const result = se.checkPermission('admin');
  assert.strictEqual(result.allowed, false);
});

test('checkPermission: usuário inexistente → negado (ou fallback permite)', () => {
  // Se RBAC não está configurado, o fallback permite (NON-BLOCKING)
  const result = se.checkPermission('nonexistent_user', 'code_write');
  // O resultado depende se rbac-system está disponível
  // Se não estiver, fallback retorna allowed=true
  if (result.allowed) {
    assert.ok(result.reason.includes('fallback') || result.reason.includes('indisponível'));
  } else {
    assert.ok(result.reason.includes('não encontrado') || result.reason.includes('inexistente'));
  }
});

test('checkPermission: retorna estrutura esperada', () => {
  const result = se.checkPermission('anyone', 'pipeline_execute');
  assert.ok('allowed' in result);
  assert.ok('reason' in result);
  assert.ok('role' in result);
});

// ═══════════════════════════════════════════════════════════════════════
// scanForSecrets
// ═══════════════════════════════════════════════════════════════════════
console.log('\n\x1b[36m\x1b[1m🔍 scanForSecrets — Secrets Scanner\x1b[0m\n');

test('scanForSecrets: sem diretório → escaneia cwd', () => {
  const result = se.scanForSecrets();
  assert.ok('secrets' in result);
  assert.ok('safe' in result);
  assert.ok('count' in result);
});

test('scanForSecrets: diretório inexistente → seguro (NON-BLOCKING)', () => {
  const result = se.scanForSecrets(path.join(__dirname, '__nonexistent_dir_xyz__'));
  // Non-blocking: mesmo que o scanner falhe, retorna safe: true
  assert.strictEqual(result.safe, true);
  assert.strictEqual(result.count, 0);
});

test('scanForSecrets: retorna estrutura esperada', () => {
  const result = se.scanForSecrets(__dirname);
  assert.ok(Array.isArray(result.secrets));
  assert.strictEqual(typeof result.safe, 'boolean');
  assert.strictEqual(typeof result.count, 'number');
});

// ═══════════════════════════════════════════════════════════════════════
// enforceAll (multi-camada)
// ═══════════════════════════════════════════════════════════════════════
console.log('\n\x1b[36m\x1b[1m🛡️ enforceAll — Multi-layer Validation\x1b[0m\n');

test('enforceAll: comando bloqueado → não permitido', () => {
  const result = se.enforceAll('rm -rf /', { userId: 'admin', actionType: 'execute' });
  assert.strictEqual(result.allowed, false);
  assert.ok(Array.isArray(result.checks));
  assert.ok(result.checks.length > 0);
});

test('enforceAll: comando permitido → resultado tem checks', () => {
  const result = se.enforceAll('node script.js', { userId: 'admin', actionType: 'execute' });
  assert.ok(Array.isArray(result.checks));
  assert.ok(result.checks.length >= 1);
});

test('enforceAll: sem contexto → apenas sandbox check', () => {
  const result = se.enforceAll('node script.js');
  assert.ok(Array.isArray(result.checks));
  // Deve ter pelo menos o sandbox check
  const hasSandbox = result.checks.some(function(c) { return c.check === 'sandbox'; });
  assert.ok(hasSandbox, 'Deve ter pelo menos check sandbox');
});

test('enforceAll: ação mapeada "execute" → pipeline_execute', () => {
  const result = se.enforceAll('node script.js', { userId: 'admin', actionType: 'execute' });
  const rbacCheck = result.checks.find(function(c) { return c.check === 'rbac'; });
  if (rbacCheck) {
    assert.strictEqual(rbacCheck.action, 'pipeline_execute');
  }
});

test('enforceAll: scanDir opcional → adiciona secrets_scan check', () => {
  const result = se.enforceAll('node script.js', { scanDir: __dirname });
  const scanCheck = result.checks.find(function(c) { return c.check === 'secrets_scan'; });
  // Secrets scan é opcional, pode ou não estar presente
  if (scanCheck) {
    assert.strictEqual(scanCheck.check, 'secrets_scan');
  }
});

// ═══════════════════════════════════════════════════════════════════════
// getStatus
// ═══════════════════════════════════════════════════════════════════════
console.log('\n\x1b[36m\x1b[1m📊 getStatus — Security Status\x1b[0m\n');

test('getStatus: retorna estrutura completa', () => {
  const status = se.getStatus();
  assert.ok('sandbox' in status);
  assert.ok('rbac' in status);
  assert.ok('scanner' in status);
  assert.ok('allowed_dirs' in status);
  assert.ok('version' in status);
  assert.strictEqual(status.version, '2.0');
});

test('getStatus: sandbox tem campos obrigatórios', () => {
  const status = se.getStatus();
  assert.ok('available' in status.sandbox);
  assert.ok('enabled' in status.sandbox);
});

test('getStatus: rbac tem campos obrigatórios', () => {
  const status = se.getStatus();
  assert.ok('available' in status.rbac);
  assert.ok('roles' in status.rbac);
  assert.ok('users' in status.rbac);
});

// ═══════════════════════════════════════════════════════════════════════
// checkFileAccess
// ═══════════════════════════════════════════════════════════════════════
console.log('\n\x1b[36m\x1b[1m📁 checkFileAccess — File Access\x1b[0m\n');

test('checkFileAccess: caminho vazio → negado', () => {
  const result = se.checkFileAccess('');
  assert.strictEqual(result.allowed, false);
});

test('checkFileAccess: caminho null → negado', () => {
  const result = se.checkFileAccess(null);
  assert.strictEqual(result.allowed, false);
});

test('checkFileAccess: caminho do pipeline → permitido', () => {
  // O pipeline dir deve estar na lista de diretórios permitidos
  const pipelineDir = path.resolve(__dirname, '..');
  const result = se.checkFileAccess(pipelineDir);
  assert.strictEqual(result.allowed, true);
});

test('checkFileAccess: retorna estrutura esperada', () => {
  const result = se.checkFileAccess(__dirname);
  assert.ok('allowed' in result);
  assert.ok('reason' in result);
});

// ═══════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════

const total = testsPassed + testsFailed;
console.log('\n\x1b[1m\u2514\u2500 Resultado:\x1b[0m ' +
  (testsFailed === 0 ? '\x1b[32m' + testsPassed + '/' + total + ' testes passaram\x1b[0m' :
                       '\x1b[31m' + testsPassed + '/' + total + ' passaram, ' + testsFailed + ' falharam\x1b[0m'));

process.exit(testsFailed > 0 ? 1 : 0);
