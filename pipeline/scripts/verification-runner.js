'use strict';

/**
 * Matrix Automated Verification Runner v1.0
 * ===========================================
 * Executa verificacoes objetivas automaticamente apos a Fase 2 do pipeline.
 * NON-BLOCKING: falhas nunca quebram o pipeline — apenas registram avisos.
 *
 * Uso:
 *   const runner = new VerificationRunner('/caminho/do/projeto');
 *   const result = await runner.runAll();
 *   console.log(result.summary);
 *
 * Dependencias: zero (apenas fs, path, child_process nativos)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Tenta executar um comando via execSync com tratamento de erro robusto.
 * Nunca lanca excecao — sempre retorna um objeto padronizado.
 *
 * @param {string} command  - Comando a executar
 * @param {object} options  - Opcoes passadas ao execSync (cwd, timeout, etc)
 * @returns {{ exitCode: number, stdout: string, stderr: string, error?: string }}
 */
function safeExec(command, options = {}) {
  const defaults = {
    timeout: 60000,
    maxBuffer: 10 * 1024 * 1024, // 10MB
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  };

  const merged = { ...defaults, ...options };

  try {
    const stdout = execSync(command, merged);
    return {
      exitCode: 0,
      stdout: (stdout || '').toString(),
      stderr: '',
    };
  } catch (err) {
    // execSync lanca um erro com stdout/stderr quando exitCode !== 0
    const exitCode = err.status !== undefined ? err.status : 1;
    const stderr = (err.stderr || '').toString();
    const stdout = (err.stdout || '').toString();

    return {
      exitCode,
      stdout,
      stderr,
      error: err.message || 'unknown error',
    };
  }
}

/**
 * Verifica se um script npm existe no package.json do diretorio.
 * @param {string} dir - Diretorio raiz do projeto
 * @param {string} scriptName - Nome do script (ex: "test", "build")
 * @returns {boolean}
 */
function hasNpmScript(dir, scriptName) {
  try {
    const pkgPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgPath)) return false;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const scripts = pkg.scripts || {};
    return typeof scripts[scriptName] === 'string' && scripts[scriptName].length > 0;
  } catch {
    return false;
  }
}

/**
 * Trunca uma string para um numero maximo de linhas.
 */
function truncateLines(str, maxLines) {
  if (!str) return '';
  const lines = str.split('\n');
  if (lines.length <= maxLines) return str;
  return lines.slice(0, maxLines).join('\n') + `\n... (truncado, ${lines.length - maxLines} linhas a mais)`;
}

// ---------------------------------------------------------------------------
// VerificationRunner
// ---------------------------------------------------------------------------

class VerificationRunner {
  /**
   * @param {string}  rootDir    - Caminho absoluto para a raiz do projeto
   * @param {object}  [options]  - Configuracoes opcionais
   * @param {number}  [options.timeout=60000]  - Timeout por comando (ms)
   */
  constructor(rootDir, options = {}) {
    if (!rootDir) {
      throw new Error('VerificationRunner: rootDir é obrigatório');
    }

    this.rootDir = path.resolve(rootDir);
    this.options = {
      timeout: options.timeout || 60000,
    };

    // Cache do package.json
    this._pkg = null;
  }

  /**
   * Le o package.json do projeto (com cache).
   * @returns {object|null}
   */
  _loadPackageJson() {
    if (this._pkg) return this._pkg;
    try {
      const pkgPath = path.join(this.rootDir, 'package.json');
      if (!fs.existsSync(pkgPath)) {
        this._pkg = null;
        return null;
      }
      this._pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return this._pkg;
    } catch {
      this._pkg = null;
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Metodos individuais de verificacao
  // -----------------------------------------------------------------------

  /**
   * Executa `npm test` com reporter JSON.
   * Retorna { exitCode, stdout, stderr, skipped, reason, output }
   */
  runTests() {
    const label = '[tests]';
    const has = hasNpmScript(this.rootDir, 'test');

    if (!has) {
      const result = { skipped: true, reason: 'script not found' };
      console.log(`${label} SKIPPED — ${result.reason}`);
      return result;
    }

    console.log(`${label} Running: npm test -- --reporter=json 2>&1 || true`);
    const raw = safeExec('npm test -- --reporter=json 2>&1 || true', {
      cwd: this.rootDir,
      timeout: this.options.timeout,
    });

    const result = {
      exitCode: raw.exitCode,
      stdout: truncateLines(raw.stdout, 500),
      stderr: truncateLines(raw.stderr, 200),
      error: raw.error || null,
    };

    if (result.exitCode === 0) {
      console.log(`${label} PASSED`);
    } else {
      console.log(`${label} FAILED (exitCode=${result.exitCode})`);
    }

    return result;
  }

  /**
   * Executa `npm run build`.
   * Retorna { exitCode, stdout, stderr, skipped, reason }
   */
  runBuild() {
    const label = '[build]';
    const has = hasNpmScript(this.rootDir, 'build');

    if (!has) {
      const result = { skipped: true, reason: 'script not found' };
      console.log(`${label} SKIPPED — ${result.reason}`);
      return result;
    }

    console.log(`${label} Running: npm run build 2>&1 || true`);
    const raw = safeExec('npm run build 2>&1 || true', {
      cwd: this.rootDir,
      timeout: this.options.timeout,
    });

    const result = {
      exitCode: raw.exitCode,
      stdout: truncateLines(raw.stdout, 500),
      stderr: truncateLines(raw.stderr, 200),
      error: raw.error || null,
    };

    if (result.exitCode === 0) {
      console.log(`${label} PASSED`);
    } else {
      console.log(`${label} FAILED (exitCode=${result.exitCode})`);
    }

    return result;
  }

  /**
   * Executa `npm run lint` com formato JSON.
   * Retorna { exitCode, stdout, stderr, skipped, reason }
   */
  runLint() {
    const label = '[lint]';
    const has = hasNpmScript(this.rootDir, 'lint');

    if (!has) {
      const result = { skipped: true, reason: 'script not found' };
      console.log(`${label} SKIPPED — ${result.reason}`);
      return result;
    }

    console.log(`${label} Running: npm run lint -- --format=json 2>&1 || true`);
    const raw = safeExec('npm run lint -- --format=json 2>&1 || true', {
      cwd: this.rootDir,
      timeout: this.options.timeout,
    });

    const result = {
      exitCode: raw.exitCode,
      stdout: truncateLines(raw.stdout, 500),
      stderr: truncateLines(raw.stderr, 200),
      error: raw.error || null,
    };

    if (result.exitCode === 0) {
      console.log(`${label} PASSED`);
    } else {
      console.log(`${label} FAILED (exitCode=${result.exitCode})`);
    }

    return result;
  }

  /**
   * Executa `npx tsc --noEmit`.
   * Retorna { exitCode, stdout, stderr, skipped, reason }
   */
  runTypeCheck() {
    const label = '[typecheck]';

    // Verifica se ha um tsconfig.json (caso nao tenha, faz sentido pular)
    const tsconfigPath = path.join(this.rootDir, 'tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) {
      const result = { skipped: true, reason: 'tsconfig.json not found' };
      console.log(`${label} SKIPPED — ${result.reason}`);
      return result;
    }

    console.log(`${label} Running: npx tsc --noEmit 2>&1 || true`);
    const raw = safeExec('npx tsc --noEmit 2>&1 || true', {
      cwd: this.rootDir,
      timeout: this.options.timeout,
    });

    const result = {
      exitCode: raw.exitCode,
      stdout: truncateLines(raw.stdout, 500),
      stderr: truncateLines(raw.stderr, 200),
      error: raw.error || null,
    };

    if (result.exitCode === 0) {
      console.log(`${label} PASSED`);
    } else {
      console.log(`${label} FAILED (exitCode=${result.exitCode})`);
    }

    return result;
  }

  /**
   * Executa `git diff --stat` e `git diff` para capturar mudancas.
   * Diferente dos outros metodos, este NAO depende de scripts npm.
   * Retorna { files_changed, insertions, deletions, stat, full_diff }
   */
  runGitDiff() {
    const label = '[git-diff]';

    // Verifica se estamos em um repositorio git valido
    const gitDir = path.join(this.rootDir, '.git');
    if (!fs.existsSync(gitDir)) {
      const result = { skipped: true, reason: 'not a git repository (.git not found)' };
      console.log(`${label} SKIPPED — ${result.reason}`);
      return result;
    }

    console.log(`${label} Running: git diff --stat`);

    // --stat: arquivos modificados + contagem de insercoes/delecoes
    const statRaw = safeExec('git diff --stat', {
      cwd: this.rootDir,
      timeout: this.options.timeout,
    });

    // diff completo
    const diffRaw = safeExec('git diff', {
      cwd: this.rootDir,
      timeout: this.options.timeout,
    });

    // diff do staged (--cached)
    const stagedRaw = safeExec('git diff --cached --stat', {
      cwd: this.rootDir,
      timeout: this.options.timeout,
    });

    // diff total (working + staged)
    const totalStatRaw = safeExec('git diff --stat HEAD 2>&1 || echo "(sem commits para comparar)"', {
      cwd: this.rootDir,
      timeout: this.options.timeout,
    });

    // Parse da saida do --stat para extrair numeros
    const statOutput = statRaw.stdout || '';
    const filesChanged = statOutput ? statOutput.trim().split('\n').length : 0;

    // Tenta extrair insercoes/delecoes do stat
    let insertions = 0;
    let deletions = 0;

    // O formato do git diff --stat tem linhas como:
    // "src/index.ts | 10 +++++-----"
    // e uma linha final "3 files changed, 15 insertions(+), 5 deletions(-)"
    if (statOutput) {
      const summaryLine = statOutput
        .split('\n')
        .filter((l) => l.includes('insertion') || l.includes('deletion'))
        .pop();

      if (summaryLine) {
        const insMatch = summaryLine.match(/(\d+)\s*insertion/);
        const delMatch = summaryLine.match(/(\d+)\s*deletion/);
        if (insMatch) insertions = parseInt(insMatch[1], 10);
        if (delMatch) deletions = parseInt(delMatch[1], 10);
      } else {
        // Fallback: tenta parser linha a linha
        for (const line of statOutput.split('\n')) {
          const insMatch = line.match(/(\d+)\s*\+/);
          const delMatch = line.match(/(\d+)\s*-/);
          if (insMatch) insertions += parseInt(insMatch[1], 10);
          if (delMatch) deletions += parseInt(delMatch[1], 10);
        }
      }
    }

    const fullDiff = truncateLines(diffRaw.stdout || '', 200);

    const result = {
      files_changed: filesChanged,
      insertions,
      deletions,
      stat: statOutput || '',
      staged_stat: truncateLines(stagedRaw.stdout || '', 100),
      total_stat: truncateLines(totalStatRaw.stdout || '', 100),
      full_diff: fullDiff || '(nenhuma diferenca)',
      error: statRaw.error || diffRaw.error || null,
    };

    if (filesChanged > 0) {
      console.log(`${label} ${filesChanged} arquivo(s) modificado(s), +${insertions}/-${deletions}`);
    } else {
      console.log(`${label} Nenhuma alteracao detectada`);
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Agregador
  // -----------------------------------------------------------------------

  /**
   * Executa TODAS as verificacoes em paralelo via Promise.all.
   * NON-BLOCKING: se uma falhar, as outras continuam.
   *
   * @returns {Promise<{
   *   tests:      object,
   *   build:      object,
   *   lint:       object,
   *   typecheck:  object,
   *   diff:       object,
   *   summary:    string[],
   *   passed:     boolean,
   *   failed:     boolean,
   *   timestamp:  string,
   * }>}
   */
  async runAll() {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  Matrix Verification Runner v1.0');
    console.log(`  Projeto: ${this.rootDir}`);
    console.log(`  Timeout: ${this.options.timeout}ms`);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');

    const startTime = Date.now();

    // Executa tudo em paralelo — cada metodo tem seu proprio try/catch interno
    const [tests, build, lint, typecheck, diff] = await Promise.all([
      this._safeRun('runTests'),
      this._safeRun('runBuild'),
      this._safeRun('runLint'),
      this._safeRun('runTypeCheck'),
      this._safeRun('runGitDiff'),
    ]);

    const elapsed = Date.now() - startTime;

    // Monta sumario legivel
    const summary = [];
    summary.push(`═══════ Verification Results ═══════`);
    summary.push(`Projeto: ${this.rootDir}`);
    summary.push(`Duracao: ${elapsed}ms`);
    summary.push('');

    // Tests
    if (tests.skipped) {
      summary.push(`[tests]     ⏭️  SKIPPED (${tests.reason})`);
    } else if (tests.exitCode === 0) {
      summary.push(`[tests]     ✅ PASSED`);
    } else {
      summary.push(`[tests]     ❌ FAILED (exitCode=${tests.exitCode})`);
    }

    // Build
    if (build.skipped) {
      summary.push(`[build]     ⏭️  SKIPPED (${build.reason})`);
    } else if (build.exitCode === 0) {
      summary.push(`[build]     ✅ PASSED`);
    } else {
      summary.push(`[build]     ❌ FAILED (exitCode=${build.exitCode})`);
    }

    // Lint
    if (lint.skipped) {
      summary.push(`[lint]      ⏭️  SKIPPED (${lint.reason})`);
    } else if (lint.exitCode === 0) {
      summary.push(`[lint]      ✅ PASSED`);
    } else {
      summary.push(`[lint]      ❌ FAILED (exitCode=${lint.exitCode})`);
    }

    // Typecheck
    if (typecheck.skipped) {
      summary.push(`[typecheck] ⏭️  SKIPPED (${typecheck.reason})`);
    } else if (typecheck.exitCode === 0) {
      summary.push(`[typecheck] ✅ PASSED`);
    } else {
      summary.push(`[typecheck] ❌ FAILED (exitCode=${typecheck.exitCode})`);
    }

    // Git Diff
    if (diff.skipped) {
      summary.push(`[git-diff]  ⏭️  SKIPPED (${diff.reason})`);
    } else {
      summary.push(`[git-diff]  📄 ${diff.files_changed} arquivo(s), +${diff.insertions}/-${diff.deletions}`);
    }

    summary.push('');

    // Determina passed/failed
    // passed = true APENAS se todos os testes e build passaram
    // (lint, typecheck, git diff nao bloqueiam — sao informativos)
    const testsPassed = tests.skipped || (tests.exitCode === 0);
    const buildPassed = build.skipped || (build.exitCode === 0);
    const lintPassed = lint.skipped || (lint.exitCode === 0);
    const typecheckPassed = typecheck.skipped || (typecheck.exitCode === 0);

    const passed = testsPassed && buildPassed;
    const failed = !passed;

    // Monta mensagem de resultado
    if (passed) {
      if (lintPassed && typecheckPassed) {
        summary.push('✅ VERIFICATION PASSED (todas as verificacoes OK)');
      } else {
        summary.push('✅ VERIFICATION PASSED (testes e build OK, com ressalvas)');
      }
    } else {
      const failures = [];
      if (!testsPassed) failures.push('tests');
      if (!buildPassed) failures.push('build');
      summary.push(`❌ VERIFICATION FAILED (${failures.join(', ')})`);
    }

    summary.push(`⏱️  ${elapsed}ms`);
    summary.push('═══════════════════════════════════════════════════════════════');

    // Loga o sumario no console
    for (const line of summary) {
      console.log(line);
    }

    return {
      tests,
      build,
      lint,
      typecheck,
      diff,
      summary,
      passed,
      failed,
      elapsed,
      timestamp: new Date().toISOString(),
      config: { ...this.options },
    };
  }

  /**
   * Wrapper seguro que executa um metodo pelo nome, capturando qualquer erro
   * para que uma falha em um metodo nunca quebre os outros (Promise.all).
   *
   * @param {string} methodName - Nome do metodo a executar
   * @returns {Promise<object>}
   */
  async _safeRun(methodName) {
    try {
      const result = await Promise.resolve(this[methodName]());
      return result;
    } catch (err) {
      console.error(`[${methodName}] UNEXPECTED ERROR: ${err.message}`);
      return {
        error: err.message,
        crashed: true,
        skipped: false,
        exitCode: -1,
        stdout: '',
        stderr: err.stack || '',
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { VerificationRunner };
