/**
 * Matrix Strategy: Deep
 * =====================
 * For complexity 4 tasks. Plan + context + model call + validation + judge.
 * Comprehensive path with quality gates.
 *
 * EXECUTION FLOW:
 *   1. Generate execution plan
 *   2. Gather and optimize context
 *   3. Model call with structured prompt
 *   4. Full validation (schema, tests, requirements)
 *   5. Judge review of output
 *   6. Return result with full metadata
 *
 * CommonJS module. Zero npm dependencies.
 *
 * @version 1.0.0
 */

'use strict';

/**
 * Strategy definition.
 */
const definition = {
  name: 'deep',
  complexityRange: [4, 4],
  maxModelCalls: 1,
  requiresContext: true,
  requiresAnalysis: true,
  requiresValidation: true,
  requiresJudge: true,
  description: 'Plan-guided execution with full validation and judge review. For complex tasks.'
};

/**
 * Execute the deep strategy.
 *
 * @param {Object} task - Task analysis from task-intelligence.js
 * @param {Object} provider - Model provider with a `call(prompt)` method
 * @param {Object} [context] - Gathered context from context-engine.js
 * @param {Object} [options]
 * @param {Function} [options.judge] - Optional judge function for review
 * @returns {Promise<{ content: string, usage: Object, metadata: Object, validation: Object, plan: Object }>}
 */
async function execute(task, provider, context, options) {
  options = options || {};

  if (!task) {
    throw new Error('Deep strategy: task is required');
  }
  if (!provider || typeof provider.call !== 'function') {
    throw new Error('Deep strategy: provider with call() method is required');
  }

  const startTime = Date.now();
  const timeline = [];

  // Step 1: Generate execution plan
  const plan = generatePlan(task, context);
  timeline.push({ step: 'plan_generated', ms: Date.now() - startTime });

  // Step 2: Build structured prompt
  const { systemPrompt, userPrompt } = buildStructuredPrompts(task, context, plan);
  timeline.push({ step: 'prompts_built', ms: Date.now() - startTime });

  // Step 3: Model call
  let rawResult;
  try {
    rawResult = await provider.call({
      system: systemPrompt,
      user: userPrompt
    });
  } catch (err) {
    throw new Error(`Deep strategy: model call failed — ${err.message}`);
  }
  timeline.push({ step: 'model_call_complete', ms: Date.now() - startTime });

  // Normalize output
  const content = normalizeOutput(rawResult);

  // Step 4: Full validation
  const validation = validateFull(content, task, plan);
  timeline.push({ step: 'validation_complete', ms: Date.now() - startTime });

  // Step 5: Judge review (optional)
  let judgeResult = null;
  if (options.judge && typeof options.judge === 'function') {
    try {
      judgeResult = await options.judge(content, task, validation);
      timeline.push({ step: 'judge_review_complete', ms: Date.now() - startTime });
    } catch (err) {
      judgeResult = { error: err.message, skipped: true };
    }
  } else if (definition.requiresJudge && !options.judge) {
    // Judge is required but not provided — flag as degraded
    judgeResult = { degraded: true, reason: 'judge_not_available' };
  }

  const duration = Date.now() - startTime;

  const usage = rawResult.usage || estimateUsage(systemPrompt + userPrompt, content);

  const metadata = {
    strategy: 'deep',
    modelCalls: 1,
    totalDuration: duration,
    tokenUsage: usage,
    timeline,
    judgeResult,
    timestamp: new Date().toISOString()
  };

  return { content, usage, metadata, validation, plan };
}

// ---------------------------------------------------------------------------
// Plan Generation
// ---------------------------------------------------------------------------

/**
 * Generate an execution plan from task analysis.
 *
 * @param {Object} task
 * @param {Object} [context]
 * @returns {{ steps: Array<{ id: number, action: string, files: string[] }>, constraints: string[] }}
 */
function generatePlan(task, context) {
  const steps = [];
  const relevantFiles = extractRelevantFiles(context);

  // Step decomposition based on task type
  switch (task.taskType) {
    case 'coding':
      steps.push(
        { id: 1, action: 'Analyze requirements and identify target files', files: relevantFiles.slice(0, 3) },
        { id: 2, action: 'Implement core logic', files: relevantFiles },
        { id: 3, action: 'Wire up dependencies and imports', files: relevantFiles },
        { id: 4, action: 'Add error handling and edge cases', files: relevantFiles }
      );
      break;

    case 'debugging':
      steps.push(
        { id: 1, action: 'Reproduce and isolate the bug', files: relevantFiles.slice(0, 2) },
        { id: 2, action: 'Identify root cause in code', files: relevantFiles },
        { id: 3, action: 'Apply fix with minimal changes', files: relevantFiles.slice(0, 2) },
        { id: 4, action: 'Verify fix does not break anything', files: relevantFiles }
      );
      break;

    case 'refactoring':
      steps.push(
        { id: 1, action: 'Map current structure and dependencies', files: relevantFiles },
        { id: 2, action: 'Design target structure', files: [] },
        { id: 3, action: 'Extract and reorganize incrementally', files: relevantFiles },
        { id: 4, action: 'Update all references and imports', files: relevantFiles },
        { id: 5, action: 'Validate behavior unchanged', files: relevantFiles }
      );
      break;

    case 'architecture':
      steps.push(
        { id: 1, action: 'Document current architecture', files: relevantFiles },
        { id: 2, action: 'Identify requirements and constraints', files: [] },
        { id: 3, action: 'Design target architecture', files: [] },
        { id: 4, action: 'Plan migration path', files: [] },
        { id: 5, action: 'Define success metrics', files: [] }
      );
      break;

    default:
      steps.push(
        { id: 1, action: 'Analyze problem', files: relevantFiles.slice(0, 3) },
        { id: 2, action: 'Develop solution', files: relevantFiles },
        { id: 3, action: 'Verify solution', files: relevantFiles }
      );
  }

  return {
    steps,
    constraints: task.constraints || [],
    successCriteria: task.successCriteria || [],
    estimatedSteps: steps.length
  };
}

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------

/**
 * Build structured prompts for the deep strategy.
 *
 * @param {Object} task
 * @param {Object} [context]
 * @param {Object} plan
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
function buildStructuredPrompts(task, context, plan) {
  const systemPrompt = [
    'You are a senior software architect with deep expertise.',
    'You follow a systematic approach: analyze, plan, execute, verify.',
    '',
    `**Role:** Expert ${task.taskType || 'developer'}`,
    `**Complexity Level:** ${task.complexity || 4}/5`,
    '',
    '**Quality Requirements:**',
    '- Write production-quality code',
    '- Handle all edge cases and errors',
    '- Include necessary imports and dependencies',
    '- Follow existing project conventions',
    '- Ensure backward compatibility where specified',
    '',
    task.constraints && task.constraints.length > 0
      ? `**Constraints:** ${task.constraints.join('; ')}`
      : ''
  ].filter(Boolean).join('\n');

  let userPrompt = `# Task\n\n${task.goal || '(no goal specified)'}\n\n`;

  // Execution plan
  userPrompt += `# Execution Plan\n\n`;
  for (const step of (plan.steps || [])) {
    userPrompt += `${step.id}. **${step.action}**`;
    if (step.files && step.files.length > 0) {
      userPrompt += ` (files: ${step.files.join(', ')})`;
    }
    userPrompt += '\n';
  }
  userPrompt += '\n';

  // Success criteria
  if (task.successCriteria && task.successCriteria.length > 0) {
    userPrompt += `# Success Criteria\n`;
    for (const criterion of task.successCriteria) {
      userPrompt += `- [ ] ${criterion}\n`;
    }
    userPrompt += '\n';
  }

  // Context
  if (context && context.files && context.files.length > 0) {
    userPrompt += `# Context Files\n\n`;
    for (const file of context.files.slice(0, 10)) {
      const content = file.compressed_content || file.content || '';
      if (content) {
        const snippet = content.length > 3000
          ? content.slice(0, 3000) + '\n// ... (truncated)'
          : content;
        userPrompt += `### ${file.path || 'unknown'}\n\`\`\`\n${snippet}\n\`\`\`\n\n`;
      }
    }
  }

  // Output requirements
  userPrompt += `# Output Requirements\n`;
  userPrompt += `1. Provide complete, working solution\n`;
  userPrompt += `2. Include all necessary code, imports, and configuration\n`;
  userPrompt += `3. Add brief explanatory comments for complex logic\n`;
  userPrompt += `4. List any assumptions made\n`;

  return { systemPrompt, userPrompt };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Full output validation for deep strategy.
 *
 * @param {string} content
 * @param {Object} task
 * @param {Object} plan
 * @returns {{ passed: boolean, score: number, issues: string[], warnings: string[] }}
 */
function validateFull(content, task, plan) {
  const issues = [];
  const warnings = [];
  let score = 10;

  // Empty check
  if (!content || content.trim().length === 0) {
    return { passed: false, score: 0, issues: ['output_empty'], warnings: [] };
  }

  // Refusal check
  const refusalPatterns = /i (?:cannot|can't|am unable to|don't have the|am not able to)/i;
  if (refusalPatterns.test(content)) {
    issues.push('model_refusal');
    score -= 5;
  }

  // Length check
  if (content.length < 100) {
    issues.push('output_too_short');
    score -= 3;
  }

  // Code presence check (for code-related tasks)
  const isCodeTask = ['coding', 'debugging', 'refactoring', 'architecture'].includes(task.taskType);
  if (isCodeTask && !content.includes('```') && !hasCodeIndicators(content)) {
    warnings.push('no_explicit_code_blocks');
    score -= 1;
  }

  // Plan coverage: check if each plan step is addressed
  if (plan && plan.steps) {
    const addressed = plan.steps.filter(step =>
      content.toLowerCase().includes(step.action.toLowerCase().split(' ')[0])
    ).length;
    const coverage = addressed / plan.steps.length;
    if (coverage < 0.5) {
      warnings.push(`low_plan_coverage: ${Math.round(coverage * 100)}% of steps addressed`);
      score -= 2;
    }
  }

  // Constraint compliance check
  if (task.constraints && task.constraints.length > 0) {
    for (const constraint of task.constraints) {
      const keyword = constraint.replace(/^[^:]+:/, '').toLowerCase();
      if (keyword && !content.toLowerCase().includes(keyword) && constraint.includes(':')) {
        warnings.push(`constraint_not_addressed: ${constraint}`);
      }
    }
  }

  return {
    passed: issues.length === 0,
    score: Math.max(0, Math.min(10, score)),
    issues,
    warnings,
    outputLength: content.length
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract relevant file paths from context.
 *
 * @param {Object} [context]
 * @returns {string[]}
 */
function extractRelevantFiles(context) {
  if (!context || !context.files) return [];
  return context.files
    .filter(f => f && f.path)
    .map(f => f.path);
}

/**
 * Normalize model output.
 *
 * @param {*} rawResult
 * @returns {string}
 */
function normalizeOutput(rawResult) {
  if (typeof rawResult === 'string') return rawResult;
  if (rawResult && typeof rawResult.output === 'string') return rawResult.output;
  if (rawResult && typeof rawResult.content === 'string') return rawResult.content;
  if (rawResult && typeof rawResult.text === 'string') return rawResult.text;
  if (rawResult && typeof rawResult === 'object') return JSON.stringify(rawResult);
  return String(rawResult || '');
}

/**
 * Check if content has code indicators without markdown code blocks.
 *
 * @param {string} content
 * @returns {boolean}
 */
function hasCodeIndicators(content) {
  const indicators = [
    /\bfunction\b/, /\bclass\b/, /\bconst\b/, /\blet\b/, /\bvar\b/,
    /\bimport\b/, /\brequire\b/, /\bexport\b/, /\breturn\b/,
    /\bif\s*\(/, /\bfor\s*\(/, /\bwhile\s*\(/
  ];
  return indicators.some(r => r.test(content));
}

/**
 * Estimate token usage.
 *
 * @param {string} input
 * @param {string} output
 * @returns {{ prompt_tokens: number, completion_tokens: number }}
 */
function estimateUsage(input, output) {
  return {
    prompt_tokens: Math.ceil((input || '').length / 4),
    completion_tokens: Math.ceil((output || '').length / 4)
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  definition,
  execute,
  generatePlan,
  buildStructuredPrompts,
  validateFull
};
