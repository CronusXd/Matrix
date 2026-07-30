#!/usr/bin/env node
/**
 * Matrix Pre-Judge Collector v1.0
 * =================================
 * Coletor de evidencias objetivas que roda ANTES do Fable Judge.
 *
 * Em vez do Judge precisar "descobrir" o que aconteceu (lendo git diff,
 * output de testes, etc.), o Matrix coleta TUDO e entrega como fatos
 * estruturados — prontos para o Judge consumir.
 *
 * Fluxo:
 *   1. Coleta diff (git diff --stat, arquivos alterados)
 *   2. Verifica escopo declarado vs real (scope creep detection)
 *   3. Executa testes (npm test) com analise de weakening
 *   4. Verifica build (npm run build)
 *   5. Reporta lint (npm run lint)
 *   6. Escaneia seguranca (npm audit)
 *   7. Gera sumario markdown para o Judge
 *
 * Uso:
 *   const { PreJudgeCollector } = require('./pre-judge-collector');
 *   const collector = new PreJudgeCollector('/caminho/do/projeto');
 *   const evidence = await collector.collect(taskDeclaration);
 *   console.log(evidence.summary);
 *
 * Dependencias: zero (apenas fs, path, child_process nativos)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ============================================================================
//  CONSTANTES
// ============================================================================

/** Numero maximo de linhas para truncar outputs longos. */
const MAX_OUTPUT_LINES = 300;

/** Timeout padrao para execucao de comandos (ms). */
const DEFAULT_TIMEOUT = 120000;

// ============================================================================
//  HELPERS INTERNOS
// ============================================================================

/**
 * Executa um comando via execSync com tratamento de erro robusto.
 * Nunca lanca excecao — sempre retorna um objeto padronizado.
 *
 * @param {string}  command         - Comando a executar
 * @param {object}  [options]       - Opcoes passadas ao execSync
 * @param {string}  [options.cwd]   - Diretorio de trabalho
 * @param {number}  [options.timeout] - Timeout em ms
 * @returns {{ exitCode: number, stdout: string, stderr: string, error: string|null }}
 */
function safeExec(command, options) {
  options = options || {};
  var defaults = {
    timeout: DEFAULT_TIMEOUT,
    maxBuffer: 10 * 1024 * 1024, // 10MB
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    encoding: 'utf-8',
  };

  var merged = {};
  for (var k in defaults) {
    if (defaults.hasOwnProperty(k)) merged[k] = defaults[k];
  }
  for (var k2 in options) {
    if (options.hasOwnProperty(k2)) merged[k2] = options[k2];
  }

  try {
    var stdout = execSync(command, merged);
    return {
      exitCode: 0,
      stdout: (stdout || '').toString(),
      stderr: '',
      error: null,
    };
  } catch (err) {
    var exitCode = err.status !== undefined ? err.status : 1;
    var stderr = (err.stderr || '').toString();
    var stdout = (err.stdout || '').toString();

    return {
      exitCode: exitCode,
      stdout: stdout,
      stderr: stderr,
      error: err.message || 'unknown error',
    };
  }
}

/**
 * Trunca uma string para um numero maximo de linhas.
 *
 * @param {string} str      - String a truncar
 * @param {number} maxLines - Numero maximo de linhas
 * @returns {string}
 */
function truncateLines(str, maxLines) {
  if (!str) return '';
  var lines = str.split('\n');
  if (lines.length <= maxLines) return str;
  return lines.slice(0, maxLines).join('\n') + '\n... (truncado, ' + (lines.length - maxLines) + ' linhas a mais)';
}

/**
 * Verifica se um script npm existe no package.json do diretorio.
 *
 * @param {string} dir        - Diretorio raiz do projeto
 * @param {string} scriptName - Nome do script (ex: "test", "build")
 * @returns {boolean}
 */
function hasNpmScript(dir, scriptName) {
  try {
    var pkgPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgPath)) return false;
    var pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    var scripts = pkg.scripts || {};
    return typeof scripts[scriptName] === 'string' && scripts[scriptName].length > 0;
  } catch (e) {
    return false;
  }
}

/**
 * Obtem o nome do projeto a partir do package.json ou do nome do diretorio.
 *
 * @param {string} dir - Diretorio raiz
 * @returns {string}
 */
function getProjectName(dir) {
  try {
    var pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      var pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.name) return pkg.name;
    }
  } catch (e) { /* fallback */ }
  return path.basename(dir);
}

/**
 * Verifica se o diretorio eh um repositorio git valido.
 *
 * @param {string} dir - Diretorio raiz
 * @returns {boolean}
 */
function isGitRepo(dir) {
  try {
    var result = execSync('git rev-parse --is-inside-work-tree', {
      cwd: dir,
      encoding: 'utf-8',
      stdio: 'pipe',
      windowsHide: true,
    });
    return (result || '').toString().trim() === 'true';
  } catch (e) {
    return false;
  }
}

/**
 * Extrai a lista de arquivos de um diff stat.
 * Parser do formato "src/file.js | 10 +++++-----"
 *
 * @param {string} statOutput - Saida do git diff --stat
 * @returns {string[]}
 */
function parseFilesFromStat(statOutput) {
  if (!statOutput) return [];
  var files = [];
  var lines = statOutput.split('\n');

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    // Filtra linhas de warning do git (ex: "warning: in the working copy...")
    if (line.indexOf('warning:') === 0) continue;
    // Pula a linha de sumario ("X files changed, Y insertions...")
    if (line.indexOf('files changed') !== -1 || line.indexOf('file changed') !== -1) continue;
    // Pula linhas sem "|" (que nao sao linhas de arquivo)
    if (line.indexOf('|') === -1) continue;
    // Extrai o nome do arquivo (tudo antes do ultimo " |")
    var pipeIdx = line.indexOf('|');
    if (pipeIdx === -1) continue;
    var fileName = line.substring(0, pipeIdx).trim();
    if (fileName) files.push(fileName);
  }

  return files;
}

// ============================================================================
//  PRE-JUDGE COLLECTOR
// ============================================================================

class PreJudgeCollector {

  /**
   * @param {string} projectDir - Caminho absoluto para a raiz do projeto
   * @param {object} [options]  - Configuracoes opcionais
   * @param {number} [options.timeout=120000] - Timeout por comando (ms)
   */
  constructor(projectDir, options) {
    if (!projectDir) {
      throw new Error('PreJudgeCollector: projectDir eh obrigatorio');
    }

    this.projectDir = path.resolve(projectDir);
    this.options = options || {};
    this.options.timeout = this.options.timeout || DEFAULT_TIMEOUT;

    /** Cache interno para o resultado do collect() — evita re-execucao. */
    this._cachedEvidence = null;
  }

  // ========================================================================
  //  METODO PRINCIPAL
  // ========================================================================

  /**
   * Metodo principal que orquestra todas as coletas de evidencia.
   *
   * @param {object}  taskDeclaration             - Declaracao da tarefa (vinda do fable-method-agent)
   * @param {string}  [taskDeclaration.task]      - Descricao da tarefa
   * @param {string[]}[taskDeclaration.files_to_touch] - Arquivos que a tarefa deveria modificar
   * @param {object}  [taskDeclaration.checks]    - Verificacoes esperadas (opcional)
   * @returns {Promise<object>} Objeto completo de evidencias
   */
  async collect(taskDeclaration) {
    var startTime = Date.now();
    var projectName = getProjectName(this.projectDir);

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  Matrix Pre-Judge Collector v1.0');
    console.log('  Projeto: ' + projectName);
    console.log('  Diretorio: ' + this.projectDir);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');

    // 1. Diff analysis
    console.log('[diff]     Coletando informacoes do git diff...');
    var diff = this.getDiff();

    // 2. Scope compliance
    console.log('[scope]    Verificando conformidade de escopo...');
    var scope = this.checkScope(taskDeclaration);

    // 3. Test analysis
    console.log('[tests]    Executando testes...');
    var tests = this.getTestAnalysis();

    // 4. Build status
    console.log('[build]    Verificando build...');
    var build = this.getBuildStatus();

    // 5. Lint report
    console.log('[lint]     Executando lint...');
    var lint = this.getLintReport();

    // 6. Security analysis
    console.log('[security] Escaneando vulnerabilidades...');
    var security = this.getSecurityAnalysis();

    // 7. Monta resultado completo
    var evidence = {
      collected_at: new Date().toISOString(),
      project: projectName,
      project_dir: this.projectDir,
      duration_ms: Date.now() - startTime,

      diff: diff,
      scope: scope,
      tests: tests,
      build: build,
      lint: lint,
      security: security,
    };

    // 8. Determina blocking issues e passed/failed
    evidence.blocking_issues = this._determineBlockingIssues(evidence);
    evidence.passed = evidence.blocking_issues.length === 0;
    evidence.summary = this._buildSummaryMarkdown(evidence, taskDeclaration);

    // Cache
    this._cachedEvidence = evidence;

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    if (evidence.passed) {
      console.log('  ✅ COLETA CONCLUIDA — Sem issues bloqueantes');
    } else {
      console.log('  ⚠️  COLETA CONCLUIDA — ' + evidence.blocking_issues.length + ' issue(s) bloqueante(s)');
      for (var bi = 0; bi < evidence.blocking_issues.length; bi++) {
        console.log('     - ' + evidence.blocking_issues[bi]);
      }
    }
    console.log('  Duracao: ' + evidence.duration_ms + 'ms');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');

    return evidence;
  }

  // ========================================================================
  //  1. DIFF ANALYSIS
  // ========================================================================

  /**
   * Coleta o git diff detalhado do projeto.
   * Retorna lista de arquivos alterados, adicionados, modificados, deletados,
   * contagem de insercoes/delecoes e o diff stat completo.
   *
   * @returns {{
   *   files_changed: string[],
   *   files_added: string[],
   *   files_modified: string[],
   *   files_deleted: string[],
   *   insertions: number,
   *   deletions: number,
   *   stat: string,
   *   full_diff: string,
   *   has_changes: boolean,
   *   error: string|null,
   * }}
   */
  getDiff() {
    if (!isGitRepo(this.projectDir)) {
      return {
        files_changed: [],
        files_added: [],
        files_modified: [],
        files_deleted: [],
        insertions: 0,
        deletions: 0,
        stat: '',
        full_diff: '',
        has_changes: false,
        error: 'not a git repository',
      };
    }

    var cwd = this.projectDir;

    // --stat total (working + staged vs HEAD)
    var statRaw = safeExec('git diff --stat HEAD 2>&1 || echo "(sem commits para comparar)"', { cwd: cwd });

    // diff completo
    var diffRaw = safeExec('git diff HEAD 2>&1 || true', { cwd: cwd });

    // diff do staged (--cached)
    var stagedRaw = safeExec('git diff --cached --stat 2>&1 || true', { cwd: cwd });

    // diff --name-status para categorizar arquivos
    var nameStatusRaw = safeExec('git diff --name-status HEAD 2>&1 || true', { cwd: cwd });

    // ── Parse do stat ───────────────────────────────────────────────────
    var statOutputRaw = statRaw.stdout || '';
    var statOutput = statOutputRaw.split('\n')
      .filter(function(l) { return l.indexOf('warning:') !== 0; })
      .join('\n');
    var insertions = 0;
    var deletions = 0;

    if (statOutput) {
      var summaryLine = statOutput
        .split('\n')
        .filter(function (l) { return l.indexOf('insertion') !== -1 || l.indexOf('deletion') !== -1; })
        .pop();

      if (summaryLine) {
        var insMatch = summaryLine.match(/(\d+)\s*insertion/);
        var delMatch = summaryLine.match(/(\d+)\s*deletion/);
        if (insMatch) insertions = parseInt(insMatch[1], 10);
        if (delMatch) deletions = parseInt(delMatch[1], 10);
      } else {
        // Fallback: parser linha a linha
        var statLines = statOutput.split('\n');
        for (var s = 0; s < statLines.length; s++) {
          var stLine = statLines[s];
          var insMatch2 = stLine.match(/(\d+)\s*\+/);
          var delMatch2 = stLine.match(/(\d+)\s*-/);
          if (insMatch2) insertions += parseInt(insMatch2[1], 10);
          if (delMatch2) deletions += parseInt(delMatch2[1], 10);
        }
      }
    }

    // ── Categoriza arquivos ─────────────────────────────────────────────
    var filesAdded = [];
    var filesModified = [];
    var filesDeleted = [];
    var filesChanged = [];

    if (nameStatusRaw.stdout) {
      var nsLines = nameStatusRaw.stdout.trim().split('\n');
      for (var n = 0; n < nsLines.length; n++) {
        var nsLine = nsLines[n].trim();
        if (!nsLine) continue;
        // Filtra linhas de warning do git (ex: "warning: in the working copy... LF will be replaced...")
        if (nsLine.indexOf('warning:') === 0) continue;
        var parts = nsLine.split(/\s+/);
        if (parts.length < 2) continue;
        var status = parts[0];
        var filePath = parts.slice(1).join(' ');

        switch (status) {
          case 'A':
            filesAdded.push(filePath);
            break;
          case 'M':
          case 'M\t':
            filesModified.push(filePath);
            break;
          case 'D':
            filesDeleted.push(filePath);
            break;
          case 'R':
            // Rename: "R100\told\tnew"
            if (parts.length >= 3) {
              filesAdded.push(parts[parts.length - 1]);
              filesDeleted.push(parts[1]);
            }
            break;
          case 'C':
            filesAdded.push(filePath);
            break;
          default:
            // Qualquer outro status (??, MM, etc) trata como modified
            filesModified.push(filePath);
            break;
        }
        filesChanged.push(filePath);
      }
    }

    // Se name-status falhou ou veio vazio, fallback para parse do --stat
    if (filesChanged.length === 0 && statOutput) {
      filesChanged = parseFilesFromStat(statOutput);
      filesModified = filesChanged.slice(); // nao temos categorizacao fina
    }

    var fullDiff = truncateLines(diffRaw.stdout || '', MAX_OUTPUT_LINES);

    return {
      files_changed: filesChanged,
      files_added: filesAdded,
      files_modified: filesModified,
      files_deleted: filesDeleted,
      insertions: insertions,
      deletions: deletions,
      stat: statOutput || '',
      staged_stat: truncateLines(stagedRaw.stdout || '', 100),
      full_diff: fullDiff || '(nenhuma diferenca)',
      has_changes: filesChanged.length > 0,
      error: statRaw.error || diffRaw.error || null,
    };
  }

  // ========================================================================
  //  2. SCOPE COMPLIANCE
  // ========================================================================

  /**
   * Compara o escopo declarado na taskDeclaration com as alteracoes reais
   * detectadas pelo git diff. Detecta scope creep (arquivos alterados
   * que nao estavam no escopo declarado).
   *
   * @param {object} taskDeclaration - Declaracao da tarefa
   * @returns {{
   *   declared_files: string[],
   *   actual_files: string[],
   *   out_of_scope: string[],
   *   scope_creep: boolean,
   *   scope_creep_detail: string,
   *   files_missing: string[],
   * }}
   */
  checkScope(taskDeclaration) {
    var declared = [];
    var declaredRaw = (taskDeclaration && taskDeclaration.files_to_touch) || [];

    // Normaliza caminhos declarados
    for (var d = 0; d < declaredRaw.length; d++) {
      var declPath = declaredRaw[d];
      if (typeof declPath === 'string') {
        declared.push(declPath.replace(/\//g, path.sep));
      }
    }

    // Arquivos reais (do git diff)
    var diff = this._cachedEvidence ? this._cachedEvidence.diff : this.getDiff();
    var actual = diff.files_changed || [];

    // Detecta out-of-scope: arquivos alterados que nao estavam declarados
    var outOfScope = [];
    for (var a = 0; a < actual.length; a++) {
      var actualFile = actual[a];
      var found = false;
      for (var d2 = 0; d2 < declared.length; d2++) {
        // Comparacao flexivel: suporta match exato ou por sufixo
        var declaredFile = declared[d2];
        if (actualFile === declaredFile) {
          found = true;
          break;
        }
        // Se o caminho declarado termina com o actual ou vice-versa
        if (actualFile.indexOf(declaredFile) !== -1 || declaredFile.indexOf(actualFile) !== -1) {
          found = true;
          break;
        }
      }
      if (!found) {
        outOfScope.push(actualFile);
      }
    }

    // Detecta files missing: declarados mas nao alterados
    var filesMissing = [];
    for (var d3 = 0; d3 < declared.length; d3++) {
      var decl = declared[d3];
      var missing = true;
      for (var a2 = 0; a2 < actual.length; a2++) {
        if (actual[a2].indexOf(decl) !== -1 || decl.indexOf(actual[a2]) !== -1) {
          missing = false;
          break;
        }
      }
      if (missing) {
        filesMissing.push(decl);
      }
    }

    var scopeCreep = outOfScope.length > 0;
    var scopeCreepDetail = '';

    if (scopeCreep) {
      scopeCreepDetail = '⚠️ Scope creep detectado: ' + outOfScope.length + ' arquivo(s) alterado(s) nao declarado(s)';
      if (outOfScope.length <= 5) {
        scopeCreepDetail += ': ' + outOfScope.join(', ');
      } else {
        scopeCreepDetail += ': ' + outOfScope.slice(0, 5).join(', ') + ' ... (+' + (outOfScope.length - 5) + ' outros)';
      }
    } else if (filesMissing.length > 0) {
      scopeCreepDetail = '⚠️ ' + filesMissing.length + ' arquivo(s) declarado(s) nao foram alterados';
      if (filesMissing.length <= 5) {
        scopeCreepDetail += ': ' + filesMissing.join(', ');
      } else {
        scopeCreepDetail += ': ' + filesMissing.slice(0, 5).join(', ') + ' ... (+' + (filesMissing.length - 5) + ' outros)';
      }
    } else {
      scopeCreepDetail = '✅ Escopo 100% conforme o declarado';
    }

    return {
      declared_files: declared,
      actual_files: actual,
      out_of_scope: outOfScope,
      files_missing: filesMissing,
      scope_creep: scopeCreep,
      scope_creep_detail: scopeCreepDetail,
    };
  }

  // ========================================================================
  //  3. TEST ANALYSIS
  // ========================================================================

  /**
   * Executa os testes (npm test) e analisa o resultado.
   * Inclui deteccao de weakening: quando testes passam mas com suspeita
   * de terem sido enfraquecidos (pulando assertions, testes vazios, etc).
   *
   * @returns {{
   *   status: string,
   *   exit_code: number|null,
   *   output: string,
   *   summary: string,
   *   weakening_detected: boolean,
   *   weakening_detail: string,
   *   skipped: boolean,
   * }}
   */
  getTestAnalysis() {
    if (!hasNpmScript(this.projectDir, 'test')) {
      return {
        status: 'skipped',
        exit_code: null,
        output: '',
        summary: '⏭️  Testes skippados: npm script "test" nao encontrado',
        weakening_detected: false,
        weakening_detail: '',
        skipped: true,
      };
    }

    var raw = safeExec('npm test 2>&1 || true', {
      cwd: this.projectDir,
      timeout: this.options.timeout,
    });

    var output = truncateLines((raw.stdout || '') + '\n' + (raw.stderr || ''), MAX_OUTPUT_LINES);
    var status = raw.exitCode === 0 ? 'passed' : 'failed';

    // Tenta extrair sumario de saida comum de test runners
    var summary = this._parseTestSummary(raw.stdout, raw.exitCode);

    // Analise de weakening
    var weakening = this._detectWeakening(raw.stdout, raw.stderr);

    return {
      status: status,
      exit_code: raw.exitCode,
      output: output,
      summary: summary,
      weakening_detected: weakening.detected,
      weakening_detail: weakening.detail,
      skipped: false,
    };
  }

  /**
   * Tenta extrair um sumario legivel da saida dos testes.
   * Suporta: Jest, Mocha, AVA, Vitest, PHPUnit.
   *
   * @param {string} stdout   - Saida padrao dos testes
   * @param {number} exitCode - Codigo de saida
   * @returns {string}
   */
  _parseTestSummary(stdout, exitCode) {
    if (!stdout) {
      return exitCode === 0
        ? 'Testes executados com sucesso (exitCode=0) — sem output detalhado'
        : 'Testes falharam (exitCode=' + exitCode + ') — sem output detalhado';
    }

    var lines = stdout.split('\n');

    // ── Jest ──────────────────────────────────────────────────────────
    // "Tests:       12 passed, 12 total"
    // "Tests:       10 passed, 2 failed, 12 total"
    for (var j = 0; j < lines.length; j++) {
      var line = lines[j].trim();
      if (line.indexOf('Tests:') !== -1 && (line.indexOf('passed') !== -1 || line.indexOf('failed') !== -1)) {
        return line.replace(/^\s*✓?\s*/, '').trim();
      }
    }

    // ── Mocha ─────────────────────────────────────────────────────────
    // "  12 passing (2s)"
    // "  2 failing"
    for (var m = 0; m < lines.length; m++) {
      var ml = lines[m].trim();
      if (ml.indexOf('passing') !== -1 || (ml.indexOf('failing') !== -1 && ml.match(/\d+/))) {
        return ml.replace(/^\s+/, '');
      }
    }

    // ── AVA ───────────────────────────────────────────────────────────
    // "  12 tests passed"
    for (var av = 0; av < lines.length; av++) {
      var avl = lines[av].trim();
      if (avl.indexOf('tests passed') !== -1 || avl.indexOf('tests failed') !== -1) {
        return avl;
      }
    }

    // ── PHPUnit ───────────────────────────────────────────────────────
    // "OK (12 tests, 15 assertions)"
    // "FAILURES!"
    for (var p = 0; p < lines.length; p++) {
      var pl = lines[p].trim();
      if (pl.indexOf('OK (') !== -1 && pl.indexOf('tests') !== -1) {
        return pl;
      }
      if (pl === 'FAILURES!' || pl === 'ERRORS!') {
        // Pega a linha seguinte
        if (p + 1 < lines.length) {
          return pl + ' ' + lines[p + 1].trim();
        }
        return pl;
      }
    }

    // ── Fallback: ultima linha nao vazia ──────────────────────────────
    var lastLine = '';
    for (var i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim()) {
        lastLine = lines[i].trim();
        break;
      }
    }

    if (lastLine) {
      return lastLine + ' (exitCode=' + exitCode + ')';
    }

    return exitCode === 0
      ? 'Testes passaram (exitCode=0)'
      : 'Testes falharam (exitCode=' + exitCode + ')';
  }

  /**
   * Detecta possivel weakening nos testes:
   * - testes vazios (describe/it sem assertions)
   * - todos os testes pulados via .skip
   * - timeout excessivamente curto
   * - testes marcados como .todo
   *
   * @param {string} stdout - Saida padrao
   * @param {string} stderr - Saida de erro
   * @returns {{ detected: boolean, detail: string }}
   */
  _detectWeakening(stdout, stderr) {
    var combined = (stdout || '') + '\n' + (stderr || '');

    var warnings = [];

    // 1. Testes vazios (describe/it sem funcao ou com funcao vazia)
    var emptyTestMatches = combined.match(/(?:it|test|describe)\([^)]*\)\s*;?$/gm);
    if (emptyTestMatches && emptyTestMatches.length > 0) {
      warnings.push('' + emptyTestMatches.length + ' possivel(is) teste(s) vazio(s) (it/test sem callback)');
    }

    // 2. Testes pulados (.skip)
    var skipMatches = combined.match(/\.skip\s*\(/g);
    if (skipMatches && skipMatches.length > 0) {
      warnings.push('' + skipMatches.length + ' teste(s) pulado(s) via .skip');
    }

    // 3. Testes .todo
    var todoMatches = combined.match(/\.todo\s*\(/g);
    if (todoMatches && todoMatches.length > 0) {
      warnings.push('' + todoMatches.length + ' teste(s) marcado(s) como .todo (nao implementados)');
    }

    // 4. "passed" com 0 assertions (Jest: "Tests: 0 tests")
    var zeroTestsMatch = combined.match(/Tests:\s*0\s*tests/i);
    if (zeroTestsMatch) {
      warnings.push('0 testes executados — possivel weakening');
    }

    // 5. Nenhum assertion ("expect" ou "assert" ausente)
    var expectCount = (combined.match(/\bexpect\s*\(/g) || []).length;
    var assertCount = (combined.match(/\bassert\s*\(/g) || []).length;
    var itCount = (combined.match(/\bit\s*\(/g) || []).length;
    var testCount = (combined.match(/\btest\s*\(/g) || []).length;

    var totalAssertions = expectCount + assertCount;
    var totalTests = itCount + testCount;

    if (totalTests > 0 && totalAssertions === 0) {
      warnings.push('Nenhuma assertion (expect/assert) encontrada — ' + totalTests + ' teste(s) podem estar sem verificacao');
    }

    if (warnings.length === 0) {
      return { detected: false, detail: 'Nenhum sinal de weakening detectado' };
    }

    return {
      detected: true,
      detail: '⚠️ Possivel weakening detectado:\n  - ' + warnings.join('\n  - '),
    };
  }

  // ========================================================================
  //  4. BUILD STATUS
  // ========================================================================

  /**
   * Executa npm run build e retorna o status.
   *
   * @returns {{
   *   status: string,
   *   exit_code: number|null,
   *   output: string,
   *   skipped: boolean,
   * }}
   */
  getBuildStatus() {
    if (!hasNpmScript(this.projectDir, 'build')) {
      return {
        status: 'skipped',
        exit_code: null,
        output: '',
        skipped: true,
      };
    }

    var raw = safeExec('npm run build 2>&1 || true', {
      cwd: this.projectDir,
      timeout: this.options.timeout,
    });

    var output = truncateLines((raw.stdout || '') + '\n' + (raw.stderr || ''), MAX_OUTPUT_LINES);
    var status = raw.exitCode === 0 ? 'passed' : 'failed';

    return {
      status: status,
      exit_code: raw.exitCode,
      output: output,
      skipped: false,
    };
  }

  // ========================================================================
  //  5. LINT REPORT
  // ========================================================================

  /**
   * Executa npm run lint e analisa o resultado.
   * Tenta parsear contagem de erros e warnings de linters comuns
   * (ESLint, Standard, Prettier, PHP_CodeSniffer).
   *
   * @returns {{
   *   status: string,
   *   errors_count: number,
   *   warnings_count: number,
   *   output: string,
   *   skipped: boolean,
   * }}
   */
  getLintReport() {
    if (!hasNpmScript(this.projectDir, 'lint')) {
      return {
        status: 'skipped',
        errors_count: 0,
        warnings_count: 0,
        output: '',
        skipped: true,
      };
    }

    var raw = safeExec('npm run lint 2>&1 || true', {
      cwd: this.projectDir,
      timeout: this.options.timeout,
    });

    var output = truncateLines((raw.stdout || '') + '\n' + (raw.stderr || ''), MAX_OUTPUT_LINES);
    var errorsCount = 0;
    var warningsCount = 0;

    // ── Parse de linters comuns ─────────────────────────────────────────
    var combinedOutput = (raw.stdout || '') + '\n' + (raw.stderr || '');

    // ESLint: "✖ 2 problems (1 error, 1 warning)"
    var eslintMatch = combinedOutput.match(/(\d+)\s*problems?\s*\((\d+)\s*error.*,\s*(\d+)\s*warning/);
    if (eslintMatch) {
      errorsCount = parseInt(eslintMatch[2], 10);
      warningsCount = parseInt(eslintMatch[3], 10);
    } else {
      // ESLint formato alternativo: "2 errors and 1 warning"
      var eslintMatch2 = combinedOutput.match(/(\d+)\s*errors?\s*and\s*(\d+)\s*warnings?/);
      if (eslintMatch2) {
        errorsCount = parseInt(eslintMatch2[1], 10);
        warningsCount = parseInt(eslintMatch2[2], 10);
      } else {
        // PHP_CodeSniffer: "FOUND 2 ERRORS AND 1 WARNING"
        var phpcsMatch = combinedOutput.match(/FOUND\s+(\d+)\s+ERRORS?\s+AND\s+(\d+)\s+WARNINGS?/i);
        if (phpcsMatch) {
          errorsCount = parseInt(phpcsMatch[1], 10);
          warningsCount = parseInt(phpcsMatch[2], 10);
        } else {
          // Standard JS: "2 errors, 1 warning"
          var stdMatch = combinedOutput.match(/(\d+)\s*errors?,\s*(\d+)\s*warnings?/);
          if (stdMatch) {
            errorsCount = parseInt(stdMatch[1], 10);
            warningsCount = parseInt(stdMatch[2], 10);
          } else {
            // Fallback: conta linhas com "error" e "warning" no output
            var errorLines = combinedOutput.match(/error/g);
            var warnLines = combinedOutput.match(/warning/g);
            if (errorLines) errorsCount = errorLines.length;
            if (warnLines) warningsCount = warnLines.length;
          }
        }
      }
    }

    var status = 'clean';
    if (errorsCount > 0) {
      status = 'errors';
    } else if (warningsCount > 0) {
      status = 'warnings';
    }

    return {
      status: status,
      errors_count: errorsCount,
      warnings_count: warningsCount,
      output: output,
      skipped: false,
    };
  }

  // ========================================================================
  //  6. SECURITY ANALYSIS
  // ========================================================================

  /**
   * Executa npm audit e analisa vulnerabilidades.
   * NON-BLOCKING: se npm audit falhar (ex: sem package-lock.json),
   * retorna resultado vazio sem quebrar a coleta.
   *
   * @returns {{
   *   vulnerabilities: number,
   *   critical: number,
   *   high: number,
   *   medium: number,
   *   low: number,
   *   audit_output: string,
   *   skipped: boolean,
   * }}
   */
  getSecurityAnalysis() {
    // Verifica se existe package-lock.json ou yarn.lock
    var hasLockFile = fs.existsSync(path.join(this.projectDir, 'package-lock.json')) ||
                      fs.existsSync(path.join(this.projectDir, 'yarn.lock'));

    if (!hasLockFile) {
      return {
        vulnerabilities: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        audit_output: '',
        skipped: true,
      };
    }

    var raw = safeExec('npm audit --json 2>&1 || true', {
      cwd: this.projectDir,
      timeout: this.options.timeout,
    });

    var vulnerabilities = 0;
    var critical = 0;
    var high = 0;
    var medium = 0;
    var low = 0;

    // Tenta parsear JSON do npm audit
    if (raw.stdout) {
      try {
        var auditJson = JSON.parse(raw.stdout);

        // npm audit JSON tem metadados em "metadata" e "vulnerabilities"
        if (auditJson.metadata && auditJson.metadata.vulnerabilities) {
          var v = auditJson.metadata.vulnerabilities;
          critical = v.critical || 0;
          high = v.high || 0;
          medium = v.medium || 0;
          low = v.low || 0;
          vulnerabilities = critical + high + medium + low;
        } else if (auditJson.vulnerabilities) {
          // Formato alternativo
          var vulnMap = auditJson.vulnerabilities;
          for (var key in vulnMap) {
            if (vulnMap.hasOwnProperty(key)) {
              var severity = (vulnMap[key].severity || '').toLowerCase();
              switch (severity) {
                case 'critical': critical++; break;
                case 'high': high++; break;
                case 'medium': medium++; break;
                case 'low': low++; break;
              }
              vulnerabilities++;
            }
          }
        }
      } catch (parseErr) {
        // Se o parse falhar, tenta parse textual do output nao-JSON
        var textOutput = raw.stdout;

        var critMatch = textOutput.match(/(\d+)\s*critical/i);
        var highMatch = textOutput.match(/(\d+)\s*high/i);
        var medMatch = textOutput.match(/(\d+)\s*medium/i);
        var lowMatch = textOutput.match(/(\d+)\s*low/i);

        if (critMatch) critical = parseInt(critMatch[1], 10);
        if (highMatch) high = parseInt(highMatch[1], 10);
        if (medMatch) medium = parseInt(medMatch[1], 10);
        if (lowMatch) low = parseInt(lowMatch[1], 10);

        vulnerabilities = critical + high + medium + low;
      }
    }

    return {
      vulnerabilities: vulnerabilities,
      critical: critical,
      high: high,
      medium: medium,
      low: low,
      audit_output: truncateLines(raw.stdout || raw.stderr || '', MAX_OUTPUT_LINES),
      skipped: false,
    };
  }

  // ========================================================================
  //  7. SUMMARY — Markdown para o Judge
  // ========================================================================

  /**
   * Gera o sumario markdown formatado para o Judge ler.
   * Metodo publico que pode ser chamado independentemente.
   *
   * @returns {string} Markdown formatado
   */
  generateSummary() {
    // Usa o cache do collect() se disponivel, ou monta um basico
    var evidence = this._cachedEvidence;
    if (!evidence) {
      // Tenta coletar evidencias com taskDeclaration vazia
      return '⚠️ Nenhuma evidencia coletada. Execute collect(taskDeclaration) primeiro.';
    }

    return this._buildSummaryMarkdown(evidence, null);
  }

  /**
   * Constroi o sumario markdown a partir do objeto de evidencia completo.
   *
   * @param {object}  evidence         - Objeto completo de evidencia
   * @param {object|null} taskDeclaration - Declaracao original da tarefa (opcional)
   * @returns {string}
   */
  _buildSummaryMarkdown(evidence, taskDeclaration) {
    var md = '';
    var taskName = (taskDeclaration && taskDeclaration.task) || 'Tarefa sem nome';

    md += '## Evidencias Objetivas (coletadas pelo Matrix)\n';
    md += '\n';
    md += '**Projeto:** ' + evidence.project + '\n';
    md += '**Tarefa:** ' + taskName + '\n';
    md += '**Coletado em:** ' + evidence.collected_at + '\n';
    md += '**Duracao:** ' + evidence.duration_ms + 'ms\n';
    md += '\n';

    // ── O que mudou ───────────────────────────────────────────────────
    md += '### O que mudou\n';
    md += '- Arquivos alterados: ' + (evidence.diff.files_changed.length || 0) + '\n';
    if (evidence.diff.files_changed.length > 0) {
      md += '- Arquivos: ' + evidence.diff.files_changed.slice(0, 10).join(', ');
      if (evidence.diff.files_changed.length > 10) {
        md += ' ... (+' + (evidence.diff.files_changed.length - 10) + ' outros)';
      }
      md += '\n';
    }
    md += '- Insercoes: ' + evidence.diff.insertions + ', Delecoes: ' + evidence.diff.deletions + '\n';

    if (evidence.diff.files_added.length > 0) {
      md += '- Adicionados: ' + evidence.diff.files_added.join(', ') + '\n';
    }
    if (evidence.diff.files_deleted.length > 0) {
      md += '- Deletados: ' + evidence.diff.files_deleted.join(', ') + '\n';
    }
    md += '\n';

    // ── Escopo ────────────────────────────────────────────────────────
    md += '### Escopo\n';

    if (evidence.scope.declared_files.length > 0) {
      md += '- Declarado: ' + evidence.scope.declared_files.join(', ') + '\n';
    } else {
      md += '- Declarado: (nenhum arquivo declarado na task)\n';
    }

    if (evidence.scope.actual_files.length > 0) {
      md += '- Real: ' + evidence.scope.actual_files.slice(0, 15).join(', ');
      if (evidence.scope.actual_files.length > 15) {
        md += ' ... (+' + (evidence.scope.actual_files.length - 15) + ' outros)';
      }
      md += '\n';
    } else {
      md += '- Real: (nenhuma alteracao detectada)\n';
    }

    if (evidence.scope.scope_creep) {
      md += '- ⚠️ Scope creep: ' + evidence.scope.out_of_scope.slice(0, 10).join(', ');
      if (evidence.scope.out_of_scope.length > 10) {
        md += ' ... (+' + (evidence.scope.out_of_scope.length - 10) + ' outros)';
      }
      md += ' nao estava no escopo\n';
    } else if (evidence.scope.files_missing.length > 0) {
      md += '- ⚠️ Arquivos declarados nao alterados: ' + evidence.scope.files_missing.join(', ') + '\n';
    } else {
      md += '- ✅ Escopo 100% conforme\n';
    }
    md += '\n';

    // ── Testes ────────────────────────────────────────────────────────
    md += '### Testes\n';
    if (evidence.tests.skipped) {
      md += '- Status: ⏭️  SKIPPED (' + evidence.tests.summary + ')\n';
    } else if (evidence.tests.status === 'passed') {
      md += '- Status: ✅ PASSED (' + evidence.tests.summary + ')\n';
    } else {
      md += '- Status: ❌ FAILED (' + evidence.tests.summary + ')\n';
    }

    if (evidence.tests.weakening_detected) {
      md += '- ⚠️ Weakening: DETECTADO\n';
      md += '  ' + evidence.tests.weakening_detail.replace(/\n/g, '\n  ') + '\n';
    } else {
      md += '- Weakening: Nao detectado\n';
    }
    md += '\n';

    // ── Build ─────────────────────────────────────────────────────────
    md += '### Build\n';
    if (evidence.build.skipped) {
      md += '- Status: ⏭️  SKIPPED (npm script "build" nao encontrado)\n';
    } else if (evidence.build.status === 'passed') {
      md += '- Status: ✅ PASSED\n';
    } else {
      md += '- Status: ❌ FAILED (exitCode=' + evidence.build.exit_code + ')\n';
    }
    md += '\n';

    // ── Lint ──────────────────────────────────────────────────────────
    md += '### Lint\n';
    if (evidence.lint.skipped) {
      md += '- Status: ⏭️  SKIPPED (npm script "lint" nao encontrado)\n';
    } else {
      var lintIcon = evidence.lint.status === 'clean' ? '✅' : (evidence.lint.status === 'warnings' ? '⚠️' : '❌');
      md += '- Status: ' + lintIcon + ' ' + evidence.lint.status.toUpperCase();
      if (evidence.lint.errors_count > 0 || evidence.lint.warnings_count > 0) {
        md += ' (' + evidence.lint.errors_count + ' erros, ' + evidence.lint.warnings_count + ' warnings)';
      }
      md += '\n';
    }
    md += '\n';

    // ── Seguranca ─────────────────────────────────────────────────────
    md += '### Seguranca\n';
    if (evidence.security.skipped) {
      md += '- Status: ⏭️  SKIPPED (sem lockfile)\n';
    } else if (evidence.security.vulnerabilities === 0) {
      md += '- 0 vulnerabilidades encontradas ✅\n';
    } else {
      md += '- ' + evidence.security.vulnerabilities + ' vulnerabilidade(s):\n';
      md += '  - Criticas: ' + evidence.security.critical + '\n';
      md += '  - Altas: ' + evidence.security.high + '\n';
      md += '  - Medias: ' + evidence.security.medium + '\n';
      md += '  - Baixas: ' + evidence.security.low + '\n';
    }
    md += '\n';

    // ── Conclusao ─────────────────────────────────────────────────────
    md += '### Conclusao da Matrix\n';

    if (evidence.blocking_issues.length === 0) {
      md += '✅ **Pronto para revisao do Judge.** Todas as verificacoes passaram, sem issues bloqueantes.\n';
    } else {
      md += '⚠️ **' + evidence.blocking_issues.length + ' issue(s) bloqueante(s):**\n';
      for (var bi = 0; bi < evidence.blocking_issues.length; bi++) {
        md += '- ' + evidence.blocking_issues[bi] + '\n';
      }
      md += '\n';
      md += '**Encaminhamento:** Corrigir issues antes de enviar ao Judge.\n';
    }

    return md;
  }

  // ========================================================================
  //  DETERMINACAO DE ISSUES BLOQUEANTES
  // ========================================================================

  /**
   * Analisa todas as evidencias e determina quais issues impedem
   * a aprovacao. Um issue eh bloqueante quando:
   *   - Testes falharam (nao skippados)
   *   - Build falhou (nao skippado)
   *   - Scope creep critico (mais de 5 arquivos out-of-scope)
   *   - Vulnerabilidade critica de seguranca
   *
   * @param {object} evidence - Objeto completo de evidencia
   * @returns {string[]} Lista de issues bloqueantes
   */
  _determineBlockingIssues(evidence) {
    var issues = [];

    // 1. Testes falharam
    if (!evidence.tests.skipped && evidence.tests.status === 'failed') {
      issues.push('Testes falharam (exitCode=' + evidence.tests.exit_code + '): ' + evidence.tests.summary);
    }

    // 2. Weakening detectado
    if (evidence.tests.weakening_detected) {
      issues.push('Possivel weakening em testes detectado — revisar qualidade dos testes');
    }

    // 3. Build falhou
    if (!evidence.build.skipped && evidence.build.status === 'failed') {
      issues.push('Build falhou (exitCode=' + evidence.build.exit_code + ')');
    }

    // 4. Lint com erros (apenas erros, warnings nao bloqueiam)
    if (!evidence.lint.skipped && evidence.lint.errors_count > 0) {
      issues.push('Lint com ' + evidence.lint.errors_count + ' erro(s)');
    }

    // 5. Scope creep significativo (> 5 arquivos)
    if (evidence.scope.scope_creep && evidence.scope.out_of_scope.length > 5) {
      issues.push('Scope creep significativo: ' + evidence.scope.out_of_scope.length + ' arquivo(s) fora do escopo declarado');
    }

    // 6. Vulnerabilidades criticas
    if (evidence.security.critical > 0) {
      issues.push(evidence.security.critical + ' vulnerabilidade(s) critica(s) de seguranca');
    }

    // 7. Erro no diff (git nao disponivel)
    if (evidence.diff.error && evidence.diff.error !== 'not a git repository') {
      issues.push('Erro ao coletar git diff: ' + evidence.diff.error);
    }

    return issues;
  }
}

// ============================================================================
//  EXPORTS
// ============================================================================

module.exports = { PreJudgeCollector };
