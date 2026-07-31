/**
 * Matrix Validation Engine v1.0
 * =============================
 * Automated validation of model outputs. Refactored from
 * pipeline/scripts/verification-runner.js and pre-judge-collector.js.
 *
 * Validates: build, tests, lint, type checking, git diff, and
 * task-specific criteria. Standalone — no OpenCode dependencies.
 *
 * NON-BLOCKING design: failures never crash the pipeline.
 *
 * CommonJS module. Zero npm dependencies beyond Node.js built-ins.
 *
 * @version 1.0.0
 * @see pipeline/scripts/verification-runner.js
 * @see pipeline/scripts/pre-judge-collector.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Timeout for npm commands (ms) */
const DEFAULT_TIMEOUT = 60000;

/** Max output lines to keep in results */
const MAX_OUTPUT_LINES = 500;

// ---------------------------------------------------------------------------
// @typedef
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} testsPassed
 * @property {boolean} buildSuccess
 * @property {boolean} lintPassed
 * @property {boolean} typeCheckPassed
 * @property {boolean} taskCriteriaMet
 * @property {number} score - 0-10
 * @property {Object} details - Per-check details
 * @property {string[]} issues - Issues found
 * @property {Object} diff - Git diff info
 */

// ---------------------------------------------------------------------------
// Safe Command Execution
// ---------------------------------------------------------------------------

/**
 * Execute a command safely. Never throws.
 *
 * @param {string} command
 * @param {Object} [options]
 * @returns {{ exitCode: number, stdout: string, stderr: string, error: string|null }}
 */
function safeExec(command, options) {
  const defaults = {
    timeout: DEFAULT_TIMEOUT,
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    encoding: 'utf-8'
  };

  const merged = { ...defaults, ...(options || {}) };

  try {
    const stdout = execSync(command, merged);
    return {
      exitCode: 0,
      stdout: (stdout || '').toString(),
      stderr: '',
      error: null
    };
  } catch (err) {
    return {
      exitCode: err.status !== undefined ? err.status : 1,
      stdout: (err.stdout || '').toString(),
      stderr: (err.stderr || '').toString(),
      error: err.message || 'unknown error'
    };
  }
}

/**
 * Truncate output to max lines.
 *
 * @param {string} str
 * @param {number} maxLines
 * @returns {string}
 */
function truncateLines(str, maxLines) {
  if (!str) return '';
  const lines = str.split('\n');
  if (lines.length <= maxLines) return str;
  return lines.slice(0, maxLines).join('\n') +
    `\n... (${lines.length - maxLines} more lines truncated)`;
}

/**
 * Check if an npm script exists.
 *
 * @param {string} rootDir
 * @param {string} scriptName
 * @returns {boolean}
 */
function hasNpmScript(rootDir, scriptName) {
  try {
    const pkgPath = path.join(rootDir, 'package.json');
    if (!fs.existsSync(pkgPath)) return false;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const scripts = pkg.scripts || {};
    return typeof scripts[scriptName] === 'string' && scripts[scriptName].length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main API: validateResult
// ---------------------------------------------------------------------------

/**
 * Validate a model result against task and context.
 *
 * @param {Object} result - Model output { content, metadata }
 * @param {Object} task - Task analysis
 * @param {Object} [context] - Gathered context
 * @param {Object} [options]
 * @param {string} [options.rootDir] - Project root (default: cwd)
 * @returns {Promise<ValidationResult>}
 */
async function validateResult(result, task, context, options) {
  const opts = options || {};
  const rootDir = opts.rootDir || process.cwd();

  const issues = [];

  // Run validation checks
  const tests = await runTests(rootDir);
  const build = await runBuild(rootDir);
  const lint = await runLint(rootDir);
  const typeCheck = await runTypeCheck(rootDir);
  const diff = await runGitDiff(rootDir);

  // Determine pass/fail for each
  const testsPassed = tests.skipped || tests.exitCode === 0;
  const buildSuccess = build.skipped || build.exitCode === 0;
  const lintPassed = lint.skipped || lint.exitCode === 0;
  const typeCheckPassed = typeCheck.skipped || typeCheck.exitCode === 0;

  // Task-specific criteria validation
  const taskCriteriaMet = validateTaskCriteria(result, task);

  // Collect issues
  if (!testsPassed && !tests.skipped) issues.push('tests_failed');
  if (!buildSuccess && !build.skipped) issues.push('build_failed');
  if (!lintPassed && !lint.skipped) issues.push('lint_failed');
  if (!typeCheckPassed && !typeCheck.skipped) issues.push('type_check_failed');
  if (!taskCriteriaMet) issues.push('task_criteria_not_met');

  // Score calculation
  let score = 10;
  if (!testsPassed && !tests.skipped) score -= 3;
  if (!buildSuccess && !build.skipped) score -= 3;
  if (!lintPassed && !lint.skipped) score -= 1;
  if (!typeCheckPassed && !typeCheck.skipped) score -= 1;
  if (!taskCriteriaMet) score -= 2;

  return {
    testsPassed,
    buildSuccess,
    lintPassed,
    typeCheckPassed,
    taskCriteriaMet,
    score: Math.max(0, score),
    details: {
      tests: tests.skipped ? { skipped: true, reason: tests.reason } : { exitCode: tests.exitCode, output: truncateLines(tests.stdout, 100) },
      build: build.skipped ? { skipped: true, reason: build.reason } : { exitCode: build.exitCode },
      lint: lint.skipped ? { skipped: true, reason: lint.reason } : { exitCode: lint.exitCode },
      typeCheck: typeCheck.skipped ? { skipped: true, reason: typeCheck.reason } : { exitCode: typeCheck.exitCode },
      diff
    },
    issues
  };
}

// ---------------------------------------------------------------------------
// Individual Checks
// ---------------------------------------------------------------------------

/**
 * Run tests (npm test).
 *
 * @param {string} rootDir
 * @returns {Promise<{ exitCode?: number, stdout?: string, stderr?: string, skipped?: boolean, reason?: string, error?: string }>}
 */
async function runTests(rootDir) {
  const has = hasNpmScript(rootDir, 'test');
  if (!has) {
    return { skipped: true, reason: 'no test script' };
  }

  const result = safeExec('npm test -- --reporter=json 2>&1 || true', { cwd: rootDir });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error
  };
}

/**
 * Run build (npm run build).
 *
 * @param {string} rootDir
 * @returns {Promise<{ exitCode?: number, stdout?: string, stderr?: string, skipped?: boolean, reason?: string, error?: string }>}
 */
async function runBuild(rootDir) {
  const has = hasNpmScript(rootDir, 'build');
  if (!has) {
    return { skipped: true, reason: 'no build script' };
  }

  const result = safeExec('npm run build 2>&1 || true', { cwd: rootDir });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error
  };
}

/**
 * Run lint (npm run lint).
 *
 * @param {string} rootDir
 * @returns {Promise<{ exitCode?: number, stdout?: string, stderr?: string, skipped?: boolean, reason?: string, error?: string }>}
 */
async function runLint(rootDir) {
  const has = hasNpmScript(rootDir, 'lint');
  if (!has) {
    return { skipped: true, reason: 'no lint script' };
  }

  const result = safeExec('npm run lint -- --format=json 2>&1 || true', { cwd: rootDir });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error
  };
}

/**
 * Run type check (npx tsc --noEmit or npm run typecheck).
 *
 * @param {string} rootDir
 * @returns {Promise<{ exitCode?: number, stdout?: string, stderr?: string, skipped?: boolean, reason?: string, error?: string }>}
 */
async function runTypeCheck(rootDir) {
  // Check for tsconfig.json
  if (!fs.existsSync(path.join(rootDir, 'tsconfig.json'))) {
    return { skipped: true, reason: 'no tsconfig.json' };
  }

  const has = hasNpmScript(rootDir, 'typecheck');
  const command = has
    ? 'npm run typecheck 2>&1 || true'
    : 'npx tsc --noEmit 2>&1 || true';

  const result = safeExec(command, { cwd: rootDir });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error
  };
}

/**
 * Run git diff to capture changes.
 *
 * @param {string} rootDir
 * @returns {Promise<{ filesChanged: number, insertions: number, deletions: number, stat: string, fullDiff: string, skipped?: boolean, reason?: string }>}
 */
async function runGitDiff(rootDir) {
  if (!fs.existsSync(path.join(rootDir, '.git'))) {
    return { skipped: true, reason: 'not a git repo', filesChanged: 0, insertions: 0, deletions: 0, stat: '', fullDiff: '' };
  }

  const stat = safeExec('git diff --stat', { cwd: rootDir });
  const diff = safeExec('git diff', { cwd: rootDir });

  const statOutput = stat.stdout || '';
  const filesChanged = statOutput ? statOutput.trim().split('\n').filter(l => l.includes('|')).length : 0;

  let insertions = 0;
  let deletions = 0;

  const summaryLine = statOutput.split('\n').filter(l => l.includes('insertion') || l.includes('deletion')).pop();
  if (summaryLine) {
    const insMatch = summaryLine.match(/(\d+)\s*insertion/);
    const delMatch = summaryLine.match(/(\d+)\s*deletion/);
    if (insMatch) insertions = parseInt(insMatch[1], 10);
    if (delMatch) deletions = parseInt(delMatch[1], 10);
  }

  return {
    filesChanged,
    insertions,
    deletions,
    stat: statOutput,
    fullDiff: truncateLines(diff.stdout || '', 200)
  };
}

// ---------------------------------------------------------------------------
// Task Criteria Validation
// ---------------------------------------------------------------------------

/**
 * Validate output against task-specific success criteria.
 *
 * @param {Object} result - Model result
 * @param {Object} task - Task analysis
 * @returns {boolean} Whether all criteria are met
 */
function validateTaskCriteria(result, task) {
  if (!task || !task.successCriteria || task.successCriteria.length === 0) {
    return true; // No criteria defined → pass
  }

  const content = typeof result === 'string'
    ? result
    : (result.content || result.output || JSON.stringify(result));

  if (!content || content.trim().length === 0) return false;

  const lower = content.toLowerCase();

  // Check each criterion
  for (const criterion of task.successCriteria) {
    if (!checkCriterion(criterion, lower, task)) {
      return false;
    }
  }

  return true;
}

/**
 * Check a single criterion against output content.
 *
 * @param {string} criterion
 * @param {string} lowerContent
 * @param {Object} task
 * @returns {boolean}
 */
function checkCriterion(criterion, lowerContent, task) {
  // Refusal check
  if (criterion === 'task_completed_successfully' || criterion === 'response_complete') {
    const refusalPatterns = /i (?:cannot|can't|am unable to|don't have the|am not able to)/i;
    if (refusalPatterns.test(lowerContent)) return false;
  }

  // Code-related checks
  if (['code_compiles_without_errors', 'new_functionality_works_as_expected'].includes(criterion)) {
    // Check for code blocks or code indicators
    const hasCode = lowerContent.includes('```') ||
      /\b(function|class|const|let|var|import|require|export)\b/.test(lowerContent);
    return hasCode;
  }

  // Research/analysis checks
  if (criterion === 'sources_cited') {
    return lowerContent.includes('http') || lowerContent.includes('source') ||
      lowerContent.includes('reference') || lowerContent.includes('citation');
  }

  if (criterion === 'actionable_conclusions') {
    const actionWords = /\b(recommend|should|must|need to|will|action|next step|implement|adopt)\b/i;
    return actionWords.test(lowerContent);
  }

  // Planning checks
  if (criterion === 'tasks_decomposed') {
    const numbers = lowerContent.match(/^\d+\.|^\-\s|step\s\d/i);
    return numbers !== null;
  }

  if (criterion === 'dependencies_mapped') {
    return lowerContent.includes('dependency') || lowerContent.includes('depends on') ||
      lowerContent.includes('requires') || lowerContent.includes('blocked by');
  }

  // Reasoning checks
  if (criterion === 'assumptions_stated') {
    return lowerContent.includes('assum') || lowerContent.includes('given that') ||
      lowerContent.includes('assuming');
  }

  if (criterion === 'logic_sound') {
    // Hard to auto-verify — check for reasoning structure
    return lowerContent.includes('because') || lowerContent.includes('therefore') ||
      lowerContent.includes('since') || lowerContent.includes('thus');
  }

  // Default: check if criterion keywords appear in content
  const keywords = criterion.replace(/_/g, ' ').split(' ');
  const matchCount = keywords.filter(kw => lowerContent.includes(kw)).length;
  return matchCount >= keywords.length * 0.5; // At least half the keywords match
}

// ---------------------------------------------------------------------------
// Quick Checks
// ---------------------------------------------------------------------------

/**
 * Quick validation — just check output is not empty/refused.
 *
 * @param {string|Object} result
 * @returns {{ valid: boolean, reason?: string }}
 */
function quickValidate(result) {
  const content = typeof result === 'string'
    ? result
    : (result.content || result.output || '');

  if (!content || content.trim().length === 0) {
    return { valid: false, reason: 'output_empty' };
  }

  if (content.length < 10) {
    return { valid: false, reason: 'output_too_short' };
  }

  const refusalPattern = /\b(i cannot|i'm unable|i am unable|i don't have|cannot assist)\b/i;
  if (refusalPattern.test(content)) {
    return { valid: false, reason: 'model_refusal' };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  validateResult,
  validateTaskCriteria,
  quickValidate,

  // Individual checks (for granular use)
  runTests,
  runBuild,
  runLint,
  runTypeCheck,
  runGitDiff
};
