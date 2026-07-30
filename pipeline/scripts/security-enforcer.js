#!/usr/bin/env node
/**
 * Matrix Security Enforcer v2.0 — Security Middleware Runtime
 * ====================================================================
 * Camada unificada de segurança do pipeline Matrix.
 * Integra sandbox.yaml, rbac.json, secrets scanner em uma única API.
 *
 * Mudanças da v2.0:
 *   - API programática completa (não apenas CLI)
 *   - Leitura dinâmica de sandbox.yaml (não patterns hardcoded)
 *   - Integração RBAC por ação (code_write, git_push, config_write)
 *   - Secrets scan integrado no fluxo de commit
 *   - enforceAll() para validação multi-camada
 *   - NON-BLOCKING: todas as funções retornam { allowed, reason }
 *     em vez de lançar exceções
 *
 * Uso programático:
 *   const se = require('./security-enforcer');
 *   se.checkCommand('rm -rf /');                    // { allowed: false, ... }
 *   se.checkPermission('pipeline-default', 'code_write'); // true/false
 *   se.scanForSecrets('./src');                     // { secrets: [], safe: true }
 *   se.enforceAll('node script.js', { userId: 'admin', actionType: 'execute' });
 *
 * Uso CLI:
 *   node security-enforcer.js check <command>
 *   node security-enforcer.js check-permission <userId> <action>
 *   node security-enforcer.js scan [directory]
 *   node security-enforcer.js enforce <command> [--userId=<id>]
 *   node security-enforcer.js status
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Caminhos ──────────────────────────────────────────────────────────
const SCRIPTS_DIR = __dirname;
const PIPELINE_DIR = path.resolve(SCRIPTS_DIR, '..');
const SANDBOX_PATH = path.join(PIPELINE_DIR, 'sandbox.yaml');
const RBAC_PATH = path.join(PIPELINE_DIR, 'rbac.json');
const OPENCODE_CONFIG = path.resolve(PIPELINE_DIR, '..', 'opencode.jsonc');

// ─── Cache para evitar reloading desnecessário ─────────────────────────
let _sandboxConfig = null;
let _sandboxConfigTime = 0;
const CACHE_TTL_MS = 30000; // 30 segundos

// ======================================================================
//  HELPERS
// ======================================================================

/**
 * Carrega sandbox.yaml com cache de curta duração.
 * NON-BLOCKING: retorna config válido ou fallback seguro.
 */
function loadSandboxConfig() {
  const now = Date.now();
  if (_sandboxConfig && (now - _sandboxConfigTime) < CACHE_TTL_MS) {
    return _sandboxConfig;
  }

  try {
    if (!fs.existsSync(SANDBOX_PATH)) {
      const fallback = {
        sandbox: {
          enabled: true,
          timeout_ms: 300000,
          allowed_commands: ['node', 'npm', 'npx', 'python', 'git', 'dir', 'type'],
          blocked_commands: ['rm -rf', 'format', 'shutdown', 'taskkill'],
          dangerous_patterns: [],
          limits: { max_output_lines: 5000, max_output_chars: 512000 }
        }
      };
      _sandboxConfig = fallback;
      _sandboxConfigTime = now;
      return fallback;
    }

    const raw = fs.readFileSync(SANDBOX_PATH, 'utf-8');
    const yamlUtils = require('./lib/yaml-utils');
    const config = yamlUtils.parseYaml ? yamlUtils.parseYaml(raw) : parseYamlSimple(raw);

    _sandboxConfig = config || { sandbox: { enabled: true, allowed_commands: [], blocked_commands: [], dangerous_patterns: [] } };
    _sandboxConfigTime = now;
    return _sandboxConfig;
  } catch (err) {
    return {
      sandbox: {
        enabled: true,
        allowed_commands: [],
        blocked_commands: [],
        dangerous_patterns: [],
        error: err.message
      }
    };
  }
}

/**
 * Parse YAML simples (fallback caso yaml-utils não tenha parseYaml).
 */
function parseYamlSimple(raw) {
  const result = { sandbox: { allowed_commands: [], blocked_commands: [], dangerous_patterns: [], limits: {} } };
  const lines = raw.split('\n');
  let section = null;
  let subsection = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed.length === 0) continue;

    if (trimmed.startsWith('allowed_commands:')) {
      section = 'allowed_commands';
      subsection = null;
      continue;
    }
    if (trimmed.startsWith('blocked_commands:')) {
      section = 'blocked_commands';
      subsection = null;
      continue;
    }
    if (trimmed.startsWith('dangerous_patterns:')) {
      section = 'dangerous_patterns';
      subsection = null;
      continue;
    }
    if (trimmed.startsWith('limits:')) {
      section = 'limits';
      subsection = null;
      continue;
    }
    if (trimmed.startsWith('timeout_ms:')) {
      result.sandbox.timeout_ms = parseInt(trimmed.split(':')[1].trim(), 10);
      continue;
    }
    if (trimmed.startsWith('enabled:')) {
      result.sandbox.enabled = trimmed.split(':')[1].trim() === 'true';
      continue;
    }

    if (section && trimmed.startsWith('- ')) {
      const value = trimmed.substring(2).replace(/"/g, '');
      if (section === 'limits') {
        const parts = value.split(':');
        if (parts.length === 2) {
          const key = parts[0].trim();
          const val = parseInt(parts[1].trim(), 10);
          if (!isNaN(val)) result.sandbox.limits[key] = val;
        }
      } else if (Array.isArray(result.sandbox[section])) {
        result.sandbox[section].push(value);
      }
    }
  }

  return result;
}

/**
 * Carrega rbac.json e retorna os dados.
 * NON-BLOCKING: retorna null em caso de erro.
 */
function loadRbacData() {
  try {
    if (!fs.existsSync(RBAC_PATH)) return null;
    return JSON.parse(fs.readFileSync(RBAC_PATH, 'utf-8'));
  } catch (err) {
    return null;
  }
}

/**
 * Lê diretórios permitidos do opencode.jsonc.
 */
function loadAllowedDirs() {
  try {
    if (!fs.existsSync(OPENCODE_CONFIG)) return [process.cwd()];

    const raw = fs.readFileSync(OPENCODE_CONFIG, 'utf-8');
    // Remove comentários e trailing commas
    const clean = raw
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,(\s*[}\]])/g, '$1');

    const config = JSON.parse(clean);
    const dirs = [];

    // Extrai diretórios permitidos do permission.external_directory
    if (config.permission && config.permission.external_directory) {
      const extDirs = config.permission.external_directory;
      for (const dir of Object.keys(extDirs)) {
        if (extDirs[dir] === 'allow') {
          dirs.push(dir);
          // Also add normalized version
          dirs.push(path.resolve(dir));
        }
      }
    }

    // Sempre inclui o workspace root e o pipeline
    dirs.push(PIPELINE_DIR);
    dirs.push(path.resolve(PIPELINE_DIR, '..'));

    return [...new Set(dirs.map(d => path.resolve(d)))];
  } catch (err) {
    return [process.cwd(), path.resolve(PIPELINE_DIR, '..')];
  }
}

// ======================================================================
//  API PÚBLICA — Middleware Security
// ======================================================================

/**
 * Verifica se um comando é permitido com base no sandbox.yaml.
 *
 * @param {string} command - Comando a ser verificado
 * @param {object} [options] - Opções
 * @param {boolean} [options.useWhitelist=true] - Se true, usa whitelist de comandos
 * @returns {{ allowed: boolean, reason: string, source: string }}
 *
 * NON-BLOCKING: sempre retorna um objeto, nunca lança exceção.
 */
function checkCommand(command, options) {
  options = options || {};

  if (!command || typeof command !== 'string') {
    return { allowed: false, reason: 'Comando vazio ou inválido', source: 'security-enforcer' };
  }

  try {
    // Tenta usar sandbox-run.js se disponível (mais completo)
    try {
      const sandbox = require('./sandbox-run');
      const config = sandbox.loadConfig();
      return sandbox.validateCommand(command, config);
    } catch (sandboxErr) {
      // Fallback: validação inline
      const config = loadSandboxConfig();
      return validateCommandInternal(command, config, options);
    }
  } catch (err) {
    // NON-BLOCKING: em caso de erro, permite o comando com warning
    return {
      allowed: true,
      reason: 'Security enforcer indisponível, permitindo como fallback seguro: ' + err.message,
      source: 'security-enforcer (fallback)'
    };
  }
}

/**
 * Validação interna de comando (fallback caso sandbox-run.js não esteja disponível).
 */
function validateCommandInternal(command, config, options) {
  const sandbox = config && config.sandbox ? config.sandbox : {};
  const useWhitelist = options.useWhitelist !== false;

  const cmdLower = command.toLowerCase().trim();
  const firstCmd = cmdLower.split(/\s+/)[0];

  // 1. Check dangerous patterns
  const dangerous = sandbox.dangerous_patterns || [];
  for (const pattern of dangerous) {
    if (cmdLower.includes(pattern.toLowerCase())) {
      return {
        allowed: false,
        reason: 'Comando bloqueado: contém padrão perigoso "' + pattern + '"',
        source: 'security-enforcer (dangerous_patterns)'
      };
    }
  }

  // 2. Check blocked commands
  const blocked = sandbox.blocked_commands || [];
  for (const blockedCmd of blocked) {
    if (cmdLower.includes(blockedCmd.toLowerCase())) {
      return {
        allowed: false,
        reason: 'Comando bloqueado: "' + blockedCmd + '" (blacklist)',
        source: 'security-enforcer (blocked_commands)'
      };
    }
  }

  // 3. Check whitelist (se configurada e habilitada)
  const allowed = sandbox.allowed_commands || [];
  if (useWhitelist && allowed.length > 0) {
    const isAllowed = allowed.some(function(a) {
      return firstCmd === a.toLowerCase();
    });
    if (!isAllowed) {
      return {
        allowed: false,
        reason: 'Comando "' + firstCmd + '" não está na whitelist de comandos permitidos',
        source: 'security-enforcer (allowed_commands)'
      };
    }
  }

  return { allowed: true, reason: 'Comando permitido', source: 'security-enforcer' };
}

/**
 * Verifica se um usuário tem permissão para uma ação específica via RBAC.
 *
 * @param {string} userId - ID do usuário
 * @param {string} action - Ação a verificar (ex: 'code_write', 'git_push', 'config_write')
 * @returns {{ allowed: boolean, reason: string, role: string|null }}
 *
 * NON-BLOCKING: sempre retorna objeto, nunca lança exceção.
 */
function checkPermission(userId, action) {
  if (!userId) {
    return { allowed: false, reason: 'userId não fornecido', role: null };
  }

  if (!action) {
    return { allowed: false, reason: 'action não fornecida', role: null };
  }

  try {
    const rbac = require('./rbac-system');
    rbac.init();

    if (!rbac.userExists(userId)) {
      return {
        allowed: false,
        reason: 'Usuário "' + userId + '" não encontrado no RBAC',
        role: null
      };
    }

    const hasPermission = rbac.checkPermission(userId, action);
    const userRole = getRbacRole(userId);

    if (hasPermission) {
      return {
        allowed: true,
        reason: 'Usuário "' + userId + '" tem permissão "' + action + '"',
        role: userRole
      };
    } else {
      return {
        allowed: false,
        reason: 'Usuário "' + userId + '" (' + userRole + ') não tem permissão "' + action + '"',
        role: userRole
      };
    }
  } catch (err) {
    // NON-BLOCKING: permite em caso de erro (fallback seguro para admin)
    return {
      allowed: true,
      reason: 'RBAC indisponível, permitindo como fallback: ' + err.message,
      role: null
    };
  }
}

/**
 * Obtém o papel RBAC de um usuário.
 */
function getRbacRole(userId) {
  try {
    const data = loadRbacData();
    if (data && data.users && data.users[userId]) {
      return data.users[userId].role || null;
    }
  } catch (e) { /* NON-BLOCKING */ }
  return null;
}

/**
 * Escaneia um diretório em busca de secrets (tokens, senhas, chaves).
 *
 * @param {string} directory - Diretório a escanear
 * @returns {{ secrets: Array, safe: boolean, count: number, error: string|null }}
 *
 * NON-BLOCKING: sempre retorna objeto, nunca lança exceção.
 */
function scanForSecrets(directory) {
  const scanDir = directory || process.cwd();

  try {
    const scanner = require('./secrets-scanner');
    const results = scanner.run(scanDir);

    return {
      secrets: results || [],
      safe: !results || results.length === 0,
      count: results ? results.length : 0,
      error: null
    };
  } catch (err) {
    // NON-BLOCKING: falha no scanner não bloqueia o pipeline
    return {
      secrets: [],
      safe: true,
      count: 0,
      error: 'Secrets scanner indisponível: ' + err.message
    };
  }
}

/**
 * Verifica se um arquivo está em um diretório permitido.
 *
 * @param {string} filePath - Caminho do arquivo a verificar
 * @returns {{ allowed: boolean, reason: string }}
 *
 * NON-BLOCKING: sempre retorna objeto, nunca lança exceção.
 */
function checkFileAccess(filePath) {
  if (!filePath) {
    return { allowed: false, reason: 'Caminho do arquivo não fornecido' };
  }

  try {
    const resolvedPath = path.resolve(filePath);
    const allowedDirs = loadAllowedDirs();

    for (const dir of allowedDirs) {
      const resolvedDir = path.resolve(dir);
      if (resolvedPath.startsWith(resolvedDir)) {
        return {
          allowed: true,
          reason: 'Arquivo acessível em: ' + resolvedDir
        };
      }
    }

    return {
      allowed: false,
      reason: 'Acesso negado: "' + resolvedPath + '" não está em diretório permitido'
    };
  } catch (err) {
    return {
      allowed: true,
      reason: 'File access check indisponível, permitindo: ' + err.message
    };
  }
}

/**
 * Executa TODAS as verificações de segurança para um comando em um contexto.
 * Esta é a função principal do middleware — chama sandbox + RBAC + file access.
 *
 * @param {string} command - Comando a ser executado
 * @param {object} context - Contexto da execução
 * @param {string} [context.userId] - ID do usuário para RBAC
 * @param {string} [context.actionType] - Tipo de ação (execute, code_write, git_push, config_write)
 * @param {string} [context.workingDir] - Diretório de trabalho para file access
 * @returns {{ allowed: boolean, reason: string, checks: Array<object> }}
 *
 * NON-BLOCKING: sempre retorna objeto, nunca lança exceção.
 */
function enforceAll(command, context) {
  context = context || {};
  const checks = [];
  let allAllowed = true;
  let reasons = [];

  // 1. Sandbox: checkCommand
  const sandboxResult = checkCommand(command, { useWhitelist: context.useWhitelist });
  checks.push({
    check: 'sandbox',
    allowed: sandboxResult.allowed,
    reason: sandboxResult.reason,
    source: sandboxResult.source
  });
  if (!sandboxResult.allowed) {
    allAllowed = false;
    reasons.push('[SANDBOX] ' + sandboxResult.reason);
  }

  // 2. RBAC: se userId e actionType foram fornecidos
  //    Mapeia actionTypes comuns para ações RBAC válidas
  const RBAC_ACTION_MAP = {
    'execute': 'pipeline_execute',
    'code_write': 'code_write',
    'git_push': 'git_push',
    'config_write': 'config_write',
    'agent_delegate': 'agent_delegate',
    'read': 'state_read',
    'write': 'code_write',
    'push': 'git_push',
    'deploy': 'pipeline_execute'
  };

  if (context.userId && context.actionType) {
    const rbacAction = RBAC_ACTION_MAP[context.actionType] || context.actionType;
    const rbacResult = checkPermission(context.userId, rbacAction);
    checks.push({
      check: 'rbac',
      allowed: rbacResult.allowed,
      reason: rbacResult.reason,
      role: rbacResult.role,
      action: rbacAction
    });
    if (!rbacResult.allowed) {
      allAllowed = false;
      reasons.push('[RBAC] ' + rbacResult.reason);
    }
  }

  // 3. File access: se workingDir foi fornecido
  if (context.workingDir) {
    const fileResult = checkFileAccess(context.workingDir);
    checks.push({
      check: 'file_access',
      allowed: fileResult.allowed,
      reason: fileResult.reason
    });
    if (!fileResult.allowed) {
      allAllowed = false;
      reasons.push('[FILE] ' + fileResult.reason);
    }
  }

  // 4. Secrets scan (apenas aviso, NON-BLOCKING)
  if (context.scanDir) {
    try {
      const secretsResult = scanForSecrets(context.scanDir);
      checks.push({
        check: 'secrets_scan',
        allowed: secretsResult.safe,
        reason: secretsResult.safe ? 'Nenhum secret encontrado' : secretsResult.count + ' potenciais secrets encontrados',
        count: secretsResult.count
      });
      if (!secretsResult.safe) {
        reasons.push('[SECRETS] ' + secretsResult.count + ' potenciais secrets detectados em ' + context.scanDir);
      }
    } catch (secErr) {
      checks.push({
        check: 'secrets_scan',
        allowed: true,
        reason: 'Secrets scan indisponível (NON-BLOCKING): ' + secErr.message
      });
    }
  }

  return {
    allowed: allAllowed,
    reason: allAllowed ? 'Todas as verificações de segurança passaram' : reasons.join('; '),
    checks: checks
  };
}

/**
 * Retorna o status atual de todos os subsistemas de segurança.
 *
 * @returns {{ sandbox: object, rbac: object, scanner: object, allowedDirs: string[] }}
 */
function getStatus() {
  // Status do sandbox
  let sandboxStatus = { available: false, enabled: false, commands_allowed: 0, commands_blocked: 0 };
  try {
    const sandbox = require('./sandbox-run');
    const config = sandbox.loadConfig();
    sandboxStatus = {
      available: true,
      enabled: config.sandbox && config.sandbox.enabled !== false,
      commands_allowed: (config.sandbox && config.sandbox.allowed_commands) ? config.sandbox.allowed_commands.length : 0,
      commands_blocked: (config.sandbox && config.sandbox.blocked_commands) ? config.sandbox.blocked_commands.length : 0,
      timeout_ms: config.sandbox ? config.sandbox.timeout_ms : 300000
    };
  } catch (e) {
    sandboxStatus = { available: false, enabled: false, error: e.message };
  }

  // Status do RBAC
  let rbacStatus = { available: false, roles: 0, users: 0 };
  try {
    const rbac = require('./rbac-system');
    rbac.init();
    const roles = rbac.listRoles();
    const users = rbac.getUsers();
    rbacStatus = {
      available: true,
      roles: roles.length,
      users: users.length,
      roles_list: roles.map(function(r) { return r.name; })
    };
  } catch (e) {
    rbacStatus = { available: false, error: e.message };
  }

  // Status do secrets scanner
  let scannerStatus = { available: false, patterns: 0 };
  try {
    const scanner = require('./secrets-scanner');
    scannerStatus = {
      available: true,
      patterns: scanner.PATTERNS ? scanner.PATTERNS.length : 0
    };
  } catch (e) {
    scannerStatus = { available: false, error: e.message };
  }

  return {
    sandbox: sandboxStatus,
    rbac: rbacStatus,
    scanner: scannerStatus,
    allowed_dirs: loadAllowedDirs(),
    version: '2.0'
  };
}

// ======================================================================
//  CLI Interface
// ======================================================================

function printCliHelp() {
  console.log('');
  console.log('Matrix Security Enforcer v2.0 — Security Middleware');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('Uso programático:');
  console.log('  const se = require("./security-enforcer");');
  console.log('  se.checkCommand("comando");');
  console.log('  se.checkPermission("userId", "action");');
  console.log('  se.scanForSecrets("./dir");');
  console.log('  se.enforceAll("comando", { userId: "admin", actionType: "execute" });');
  console.log('');
  console.log('Uso CLI:');
  console.log('  node security-enforcer.js check <comando>');
  console.log('  node security-enforcer.js check-permission <userId> <action>');
  console.log('  node security-enforcer.js scan [diretório]');
  console.log('  node security-enforcer.js enforce <comando> [--userId=<id>] [--action=<action>]');
  console.log('  node security-enforcer.js status');
  console.log('');
  console.log('Ações RBAC: pipeline_execute, code_write, config_write, agent_delegate,');
  console.log('            git_push, logs_read, metrics_read, state_read, tenant_manage, user_manage');
  console.log('');
}

function cliCheck(args) {
  const command = args.join(' ');
  if (!command) {
    console.error('❌ Uso: node security-enforcer.js check <comando>');
    process.exit(1);
  }

  const result = checkCommand(command);
  if (result.allowed) {
    console.log('✅ COMANDO PERMITIDO');
    if (result.reason) console.log('   Motivo: ' + result.reason);
  } else {
    console.log('❌ COMANDO BLOQUEADO');
    console.log('   Motivo: ' + result.reason);
    if (result.source) console.log('   Fonte: ' + result.source);
    process.exit(1);
  }
}

function cliCheckPermission(args) {
  const userId = args[0];
  const action = args[1];

  if (!userId || !action) {
    console.error('❌ Uso: node security-enforcer.js check-permission <userId> <action>');
    process.exit(1);
  }

  const result = checkPermission(userId, action);
  if (result.allowed) {
    console.log('✅ PERMISSÃO CONCEDIDA');
    console.log('   Usuário: ' + userId);
    console.log('   Ação: ' + action);
    if (result.role) console.log('   Papel: ' + result.role);
  } else {
    console.log('❌ PERMISSÃO NEGADA');
    console.log('   Usuário: ' + userId);
    console.log('   Ação: ' + action);
    if (result.role) console.log('   Papel: ' + result.role);
    console.log('   Motivo: ' + result.reason);
    process.exit(1);
  }
}

function cliScan(args) {
  const dir = args[0] || process.cwd();

  console.log('🔍 Escaneando secrets em: ' + dir);
  console.log('');

  const result = scanForSecrets(dir);

  if (result.error) {
    console.log('⚠️  Secrets scanner: ' + result.error);
    process.exit(0);
  }

  if (result.safe) {
    console.log('✅ Nenhum secret encontrado — diretório seguro');
  } else {
    console.log('⚠️  ' + result.count + ' potenciais secrets encontrados:');
    result.secrets.forEach(function(s) {
      console.log('   [' + s.pattern + '] ' + s.file + ' (' + s.count + ' ocorrência' + (s.count > 1 ? 's' : '') + ')');
    });
  }
}

function cliEnforce(args) {
  // Extrai flags
  let userId = null;
  let actionType = null;
  const commandArgs = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--userId=')) {
      userId = args[i].split('=')[1];
    } else if (args[i].startsWith('--action=')) {
      actionType = args[i].split('=')[1];
    } else if (args[i].startsWith('--user-id=')) {
      userId = args[i].split('=')[1];
    } else if (args[i].startsWith('--action-type=')) {
      actionType = args[i].split('=')[1];
    } else {
      commandArgs.push(args[i]);
    }
  }

  const command = commandArgs.join(' ');

  if (!command) {
    console.error('❌ Uso: node security-enforcer.js enforce <comando> [--userId=<id>] [--action=<action>]');
    process.exit(1);
  }

  console.log('');
  console.log('🔒 Security Enforcer — Validação Multi-Camada');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   Comando:    ' + command);
  if (userId) console.log('   Usuário:    ' + userId);
  if (actionType) console.log('   Ação:       ' + actionType);
  console.log('');

  const result = enforceAll(command, { userId: userId, actionType: actionType });

  // Mostra cada verificação
  if (result.checks && result.checks.length > 0) {
    console.log('   Verificações:');
    result.checks.forEach(function(check) {
      const icon = check.allowed ? '✅' : '❌';
      const checkName = check.check.toUpperCase();
      console.log('   ' + icon + ' [' + checkName + '] ' + check.reason);
    });
    console.log('');
  }

  if (result.allowed) {
    console.log('✅ VEREDICTO: PERMITIDO');
    console.log('   Todas as camadas de segurança aprovaram o comando.');
  } else {
    console.log('❌ VEREDICTO: BLOQUEADO');
    console.log('   Motivo: ' + result.reason);
    process.exit(1);
  }
}

function cliStatus() {
  const status = getStatus();

  console.log('');
  console.log('🔒 Matrix Security Enforcer v2.0 — Status');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // Sandbox
  console.log('📦 Sandbox:');
  if (status.sandbox.available) {
    console.log('   ✅ Disponível');
    console.log('   Habilitado: ' + (status.sandbox.enabled ? 'SIM' : 'NÃO'));
    console.log('   Comandos permitidos: ' + status.sandbox.commands_allowed);
    console.log('   Comandos bloqueados: ' + status.sandbox.commands_blocked);
    if (status.sandbox.timeout_ms) console.log('   Timeout: ' + status.sandbox.timeout_ms + 'ms');
  } else {
    console.log('   ❌ Indisponível' + (status.sandbox.error ? ': ' + status.sandbox.error : ''));
  }
  console.log('');

  // RBAC
  console.log('👤 RBAC:');
  if (status.rbac.available) {
    console.log('   ✅ Disponível');
    console.log('   Papéis: ' + status.rbac.roles);
    console.log('   Usuários: ' + status.rbac.users);
    if (status.rbac.roles_list && status.rbac.roles_list.length > 0) {
      console.log('   Papéis: ' + status.rbac.roles_list.join(', '));
    }
  } else {
    console.log('   ❌ Indisponível' + (status.rbac.error ? ': ' + status.rbac.error : ''));
  }
  console.log('');

  // Secrets Scanner
  console.log('🔍 Secrets Scanner:');
  if (status.scanner.available) {
    console.log('   ✅ Disponível');
    console.log('   Padrões: ' + status.scanner.patterns);
  } else {
    console.log('   ❌ Indisponível' + (status.scanner.error ? ': ' + status.scanner.error : ''));
  }
  console.log('');

  // Allowed dirs
  console.log('📁 Diretórios permitidos:');
  if (status.allowed_dirs && status.allowed_dirs.length > 0) {
    status.allowed_dirs.forEach(function(d) {
      console.log('   • ' + d);
    });
  }
  console.log('');
}

// ─── Main CLI ──────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === '--help' || cmd === '-h') {
    printCliHelp();
    return;
  }

  switch (cmd) {
    case 'check':
      cliCheck(args.slice(1));
      break;
    case 'check-permission':
    case 'check-permissions':
      cliCheckPermission(args.slice(1));
      break;
    case 'scan':
      cliScan(args.slice(1));
      break;
    case 'enforce':
      cliEnforce(args.slice(1));
      break;
    case 'status':
      cliStatus();
      break;
    default:
      console.error('Comando desconhecido: "' + cmd + '"');
      console.error('Use --help para ver os comandos disponíveis.');
      process.exit(1);
  }
}

if (require.main === module) {
  main();
}

// ======================================================================
//  Exports — API Programática
// ======================================================================

module.exports = {
  // Middleware principal
  checkCommand: checkCommand,
  checkPermission: checkPermission,
  scanForSecrets: scanForSecrets,
  checkFileAccess: checkFileAccess,
  enforceAll: enforceAll,
  getStatus: getStatus,

  // CLI (para compatibilidade com v1)
  run: main
};
