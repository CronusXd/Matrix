/**
 * Matrix Model Strategy Adapter v1.0
 * ===================================
 * Adapts strategies based on model capability profiles.
 *
 * Core principle:
 *   Weak model → more decomposition, simpler prompts, stricter verification.
 *   Strong model → less hand-holding, more autonomy.
 *
 * NEVER over-decompose a task that a strong model can handle directly.
 *
 * CommonJS module. Zero npm dependencies.
 *
 * @version 1.0.0
 */

'use strict';

// ---------------------------------------------------------------------------
// @typedef
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} StrategyAdaptation
 * @property {Object} adaptedStrategy - Modified strategy config
 * @property {string[]} adaptations - List of adaptations made
 * @property {number} confidence - Confidence in the adaptation (0-1)
 * @property {Object} reasoning - Detailed reasoning for each adaptation
 */

/**
 * @typedef {Object} PromptAdaptation
 * @property {string} adaptedPrompt - Modified prompt
 * @property {string[]} changes - What was changed
 */

/**
 * @typedef {Object} DecompositionAdaptation
 * @property {Object[]} subTasks - Decomposed sub-tasks
 * @property {string[]} reasoning - Why decomposition was applied
 */

// ---------------------------------------------------------------------------
// Main API: adaptStrategy
// ---------------------------------------------------------------------------

/**
 * Adapt a strategy based on model capability profile.
 *
 * @param {Object} strategy - Strategy selection from strategy-engine.js
 * @param {Object} profile - Model capability profile from profile.js
 * @param {Object} [options]
 * @param {Object} [options.task] - Task analysis for context
 * @returns {StrategyAdaptation}
 */
function adaptStrategy(strategy, profile, options) {
  options = options || {};

  if (!strategy) {
    return {
      adaptedStrategy: { name: 'standard' },
      adaptations: ['strategy_not_provided'],
      confidence: 0.3,
      reasoning: { error: 'No strategy provided' }
    };
  }

  if (!profile) {
    // No profile → proceed with strategy as-is
    return {
      adaptedStrategy: { ...(strategy.definition || {}), name: strategy.name },
      adaptations: [],
      confidence: 0.5,
      reasoning: { warning: 'No model profile available, using strategy as-is' }
    };
  }

  const adaptations = [];
  const reasoning = {};
  const adapted = {
    ...(strategy.definition || {}),
    name: strategy.name
  };

  // Adaptation 1: Coding capability
  if (profile.coding !== undefined && profile.coding < 0.65) {
    adaptations.push('added_explicit_code_structure');
    reasoning.coding = `Low coding score (${profile.coding.toFixed(2)}): provide explicit code structure`;
    adapted.useExplicitStructure = true;
    adapted.maxSubTasks = (adapted.maxSubTasks || 2) + 1; // More decomposition
  }

  // Adaptation 2: Reasoning capability
  if (profile.reasoning !== undefined && profile.reasoning < 0.60) {
    adaptations.push('decomposed_into_smaller_steps');
    reasoning.reasoning = `Low reasoning score (${profile.reasoning.toFixed(2)}): decompose further`;
    adapted.maxSubTasks = (adapted.maxSubTasks || 3) + 2;
    adapted.requiresAnalysis = true; // Force analysis step
  }

  // Adaptation 3: Instruction following
  if (profile.instructionFollowing !== undefined && profile.instructionFollowing < 0.70) {
    adaptations.push('simplified_instructions');
    reasoning.instructionFollowing = `Low instruction following (${profile.instructionFollowing.toFixed(2)}): use simpler, more explicit instructions`;
    adapted.simplifiedInstructions = true;
    adapted.maxInstructionLength = 1500;
  }

  // Adaptation 4: Structured output
  if (profile.structuredOutput !== undefined && profile.structuredOutput < 0.70) {
    adaptations.push('added_output_schema_constraints');
    reasoning.structuredOutput = `Low structured output score (${profile.structuredOutput.toFixed(2)}): add schema constraints`;
    adapted.enforceSchema = true;
    adapted.useTemplates = true;
  }

  // Adaptation 5: Tool use
  if (profile.toolUse !== undefined && profile.toolUse < 0.55) {
    adaptations.push('provide_tool_alternatives');
    reasoning.toolUse = `Low tool use score (${profile.toolUse.toFixed(2)}): limit tool dependency`;
    adapted.useTools = false;
    adapted.provideToolAlternatives = true;
  }

  // Adaptation 6: Error recovery
  if (profile.errorRecovery !== undefined && profile.errorRecovery < 0.50) {
    adaptations.push('stricter_verification_required');
    reasoning.errorRecovery = `Low error recovery (${profile.errorRecovery.toFixed(2)}): require stricter verification`;
    adapted.requiresValidation = true;
    adapted.requiresJudge = true;
    adapted.extraValidationSteps = 2;
  }

  // Adaptation 7: Context handling
  if (profile.contextHandling !== undefined && profile.contextHandling < 0.60) {
    adaptations.push('reduced_context_size');
    reasoning.contextHandling = `Low context handling (${profile.contextHandling.toFixed(2)}): reduce context`;
    adapted.maxContextFiles = 5;
    adapted.contextTruncationThreshold = 2000;
  }

  // Adaptation 8: High scores → reduce overhead
  if (isStrongModel(profile)) {
    adaptations.push('reduced_verbosity_for_strong_model');
    reasoning.strongModel = 'Strong model: reduce hand-holding and explicit decomposition';
    adapted.reducedVerbosity = true;
    adapted.maxSubTasks = Math.max(1, (adapted.maxSubTasks || 5) - 2);
    adapted.requiresAnalysis = false;
  }

  // Confidence: higher when we have verified profiles
  const confidence = profile.verified ? 0.9 : 0.7 - (adaptations.length * 0.05);

  return {
    adaptedStrategy: adapted,
    adaptations,
    confidence: +Math.max(0.1, confidence).toFixed(2),
    reasoning
  };
}

// ---------------------------------------------------------------------------
// Prompt Adaptation
// ---------------------------------------------------------------------------

/**
 * Adapt a prompt based on model profile.
 * Weaker models get simpler, more explicit prompts.
 *
 * @param {Object|string} prompt - Original prompt or compiled prompt object
 * @param {Object} profile - Model capability profile
 * @returns {PromptAdaptation}
 */
function adaptPrompt(prompt, profile) {
  const changes = [];

  if (!prompt || !profile) {
    return {
      adaptedPrompt: typeof prompt === 'string' ? prompt : JSON.stringify(prompt),
      changes: ['no_adaptation_possible'],
    };
  }

  // Normalize to string
  const originalPrompt = typeof prompt === 'string'
    ? prompt
    : (prompt.userPrompt || prompt.systemPrompt || JSON.stringify(prompt));

  let adaptedPrompt = originalPrompt;

  // Low instruction following → add explicit markers
  if (profile.instructionFollowing < 0.70) {
    // Add [IMPORTANT] markers before key instructions
    adaptedPrompt = adaptedPrompt
      .replace(/## (?!IMPORTANT)(\w+)/g, '## [IMPORTANT] $1')
      .replace(/\n\*\*/g, '\n**[IMPORTANT]** ');
    changes.push('added_explicit_importance_markers');

    // Add "do not skip" reminders
    adaptedPrompt += '\n\n**REMINDER: Address ALL sections above. Do not skip any part.**';
    changes.push('added_skip_prevention');
  }

  // Low structured output → add format template
  if (profile.structuredOutput < 0.70) {
    const template = '\n\n**OUTPUT TEMPLATE (follow exactly):**\n' +
      '```\n' +
      '1. Brief Analysis (2-3 sentences)\n' +
      '2. Solution:\n' +
      '   ```[language]\n' +
      '   [your complete code here]\n' +
      '   ```\n' +
      '3. Key decisions made (bullet points)\n' +
      '```';
    adaptedPrompt += template;
    changes.push('added_output_template');
  }

  // Low coding → add scaffolding
  if (profile.coding < 0.65) {
    const scaffolding = '\n\n**CODING GUIDE:**\n' +
      '- Include ALL imports at the top\n' +
      '- Use try/catch for error-prone operations\n' +
      '- Add comments explaining the logic\n' +
      '- Test with the examples provided\n';
    adaptedPrompt += scaffolding;
    changes.push('added_coding_scaffolding');
  }

  // Truncate if model has small context window
  if (profile.maxContextWindow && profile.maxContextWindow < 64000) {
    const maxChars = Math.floor(profile.maxContextWindow * 0.8); // 80% safety margin
    if (adaptedPrompt.length > maxChars) {
      adaptedPrompt = adaptedPrompt.slice(0, maxChars - 100) +
        '\n\n// [truncated for context window compatibility]';
      changes.push('truncated_for_context_window');
    }
  }

  return {
    adaptedPrompt,
    changes
  };
}

// ---------------------------------------------------------------------------
// Decomposition Adaptation
// ---------------------------------------------------------------------------

/**
 * Adapt task decomposition based on model profile.
 * Weaker models → more granular sub-tasks.
 *
 * @param {Object} task - Task analysis
 * @param {Object} profile - Model capability profile
 * @returns {DecompositionAdaptation}
 */
function adaptDecomposition(task, profile) {
  const reasoning = [];

  if (!task) {
    return { subTasks: [], reasoning: ['no_task_provided'] };
  }

  const complexity = task.complexity || 3;
  const taskType = task.taskType || 'other';

  // Default sub-task count based on complexity
  let subTaskCount = complexity;

  // Adjust based on model capabilities
  if (profile) {
    if (profile.reasoning < 0.60) {
      subTaskCount += 2;
      reasoning.push(`Low reasoning (${profile.reasoning.toFixed(2)}): adding 2 more sub-tasks`);
    }
    if (profile.coding < 0.65) {
      subTaskCount += 1;
      reasoning.push(`Low coding (${profile.coding.toFixed(2)}): adding 1 more sub-task`);
    }
    if (profile.consistency < 0.65) {
      subTaskCount += 1;
      reasoning.push(`Low consistency (${profile.consistency.toFixed(2)}): adding verification sub-task`);
    }
  }

  // Cap at reasonable maximum
  subTaskCount = Math.min(10, Math.max(1, subTaskCount));

  // Generate sub-tasks based on task type
  const subTasks = generateSubTasks(taskType, subTaskCount, task.goal);

  return {
    subTasks,
    reasoning: reasoning.length > 0 ? reasoning : ['standard decomposition for task type']
  };
}

// ---------------------------------------------------------------------------
// Verification Adaptation
// ---------------------------------------------------------------------------

/**
 * Adapt verification requirements based on model profile.
 *
 * @param {Object} strategy - Strategy object
 * @param {Object} profile - Model capability profile
 * @returns {{ requireDeepValidation: boolean, requireJudge: boolean, verificationSteps: string[] }}
 */
function adaptVerification(strategy, profile) {
  if (!profile) {
    return {
      requireDeepValidation: false,
      requireJudge: false,
      verificationSteps: ['basic_output_check']
    };
  }

  const steps = ['basic_output_check'];
  let requireDeepValidation = false;
  let requireJudge = false;

  // Models with poor error recovery need stricter verification
  if (profile.errorRecovery < 0.55) {
    requireDeepValidation = true;
    requireJudge = true;
    steps.push('schema_validation');
    steps.push('syntax_check');
    steps.push('edge_case_testing');
  }

  // Models with poor consistency need more checks
  if (profile.consistency < 0.65) {
    requireDeepValidation = true;
    steps.push('consistency_check');
    steps.push('cross_reference_validation');
  }

  // Models with poor coding need code quality checks
  if (profile.coding < 0.65) {
    steps.push('code_quality_check');
    steps.push('full_test_suite');
  }

  // Strong models can self-verify
  if (isStrongModel(profile)) {
    requireJudge = false;
    if (steps.length > 2) {
      steps.length = 2; // Keep only basic checks
    }
  }

  return {
    requireDeepValidation,
    requireJudge,
    verificationSteps: [...new Set(steps)] // Deduplicate
  };
}

// ---------------------------------------------------------------------------
// Strategy Routing Adapter
// ---------------------------------------------------------------------------

/**
 * Route model selection based on task and available models.
 * Uses capability profiles to pick the best model.
 *
 * @param {Object} taskAnalysis - Task analysis
 * @param {string[]} availableModels - Available model identifiers
 * @param {Object} [options]
 * @param {boolean} [options.preferCheapest] - Prefer cheapest suitable model
 * @param {number} [options.maxCost] - Maximum acceptable cost tier
 * @returns {{ selectedModel: string, fallbackModels: string[], reasoning: string }}
 */
function routeModel(taskAnalysis, availableModels, options) {
  options = options || {};

  if (!availableModels || availableModels.length === 0) {
    return {
      selectedModel: null,
      fallbackModels: [],
      reasoning: 'no_models_available'
    };
  }

  try {
    const profileModule = require('./profile');
    const bestModel = profileModule.findBestModel(availableModels, taskAnalysis);

    // Build fallback chain (remaining models)
    const fallbackModels = availableModels.filter(m => m !== bestModel);

    // Verify the selected model
    const suitability = profileModule.isSuitable(
      bestModel,
      taskAnalysis ? taskAnalysis.complexity : 3,
      taskAnalysis ? taskAnalysis.taskType : 'coding'
    );

    return {
      selectedModel: bestModel,
      fallbackModels,
      reasoning: suitability.reason
    };
  } catch (err) {
    return {
      selectedModel: availableModels[0],
      fallbackModels: availableModels.slice(1),
      reasoning: `profile_module_unavailable: ${err.message}`
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a model is considered "strong" based on its profile.
 *
 * @param {Object} profile
 * @returns {boolean}
 */
function isStrongModel(profile) {
  if (!profile) return false;

  // Average of key capabilities
  const avgScore = (
    (profile.coding || 0) +
    (profile.reasoning || 0) +
    (profile.planning || 0) +
    (profile.instructionFollowing || 0) +
    (profile.structuredOutput || 0)
  ) / 5;

  return avgScore >= 0.80;
}

/**
 * Generate sub-tasks based on task type and count.
 *
 * @param {string} taskType
 * @param {number} count
 * @param {string} goal
 * @returns {Object[]}
 */
function generateSubTasks(taskType, count, goal) {
  const templates = {
    coding: [
      { title: 'Analyze Requirements', description: 'Understand what needs to be built' },
      { title: 'Design Solution', description: 'Plan the code structure' },
      { title: 'Implement Core Logic', description: 'Write the main implementation' },
      { title: 'Handle Edge Cases', description: 'Add error handling and edge cases' },
      { title: 'Integrate Components', description: 'Wire everything together' },
      { title: 'Add Tests', description: 'Write unit tests' },
      { title: 'Verify', description: 'Run tests and verify criteria' },
      { title: 'Document', description: 'Add comments and documentation' },
      { title: 'Review', description: 'Self-review for quality' },
      { title: 'Polish', description: 'Final cleanup and optimization' }
    ],
    debugging: [
      { title: 'Reproduce Bug', description: 'Create a reproducible test case' },
      { title: 'Isolate Cause', description: 'Narrow down to specific code section' },
      { title: 'Identify Root Cause', description: 'Find the exact line/condition' },
      { title: 'Design Fix', description: 'Plan the minimal fix' },
      { title: 'Apply Fix', description: 'Implement the correction' },
      { title: 'Verify Fix', description: 'Confirm the bug is resolved' },
      { title: 'Check Regressions', description: 'Ensure nothing else broke' },
      { title: 'Add Test', description: 'Add regression test' }
    ],
    refactoring: [
      { title: 'Map Current State', description: 'Document existing structure' },
      { title: 'Design Target', description: 'Plan the new structure' },
      { title: 'Extract Module 1', description: 'First extraction step' },
      { title: 'Extract Module 2', description: 'Second extraction step' },
      { title: 'Update References', description: 'Update all imports and calls' },
      { title: 'Verify Behavior', description: 'Run tests to ensure no regression' },
      { title: 'Clean Up', description: 'Remove old code, update docs' }
    ],
    default: [
      { title: 'Analyze', description: 'Understand the problem' },
      { title: 'Plan', description: 'Design the approach' },
      { title: 'Execute', description: 'Implement the solution' },
      { title: 'Verify', description: 'Check the results' },
      { title: 'Deliver', description: 'Finalize the output' }
    ]
  };

  const template = templates[taskType] || templates.default;
  return template.slice(0, count).map((t, i) => ({
    id: i + 1,
    title: t.title,
    description: t.description,
    goal: goal ? `Towards: ${goal.slice(0, 100)}` : undefined
  }));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Main adaptation
  adaptStrategy,
  adaptPrompt,
  adaptDecomposition,
  adaptVerification,

  // Routing
  routeModel,

  // Helpers
  isStrongModel,
  generateSubTasks
};
