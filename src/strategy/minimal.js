/**
 * Matrix Strategy: Minimal
 * ========================
 * For complexity 1-2 tasks. Single model call, minimal context,
 * no validation or judge. Fastest path with lowest cost.
 *
 * EXECUTION FLOW:
 *   1. Build prompt from task
 *   2. Single model call
 *   3. Return raw result
 *
 * CommonJS module. Zero npm dependencies.
 *
 * @version 1.0.0
 */

'use strict';

/**
 * Strategy definition — exported for strategy-engine.js introspection.
 */
const definition = {
  name: 'minimal',
  complexityRange: [1, 2],
  maxModelCalls: 1,
  requiresContext: false,
  requiresAnalysis: false,
  requiresValidation: false,
  requiresJudge: false,
  description: 'Single model call with minimal overhead. For trivial/simple tasks.'
};

/**
 * Execute the minimal strategy.
 *
 * @param {Object} task - Task analysis from task-intelligence.js
 * @param {Object} provider - Model provider with a `call(prompt)` method
 * @param {Object} [context] - Optional context (not used by minimal strategy)
 * @returns {Promise<{ content: string, usage: Object, metadata: Object }>}
 */
async function execute(task, provider, context) {
  if (!task) {
    throw new Error('Minimal strategy: task is required');
  }
  if (!provider || typeof provider.call !== 'function') {
    throw new Error('Minimal strategy: provider with call() method is required');
  }

  const startTime = Date.now();

  // Build a simple prompt from the task goal
  const prompt = task.goal || JSON.stringify(task);

  // Single model call
  let rawResult;
  try {
    rawResult = await provider.call(prompt);
  } catch (err) {
    throw new Error(`Minimal strategy: model call failed — ${err.message}`);
  }

  // Normalize result
  const content = typeof rawResult === 'string'
    ? rawResult
    : (rawResult.output || rawResult.content || rawResult.text || JSON.stringify(rawResult));

  const usage = rawResult.usage || {
    prompt_tokens: estimateTokens(prompt),
    completion_tokens: estimateTokens(content),
    total_tokens: estimateTokens(prompt) + estimateTokens(content)
  };

  const duration = Date.now() - startTime;

  const metadata = {
    strategy: 'minimal',
    modelCalls: 1,
    totalDuration: duration,
    tokenUsage: usage,
    timestamp: new Date().toISOString()
  };

  return { content, usage, metadata };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Rough token estimation (4 chars ≈ 1 token).
 *
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  definition,
  execute
};
