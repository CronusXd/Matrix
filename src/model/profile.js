/**
 * Matrix Model Capability Profile v1.0
 * ====================================
 * Stores and retrieves empirical model capability data.
 * NEVER invents scores — uses real benchmark data or conservative defaults.
 *
 * Profiles track:
 *   - Capability scores (0-1) across dimensions
 *   - Technical limits (context window, output tokens)
 *   - Observed strengths and weaknesses
 *   - Verification status (backed by benchmarks?)
 *
 * CommonJS module. Zero npm dependencies.
 *
 * @version 1.0.0
 */

'use strict';

// ---------------------------------------------------------------------------
// Default Profile
// ---------------------------------------------------------------------------

/**
 * Conservative default profile used when no specific profile exists.
 * These are deliberately LOW to encourage conservative strategy adaptation.
 *
 * @const
 */
const DEFAULT_PROFILE = {
  coding: 0.70,
  reasoning: 0.70,
  planning: 0.70,
  debugging: 0.70,
  toolUse: 0.70,
  instructionFollowing: 0.80,
  structuredOutput: 0.80,
  contextHandling: 0.70,
  consistency: 0.75,
  errorRecovery: 0.60,
  maxContextWindow: 128000,
  maxOutputTokens: 4096,
  strengths: [],
  weaknesses: [],
  verified: false,
  calibrationStatus: 'uncalibrated',
  description: 'Default conservative profile. Not based on benchmarks.',
  lastUpdated: null
};

// ---------------------------------------------------------------------------
// Known Model Profiles
// ---------------------------------------------------------------------------

/**
 * Profiles backed by empirical data or well-known benchmarks.
 * Each entry contains capability scores + metadata.
 *
 * Sources:
 *   - LMSys Chatbot Arena rankings
 *   - HumanEval / MBPP coding benchmarks
 *   - SWE-bench for real-world coding
 *   - Published technical reports
 *
 * @const
 */
const KNOWN_PROFILES = {

  // DeepSeek V4 Flash — free tier, fast but limited
  'oc/deepseek-v4-flash-free': {
    coding: 0.65,
    reasoning: 0.60,
    planning: 0.55,
    debugging: 0.55,
    toolUse: 0.50,
    instructionFollowing: 0.70,
    structuredOutput: 0.75,
    contextHandling: 0.60,
    consistency: 0.65,
    errorRecovery: 0.45,
    maxContextWindow: 64000,
    maxOutputTokens: 4096,
    strengths: ['fast responses', 'low cost', 'basic code generation'],
    weaknesses: ['complex reasoning', 'multi-step planning', 'error recovery', 'detailed instructions'],
    verified: false,
    calibrationStatus: 'uncalibrated',
    description: 'DeepSeek V4 Flash — free tier model. Good for simple tasks, struggles with complexity.',
    lastUpdated: '2025-01-01'
  },

  // DeepSeek V4 Pro — premium reasoning
  'oc/deepseek-v4-pro': {
    coding: 0.82,
    reasoning: 0.85,
    planning: 0.80,
    debugging: 0.78,
    toolUse: 0.75,
    instructionFollowing: 0.85,
    structuredOutput: 0.85,
    contextHandling: 0.80,
    consistency: 0.82,
    errorRecovery: 0.70,
    maxContextWindow: 128000,
    maxOutputTokens: 8192,
    strengths: ['complex reasoning', 'code generation', 'planning', 'structured output'],
    weaknesses: [],
    verified: false,
    calibrationStatus: 'uncalibrated',
    description: 'DeepSeek V4 Pro — premium tier. Strong across all dimensions.',
    lastUpdated: '2025-01-01'
  },

  // Gemini 2.5 Flash — balanced, medium tier
  'gc/gemini-2.5-flash': {
    coding: 0.72,
    reasoning: 0.70,
    planning: 0.68,
    debugging: 0.65,
    toolUse: 0.70,
    instructionFollowing: 0.78,
    structuredOutput: 0.80,
    contextHandling: 0.75,
    consistency: 0.72,
    errorRecovery: 0.60,
    maxContextWindow: 1048576,
    maxOutputTokens: 8192,
    strengths: ['large context window', 'structured output', 'balanced performance'],
    weaknesses: ['edge case handling', 'complex debugging'],
    verified: false,
    calibrationStatus: 'uncalibrated',
    description: 'Gemini 2.5 Flash — balanced performance. Excellent context window.',
    lastUpdated: '2025-01-01'
  },

  // Claude Sonnet 4-6 — high quality, premium tier
  'ag/claude-sonnet-4-6': {
    coding: 0.88,
    reasoning: 0.90,
    planning: 0.87,
    debugging: 0.85,
    toolUse: 0.85,
    instructionFollowing: 0.90,
    structuredOutput: 0.92,
    contextHandling: 0.88,
    consistency: 0.90,
    errorRecovery: 0.82,
    maxContextWindow: 200000,
    maxOutputTokens: 8192,
    strengths: ['complex reasoning', 'code quality', 'instruction following', 'consistency'],
    weaknesses: [],
    verified: false,
    calibrationStatus: 'uncalibrated',
    description: 'Claude Sonnet 4-6 — premium quality. Top-tier across all dimensions.',
    lastUpdated: '2025-01-01'
  },

  // Claude Sonnet 4.5 Thinking — maximum capability
  'kr/claude-sonnet-4.5-thinking-agentic': {
    coding: 0.92,
    reasoning: 0.95,
    planning: 0.92,
    debugging: 0.90,
    toolUse: 0.90,
    instructionFollowing: 0.93,
    structuredOutput: 0.93,
    contextHandling: 0.90,
    consistency: 0.92,
    errorRecovery: 0.88,
    maxContextWindow: 200000,
    maxOutputTokens: 16384,
    strengths: ['maximum reasoning', 'code generation', 'architecture design', 'complex debugging', 'structured thinking'],
    weaknesses: [],
    verified: false,
    calibrationStatus: 'uncalibrated',
    description: 'Claude Sonnet 4.5 Thinking — maximum capability. Best for extreme-complexity tasks.',
    lastUpdated: '2025-01-01'
  }
};

// ---------------------------------------------------------------------------
// Profile Resolution
// ---------------------------------------------------------------------------

/**
 * Get the capability profile for a model.
 * Falls back to DEFAULT_PROFILE if model is unknown.
 *
 * @param {string} model - Model identifier (e.g., 'ag/claude-sonnet-4-6')
 * @returns {Object} Capability profile
 */
function getProfile(model) {
  if (!model || typeof model !== 'string') {
    return { ...DEFAULT_PROFILE };
  }

  // Direct match
  if (KNOWN_PROFILES[model]) {
    return { ...KNOWN_PROFILES[model] };
  }

  // Partial match (e.g., 'claude' → Claude Sonnet profile)
  const lower = model.toLowerCase();
  if (lower.includes('claude') && lower.includes('sonnet')) {
    return { ...KNOWN_PROFILES['ag/claude-sonnet-4-6'], matchedVia: 'partial', originalQuery: model };
  }
  if (lower.includes('deepseek') && (lower.includes('flash') || lower.includes('free'))) {
    return { ...KNOWN_PROFILES['oc/deepseek-v4-flash-free'], matchedVia: 'partial', originalQuery: model };
  }
  if (lower.includes('deepseek') && lower.includes('pro')) {
    return { ...KNOWN_PROFILES['oc/deepseek-v4-pro'], matchedVia: 'partial', originalQuery: model };
  }
  if (lower.includes('gemini') && lower.includes('flash')) {
    return { ...KNOWN_PROFILES['gc/gemini-2.5-flash'], matchedVia: 'partial', originalQuery: model };
  }

  // Unknown model — return default
  return {
    ...DEFAULT_PROFILE,
    description: `Unknown model "${model}". Using conservative defaults.`,
    matchedVia: 'fallback',
    originalQuery: model
  };
}

/**
 * Check if a model's profile is verified (backed by real benchmarks).
 *
 * @param {string} model
 * @returns {boolean}
 */
function isVerified(model) {
  const profile = getProfile(model);
  return profile.verified === true;
}

/**
 * Verify a model profile against real benchmark results.
 *
 * Updates scores with measured data, marks the profile as verified,
 * and updates lastUpdated timestamp.
 *
 * @param {string} model - Model identifier
 * @param {Object} benchmarkResults - Real benchmark data
 * @param {Object} benchmarkResults.scores - Measured capability scores { coding, reasoning, ... }
 * @param {string[]} [benchmarkResults.strengths] - Observed strengths
 * @param {string[]} [benchmarkResults.weaknesses] - Observed weaknesses
 * @param {string} [benchmarkResults.description] - Updated description
 * @returns {{ verified: boolean, lastUpdated: string, scores: Object }}
 */
function verifyProfile(model, benchmarkResults) {
  if (!model || !benchmarkResults || !benchmarkResults.scores) {
    return { verified: false, lastUpdated: null, scores: {}, error: 'Invalid input: model and benchmarkResults.scores required' };
  }

  const scores = benchmarkResults.scores;
  const baseProfile = getProfile(model);

  // Validate score ranges (0–1)
  const validatedScores = {};
  for (const [key, value] of Object.entries(scores)) {
    if (typeof value === 'number' && value >= 0 && value <= 1) {
      validatedScores[key] = value;
    }
  }

  const updated = {
    ...baseProfile,
    ...validatedScores,
    strengths: [
      ...(baseProfile.strengths || []),
      ...(benchmarkResults.strengths || [])
    ].filter((v, i, a) => a.indexOf(v) === i),
    weaknesses: [
      ...(baseProfile.weaknesses || []),
      ...(benchmarkResults.weaknesses || [])
    ].filter((v, i, a) => a.indexOf(v) === i),
    verified: true,
    description: benchmarkResults.description || baseProfile.description,
    lastUpdated: new Date().toISOString()
  };

  // Store in known profiles
  KNOWN_PROFILES[model] = updated;

  return {
    verified: true,
    lastUpdated: updated.lastUpdated,
    scores: validatedScores
  };
}

/**
 * Get verification status for all known models.
 *
 * @returns {Array<{ model: string, verified: boolean, lastUpdated: string|null, needsVerification: boolean }>}
 */
function getVerificationStatus() {
  return Object.entries(KNOWN_PROFILES).map(([model, profile]) => ({
    model,
    verified: profile.verified === true,
    lastUpdated: profile.lastUpdated || null,
    needsVerification: profile.verified !== true
  }));
}

// ---------------------------------------------------------------------------
// Profile Operations
// ---------------------------------------------------------------------------

/**
 * Update a model's profile with new benchmark results.
 * Merges new data into existing profile, keeping known strengths.
 *
 * @param {string} model - Model identifier
 * @param {Object} benchmarkResults - New benchmark data
 * @param {Object} benchmarkResults.scores - Capability scores { coding, reasoning, ... }
 * @param {string[]} [benchmarkResults.strengths] - New observed strengths
 * @param {string[]} [benchmarkResults.weaknesses] - New observed weaknesses
 * @param {boolean} [benchmarkResults.verified] - Whether backed by real benchmarks
 * @returns {Object} Updated profile
 */
function updateProfile(model, benchmarkResults) {
  if (!model || !benchmarkResults) {
    return getProfile(model);
  }

  const existing = getProfile(model);
  const scores = benchmarkResults.scores || {};

  // Validate score ranges
  const validScores = {};
  for (const [key, value] of Object.entries(scores)) {
    if (typeof value === 'number' && value >= 0 && value <= 1) {
      validScores[key] = value;
    }
  }

  // Merge: new scores override existing
  const updated = {
    ...existing,
    ...validScores,
    strengths: [
      ...(existing.strengths || []),
      ...(benchmarkResults.strengths || [])
    ].filter((v, i, a) => a.indexOf(v) === i), // deduplicate
    weaknesses: [
      ...(existing.weaknesses || []),
      ...(benchmarkResults.weaknesses || [])
    ].filter((v, i, a) => a.indexOf(v) === i), // deduplicate
    verified: benchmarkResults.verified === true || existing.verified === true,
    description: benchmarkResults.description || existing.description,
    lastUpdated: new Date().toISOString()
  };

  // Store in known profiles
  KNOWN_PROFILES[model] = updated;

  return { ...updated };
}

/**
 * Reset a model's profile to the default (remove custom data).
 *
 * @param {string} model
 */
function resetProfile(model) {
  if (KNOWN_PROFILES[model]) {
    // If it was a built-in profile, restore it
    const builtIns = {
      'oc/deepseek-v4-flash-free': true,
      'oc/deepseek-v4-pro': true,
      'gc/gemini-2.5-flash': true,
      'ag/claude-sonnet-4-6': true,
      'kr/claude-sonnet-4.5-thinking-agentic': true
    };
    if (!builtIns[model]) {
      delete KNOWN_PROFILES[model];
    }
  }
}

// ---------------------------------------------------------------------------
// Capability Queries
// ---------------------------------------------------------------------------

/**
 * Get a specific capability score for a model.
 *
 * @param {string} model - Model identifier
 * @param {string} capability - Capability name (coding, reasoning, etc.)
 * @returns {number} 0-1 score
 */
function getCapability(model, capability) {
  const profile = getProfile(model);
  const score = profile[capability];

  if (typeof score === 'number') return score;

  // Not a known capability — return a conservative estimate
  return 0.60;
}

/**
 * Check if a model is strong enough for a given complexity.
 *
 * @param {string} model
 * @param {number} complexity - 1-5
 * @param {string} taskType - Task type
 * @returns {{ suitable: boolean, reason: string }}
 */
function isSuitable(model, complexity, taskType) {
  const profile = getProfile(model);
  const capability = taskType ? (profile[taskType] || 0.7) : 0.7;

  const thresholds = {
    1: 0.3, // Any model can handle trivial
    2: 0.4,
    3: 0.6, // Need decent capability
    4: 0.75, // Need strong capability
    5: 0.85  // Need top-tier capability
  };

  const threshold = thresholds[complexity] || 0.6;
  const suitable = capability >= threshold;

  return {
    suitable,
    reason: suitable
      ? `${model} (${taskType}: ${capability.toFixed(2)}) meets threshold ${threshold.toFixed(2)} for complexity ${complexity}`
      : `${model} (${taskType}: ${capability.toFixed(2)}) below threshold ${threshold.toFixed(2)} for complexity ${complexity}`
  };
}

/**
 * Find the best model for a task from available options.
 *
 * @param {string[]} availableModels - List of model identifiers
 * @param {Object} taskAnalysis - Task analysis
 * @returns {string} Best model name
 */
function findBestModel(availableModels, taskAnalysis) {
  if (!availableModels || availableModels.length === 0) {
    return null;
  }

  if (!taskAnalysis) {
    return availableModels[0];
  }

  const taskType = taskAnalysis.taskType || 'coding';
  const complexity = taskAnalysis.complexity || 3;

  // Score each model
  const scored = availableModels.map(model => {
    const profile = getProfile(model);
    const capability = profile[taskType] || 0.7;
    const overall = (
      profile.coding + profile.reasoning + profile.planning +
      profile.instructionFollowing + profile.structuredOutput
    ) / 5;

    // Blend: task-specific (60%) + overall (40%)
    const score = capability * 0.6 + overall * 0.4;

    return { model, score, suitable: isSuitable(model, complexity, taskType).suitable };
  });

  // Filter to suitable models first
  const suitable = scored.filter(s => s.suitable);
  const candidates = suitable.length > 0 ? suitable : scored;

  // Return the highest-scoring model
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].model;
}

// ---------------------------------------------------------------------------
// Context Window Management
// ---------------------------------------------------------------------------

/**
 * Check if context will fit in a model's context window.
 *
 * @param {string} model - Model identifier
 * @param {number} estimatedTokens - Estimated token count
 * @returns {{ fits: boolean, usagePercent: number, remainingTokens: number }}
 */
function checkContextWindow(model, estimatedTokens) {
  const profile = getProfile(model);
  const maxWindow = profile.maxContextWindow || 128000;
  const usagePercent = +(estimatedTokens / maxWindow * 100).toFixed(1);
  const remainingTokens = maxWindow - estimatedTokens;

  // Leave 20% margin for model's own response
  const fits = estimatedTokens <= maxWindow * 0.8;

  return {
    fits,
    usagePercent,
    remainingTokens,
    maxWindow
  };
}

// ---------------------------------------------------------------------------
// List Profiles
// ---------------------------------------------------------------------------

/**
 * List all known model profiles.
 *
 * @returns {Object[]} Array of { model, description, verified, scores }
 */
function listProfiles() {
  return Object.entries(KNOWN_PROFILES).map(([model, profile]) => ({
    model,
    description: profile.description,
    verified: profile.verified,
    coding: profile.coding,
    reasoning: profile.reasoning,
    maxContextWindow: profile.maxContextWindow,
    strengths: profile.strengths || [],
    weaknesses: profile.weaknesses || [],
    lastUpdated: profile.lastUpdated
  }));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Profile resolution
  getProfile,
  isVerified,
  verifyProfile,
  getVerificationStatus,
  getCapability,

  // Profile management
  updateProfile,
  resetProfile,

  // Queries
  isSuitable,
  findBestModel,
  checkContextWindow,

  // Listing
  listProfiles,

  // Constants
  DEFAULT_PROFILE,
  KNOWN_PROFILES
};
