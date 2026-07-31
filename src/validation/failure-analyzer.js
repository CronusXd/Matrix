/**
 * Matrix Failure Analyzer v1.0
 * ============================
 * Classifies failures into categories and identifies root causes.
 * Maps symptoms → categories → root causes → suggested fixes.
 *
 * Failure categories:
 *   MODEL_REASONING_FAILURE, BAD_CONTEXT, MISSING_CONTEXT, CONTEXT_NOISE,
 *   BAD_PLAN, BAD_DECOMPOSITION, TOOL_FAILURE, ENVIRONMENT_FAILURE,
 *   REQUIREMENT_AMBIGUITY, VALIDATION_FAILURE, EXECUTION_FAILURE
 *
 * CommonJS module. Zero npm dependencies.
 *
 * @version 1.0.0
 */

'use strict';

// ---------------------------------------------------------------------------
// Failure Categories
// ---------------------------------------------------------------------------

/**
 * @enum {string}
 */
const FAILURE_CATEGORIES = {
  MODEL_REASONING_FAILURE: 'model_reasoning_failure',
  BAD_CONTEXT: 'bad_context',
  MISSING_CONTEXT: 'missing_context',
  CONTEXT_NOISE: 'context_noise',
  BAD_PLAN: 'bad_plan',
  BAD_DECOMPOSITION: 'bad_decomposition',
  TOOL_FAILURE: 'tool_failure',
  ENVIRONMENT_FAILURE: 'environment_failure',
  REQUIREMENT_AMBIGUITY: 'requirement_ambiguity',
  VALIDATION_FAILURE: 'validation_failure',
  EXECUTION_FAILURE: 'execution_failure',
  UNKNOWN: 'unknown'
};

// ---------------------------------------------------------------------------
// @typedef
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} FailureAnalysis
 * @property {string} category - Failure category from FAILURE_CATEGORIES
 * @property {number} confidence - 0-1 confidence in this classification
 * @property {string} evidence - What evidence supports this classification
 * @property {string} suggestedFix - What should be done to fix it
 * @property {string[]} alternativeCategories - Other possible categories
 * @property {Object} details - Additional details
 */

// ---------------------------------------------------------------------------
// Symptom Patterns
// ---------------------------------------------------------------------------

/**
 * Patterns that map symptoms to failure categories.
 * Ordered by diagnostic priority — first match is primary.
 */
const SYMPTOM_PATTERNS = [
  {
    // Model refused to answer or gave nonsensical response
    test: (result, validation, task, context) => {
      const content = extractContent(result).toLowerCase();
      return (
        /\b(i cannot|i'm unable|i am unable|i don't have|cannot assist)\b/i.test(content) ||
        content.length < 10 ||
        /\b(error|exception|failed|timeout)\b/i.test(content) &&
        !hasCodePatterns(content)
      );
    },
    category: FAILURE_CATEGORIES.MODEL_REASONING_FAILURE,
    weight: 3
  },
  {
    // Output is syntactically invalid (code doesn't compile)
    test: (result, validation, task, context) => {
      return validation && validation.buildSuccess === false;
    },
    category: FAILURE_CATEGORIES.EXECUTION_FAILURE,
    weight: 3
  },
  {
    // Tests fail after changes
    test: (result, validation, task, context) => {
      return validation && validation.testsPassed === false;
    },
    category: FAILURE_CATEGORIES.EXECUTION_FAILURE,
    weight: 2
  },
  {
    // Output is off-topic or doesn't address the task
    test: (result, validation, task, context) => {
      if (!task || !task.goal) return false;
      const content = extractContent(result).toLowerCase();
      const keywords = task.goal.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const matchCount = keywords.filter(kw => content.includes(kw)).length;
      return keywords.length > 2 && matchCount < keywords.length * 0.3;
    },
    category: FAILURE_CATEGORIES.MODEL_REASONING_FAILURE,
    weight: 2
  },
  {
    // Context-related failures
    test: (result, validation, task, context) => {
      if (!context || !context.files || context.files.length === 0) {
        if (task && task.requiresContext) return true;
      }
      return false;
    },
    category: FAILURE_CATEGORIES.MISSING_CONTEXT,
    weight: 3
  },
  {
    // Context was provided but irrelevant
    test: (result, validation, task, context) => {
      return context && context.files && context.files.length > 3 &&
        context.files.every(f => (f.score || 0) < 5);
    },
    category: FAILURE_CATEGORIES.CONTEXT_NOISE,
    weight: 2
  },
  {
    // Context was provided but corrupted/incomplete
    test: (result, validation, task, context) => {
      return context && context.files && context.files.some(f =>
        !f.compressed_content && !f.content
      );
    },
    category: FAILURE_CATEGORIES.BAD_CONTEXT,
    weight: 2
  },
  {
    // Task criteria not met despite no obvious errors
    test: (result, validation, task, context) => {
      return validation && validation.taskCriteriaMet === false &&
        validation.testsPassed !== false && validation.buildSuccess !== false;
    },
    category: FAILURE_CATEGORIES.BAD_PLAN,
    weight: 2
  },
  {
    // Multiple sub-tasks but low coverage
    test: (result, validation, task, context) => {
      const content = extractContent(result);
      return result && result.metadata &&
        result.metadata.subTaskCount > 2 &&
        content.length < 500;
    },
    category: FAILURE_CATEGORIES.BAD_DECOMPOSITION,
    weight: 2
  },
  {
    // Environment errors (build, tool failures)
    test: (result, validation, task, context) => {
      const content = extractContent(result).toLowerCase();
      return (
        /\b(module not found|cannot find module|npm err|permission denied|eacces|enotfound)\b/i.test(content) ||
        (validation && (validation.details && validation.details.build && validation.details.build.error))
      );
    },
    category: FAILURE_CATEGORIES.ENVIRONMENT_FAILURE,
    weight: 3
  },
  {
    // Requirement ambiguity: task description was vague
    test: (result, validation, task, context) => {
      if (!task) return false;
      const goal = task.goal || '';
      return goal.length < 20 || !/[?.!]/.test(goal);
    },
    category: FAILURE_CATEGORIES.REQUIREMENT_AMBIGUITY,
    weight: 1
  }
];

// ---------------------------------------------------------------------------
// Main API: analyzeFailure
// ---------------------------------------------------------------------------

/**
 * Analyze a failed result to determine the root cause.
 *
 * @param {Object} result - Model output result
 * @param {Object} validation - Validation result from validator.js
 * @param {Object} task - Task analysis
 * @param {Object} [context] - Gathered context
 * @returns {FailureAnalysis}
 */
function analyzeFailure(result, validation, task, context) {
  // Edge cases
  if (!result && !validation) {
    return {
      category: FAILURE_CATEGORIES.UNKNOWN,
      confidence: 0.0,
      evidence: 'No result or validation provided',
      suggestedFix: 'Retry the task with explicit instructions',
      alternativeCategories: [],
      details: {}
    };
  }

  // Score each symptom pattern
  const scored = SYMPTOM_PATTERNS.map(pattern => {
    try {
      const match = pattern.test(result, validation, task, context);
      return {
        category: pattern.category,
        score: match ? pattern.weight : 0,
        weight: pattern.weight
      };
    } catch {
      return { category: pattern.category, score: 0, weight: 0 };
    }
  });

  // Sum scores by category (multiple patterns can match the same category)
  const categoryScores = {};
  for (const s of scored) {
    categoryScores[s.category] = (categoryScores[s.category] || 0) + s.score;
  }

  // Find the primary category
  let primaryCategory = FAILURE_CATEGORIES.UNKNOWN;
  let maxScore = 0;

  for (const [category, score] of Object.entries(categoryScores)) {
    if (score > maxScore) {
      maxScore = score;
      primaryCategory = category;
    }
  }

  // Alternative categories (other matches with non-zero scores)
  const alternativeCategories = Object.entries(categoryScores)
    .filter(([cat, score]) => score > 0 && cat !== primaryCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([cat]) => cat);

  // Confidence: higher when one category dominates
  const totalScore = Object.values(categoryScores).reduce((s, v) => s + v, 0);
  const confidence = totalScore > 0
    ? +Math.min(0.95, (maxScore / totalScore)).toFixed(2)
    : 0.1;

  // Build evidence
  const evidence = buildEvidence(primaryCategory, result, validation, task, context);

  // Build suggested fix
  const suggestedFix = buildSuggestedFix(primaryCategory, result, task, context);

  // Additional details
  const details = {
    categoryScores,
    totalPatternsMatched: Object.values(categoryScores).filter(s => s > 0).length,
    validationIssues: validation ? (validation.issues || []) : [],
    resultLength: extractContent(result).length
  };

  return {
    category: primaryCategory,
    confidence,
    evidence,
    suggestedFix,
    alternativeCategories,
    details
  };
}

// ---------------------------------------------------------------------------
// Evidence Builder
// ---------------------------------------------------------------------------

/**
 * Build human-readable evidence string for the failure category.
 *
 * @param {string} category
 * @param {Object} result
 * @param {Object} validation
 * @param {Object} task
 * @param {Object} context
 * @returns {string}
 */
function buildEvidence(category, result, validation, task, context) {
  const content = extractContent(result);

  switch (category) {
    case FAILURE_CATEGORIES.MODEL_REASONING_FAILURE:
      return `Model produced an invalid or refused response. Output length: ${content.length} chars. ` +
        `First 100 chars: "${content.slice(0, 100)}"`;

    case FAILURE_CATEGORIES.BAD_CONTEXT:
      return `Context files provided but contained errors or were incomplete. ` +
        `${context ? context.files.length : 0} files provided, some without readable content.`;

    case FAILURE_CATEGORIES.MISSING_CONTEXT:
      return `No context files were gathered for this task. ` +
        `Task type "${task ? task.taskType : 'unknown'}" typically requires context.`;

    case FAILURE_CATEGORIES.CONTEXT_NOISE:
      return `Context files had low relevance scores. ` +
        `Average score: ${computeAverage(context)}. Too many irrelevant files.`;

    case FAILURE_CATEGORIES.BAD_PLAN:
      return `Task criteria were not met despite no technical errors. ` +
        `Unmet criteria: ${validation ? (validation.issues || []).join(', ') : 'unknown'}.`;

    case FAILURE_CATEGORIES.BAD_DECOMPOSITION:
      return `Task was decomposed into ${result && result.metadata ? result.metadata.subTaskCount : '?'} ` +
        `sub-tasks but output quality is low. Decomposition may be too granular.`;

    case FAILURE_CATEGORIES.TOOL_FAILURE:
      return `A tool or API call failed during execution. ` +
        `Check tool outputs for errors.`;

    case FAILURE_CATEGORIES.ENVIRONMENT_FAILURE:
      return `Build or runtime environment error detected. ` +
        `Build status: ${validation ? (validation.buildSuccess ? 'passed' : 'failed') : 'unknown'}.`;

    case FAILURE_CATEGORIES.REQUIREMENT_AMBIGUITY:
      return `Task description was too vague. ` +
        `Goal length: ${task ? (task.goal || '').length : 0} chars. ` +
        `Add more specific requirements.`;

    case FAILURE_CATEGORIES.VALIDATION_FAILURE:
      return `Validation checks failed: ${validation ? (validation.issues || []).join(', ') : 'unknown'}.`;

    case FAILURE_CATEGORIES.EXECUTION_FAILURE:
      return `Execution error: tests=${validation ? validation.testsPassed : '?'}, ` +
        `build=${validation ? validation.buildSuccess : '?'}.`;

    default:
      return `Unable to determine specific failure cause. Multiple factors may be involved.`;
  }
}

// ---------------------------------------------------------------------------
// Suggested Fix Builder
// ---------------------------------------------------------------------------

/**
 * Build a suggested fix for the failure category.
 *
 * @param {string} category
 * @param {Object} result
 * @param {Object} task
 * @param {Object} context
 * @returns {string}
 */
function buildSuggestedFix(category, result, task, context) {
  switch (category) {
    case FAILURE_CATEGORIES.MODEL_REASONING_FAILURE:
      return 'Use a stronger model, simplify the prompt, or break the task into smaller steps with explicit instructions.';

    case FAILURE_CATEGORIES.BAD_CONTEXT:
      return 'Re-gather context with corrected file paths. Ensure all context files are readable and contain relevant data.';

    case FAILURE_CATEGORIES.MISSING_CONTEXT:
      return 'Run the context engine with more specific keywords. Expand file discovery patterns to include relevant project files.';

    case FAILURE_CATEGORIES.CONTEXT_NOISE:
      return 'Increase the minimum score threshold for file inclusion (min_score). Use more specific keywords to filter irrelevant files.';

    case FAILURE_CATEGORIES.BAD_PLAN:
      return 'Revise the execution plan. Ensure each sub-task explicitly addresses a success criterion. Add verification steps.';

    case FAILURE_CATEGORIES.BAD_DECOMPOSITION:
      return 'Reduce the number of sub-tasks. Merge related sub-tasks. Ensure each sub-task has clear, measurable output.';

    case FAILURE_CATEGORIES.TOOL_FAILURE:
      return 'Check tool availability and permissions. Add fallback logic for tool failures. Log tool inputs/outputs for debugging.';

    case FAILURE_CATEGORIES.ENVIRONMENT_FAILURE:
      return 'Check Node.js version, package installation, and build configuration. Run `npm install` and verify the environment.';

    case FAILURE_CATEGORIES.REQUIREMENT_AMBIGUITY:
      return 'Add more specific requirements: file paths, expected behavior, constraints, and examples of desired output.';

    case FAILURE_CATEGORIES.VALIDATION_FAILURE:
      return 'Review each failed validation check individually. Fix the specific issues (tests, build, lint) before re-running.';

    case FAILURE_CATEGORIES.EXECUTION_FAILURE:
      return 'Check the code for syntax errors, missing imports, or type mismatches. Fix compiler/test errors before re-running validation.';

    default:
      return 'Restart the pipeline with explicit instructions. If the issue persists, escalate to human review.';
  }
}

// ---------------------------------------------------------------------------
// Batch Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze multiple results in a pipeline to identify cascading failures.
 *
 * @param {Array<{ result: Object, validation: Object, agent: string }>} pipelineResults
 * @returns {{ rootFailure: FailureAnalysis, cascade: Array, timeline: Array }}
 */
function analyzePipeline(pipelineResults) {
  if (!pipelineResults || pipelineResults.length === 0) {
    return {
      rootFailure: null,
      cascade: [],
      timeline: []
    };
  }

  const analyses = pipelineResults.map((pr, i) => ({
    index: i,
    agent: pr.agent || `step_${i}`,
    analysis: analyzeFailure(pr.result, pr.validation, pr.task, pr.context)
  }));

  // Find the first failure in the pipeline
  const firstFailure = analyses.find(a => a.analysis.confidence > 0.3);
  const cascade = analyses.filter(a => a !== firstFailure && a.analysis.confidence > 0.3);

  return {
    rootFailure: firstFailure ? firstFailure.analysis : null,
    cascade: cascade.map(a => ({
      agent: a.agent,
      category: a.analysis.category,
      possibleCascadeFrom: firstFailure ? `May be caused by upstream failure in ${firstFailure.agent}` : null
    })),
    timeline: analyses.map(a => ({
      step: a.index,
      agent: a.agent,
      category: a.analysis.category,
      confidence: a.analysis.confidence
    }))
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract text content from a result object.
 *
 * @param {Object|string} result
 * @returns {string}
 */
function extractContent(result) {
  if (typeof result === 'string') return result;
  if (!result) return '';
  return result.content || result.output || result.text || JSON.stringify(result);
}

/**
 * Check if text contains code-like patterns.
 *
 * @param {string} text
 * @returns {boolean}
 */
function hasCodePatterns(text) {
  return /\b(function|class|const|let|var|import|require|export|return|if\s*\(|for\s*\()/i.test(text);
}

/**
 * Compute average score of context files.
 *
 * @param {Object} context
 * @returns {number}
 */
function computeAverage(context) {
  if (!context || !context.files || context.files.length === 0) return 0;
  const total = context.files.reduce((sum, f) => sum + (f.score || 0), 0);
  return +(total / context.files.length).toFixed(1);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  analyzeFailure,
  analyzePipeline,
  FAILURE_CATEGORIES
};
