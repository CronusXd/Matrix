/**
 * Matrix Context Quality Evaluator v1.0
 * ======================================
 * Evaluates whether gathered context is SUFFICIENT for the task.
 * Produces a quality score with specific gap analysis.
 *
 * CommonJS module. Zero npm dependencies.
 *
 * @version 1.0.0
 */

'use strict';

// ---------------------------------------------------------------------------
// Quality Evaluation
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ContextQualityResult
 * @property {boolean} sufficient - Is the context enough to proceed?
 * @property {number} completeness - 0-1, how complete is the coverage?
 * @property {number} relevance - 0-1, how relevant is the info?
 * @property {number} noise - 0-1, how much irrelevant info?
 * @property {string[]} missingInfo - What's missing?
 * @property {string} recommendation - 'proceed' | 'gather_more' | 'skip_context'
 * @property {Object} details - Detailed breakdown
 */

/**
 * Evaluate the quality of gathered context for a given task.
 *
 * @param {Object} context - Context object from context-engine.js
 * @param {Object} taskAnalysis - Task analysis from task-intelligence.js
 * @returns {ContextQualityResult}
 */
function evaluateContext(context, taskAnalysis) {
  // Edge case: no context provided
  if (!context || !context.files || context.files.length === 0) {
    return {
      sufficient: false,
      completeness: 0.0,
      relevance: 0.0,
      noise: 0.0,
      missingInfo: ['no_context_files_gathered'],
      recommendation: taskAnalysis && taskAnalysis.requiresContext
        ? 'gather_more'
        : 'skip_context',
      details: { reason: 'No context files available' }
    };
  }

  const files = context.files || [];
  const metadata = context.metadata || {};
  const excluded = context.excluded || [];

  // Compute metrics
  const completeness = assessCompleteness(files, taskAnalysis);
  const relevance = assessRelevance(files, taskAnalysis);
  const noise = assessNoise(files, excluded, metadata);
  const missingInfo = identifyGaps(files, taskAnalysis, completeness, relevance);

  // Overall sufficiency
  const sufficient = completeness >= 0.4 && relevance >= 0.3 && missingInfo.length === 0;

  // Recommendation
  let recommendation = 'proceed';
  if (!sufficient && taskAnalysis && taskAnalysis.requiresContext) {
    recommendation = 'gather_more';
  } else if (!sufficient && (!taskAnalysis || !taskAnalysis.requiresContext)) {
    recommendation = 'skip_context';
  }

  return {
    sufficient,
    completeness: +completeness.toFixed(2),
    relevance: +relevance.toFixed(2),
    noise: +noise.toFixed(2),
    missingInfo,
    recommendation,
    details: {
      totalFiles: files.length,
      excludedCount: excluded.length,
      averageScore: computeAverageScore(files),
      topFileTypes: getTopFileTypes(files)
    }
  };
}

// ---------------------------------------------------------------------------
// Completeness Assessment
// ---------------------------------------------------------------------------

/**
 * Assess how completely the context covers the task's needs.
 *
 * @param {Array} files - Context files
 * @param {Object} taskAnalysis
 * @returns {number} 0-1 completeness score
 */
function assessCompleteness(files, taskAnalysis) {
  if (!files || files.length === 0) return 0.0;

  const taskType = (taskAnalysis && taskAnalysis.taskType) || 'other';

  // Base completeness from file count
  let score = 0;

  // For coding/debugging tasks: need at least 1-3 files
  if (['coding', 'debugging', 'refactoring'].includes(taskType)) {
    if (files.length >= 5) score = 1.0;
    else if (files.length >= 3) score = 0.8;
    else if (files.length >= 1) score = 0.5;
    else score = 0.1;
  }
  // Architecture tasks: need more files and docs
  else if (taskType === 'architecture') {
    if (files.length >= 10) score = 1.0;
    else if (files.length >= 5) score = 0.7;
    else if (files.length >= 2) score = 0.4;
    else score = 0.1;
  }
  // Research/planning: moderate context needed
  else if (['research', 'planning', 'reasoning'].includes(taskType)) {
    if (files.length >= 3) score = 1.0;
    else if (files.length >= 1) score = 0.6;
    else score = 0.3;
  }
  // Default
  else {
    score = Math.min(1.0, files.length / 10);
  }

  // Check if context covers different types (code, config, docs)
  const fileTypes = new Set(files.map(f => {
    const ext = (f.path || '').split('.').pop() || '';
    return ext;
  }));
  const typeDiversity = Math.min(1.0, fileTypes.size / 4);

  // Blend file count completeness with type diversity
  return Math.min(1.0, score * 0.7 + typeDiversity * 0.3);
}

// ---------------------------------------------------------------------------
// Relevance Assessment
// ---------------------------------------------------------------------------

/**
 * Assess how relevant the gathered files are to the task.
 *
 * @param {Array} files - Context files
 * @param {Object} taskAnalysis
 * @returns {number} 0-1 relevance score
 */
function assessRelevance(files, taskAnalysis) {
  if (!files || files.length === 0) return 0.0;

  // Average score of files (if scored)
  const avgScore = computeAverageScore(files);

  // If files have scores, use them
  if (avgScore > 0) {
    // Normalize: typical max score is ~25
    return Math.min(1.0, avgScore / 20);
  }

  // Fallback: check if files match task type expectations
  const taskType = (taskAnalysis && taskAnalysis.taskType) || 'other';
  const expectedExtensions = getExpectedExtensions(taskType);
  const matchingFiles = files.filter(f => {
    const ext = (f.path || '').split('.').pop() || '';
    return expectedExtensions.has(ext);
  });

  return Math.min(1.0, matchingFiles.length / Math.max(1, files.length));
}

// ---------------------------------------------------------------------------
// Noise Assessment
// ---------------------------------------------------------------------------

/**
 * Assess how much noise (irrelevant info) is in the context.
 *
 * @param {Array} files - Kept files
 * @param {Array} excluded - Excluded files
 * @param {Object} metadata - Context metadata
 * @returns {number} 0-1 noise level (lower is better)
 */
function assessNoise(files, excluded, metadata) {
  const totalDiscovered = (metadata && metadata.total_scored) || 0;
  if (totalDiscovered === 0) return 0.0;

  // Noise = files eliminated / total discovered
  const eliminated = (excluded || []).length;
  const noise = totalDiscovered > 0 ? eliminated / totalDiscovered : 0;

  // If many files kept but with low scores, that's also noise
  const lowScoreFiles = (files || []).filter(f => (f.score || 0) < 5).length;
  const lowScoreNoise = files.length > 0 ? lowScoreFiles / files.length : 0;

  return +((noise * 0.6 + lowScoreNoise * 0.4).toFixed(2));
}

// ---------------------------------------------------------------------------
// Gap Identification
// ---------------------------------------------------------------------------

/**
 * Identify specific gaps in the context.
 *
 * @param {Array} files - Context files
 * @param {Object} taskAnalysis
 * @param {number} completeness
 * @param {number} relevance
 * @returns {string[]} Missing information items
 */
function identifyGaps(files, taskAnalysis, completeness, relevance) {
  const gaps = [];

  if (!files || files.length === 0) {
    gaps.push('no_context_files');
    return gaps;
  }

  // Completeness gaps
  if (completeness < 0.3) {
    gaps.push('insufficient_file_count');
  }

  // Type-specific gaps
  const taskType = (taskAnalysis && taskAnalysis.taskType) || 'other';

  if (['coding', 'debugging', 'refactoring'].includes(taskType)) {
    // Check for source files
    const hasSourceFiles = files.some(f => {
      const ext = (f.path || '').split('.').pop() || '';
      return ['js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt'].includes(ext);
    });
    if (!hasSourceFiles) {
      gaps.push('no_source_code_files');
    }

    // Check for test files (if task requires tests)
    if (taskAnalysis && taskAnalysis.successCriteria) {
      const requiresTests = taskAnalysis.successCriteria.some(c =>
        c.toLowerCase().includes('test')
      );
      if (requiresTests) {
        const hasTestFiles = files.some(f => {
          const base = (f.path || '').toLowerCase();
          return base.includes('.test.') || base.includes('.spec.') || base.includes('__tests__');
        });
        if (!hasTestFiles) {
          gaps.push('missing_test_files');
        }
      }
    }

    // Check for config files
    const hasConfigFiles = files.some(f => {
      const base = (f.path || '').toLowerCase();
      return base.includes('config') || base.includes('.json') || base.includes('.yaml');
    });
    if (!hasConfigFiles) {
      // Not a critical gap but worth noting
      // gaps.push('no_config_files');
    }
  }

  if (taskType === 'architecture') {
    const hasDocs = files.some(f => {
      const base = (f.path || '').toLowerCase();
      return base.includes('readme') || base.includes('.md') || base.includes('docs/');
    });
    if (!hasDocs) {
      gaps.push('no_documentation_files');
    }

    const hasSchemas = files.some(f => {
      const ext = (f.path || '').split('.').pop() || '';
      return ['json', 'yaml', 'yml', 'sql', 'proto', 'graphql'].includes(ext);
    });
    if (!hasSchemas) {
      gaps.push('no_schema_files');
    }
  }

  // Relevance gaps
  if (relevance < 0.3) {
    gaps.push('low_relevance_files');
  }

  return gaps;
}

// ---------------------------------------------------------------------------
// Quick Evaluation (Simplified API)
// ---------------------------------------------------------------------------

/**
 * Quick evaluation — returns a simple "go/no-go" decision.
 *
 * @param {Object} context - Context object
 * @param {Object} taskAnalysis - Task analysis
 * @returns {{ canProceed: boolean, quality: 'good'|'adequate'|'poor'|'none' }}
 */
function quickEval(context, taskAnalysis) {
  const result = evaluateContext(context, taskAnalysis);

  let quality = 'none';
  if (result.sufficient && result.completeness >= 0.8 && result.relevance >= 0.7) {
    quality = 'good';
  } else if (result.sufficient) {
    quality = 'adequate';
  } else if (context && context.files && context.files.length > 0) {
    quality = 'poor';
  }

  return {
    canProceed: result.sufficient,
    quality,
    missingInfo: result.missingInfo
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute average score of files.
 *
 * @param {Array} files
 * @returns {number}
 */
function computeAverageScore(files) {
  if (!files || files.length === 0) return 0;
  const total = files.reduce((sum, f) => sum + (f.score || 0), 0);
  return total / files.length;
}

/**
 * Get the top file types (extensions) in the context.
 *
 * @param {Array} files
 * @returns {Object} { ext: count }
 */
function getTopFileTypes(files) {
  const types = {};
  for (const file of files) {
    const ext = (file.path || '').split('.').pop() || 'unknown';
    types[ext] = (types[ext] || 0) + 1;
  }
  // Sort by count descending, return top 5
  const sorted = Object.entries(types)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  return Object.fromEntries(sorted);
}

/**
 * Get expected file extensions for a task type.
 *
 * @param {string} taskType
 * @returns {Set<string>}
 */
function getExpectedExtensions(taskType) {
  switch (taskType) {
    case 'coding':
      return new Set(['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs']);
    case 'debugging':
      return new Set(['js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs']);
    case 'refactoring':
      return new Set(['js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs']);
    case 'architecture':
      return new Set(['js', 'ts', 'json', 'yaml', 'yml', 'md']);
    case 'research':
      return new Set(['md', 'txt', 'json', 'yaml', 'yml']);
    case 'planning':
      return new Set(['md', 'yaml', 'yml', 'json']);
    default:
      return new Set(['js', 'ts', 'json', 'md']);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  evaluateContext,
  quickEval,
  assessCompleteness,
  assessRelevance,
  assessNoise,
  identifyGaps
};
