/**
 * Matrix Strategy: Standard
 * =========================
 * For complexity 3 tasks. Analysis + model call + basic validation.
 * Balanced path — moderate cost, moderate quality assurance.
 *
 * EXECUTION FLOW:
 *   1. Build optimized prompt from task analysis
 *   2. Single model call
 *   3. Basic validation (schema check, completeness)
 *   4. Return result with validation report
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
  name: 'standard',
  complexityRange: [3, 3],
  maxModelCalls: 1,
  requiresContext: true,
  requiresAnalysis: true,
  requiresValidation: true,
  requiresJudge: false,
  description: 'Analysis-guided model call with basic validation. For medium-complexity tasks.'
};

/**
 * Execute the standard strategy.
 *
 * @param {Object} task - Task analysis from task-intelligence.js
 * @param {Object} provider - Model provider with a `call(prompt)` method
 * @param {Object} [context] - Gathered context from context-engine.js
 * @returns {Promise<{ content: string, usage: Object, metadata: Object, validation: Object }>}
 */
async function execute(task, provider, context) {
  if (!task) {
    throw new Error('Standard strategy: task is required');
  }
  if (!provider || typeof provider.call !== 'function') {
    throw new Error('Standard strategy: provider with call() method is required');
  }

  const startTime = Date.now();

  // Step 1: Build an optimized prompt
  const { systemPrompt, userPrompt } = buildPrompts(task, context);

  // Step 2: Single model call
  let rawResult;
  try {
    rawResult = await provider.call({
      system: systemPrompt,
      user: userPrompt
    });
  } catch (err) {
    throw new Error(`Standard strategy: model call failed — ${err.message}`);
  }

  // Normalize result
  const content = normalizeOutput(rawResult);

  // Step 3: Basic validation
  const validation = validateOutput(content, task);

  const duration = Date.now() - startTime;

  const usage = rawResult.usage || estimateUsage(systemPrompt + userPrompt, content);

  const metadata = {
    strategy: 'standard',
    modelCalls: 1,
    totalDuration: duration,
    tokenUsage: usage,
    validationSummary: validation,
    timestamp: new Date().toISOString()
  };

  return { content, usage, metadata, validation };
}

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------

/**
 * Build system and user prompts from task analysis and context.
 *
 * @param {Object} task
 * @param {Object} [context]
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
function buildPrompts(task, context) {
  const systemPrompt = [
    'You are an expert software developer. Follow instructions precisely.',
    `Task type: ${task.taskType || 'coding'}`,
    `Complexity: ${task.complexity || 3}/5`,
    '',
    'Output format: Provide your complete solution.',
    'Do NOT include unnecessary explanations. Be direct and precise.',
    task.constraints && task.constraints.length > 0
      ? `Constraints: ${task.constraints.join(', ')}`
      : ''
  ].filter(Boolean).join('\n');

  let userPrompt = `**Goal:** ${task.goal || '(no goal specified)'}\n\n`;

  if (task.successCriteria && task.successCriteria.length > 0) {
    userPrompt += `**Success Criteria:**\n${task.successCriteria.map(c => `- ${c}`).join('\n')}\n\n`;
  }

  if (context && context.files && context.files.length > 0) {
    userPrompt += `**Relevant Context:**\n`;
    for (const file of context.files.slice(0, 5)) {
      const fileContent = file.compressed_content || file.content || '';
      if (fileContent) {
        const snippet = fileContent.length > 2000
          ? fileContent.slice(0, 2000) + '\n// ... (truncated)'
          : fileContent;
        userPrompt += `\n### File: ${file.path || file.path || 'unknown'}\n\`\`\`\n${snippet}\n\`\`\`\n`;
      }
    }
  }

  userPrompt += `\n**Instructions:** Provide your complete solution.`;

  return { systemPrompt, userPrompt };
}

// ---------------------------------------------------------------------------
// Output Processing
// ---------------------------------------------------------------------------

/**
 * Normalize model output to a string.
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

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Basic output validation.
 *
 * @param {string} content
 * @param {Object} task
 * @returns {{ passed: boolean, issues: string[] }}
 */
function validateOutput(content, task) {
  const issues = [];

  // Empty check
  if (!content || content.trim().length === 0) {
    issues.push('output_empty');
    return { passed: false, issues };
  }

  // Minimum quality check
  if (content.length < 50) {
    issues.push('output_too_short');
  }

  // Refusal detection
  const refusalPatterns = [
    /i cannot/i, /i'm unable/i, /i am unable/i, /i don't have/i,
    /not capable/i, /cannot assist/i, /no, i/i
  ];
  if (refusalPatterns.some(p => p.test(content))) {
    issues.push('model_refusal_detected');
  }

  // For coding tasks, check if code blocks present
  if (task.taskType === 'coding' || task.taskType === 'debugging' || task.taskType === 'refactoring') {
    if (!content.includes('```') && !content.includes('function') && !content.includes('class ')) {
      issues.push('no_code_detected_in_coding_task');
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    outputLength: content.length
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  buildPrompts,
  validateOutput
};
