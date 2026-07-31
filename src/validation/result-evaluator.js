/**
 * Matrix Result Evaluator v1.0
 * ============================
 * Evaluates validation results to produce a SUCCESS/FAILURE/PARTIAL verdict.
 * Maps raw validation data into actionable decisions.
 *
 * CommonJS module. Zero npm dependencies.
 *
 * @version 1.0.0
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** @enum {string} */
const VERDICT = {
  SUCCESS: 'SUCCESS',
  PARTIAL: 'PARTIAL',
  FAILURE: 'FAILURE',
  DEGRADED: 'DEGRADED'
};

// ---------------------------------------------------------------------------
// @typedef
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} EvaluationResult
 * @property {string} verdict - SUCCESS | PARTIAL | FAILURE | DEGRADED
 * @property {number} score - 0-10
 * @property {string[]} issues - What went wrong
 * @property {string[]} warnings - Non-critical issues
 * @property {Object} breakdown - Score breakdown by category
 * @property {string} summary - Human-readable summary
 */

// ---------------------------------------------------------------------------
// Main API: evaluate
// ---------------------------------------------------------------------------

/**
 * Evaluate a validation result against task analysis.
 *
 * @param {Object} validationResult - From validator.js
 * @param {Object} taskAnalysis - From task-intelligence.js
 * @param {Object} [options]
 * @param {boolean} [options.strict=false] - All checks must pass
 * @param {number} [options.passThreshold=6] - Minimum score for SUCCESS
 * @returns {EvaluationResult}
 */
function evaluate(validationResult, taskAnalysis, options) {
  const opts = options || {};
  const strict = opts.strict === true;
  const threshold = opts.passThreshold || 6;

  // Handle null/undefined validation
  if (!validationResult) {
    return {
      verdict: VERDICT.FAILURE,
      score: 0,
      issues: ['no_validation_result'],
      warnings: [],
      breakdown: {},
      summary: 'No validation result provided — cannot evaluate.'
    };
  }

  const issues = [];
  const warnings = [];
  const breakdown = {};

  // Evaluate each check
  const testResult = evaluateTests(validationResult, taskAnalysis);
  breakdown.tests = testResult;
  if (testResult.failed) issues.push(...testResult.issues);
  if (testResult.warnings.length > 0) warnings.push(...testResult.warnings);

  const buildResult = evaluateBuild(validationResult, taskAnalysis);
  breakdown.build = buildResult;
  if (buildResult.failed) issues.push(...buildResult.issues);

  const lintResult = evaluateLint(validationResult, taskAnalysis);
  breakdown.lint = lintResult;
  if (lintResult.failed && strict) issues.push(...lintResult.issues);
  else if (lintResult.warnings.length > 0) warnings.push(...lintResult.warnings);

  const typeResult = evaluateTypeCheck(validationResult, taskAnalysis);
  breakdown.typeCheck = typeResult;
  if (typeResult.failed && strict) issues.push(...typeResult.issues);
  else if (typeResult.warnings.length > 0) warnings.push(...typeResult.warnings);

  const criteriaResult = evaluateCriteria(validationResult, taskAnalysis);
  breakdown.criteria = criteriaResult;
  if (criteriaResult.failed) issues.push(...criteriaResult.issues);

  const qualityResult = evaluateOutputQuality(validationResult, taskAnalysis);
  breakdown.quality = qualityResult;
  if (qualityResult.failed) issues.push(...qualityResult.issues);
  else if (qualityResult.warnings.length > 0) warnings.push(...qualityResult.warnings);

  // Determine verdict
  let verdict;
  let score = validationResult.score || 0;

  if (issues.length === 0) {
    verdict = VERDICT.SUCCESS;
    score = Math.max(score, 8);
  } else if (score >= threshold) {
    verdict = VERDICT.PARTIAL;
  } else if (score > 0) {
    verdict = VERDICT.PARTIAL;
  } else {
    verdict = VERDICT.FAILURE;
  }

  // Degraded mode: partial but with serious issues
  if (verdict === VERDICT.PARTIAL && issues.length >= 3) {
    verdict = VERDICT.DEGRADED;
  }

  const summary = buildSummary(verdict, score, issues, warnings);

  return {
    verdict,
    score: Math.max(0, Math.min(10, score)),
    issues,
    warnings,
    breakdown,
    summary
  };
}

// ---------------------------------------------------------------------------
// Category Evaluators
// ---------------------------------------------------------------------------

/**
 * Evaluate test results.
 *
 * @param {Object} result
 * @param {Object} task
 * @returns {{ passed: boolean, failed: boolean, skipped: boolean, issues: string[], warnings: string[] }}
 */
function evaluateTests(result, task) {
  const issues = [];
  const warnings = [];

  if (result.details && result.details.tests && result.details.tests.skipped) {
    const isCodeTask = task && ['coding', 'debugging', 'refactoring'].includes(task.taskType);
    if (isCodeTask) {
      warnings.push('tests_not_run_on_code_task');
    }
    return { passed: true, failed: false, skipped: true, issues, warnings };
  }

  if (!result.testsPassed) {
    issues.push('tests_failed');
    const testDetails = result.details && result.details.tests;
    if (testDetails && testDetails.exitCode) {
      issues.push(`test_exit_code_${testDetails.exitCode}`);
    }
  }

  return {
    passed: result.testsPassed !== false,
    failed: result.testsPassed === false,
    skipped: false,
    issues,
    warnings
  };
}

/**
 * Evaluate build results.
 *
 * @param {Object} result
 * @param {Object} task
 * @returns {{ passed: boolean, failed: boolean, skipped: boolean, issues: string[], warnings: string[] }}
 */
function evaluateBuild(result, task) {
  const issues = [];

  if (result.details && result.details.build && result.details.build.skipped) {
    return { passed: true, failed: false, skipped: true, issues: [], warnings: [] };
  }

  if (!result.buildSuccess) {
    issues.push('build_failed');
  }

  return {
    passed: result.buildSuccess !== false,
    failed: result.buildSuccess === false,
    skipped: false,
    issues,
    warnings: []
  };
}

/**
 * Evaluate lint results.
 *
 * @param {Object} result
 * @param {Object} task
 * @returns {{ passed: boolean, failed: boolean, skipped: boolean, issues: string[], warnings: string[] }}
 */
function evaluateLint(result, task) {
  const warnings = [];

  if (result.details && result.details.lint && result.details.lint.skipped) {
    return { passed: true, failed: false, skipped: true, issues: [], warnings: [] };
  }

  if (!result.lintPassed) {
    warnings.push('lint_issues_found');
  }

  return {
    passed: result.lintPassed !== false,
    failed: false, // Lint failures are warnings, not blocking
    skipped: false,
    issues: [],
    warnings
  };
}

/**
 * Evaluate type check results.
 *
 * @param {Object} result
 * @param {Object} task
 * @returns {{ passed: boolean, failed: boolean, skipped: boolean, issues: string[], warnings: string[] }}
 */
function evaluateTypeCheck(result, task) {
  const warnings = [];

  if (result.details && result.details.typeCheck && result.details.typeCheck.skipped) {
    return { passed: true, failed: false, skipped: true, issues: [], warnings: [] };
  }

  if (!result.typeCheckPassed) {
    warnings.push('type_errors_found');
  }

  return {
    passed: result.typeCheckPassed !== false,
    failed: false, // Type check failures are warnings
    skipped: false,
    issues: [],
    warnings
  };
}

/**
 * Evaluate task criteria.
 *
 * @param {Object} result
 * @param {Object} task
 * @returns {{ passed: boolean, failed: boolean, issues: string[], warnings: string[] }}
 */
function evaluateCriteria(result, task) {
  const issues = [];

  if (!result.taskCriteriaMet) {
    issues.push('task_criteria_not_met');

    if (task && task.successCriteria) {
      issues.push(`unmet_criteria: ${task.successCriteria.join(', ')}`);
    }
  }

  return {
    passed: result.taskCriteriaMet !== false,
    failed: result.taskCriteriaMet === false,
    issues,
    warnings: []
  };
}

/**
 * Evaluate output quality heuristically.
 *
 * @param {Object} result
 * @param {Object} task
 * @returns {{ passed: boolean, failed: boolean, issues: string[], warnings: string[] }}
 */
function evaluateOutputQuality(result, task) {
  const issues = [];
  const warnings = [];

  // Check if we can extract the content
  const content = extractContent(result);
  if (!content) {
    issues.push('output_unreadable');
    return { passed: false, failed: true, issues, warnings };
  }

  // Length check
  if (content.length < 20) {
    issues.push('output_too_short');
  }

  // Refusal check
  const refusalPattern = /\b(i cannot|i'm unable|i am unable|i don't have the capability|cannot assist with that)\b/i;
  if (refusalPattern.test(content)) {
    issues.push('model_refusal');
  }

  // Hallucination indicators (vague/generic responses for specific tasks)
  if (task && task.complexity >= 3 && content.length < 200) {
    warnings.push('short_output_for_complex_task');
  }

  // Coding task quality
  if (task && ['coding', 'debugging', 'refactoring'].includes(task.taskType)) {
    if (!content.includes('```') && !hasCodePatterns(content)) {
      warnings.push('no_code_detected');
    }
  }

  return {
    passed: issues.length === 0,
    failed: issues.length > 0,
    issues,
    warnings
  };
}

// ---------------------------------------------------------------------------
// Helper: Extract Content
// ---------------------------------------------------------------------------

/**
 * Extract text content from various result formats.
 *
 * @param {Object|string} result
 * @returns {string}
 */
function extractContent(result) {
  if (typeof result === 'string') return result;
  if (!result) return '';

  return result.content || result.output || result.text ||
    (result.metadata && result.metadata.rawOutput) || '';
}

/**
 * Check if text contains code patterns without markdown code blocks.
 *
 * @param {string} text
 * @returns {boolean}
 */
function hasCodePatterns(text) {
  const patterns = [
    /\bfunction\b/, /\bclass\b/, /\bconst\b/, /\blet\b/, /\bvar\b/,
    /\bimport\b/, /\brequire\(/, /\bexport\b/, /\breturn\b/,
    /\bif\s*\(/, /\bfor\s*\(/, /\bwhile\s*\(/
  ];
  return patterns.some(p => p.test(text));
}

// ---------------------------------------------------------------------------
// Summary Builder
// ---------------------------------------------------------------------------

/**
 * Build a human-readable summary.
 *
 * @param {string} verdict
 * @param {number} score
 * @param {string[]} issues
 * @param {string[]} warnings
 * @returns {string}
 */
function buildSummary(verdict, score, issues, warnings) {
  const parts = [`Verdict: ${verdict}`, `Score: ${score}/10`];

  if (issues.length > 0) {
    parts.push(`Issues: ${issues.length} (${issues.slice(0, 3).join('; ')})`);
  }
  if (warnings.length > 0) {
    parts.push(`Warnings: ${warnings.length} (${warnings.slice(0, 3).join('; ')})`);
  }

  return parts.join(' | ');
}

// ---------------------------------------------------------------------------
// Quick Evaluation
// ---------------------------------------------------------------------------

/**
 * Quick evaluation — just check pass/fail status.
 *
 * @param {Object} validationResult
 * @returns {{ passed: boolean, verdict: string }}
 */
function quickEval(validationResult) {
  if (!validationResult) {
    return { passed: false, verdict: VERDICT.FAILURE };
  }

  const testsOk = validationResult.testsPassed !== false;
  const buildOk = validationResult.buildSuccess !== false;
  const criteriaOk = validationResult.taskCriteriaMet !== false;

  if (testsOk && buildOk && criteriaOk) {
    return { passed: true, verdict: VERDICT.SUCCESS };
  }

  if (validationResult.score >= 5) {
    return { passed: false, verdict: VERDICT.PARTIAL };
  }

  return { passed: false, verdict: VERDICT.FAILURE };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  evaluate,
  quickEval,
  VERDICT,

  // Category evaluators (for granular use)
  evaluateTests,
  evaluateBuild,
  evaluateLint,
  evaluateTypeCheck,
  evaluateCriteria,
  evaluateOutputQuality
};
