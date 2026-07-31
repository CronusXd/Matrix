/**
 * Matrix Self-Refinement Loop v1.0
 * ================================
 * Corrective retry loop that applies feedback to improve results.
 *
 * Rules:
 *   - MAX 3 iterations
 *   - Each iteration MUST change something (never repeat the same prompt)
 *   - Feedback is injected into context/plan/prompt before retry
 *   - Track what changed each iteration
 *   - Exit early on SUCCESS
 *
 * CommonJS module. Zero npm dependencies.
 *
 * @version 1.0.0
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum refinement iterations */
const MAX_ITERATIONS = 3;

/** Exit early if score is above this threshold */
const SUCCESS_THRESHOLD = 8;

// ---------------------------------------------------------------------------
// @typedef
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} RefinementResult
 * @property {boolean} success - Whether refinement succeeded
 * @property {Object} result - Final result (best attempt)
 * @property {number} iterations - Number of iterations attempted
 * @property {Object[]} history - History of each iteration
 * @property {Object} lastFeedback - Final feedback (if failed)
 * @property {Object[]} changes - What changed between iterations
 */

/**
 * @typedef {Object} IterationRecord
 * @property {number} index - Iteration number (0-based)
 * @property {Object} result - Model result
 * @property {Object} validation - Validation result
 * @property {Object} evaluation - Evaluation result
 * @property {Object} failureAnalysis - Failure analysis (if failed)
 * @property {Object} feedback - Generated feedback
 * @property {Object} changes - What changed for this iteration
 * @property {number} duration - Duration of this iteration (ms)
 */

// ---------------------------------------------------------------------------
// Main API: refine
// ---------------------------------------------------------------------------

/**
 * Execute the refinement loop — retry with improvements until success or max iterations.
 *
 * @param {Object} task - Task analysis
 * @param {Object} provider - Model provider with call() method
 * @param {Object} context - Initial context
 * @param {Object} strategy - Strategy selection
 * @param {Object} [options]
 * @param {number} [options.maxIterations=3] - Max retries
 * @param {Function} [options.onIteration] - Callback after each iteration
 * @param {Object} [options.deps] - Dependency injection for testing
 * @returns {Promise<RefinementResult>}
 */
async function refine(task, provider, context, strategy, options) {
  const opts = options || {};
  const maxIterations = opts.maxIterations || MAX_ITERATIONS;
  const deps = opts.deps || {};

  if (!task) {
    return createFailedResult('No task provided', 0);
  }
  if (!provider || typeof provider.call !== 'function') {
    return createFailedResult('No valid provider', 0);
  }

  // Load required modules (lazy, with DI support)
  const modules = {
    validateResult: deps.validateResult || loadModule('../validation/validator', 'validateResult'),
    evaluate: deps.evaluate || loadModule('../validation/result-evaluator', 'evaluate'),
    analyzeFailure: deps.analyzeFailure || loadModule('../validation/failure-analyzer', 'analyzeFailure'),
    generateFeedback: deps.generateFeedback || loadModule('./feedback-engine', 'generateFeedback'),
    executeStrategy: deps.executeStrategy || loadModule('../strategy/strategy-engine', 'executeStrategy')
  };

  const history = [];
  const changes = [];
  let currentContext = context;
  let currentStrategy = strategy;
  let bestResult = null;
  let bestScore = -1;
  let lastFeedback = null;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const iterStart = Date.now();
    const iterChanges = [];

    try {
      // Step 1: Execute strategy with current context
      let result;
      try {
        // If context has a modifiedPrompt from previous feedback, use it
        const execOptions = { ...opts };
        if (currentContext && currentContext.modifiedPrompt) {
          execOptions.modifiedPrompt = currentContext.modifiedPrompt;
        }
        result = await (modules.executeStrategy)
          ? modules.executeStrategy(currentStrategy, task, provider, currentContext, execOptions)
          : await getStrategyExecute(currentStrategy)(task, provider, currentContext, execOptions);
      } catch (execErr) {
        // Strategy execution failed entirely
        history.push({
          index: iteration,
          result: null,
          error: execErr.message,
          changes: [],
          duration: Date.now() - iterStart,
          feedback: { failureCategory: 'execution_failure', cause: execErr.message }
        });
        lastFeedback = {
          failureCategory: 'execution_failure',
          evidence: execErr.message,
          suggestedFix: 'Check provider availability and strategy compatibility.'
        };
        changes.push({ iteration, type: 'execution_error', detail: execErr.message });
        continue;
      }

      // Track best result
      if (result) {
        const score = result.metadata && result.metadata.score
          ? result.metadata.score
          : (result.validation ? result.validation.score : 0);

        if (!bestResult || score > bestScore) {
          bestResult = result;
          bestScore = score;
        }
      }

      // Step 2: Validate
      let validation;
      try {
        validation = await modules.validateResult(result, task, currentContext);
      } catch (valErr) {
        validation = {
          testsPassed: false,
          buildSuccess: false,
          lintPassed: false,
          typeCheckPassed: false,
          taskCriteriaMet: false,
          score: 0,
          issues: [valErr.message],
          details: {}
        };
      }

      // Step 3: Evaluate
      let evaluation;
      try {
        evaluation = modules.evaluate(validation, task);
      } catch (evalErr) {
        evaluation = { verdict: 'FAILURE', score: 0, issues: [evalErr.message] };
      }

      // Step 4: Check if SUCCESS
      if (evaluation.verdict === 'SUCCESS' && evaluation.score >= SUCCESS_THRESHOLD) {
        history.push({
          index: iteration,
          result,
          validation,
          evaluation,
          failureAnalysis: null,
          feedback: null,
          changes: iterChanges,
          duration: Date.now() - iterStart
        });

        return {
          success: true,
          result,
          iterations: iteration + 1,
          history,
          changes,
          lastFeedback: null,
          bestIteration: iteration
        };
      }

      // Check if PARTIAL with high score — may be acceptable
      if (evaluation.score >= SUCCESS_THRESHOLD && evaluation.verdict === 'PARTIAL') {
        history.push({
          index: iteration,
          result,
          validation,
          evaluation,
          failureAnalysis: null,
          feedback: null,
          changes: iterChanges,
          duration: Date.now() - iterStart
        });

        return {
          success: true,
          result,
          iterations: iteration + 1,
          history,
          changes,
          lastFeedback: null,
          bestIteration: iteration,
          note: 'Accepted as partial success'
        };
      }

      // Step 5: Analyze failure
      let failureAnalysis;
      try {
        failureAnalysis = modules.analyzeFailure(result, validation, task, currentContext);
      } catch (faErr) {
        failureAnalysis = {
          category: 'unknown',
          confidence: 0.1,
          evidence: faErr.message,
          suggestedFix: 'Retry with explicit instructions'
        };
      }

      // Step 6: Generate feedback
      let feedback;
      try {
        feedback = modules.generateFeedback(failureAnalysis, task, currentContext, result);
      } catch (fbErr) {
        feedback = {
          failureCategory: 'unknown',
          requiredAction: `Retry with different approach. Error: ${fbErr.message}`,
          modifiedPrompt: { systemPrompt: '', userPrompt: task.goal || '' }
        };
      }

      lastFeedback = feedback;

      // Step 7: Apply feedback — modify context, strategy, or plan
      const appliedChanges = applyFeedback(currentContext, currentStrategy, feedback, failureAnalysis, iteration);

      currentContext = appliedChanges.context;
      currentStrategy = appliedChanges.strategy;
      iterChanges.push(...appliedChanges.changes);

      history.push({
        index: iteration,
        result,
        validation,
        evaluation,
        failureAnalysis,
        feedback,
        changes: iterChanges,
        duration: Date.now() - iterStart
      });

      changes.push({
        iteration,
        type: 'feedback_applied',
        changes: iterChanges,
        newStrategy: currentStrategy ? currentStrategy.name : null
      });

      // Callback
      if (opts.onIteration && typeof opts.onIteration === 'function') {
        try {
          opts.onIteration(iteration + 1, history[history.length - 1]);
        } catch { /* Ignore callback errors */ }
      }

    } catch (loopErr) {
      // Unexpected error in the loop — record and continue
      history.push({
        index: iteration,
        error: loopErr.message,
        changes: [],
        duration: Date.now() - iterStart
      });
      changes.push({ iteration, type: 'unexpected_error', detail: loopErr.message });
    }
  }

  // All iterations exhausted
  return {
    success: false,
    result: bestResult,
    iterations: maxIterations,
    history,
    changes,
    lastFeedback,
    bestIteration: bestResult ? history.findIndex(h => h.result === bestResult) : -1,
    note: `Exhausted ${maxIterations} iterations without achieving success threshold.`
  };
}

// ---------------------------------------------------------------------------
// Feedback Application
// ---------------------------------------------------------------------------

/**
 * Apply feedback to context and strategy before retry.
 * NEVER returns the same context/strategy unchanged.
 *
 * @param {Object} context - Current context
 * @param {Object} strategy - Current strategy
 * @param {Object} feedback - Generated feedback
 * @param {Object} failureAnalysis - Failure analysis
 * @param {number} iteration - Current iteration (0-based)
 * @returns {{ context: Object, strategy: Object, changes: string[] }}
 */
function applyFeedback(context, strategy, feedback, failureAnalysis, iteration) {
  const changes = [];
  let newContext = context ? JSON.parse(JSON.stringify(context)) : null;
  let newStrategy = strategy ? { ...strategy } : null;

  const category = (failureAnalysis && failureAnalysis.category) || 'unknown';

  // Strategy adjustments
  switch (category) {
    case 'model_reasoning_failure':
      changes.push('strategy:increased_validation');
      if (newStrategy) {
        newStrategy.requiresValidation = true;
        newStrategy.extraValidationSteps = 1;
      }
      break;

    case 'execution_failure':
      changes.push('strategy:added_pre_check');
      if (newStrategy) {
        newStrategy.requiresValidation = true;
        newStrategy.requiresJudge = iteration >= 1; // Add judge on 2nd+ failure
      }
      break;

    case 'missing_context':
      changes.push('context:expanded_search');
      // Cannot expand context here — mark as needing more
      if (newContext && newContext.metadata) {
        newContext.metadata.needs_expansion = true;
      }
      break;

    case 'context_noise':
      changes.push('context:filtered_noise');
      if (newContext && newContext.files && newContext.files.length > 5) {
        // Keep only top-scoring files
        const topFiles = newContext.files
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .slice(0, Math.max(3, Math.floor(newContext.files.length / 2)));
        newContext.files = topFiles;
        changes.push(`context:reduced_files_from_${newContext.files.length + topFiles.length}_to_${topFiles.length}`);
      }
      break;

    case 'bad_plan':
      changes.push('prompt:restructured_plan');
      if (newStrategy) {
        newStrategy.useSimplerPlan = true;
      }
      break;

    case 'bad_decomposition':
      changes.push('decomposition:reduced_granularity');
      if (newStrategy) {
        newStrategy.maxSubTasks = Math.max(1, (newStrategy.maxSubTasks || 5) - 2);
        changes.push(`decomposition:max_subtasks_${newStrategy.maxSubTasks}`);
      }
      break;

    default:
      // Generic: tighten validation
      changes.push('strategy:tightened_validation');
      if (newStrategy) {
        newStrategy.requiresValidation = true;
      }
      break;
  }

  // Context adjustments — inject feedback into context
  if (newContext) {
    if (!newContext.feedback) newContext.feedback = [];
    newContext.feedback.push({
      iteration,
      category,
      action: feedback.requiredAction || 'Retry with corrections',
      timestamp: new Date().toISOString()
    });
    changes.push('context:injected_feedback');
  }

  // Escalate strategy on repeated failures
  if (iteration >= 2) {
    changes.push('strategy:escalated_to_strict');
    if (newStrategy) {
      newStrategy.requiresJudge = true;
      newStrategy.strictMode = true;
    }
  }

  // Inject modified prompt from feedback into context
  if (feedback && feedback.modifiedPrompt) {
    if (!newContext) {
      newContext = { metadata: { generated_at: new Date().toISOString() }, files: [], feedback: [] };
    }
    newContext.modifiedPrompt = feedback.modifiedPrompt;
    changes.push('context:injected_modified_prompt');
  }

  return {
    context: newContext,
    strategy: newStrategy,
    changes
  };
}

// ---------------------------------------------------------------------------
// Context Application (for external use)
// ---------------------------------------------------------------------------

/**
 * Apply feedback to context only — used when feedback-engine.js provides
 * modified prompts.
 *
 * @param {Object} context - Current context
 * @param {Object} feedback - Feedback with modifiedPrompt
 * @returns {Object} Updated context
 */
function applyFeedbackToContext(context, feedback) {
  if (!context) {
    return {
      metadata: { generated_at: new Date().toISOString() },
      files: [],
      feedback: [{
        iteration: 0,
        category: feedback.failureCategory || 'unknown',
        action: feedback.requiredAction || 'Retry',
        timestamp: new Date().toISOString()
      }]
    };
  }

  const updated = JSON.parse(JSON.stringify(context));

  // Add feedback history
  if (!updated.feedback) updated.feedback = [];
  updated.feedback.push({
    iteration: updated.feedback.length,
    category: feedback.failureCategory || 'unknown',
    action: feedback.requiredAction || 'Retry',
    modifiedPrompt: feedback.modifiedPrompt || null,
    timestamp: new Date().toISOString()
  });

  // Add modified prompt if available
  if (feedback.modifiedPrompt) {
    updated.modifiedPrompt = feedback.modifiedPrompt;
  }

  // Add additional context
  if (feedback.additionalContext) {
    if (!updated.additionalNotes) updated.additionalNotes = [];
    updated.additionalNotes.push(feedback.additionalContext);
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Helper: Create Failed Result
// ---------------------------------------------------------------------------

/**
 * Create a failed refinement result.
 *
 * @param {string} reason
 * @param {number} iterations
 * @returns {RefinementResult}
 */
function createFailedResult(reason, iterations) {
  return {
    success: false,
    result: null,
    iterations,
    history: [],
    changes: [{ type: 'error', detail: reason }],
    lastFeedback: { failureCategory: 'execution_failure', evidence: reason },
    bestIteration: -1
  };
}

// ---------------------------------------------------------------------------
// Helper: Load Module
// ---------------------------------------------------------------------------

/**
 * Load a module and extract a specific function.
 *
 * @param {string} path - Module path (relative)
 * @param {string} fnName - Function name to extract
 * @returns {Function|null}
 */
function loadModule(modPath, fnName) {
  try {
    const mod = require(modPath);
    return typeof mod[fnName] === 'function' ? mod[fnName] : null;
  } catch {
    return null;
  }
}

/**
 * Get the execute function from a strategy module.
 *
 * @param {Object} strategy
 * @returns {Function|null}
 */
function getStrategyExecute(strategy) {
  if (!strategy || !strategy.name) return null;

  try {
    const mod = require(`../strategy/${strategy.name}`);
    return typeof mod.execute === 'function' ? mod.execute : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  refine,
  applyFeedback,
  applyFeedbackToContext,
  MAX_ITERATIONS,
  SUCCESS_THRESHOLD
};
