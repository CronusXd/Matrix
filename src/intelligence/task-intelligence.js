#!/usr/bin/env node
/**
 * Matrix Task Intelligence Engine v1.0
 * =====================================
 * Analyzes user requests and produces structured Task Analysis objects.
 * Enhanced from pipeline/scripts/task-classifier.js with additional
 * dimensions: task type detection, goal extraction, constraint parsing,
 * success criteria generation, and risk estimation.
 *
 * Deterministic — no LLM dependency. CommonJS module. Zero npm deps.
 *
 * Output: TaskAnalysis {
 *   taskType, complexity (1-5), risk (1-5), goal, constraints,
 *   successCriteria, requiresCodeChanges, requiresContext,
 *   requiresTools, estimatedTokens, confidence (0-1)
 * }
 *
 * @version 1.0.0
 * @see pipeline/scripts/task-classifier.js — original classifier patterns
 */

'use strict';

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

/**
 * @typedef {'coding'|'debugging'|'refactoring'|'architecture'|'research'
 *          |'planning'|'reasoning'|'other'} TaskType
 */

/**
 * @typedef {Object} TaskAnalysis
 * @property {TaskType} taskType
 * @property {number} complexity - 1 (trivial) to 5 (extreme)
 * @property {number} risk - 1 (low) to 5 (critical)
 * @property {string} goal - Extracted goal statement
 * @property {string[]} constraints - Detected constraints
 * @property {string[]} successCriteria - Generated success criteria
 * @property {boolean} requiresCodeChanges
 * @property {boolean} requiresContext - Needs file context gathering
 * @property {boolean} requiresTools - Needs tool/API access
 * @property {number} estimatedTokens - Estimated token budget
 * @property {number} confidence - 0.0 to 1.0
 * @property {Object} signals - Raw detection signals (for debugging)
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum supported complexity level */
const MAX_COMPLEXITY = 5;

/** Default token estimate for simple tasks */
const BASE_TOKEN_ESTIMATE = 500;

/** Tokens per complexity level multiplier */
const TOKENS_PER_COMPLEXITY = 600;

// ---------------------------------------------------------------------------
// Task Type Pattern Definitions
// ---------------------------------------------------------------------------

/**
 * Task type detection patterns — ordered by priority.
 * First match wins. Each pattern has a type, keywords (regex), and weight.
 */
const TASK_TYPE_PATTERNS = [
  {
    type: 'debugging',
    keywords: /\b(?:bug|fix|debug|error|issue|crash|broken|failing|exception|stack\s?trace|correct|repair|resolve)\b/i,
    weight: 2
  },
  {
    type: 'refactoring',
    keywords: /\b(?:refactor|refactoring|clean\s?up|restructure|reorganize|extract\s?(?:method|function|class)|simplify|improve\s?(?:structure|code))\b/i,
    weight: 2
  },
  {
    type: 'architecture',
    keywords: /\b(?:architect|architecture|design\s?(?:pattern|system|API)|system\s?design|redesign|overhaul|blueprint)\b/i,
    weight: 3
  },
  {
    type: 'research',
    keywords: /\b(?:research|investigate|explore|analyze|study|survey|evaluate|compare|assess)\b/i,
    weight: 2
  },
  {
    type: 'planning',
    keywords: /\b(?:plan|roadmap|milestone|sprint|schedule|organize|prioritize|estimate|scope)\b/i,
    weight: 1
  },
  {
    type: 'reasoning',
    keywords: /\b(?:explain|why|how|reason|think|analyze|understand|conclude|deduce|infer)\b/i,
    weight: 1
  },
  {
    type: 'coding',
    keywords: /\b(?:implement|create|build|write|develop|code|add|feature|function|module|component|script)\b/i,
    weight: 1
  }
];

// ---------------------------------------------------------------------------
// Complexity Signal Patterns
// ---------------------------------------------------------------------------

/**
 * Words indicating trivial/simple tasks (complexity 1-2).
 * Enhanced from task-classifier.js with English + Portuguese patterns.
 */
const TRIVIAL_WORDS = [
  'correct', 'adjust', 'rename', 'typo', 'simple', 'quick',
  'trivial', 'small', 'tweak', 'minor', 'formatting',
  'cosmetic', 'correction', 'one-liner', 'single-line',
  'single line', 'cleanup', 'whitespace', 'comment',
  'corrigir', 'ajustar', 'renomear', 'simples', 'rapido',
  'rapido', 'pequeno', 'pequena', 'cosmetico', 'cosmetico'
];

/**
 * Words indicating complex tasks (complexity 4-5).
 * Enhanced from task-classifier.js with broader coverage.
 */
const COMPLEX_WORDS = [
  'architecture', 'architectural', 'design pattern', 'design system', 'redesign',
  'new feature', 'new functionality', 'migrate', 'migration',
  'refactor', 'refactoring', 'restructure', 'security', 'performance',
  'scale', 'scalability', 'distributed', 'integrate', 'integration',
  'multi', 'agent', 'orchestration', 'orchestrate', 'pipeline',
  'parallel', 'concurrent', 'cache', 'optimize', 'optimization',
  'rewrite', 'reimplement', 'modularize', 'componentize',
  'asynchronous', 'async', 'webhook', 'event-driven', 'event driven',
  'microservice', 'container', 'deploy', 'ci/cd', 'ci/cd',
  'tests', 'coverage', 'monitoring', 'observability',
  'database', 'schema', 'api', 'endpoint', 'protocol',
  'streaming', 'realtime', 'real-time', 'machine learning',
  'neural', 'transformer', 'embedding', 'vector',
  'state machine', 'workflow', 'orchestrator',
  'compliance', 'audit', 'encryption', 'authentication',
  'arquitetura', 'arquitetural', 'nova funcionalidade',
  'nova feature', 'refatorar', 'refatoracao', 'migrar',
  'migracao', 'seguranca', 'escalar', 'escalabilidade',
  'distribuido', 'integrar', 'integracao', 'agente',
  'orquestracao', 'paralelo', 'concorrente', 'otimizar',
  'otimizacao', 'reestruturar', 'redesenhar', 'reescrever'
];

/**
 * Task types that typically require code changes.
 */
const CODE_CHANGE_TYPES = new Set([
  'coding', 'debugging', 'refactoring', 'architecture'
]);

/**
 * Task types that typically require context gathering.
 */
const CONTEXT_REQUIRED_TYPES = new Set([
  'coding', 'debugging', 'refactoring', 'architecture', 'planning'
]);

/**
 * Task types that typically require tool/API access.
 */
const TOOL_REQUIRED_TYPES = new Set([
  'coding', 'debugging', 'refactoring', 'architecture', 'research'
]);

// ---------------------------------------------------------------------------
// Message Processing Helpers
// ---------------------------------------------------------------------------

/**
 * Extract clean text from an array of message objects or strings.
 *
 * @param {Array<string|{content: string, role?: string}>} messages
 * @returns {string} Concatenated text
 */
function extractText(messages) {
  if (!Array.isArray(messages)) {
    return typeof messages === 'string' ? messages : '';
  }

  return messages
    .map(msg => {
      if (typeof msg === 'string') return msg;
      if (msg && typeof msg.content === 'string') return msg.content;
      if (msg && typeof msg.text === 'string') return msg.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Count unique file mentions in text.
 *
 * @param {string} text
 * @returns {number}
 */
function countFileMentions(text) {
  const filePattern = /[\w\-/.]+\.(?:js|ts|tsx|jsx|css|scss|less|md|php|html|vue|svelte|py|rb|go|rs|java|kt|sql|yaml|yml|json|xml|env|gitignore|bat|sh|ps1)\b/gi;
  const matches = text.match(filePattern);
  if (!matches) return 0;

  const unique = new Set(matches.map(m => m.toLowerCase()));
  return unique.size;
}

// ---------------------------------------------------------------------------
// Task Type Classification
// ---------------------------------------------------------------------------

/**
 * Classify the task type based on message content.
 * Uses weighted pattern matching — highest cumulative weight wins.
 *
 * @param {string} text - Extracted message text
 * @returns {{ taskType: TaskType, confidence: number }}
 */
function classifyTaskType(text) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return { taskType: 'other', confidence: 0.0 };
  }

  const lower = text.toLowerCase();
  const scores = {};

  for (const pattern of TASK_TYPE_PATTERNS) {
    const matches = lower.match(pattern.keywords);
    if (matches) {
      scores[pattern.type] = (scores[pattern.type] || 0) + matches.length * pattern.weight;
    }
  }

  // Find the highest-scoring type
  let bestType = 'other';
  let bestScore = 0;

  for (const [type, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  // Confidence: higher when one type dominates
  const totalScore = Object.values(scores).reduce((s, v) => s + v, 0);
  const confidence = totalScore > 0
    ? Math.min(0.95, bestScore / totalScore + 0.1)
    : 0.3;

  return { taskType: bestType, confidence };
}

// ---------------------------------------------------------------------------
// Complexity Classification
// ---------------------------------------------------------------------------

/**
 * Classify the complexity level (1-5) based on textual signals.
 * Enhanced from task-classifier.js with 5-level granularity.
 *
 * @param {string} text - Extracted message text
 * @param {TaskType} taskType - Detected task type (influences complexity)
 * @returns {{ complexity: number, confidence: number, signals: Object }}
 */
function classifyComplexity(text, taskType) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return { complexity: 1, confidence: 0.5, signals: { trivialScore: 0, complexScore: 0 } };
  }

  const lower = text.toLowerCase();
  const length = text.length;

  // Build regex patterns
  const trivialRE = new RegExp(
    `\\b(${TRIVIAL_WORDS.map(escapeRegex).join('|')})\\b`, 'gi'
  );
  const complexRE = new RegExp(
    `\\b(${COMPLEX_WORDS.map(escapeRegex).join('|')})\\b`, 'gi'
  );

  const trivialMatches = (lower.match(trivialRE) || []).length;
  const complexMatches = (lower.match(complexRE) || []).length;

  // Unique word counts (deduplicated)
  const uniqueTrivial = new Set(
    (lower.match(trivialRE) || []).map(w => w.toLowerCase())
  ).size;
  const uniqueComplex = new Set(
    (lower.match(complexRE) || []).map(w => w.toLowerCase())
  ).size;

  const fileCount = countFileMentions(text);

  // Score calculation
  let trivialScore = 0;
  let complexScore = 0;

  // Trivial signals
  if (length < 30) trivialScore += 3;
  else if (length < 80) trivialScore += 1;

  trivialScore += uniqueTrivial * 2;

  if (fileCount === 1) trivialScore += 1;

  // Complex signals
  if (length > 200) complexScore += 2;
  if (length > 500) complexScore += 2;

  complexScore += uniqueComplex * 2;

  if (fileCount >= 3) complexScore += 2;
  if (fileCount >= 5) complexScore += 2;

  // Task type influences complexity baseline
  const typeComplexityBoost = {
    'architecture': 2,
    'research': 1,
    'planning': 1,
    'refactoring': 1,
    'debugging': 1,
    'coding': 0,
    'reasoning': 0,
    'other': 0
  };
  complexScore += (typeComplexityBoost[taskType] || 0);

  // Map scores to complexity levels (1-5)
  let complexity;
  let confidence;

  if (complexScore === 0 && trivialScore >= 2) {
    complexity = 1; // Trivial
    confidence = 0.9;
  } else if (complexScore === 0 && trivialScore >= 1) {
    complexity = 2; // Simple
    confidence = 0.8;
  } else if (complexScore === 1 && trivialScore >= 2) {
    complexity = 2; // Simple with minor complexity
    confidence = 0.7;
  } else if (complexScore === 1) {
    complexity = 3; // Medium
    confidence = 0.7;
  } else if (complexScore === 2) {
    complexity = 3; // Medium
    confidence = 0.75;
  } else if (complexScore === 3) {
    complexity = 4; // Complex
    confidence = 0.8;
  } else if (complexScore >= 4) {
    complexity = 5; // Extreme
    confidence = 0.85;
  } else {
    complexity = 1;
    confidence = 0.5;
  }

  // Clamp complexity
  complexity = Math.max(1, Math.min(MAX_COMPLEXITY, complexity));

  // Adjust confidence down if signals are contradictory
  if (trivialScore > 0 && complexScore > 0) {
    confidence *= 0.85;
  }

  return {
    complexity,
    confidence: +(confidence.toFixed(2)),
    signals: { trivialScore, complexScore, fileCount, length }
  };
}

// ---------------------------------------------------------------------------
// Goal Extraction
// ---------------------------------------------------------------------------

/**
 * Extract the primary goal from user messages.
 * Uses heuristics: looks for imperative verbs, task descriptions,
 * and explicit goal markers.
 *
 * @param {Array} messages - User messages
 * @returns {string} Extracted goal statement
 */
function extractGoal(messages) {
  const text = extractText(messages);

  if (!text || text.trim().length === 0) {
    return '(no goal detected)';
  }

  // Goal markers (explicit goal statements)
  const goalMarkers = [
    /(?:my goal is|goal:|objective:|i want to|i need to|please help me|can you help me)\s+(.+?)(?:\.|$)/i,
    /(?:task:|todo:|request:|demand:)\s*(.+?)(?:\.|$)/i
  ];

  for (const marker of goalMarkers) {
    const match = text.match(marker);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  // Fallback: use first substantial sentence (min 10 chars, starts with action)
  const sentences = text.split(/[.!?]\s+/).filter(s => s.trim().length > 10);
  if (sentences.length > 0) {
    const first = sentences[0].trim();
    // If first sentence is reasonable length, use it
    if (first.length <= 200) {
      return first;
    }
    // Otherwise truncate
    return first.slice(0, 200) + '...';
  }

  // Last resort: truncate the whole text
  return text.slice(0, 200).trim();
}

// ---------------------------------------------------------------------------
// Constraint Extraction
// ---------------------------------------------------------------------------

/**
 * Extract constraints from user messages.
 * Detects time constraints, platform requirements, format requirements,
 * quality requirements, and explicit restrictions.
 *
 * @param {Array} messages - User messages
 * @returns {string[]} Detected constraints
 */
function extractConstraints(messages) {
  const text = extractText(messages).toLowerCase();
  const constraints = [];

  // Time constraints
  if (/\b(?:deadline|due|by tomorrow|by end of|within \d+|urgent|asap|emergency)\b/i.test(text)) {
    constraints.push('time_sensitive');
  }

  // Platform constraints
  if (/\b(?:node\.js|express|fastify|react|vue|angular|browser|mobile|ios|android|electron|api)\b/i.test(text)) {
    const platform = text.match(/\b(node\.js|express|fastify|react|vue|angular|browser|mobile|ios|android|electron|api)\b/i)[1];
    constraints.push(`platform:${platform}`);
  }

  // Format constraints
  if (/\b(?:json|yaml|markdown|csv|xml|html|sql)\b/i.test(text)) {
    const format = text.match(/\b(json|yaml|markdown|csv|xml|html|sql)\b/i)[1];
    constraints.push(`format:${format}`);
  }

  // Quality constraints
  if (/\b(?:tested|tests|coverage|100%|well-tested|comprehensive)\b/i.test(text)) {
    constraints.push('quality:requires_tests');
  }
  if (/\b(?:documented|docs|documentation|readme|comments)\b/i.test(text)) {
    constraints.push('quality:requires_docs');
  }
  if (/\b(?:backward.?compat|breaking change|api contract|interface|compatible)\b/i.test(text)) {
    constraints.push('compatibility:backward_compatible');
  }

  // Scope constraints
  if (/\b(?:only|just|single file|one file|minimal|minimal change|small change|don't touch|do not modify|leave)\b/i.test(text)) {
    constraints.push('scope:minimal');
  }
  if (/\b(?:no test|skip test|without test|no need test)\b/i.test(text)) {
    constraints.push('scope:no_tests');
  }

  // Performance constraints
  if (/\b(?:fast|speed|latency|performance|optimize|efficient|throughput|responsive)\b/i.test(text)) {
    constraints.push('performance:sensitive');
  }

  // Security constraints
  if (/\b(?:secure|security|safe|vulnerability|exploit|injection|xss|csrf|auth)\b/i.test(text)) {
    constraints.push('security:critical');
  }

  return constraints;
}

// ---------------------------------------------------------------------------
// Success Criteria Generation
// ---------------------------------------------------------------------------

/**
 * Generate success criteria based on task type and goal.
 * These are measurable conditions that define what "done" looks like.
 *
 * @param {TaskType} taskType
 * @param {string} goal
 * @returns {string[]}
 */
function defineSuccessCriteria(taskType, goal) {
  const criteria = [];

  // Base criteria (always present)
  criteria.push('task_completed_successfully');

  // Type-specific criteria
  switch (taskType) {
    case 'coding':
      criteria.push('code_compiles_without_errors');
      criteria.push('existing_tests_pass');
      criteria.push('new_functionality_works_as_expected');
      break;

    case 'debugging':
      criteria.push('bug_reproduced_and_fixed');
      criteria.push('regression_tests_pass');
      criteria.push('root_cause_identified');
      break;

    case 'refactoring':
      criteria.push('behavior_preserved');
      criteria.push('all_tests_pass');
      criteria.push('code_quality_improved');
      criteria.push('no_new_bugs_introduced');
      break;

    case 'architecture':
      criteria.push('design_document_complete');
      criteria.push('tradeoffs_documented');
      criteria.push('stakeholder_reviewed');
      break;

    case 'research':
      criteria.push('sources_cited');
      criteria.push('findings_clear');
      criteria.push('actionable_conclusions');
      break;

    case 'planning':
      criteria.push('tasks_decomposed');
      criteria.push('estimates_provided');
      criteria.push('dependencies_mapped');
      break;

    case 'reasoning':
      criteria.push('logic_sound');
      criteria.push('conclusion_reached');
      criteria.push('assumptions_stated');
      break;

    default:
      criteria.push('response_accurate');
      criteria.push('response_complete');
  }

  return criteria;
}

// ---------------------------------------------------------------------------
// Risk Estimation
// ---------------------------------------------------------------------------

/**
 * Estimate the risk level (1-5) based on complexity and task type.
 * Risk = likelihood of failure × impact of failure.
 *
 * @param {number} complexity - 1-5
 * @param {TaskType} taskType
 * @returns {{ risk: number, factors: string[] }}
 */
function estimateRisk(complexity, taskType) {
  const factors = [];

  // Base risk from complexity
  const complexityRiskMap = { 1: 1, 2: 1, 3: 2, 4: 3, 5: 4 };
  let risk = complexityRiskMap[complexity] || 2;

  // Type-specific risk modifiers
  switch (taskType) {
    case 'architecture':
      risk += 1;
      factors.push('architecture changes have high blast radius');
      break;
    case 'debugging':
      // Debugging in production is risky; simple debugging is low risk
      if (complexity >= 4) {
        risk += 1;
        factors.push('complex debugging in production environment');
      }
      break;
    case 'refactoring':
      if (complexity >= 3) {
        risk += 1;
        factors.push('refactoring risks breaking existing behavior');
      }
      break;
    case 'research':
      risk = Math.max(1, risk - 1);
      factors.push('research has low blast radius');
      break;
    case 'planning':
      risk = Math.max(1, risk - 1);
      factors.push('planning is reversible');
      break;
    default:
      break;
  }

  // Clamp to 1-5
  risk = Math.max(1, Math.min(5, risk));

  return { risk, factors };
}

// ---------------------------------------------------------------------------
// Token Estimation
// ---------------------------------------------------------------------------

/**
 * Estimate the token budget required for this task.
 *
 * @param {number} complexity
 * @param {boolean} requiresContext
 * @param {boolean} requiresTools
 * @returns {number}
 */
function estimateTokens(complexity, requiresContext, requiresTools) {
  let estimate = BASE_TOKEN_ESTIMATE + (complexity * TOKENS_PER_COMPLEXITY);

  if (requiresContext) estimate += 2000;
  if (requiresTools) estimate += 1000;

  // Extreme tasks can be very large
  if (complexity >= 5) estimate *= 1.5;

  return Math.round(estimate);
}

// ---------------------------------------------------------------------------
// Requirement Detection
// ---------------------------------------------------------------------------

/**
 * Determine if the task requires code changes, context, or tools.
 *
 * @param {TaskType} taskType
 * @param {string} text
 * @returns {{ requiresCodeChanges: boolean, requiresContext: boolean, requiresTools: boolean }}
 */
function detectRequirements(taskType, text) {
  const lower = text.toLowerCase();

  const requiresCodeChanges = CODE_CHANGE_TYPES.has(taskType) ||
    /\b(?:code|file|implement|write|edit|modify|change|create)\b/i.test(lower);

  const requiresContext = CONTEXT_REQUIRED_TYPES.has(taskType) ||
    /\b(?:context|existing|current|project|codebase|repository|file structure)\b/i.test(lower);

  const requiresTools = TOOL_REQUIRED_TYPES.has(taskType) ||
    /\b(?:tool|api|search|browser|database|file system|command|terminal|shell)\b/i.test(lower);

  return { requiresCodeChanges, requiresContext, requiresTools };
}

// ---------------------------------------------------------------------------
// Helper: Regex Escape
// ---------------------------------------------------------------------------

/**
 * Escape special regex characters in a string.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Main API: analyzeTask
// ---------------------------------------------------------------------------

/**
 * Analyze user messages and produce a structured TaskAnalysis.
 * This is the primary entry point.
 *
 * @param {Array<string|{content: string, role?: string}>} messages
 *   - Array of message objects or strings
 * @returns {TaskAnalysis}
 *
 * @example
 *   const analysis = analyzeTask([
 *     { role: 'user', content: 'Fix the login bug in auth.js and add tests' }
 *   ]);
 *   // analysis.taskType === 'debugging', analysis.complexity === 3
 */
function analyzeTask(messages) {
  // Handle edge cases
  if (!messages || (Array.isArray(messages) && messages.length === 0)) {
    return createDefaultAnalysis('empty input');
  }

  const text = extractText(messages);

  if (!text || text.trim().length === 0) {
    return createDefaultAnalysis('empty text after extraction');
  }

  // Step 1: Classify task type
  const { taskType, confidence: typeConfidence } = classifyTaskType(text);

  // Step 2: Classify complexity
  const { complexity, confidence: complexityConfidence, signals } = classifyComplexity(text, taskType);

  // Step 3: Extract goal
  const goal = extractGoal(messages);

  // Step 4: Extract constraints
  const constraints = extractConstraints(messages);

  // Step 5: Generate success criteria
  const successCriteria = defineSuccessCriteria(taskType, goal);

  // Step 6: Detect requirements
  const { requiresCodeChanges, requiresContext, requiresTools } = detectRequirements(taskType, text);

  // Step 7: Estimate risk
  const { risk, factors: riskFactors } = estimateRisk(complexity, taskType);

  // Step 8: Estimate tokens
  const estimatedTokens = estimateTokens(complexity, requiresContext, requiresTools);

  // Step 9: Aggregate confidence
  const confidence = +(
    (typeConfidence * 0.3 + complexityConfidence * 0.7)
  ).toFixed(2);

  return {
    taskType,
    complexity,
    risk,
    goal,
    constraints,
    successCriteria,
    requiresCodeChanges,
    requiresContext,
    requiresTools,
    estimatedTokens,
    confidence,
    signals: {
      ...signals,
      typeConfidence: +typeConfidence.toFixed(2),
      complexityConfidence: +complexityConfidence.toFixed(2),
      riskFactors,
      textLength: text.length
    }
  };
}

/**
 * Create a default/fallback analysis for invalid input.
 *
 * @param {string} reason - Why we're using the fallback
 * @returns {TaskAnalysis}
 * @private
 */
function createDefaultAnalysis(reason) {
  return {
    taskType: 'other',
    complexity: 1,
    risk: 1,
    goal: '(unknown)',
    constraints: [],
    successCriteria: ['response_accurate', 'response_complete'],
    requiresCodeChanges: false,
    requiresContext: false,
    requiresTools: false,
    estimatedTokens: 200,
    confidence: 0.1,
    signals: {
      trivialScore: 0,
      complexScore: 0,
      fileCount: 0,
      length: 0,
      typeConfidence: 0,
      complexityConfidence: 0,
      riskFactors: [reason],
      textLength: 0
    }
  };
}

// ---------------------------------------------------------------------------
// Convenience Functions (mirroring task-classifier.js API)
// ---------------------------------------------------------------------------

/**
 * Quick complexity-only classification (backward compat with task-classifier.js).
 *
 * @param {string} demand - Task description
 * @returns {{ classification: 'simple'|'medium'|'complex', confidence: number }}
 */
function quickClassify(demand) {
  const analysis = analyzeTask([demand]);
  const mapping = { 1: 'simple', 2: 'simple', 3: 'medium', 4: 'complex', 5: 'complex' };
  return {
    classification: mapping[analysis.complexity] || 'medium',
    confidence: analysis.confidence
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  analyzeTask,
  classifyTaskType,
  classifyComplexity,
  extractGoal,
  extractConstraints,
  defineSuccessCriteria,
  estimateRisk,
  quickClassify
};
