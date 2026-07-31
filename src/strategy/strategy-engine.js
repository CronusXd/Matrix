/**
 * Matrix Strategy Engine v1.0
 * ===========================
 * Maps Task Analysis → Strategy Selection and execution.
 * Enforces the NEVER over-orchestrate principle:
 * complexity 1-2 → minimal, 3 → standard, 4 → deep, 5 → extreme.
 *
 * CommonJS module. Zero npm dependencies.
 *
 * @version 1.0.0
 */

'use strict';

// Lazy-loaded strategy modules
let _modules = {};

/**
 * @typedef {Object} StrategyModule
 * @property {Object} definition - { name, complexityRange, maxModelCalls, ... }
 * @property {Function} execute - async (task, provider, context, options) => result
 */

/**
 * @typedef {Object} StrategySelection
 * @property {string} name - Strategy name
 * @property {Object} definition - Strategy definition
 * @property {Object} cost - Estimated cost
 * @property {Object} latency - Estimated latency
 * @property {string} rationale - Why this strategy was selected
 */

// ---------------------------------------------------------------------------
// Strategy Registry
// ---------------------------------------------------------------------------

/**
 * Available strategies with their complexity ranges.
 */
const STRATEGY_MAP = [
  { name: 'minimal', range: [1, 2], module: './minimal' },
  { name: 'standard', range: [3, 3], module: './standard' },
  { name: 'deep', range: [4, 4], module: './deep' },
  { name: 'extreme', range: [5, 5], module: './extreme' }
];

// ---------------------------------------------------------------------------
// Module Loading
// ---------------------------------------------------------------------------

/**
 * Load a strategy module (lazy, with caching).
 *
 * @param {string} name
 * @returns {StrategyModule}
 * @private
 */
function _loadModule(name) {
  if (_modules[name]) return _modules[name];

  const entry = STRATEGY_MAP.find(s => s.name === name);
  if (!entry) {
    throw new Error(`Unknown strategy: ${name}`);
  }

  try {
    _modules[name] = require(entry.module);
    return _modules[name];
  } catch (err) {
    throw new Error(`Failed to load strategy "${name}": ${err.message}`);
  }
}

/**
 * Reset module cache (useful for testing).
 */
function resetModuleCache() {
  _modules = {};
}

// ---------------------------------------------------------------------------
// Strategy Selection
// ---------------------------------------------------------------------------

/**
 * Select the appropriate strategy for a task analysis.
 *
 * @param {Object} taskAnalysis - From task-intelligence.js (must have .complexity)
 * @returns {StrategySelection}
 */
function selectStrategy(taskAnalysis) {
  if (!taskAnalysis || typeof taskAnalysis.complexity !== 'number') {
    return _fallbackStrategy('missing complexity');
  }

  const complexity = Math.max(1, Math.min(5, Math.round(taskAnalysis.complexity)));

  // Find matching strategy by complexity range
  for (const entry of STRATEGY_MAP) {
    if (complexity >= entry.range[0] && complexity <= entry.range[1]) {
      try {
        const mod = _loadModule(entry.name);
        return {
          name: entry.name,
          definition: mod.definition,
          cost: estimateCost(entry.name, taskAnalysis),
          latency: estimateLatency(entry.name, taskAnalysis),
          rationale: `Complexity ${complexity} maps to "${entry.name}" strategy (range ${entry.range[0]}-${entry.range[1]})`
        };
      } catch (err) {
        // Module load failed — fall through to next
        continue;
      }
    }
  }

  return _fallbackStrategy(`no strategy for complexity ${complexity}`);
}

/**
 * Fallback strategy when selection fails.
 *
 * @param {string} reason
 * @returns {StrategySelection}
 * @private
 */
function _fallbackStrategy(reason) {
  return {
    name: 'standard',
    definition: {
      name: 'standard',
      complexityRange: [1, 5],
      maxModelCalls: 1,
      requiresContext: true,
      requiresAnalysis: true,
      requiresValidation: true,
      requiresJudge: false,
      description: 'Fallback standard strategy'
    },
    cost: { estimatedTokens: 2000, estimatedCost: 0.001 },
    latency: { estimatedMs: 3000 },
    rationale: `Fallback: ${reason}`
  };
}

// ---------------------------------------------------------------------------
// Strategy Execution
// ---------------------------------------------------------------------------

/**
 * Execute the selected strategy.
 *
 * @param {StrategySelection} strategy - From selectStrategy()
 * @param {Object} task - Task analysis
 * @param {Object} provider - Model provider with call() method
 * @param {Object} [context] - Gathered context
 * @param {Object} [options] - Additional options (judge, maxSubTasks, etc.)
 * @returns {Promise<Object>} Execution result
 */
async function executeStrategy(strategy, task, provider, context, options) {
  if (!strategy || !strategy.name) {
    throw new Error('Invalid strategy selection');
  }
  if (!task) {
    throw new Error('Task is required for execution');
  }
  if (!provider) {
    throw new Error('Provider is required for execution');
  }

  let mod;
  try {
    mod = _loadModule(strategy.name);
  } catch (err) {
    throw new Error(`Cannot execute strategy "${strategy.name}": ${err.message}`);
  }

  if (typeof mod.execute !== 'function') {
    throw new Error(`Strategy "${strategy.name}" has no execute() method`);
  }

  return await mod.execute(task, provider, context, options);
}

// ---------------------------------------------------------------------------
// Specialist Detection
// ---------------------------------------------------------------------------

/**
 * Determine if a specialist agent should be used for this task.
 *
 * @param {Object} taskAnalysis
 * @returns {{ useSpecialist: boolean, reason: string }}
 */
function shouldUseSpecialist(taskAnalysis) {
  if (!taskAnalysis) {
    return { useSpecialist: false, reason: 'no analysis' };
  }

  // Extreme complexity always justifies a specialist
  if (taskAnalysis.complexity >= 5) {
    return { useSpecialist: true, reason: 'extreme complexity requires domain expert' };
  }

  // Architecture tasks benefit from specialists
  if (taskAnalysis.taskType === 'architecture') {
    return { useSpecialist: true, reason: 'architecture tasks benefit from specialist review' };
  }

  // High risk tasks
  if (taskAnalysis.risk >= 4) {
    return { useSpecialist: true, reason: `high risk (${taskAnalysis.risk}/5) warrants specialist` };
  }

  // Most tasks don't need a specialist
  return { useSpecialist: false, reason: `standard strategy sufficient for ${taskAnalysis.taskType}` };
}

// ---------------------------------------------------------------------------
// Cost Estimation
// ---------------------------------------------------------------------------

/**
 * Estimate the cost of executing a strategy.
 *
 * @param {string} strategyName
 * @param {Object} [taskAnalysis]
 * @returns {{ estimatedTokens: number, estimatedCost: number, modelCalls: number }}
 */
function estimateCost(strategyName, taskAnalysis) {
  const baseEstimates = {
    minimal: { tokens: 800, calls: 1 },
    standard: { tokens: 2500, calls: 1 },
    deep: { tokens: 5000, calls: 1 },
    extreme: { tokens: 15000, calls: 5 }
  };

  const estimate = baseEstimates[strategyName] || baseEstimates.standard;

  // Adjust based on task analysis if available
  let tokens = estimate.tokens;
  if (taskAnalysis && taskAnalysis.estimatedTokens) {
    // Blend strategic estimate with task-specific estimate
    tokens = Math.round((estimate.tokens + taskAnalysis.estimatedTokens) / 2);
  }

  // Rough cost: $0.003 per 1K tokens (premium model average)
  const costPer1K = 0.003;
  const estimatedCost = +(tokens / 1000 * costPer1K).toFixed(4);

  return {
    estimatedTokens: tokens,
    estimatedCost,
    modelCalls: estimate.calls
  };
}

/**
 * Estimate the latency of executing a strategy.
 *
 * @param {string} strategyName
 * @param {Object} [taskAnalysis]
 * @returns {{ estimatedMs: number, parallelizable: boolean }}
 */
function estimateLatency(strategyName, taskAnalysis) {
  const baseLatencies = {
    minimal: { ms: 2000, parallel: false },
    standard: { ms: 5000, parallel: false },
    deep: { ms: 10000, parallel: false },
    extreme: { ms: 30000, parallel: true }
  };

  const estimate = baseLatencies[strategyName] || baseLatencies.standard;

  let ms = estimate.ms;
  if (taskAnalysis && taskAnalysis.complexity) {
    ms += taskAnalysis.complexity * 1000; // +1s per complexity level
  }

  return {
    estimatedMs: ms,
    parallelizable: estimate.parallel
  };
}

// ---------------------------------------------------------------------------
// Convenience: One-Call Execute
// ---------------------------------------------------------------------------

/**
 * Analyze and execute in one call.
 * Convenience wrapper: analyzeTask() → selectStrategy() → executeStrategy().
 *
 * @param {Array} messages - User messages
 * @param {Object} provider - Model provider
 * @param {Object} [context] - Optional context
 * @param {Object} [options] - Options { judge, maxSubTasks }
 * @returns {Promise<Object>} Full result with analysis and strategy info
 */
async function analyzeAndExecute(messages, provider, context, options) {
  let taskIntelligence;
  try {
    taskIntelligence = require('../intelligence/task-intelligence');
  } catch (err) {
    throw new Error(`Cannot load task-intelligence: ${err.message}`);
  }

  // Step 1: Analyze
  const task = taskIntelligence.analyzeTask(messages);

  // Step 2: Select
  const strategy = selectStrategy(task);

  // Step 3: Execute
  const result = await executeStrategy(strategy, task, provider, context, options);

  return {
    ...result,
    task,
    strategy: {
      name: strategy.name,
      definition: strategy.definition,
      rationale: strategy.rationale
    }
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  selectStrategy,
  executeStrategy,
  shouldUseSpecialist,
  estimateCost,
  estimateLatency,
  analyzeAndExecute,
  resetModuleCache,

  // Strategy definitions for introspection
  STRATEGIES: STRATEGY_MAP.map(s => s.name)
};
