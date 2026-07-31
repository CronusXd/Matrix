#!/usr/bin/env node
/**
 * Matrix Context Engine v1.0
 * ===========================
 * Standalone context gathering — refactored from pipeline/scripts/context-executor.js.
 * Replaces OpenCode tools (glob, grep, read) with Node.js fs/path and regex search.
 *
 * Pipeline: CB.1 Discovery → CB.2 Scoring → CB.3 Elimination →
 *           CB.4 Ordering → CB.5 Compression → CB.6 Assembly
 *
 * CommonJS module. Zero npm dependencies beyond Node.js built-ins.
 *
 * @version 1.0.0
 * @see pipeline/scripts/context-executor.js — original implementation
 * @see pipeline/scripts/context-compressor.js — compression strategies
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Context Cache ─────────────────────────────────────────────────────────────

/**
 * Simple in-memory cache for gatherContext() results.
 * Reduces redundant disk I/O and scoring when the same task context is requested
 * within a short window.
 *
 * @type {Map<string, { result: Object, timestamp: number }>}
 */
const _contextCache = new Map();

/** Cache TTL in milliseconds (5 minutes). */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Maximum cache entries before eviction. */
const CACHE_MAX_ENTRIES = 50;

// ---------------------------------------------------------------------------
// Default Configuration
// ---------------------------------------------------------------------------

/**
 * Default context builder configuration.
 * Can be overridden with a YAML/JSON config file.
 */
const DEFAULT_CONFIG = {
  // File patterns for discovery
  file_patterns: [
    '**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx',
    '**/*.json', '**/*.yaml', '**/*.yml',
    '**/*.md', '**/*.css', '**/*.scss', '**/*.less',
    '**/*.py', '**/*.rb', '**/*.go', '**/*.rs',
    '**/*.java', '**/*.kt', '**/*.sql'
  ],

  // Documentation patterns
  doc_patterns: [
    '**/README*', '**/CHANGELOG*', '**/CONTRIBUTING*',
    '**/docs/**', '**/documentation/**'
  ],

  // Patterns to exclude
  exclude_patterns: [
    'node_modules/**', '.git/**', 'dist/**', 'build/**',
    '.next/**', '.cache/**', 'coverage/**', '__pycache__/**',
    '*.pyc', '*.pyo', '*.class', '*.o', '*.so',
    '*.dll', '*.exe', '*.bin', '*.zip', '*.tar.gz',
    '*.png', '*.jpg', '*.jpeg', '*.gif', '*.ico', '*.svg',
    '*.woff', '*.woff2', '*.ttf', '*.eot',
    '*.map', '*.lock', 'package-lock.json'
  ],

  // Limits
  max_files: 15,
  max_context_lines: 500,
  min_score: 3,
  compression_strategy: 'smart',  // truncate | keyword_lines | section_extract | smart
  compression_max_lines: 200,
  enable_cache: false
};

// ---------------------------------------------------------------------------
// Mini Glob — Pattern Matching Without Dependencies
// ---------------------------------------------------------------------------

/**
 * Convert a glob pattern to a file path test function.
 * Supports: globstar-ext patterns, prefix wildcards, fixed paths, and simple wildcards.
 *
 * @param {string} pattern - Glob-like pattern
 * @returns {Function} Test function: (filePath: string) => boolean
 */
function patternToTest(pattern) {
  // Normalize separators
  const p = pattern.replace(/\\/g, '/');

  // **/*.ext → any file ending with .ext
  if (p.startsWith('**/*.')) {
    const ext = p.replace('**/*', '');
    return (filePath) => filePath.endsWith(ext);
  }

  // **/dirname/** → any file in dirname tree
  if (p.includes('**/') && p.endsWith('/**')) {
    const dirPart = p.replace('**/', '').replace('/**', '');
    return (filePath) => filePath.includes('/' + dirPart + '/');
  }

  // *.ext → ends with
  if (p.startsWith('*.')) {
    const ext = p.substring(1);
    return (filePath) => filePath.endsWith(ext);
  }

  // prefix* → starts with
  if (p.endsWith('*') && !p.includes('**')) {
    const prefix = p.slice(0, -1);
    return (filePath) => path.basename(filePath).startsWith(prefix);
  }

  // Fixed path match (contains pattern)
  if (p.includes('*')) {
    const parts = p.split('*');
    return (filePath) => {
      const base = path.basename(filePath);
      return base.startsWith(parts[0]) && base.endsWith(parts[parts.length - 1]);
    };
  }

  // Exact match
  return (filePath) => filePath.endsWith(p);
}

/**
 * Convert an exclude pattern to a test function.
 *
 * @param {string} pattern
 * @returns {Function}
 */
function excludePatternToTest(pattern) {
  const p = pattern.replace(/\\/g, '/');

  if (p.endsWith('/**')) {
    const dir = p.replace('/**', '');
    return (filePath) => filePath.includes('/' + dir + '/') || filePath.startsWith(dir + '/');
  }
  if (p.startsWith('*.')) {
    const ext = p.substring(1);
    return (filePath) => filePath.endsWith(ext);
  }
  if (p.endsWith('*')) {
    const prefix = p.slice(0, -1);
    return (filePath) => path.basename(filePath).startsWith(prefix);
  }
  return (filePath) => filePath.includes(p);
}

// ---------------------------------------------------------------------------
// File System Walker
// ---------------------------------------------------------------------------

/**
 * Recursively walk a directory and find matching files.
 *
 * @param {string} rootDir - Root directory to scan
 * @param {Function[]} includeTests - Functions that return true for matching files
 * @param {Function[]} excludeTests - Functions that return true for excluded files
 * @returns {string[]} Normalized file paths
 */
function walkDirectory(rootDir, includeTests, excludeTests) {
  const results = [];
  const visited = new Set();

  function walk(dir, depth) {
    // Safety: don't go deeper than 20 levels
    if (depth > 20) return;

    // Cycle detection
    if (visited.has(dir)) return;
    visited.add(dir);

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // Permission denied, skip
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const normalized = fullPath.replace(/\\/g, '/');

      // Check exclusion first (faster rejection)
      if (excludeTests.some(test => test(normalized))) continue;

      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        // Check inclusion
        if (includeTests.some(test => test(normalized))) {
          results.push(normalized);
        }
      }
    }
  }

  walk(rootDir, 0);
  return results;
}

// ---------------------------------------------------------------------------
// CB.1: Discovery
// ---------------------------------------------------------------------------

/**
 * Discover relevant files in the project.
 *
 * @param {Object} config - Configuration (file_patterns, doc_patterns, exclude_patterns)
 * @param {string} rootDir - Project root directory
 * @returns {{ files: string[], docFiles: string[] }}
 */
function cb1Discovery(config, rootDir) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!rootDir || !fs.existsSync(rootDir)) {
    return { files: [], docFiles: [] };
  }

  const includeTests = (cfg.file_patterns || []).map(patternToTest);
  const docTests = (cfg.doc_patterns || []).map(patternToTest);
  const excludeTests = (cfg.exclude_patterns || []).map(excludePatternToTest);

  const files = walkDirectory(rootDir, includeTests, excludeTests);
  const docFiles = walkDirectory(rootDir, docTests, excludeTests);

  return { files, docFiles };
}

// ---------------------------------------------------------------------------
// CB.2: Scoring
// ---------------------------------------------------------------------------

/**
 * Score files by relevance to keywords.
 *
 * Scoring rules:
 *   - keyword in content: +10
 *   - keyword in filename: +8
 *   - recently modified (git): +5
 *   - documentation match: +4
 *   - dependency reference: +3
 *
 * @param {string[]} files - File paths to score
 * @param {string[]} docFiles - Documentation file paths
 * @param {string[]} keywords - Search keywords
 * @param {Object} config - Configuration
 * @param {string} rootDir - Project root
 * @returns {Array<{ path: string, baseName: string, score: number, reasons: string[] }>}
 */
function cb2Scoring(files, docFiles, keywords, config, rootDir) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!files || files.length === 0) return [];

  const keywordsLower = (keywords || []).map(k => String(k).toLowerCase());
  if (keywordsLower.length === 0) {
    // No keywords — score all files as baseline
    return files.map(f => ({
      path: f,
      baseName: path.basename(f),
      score: 5,
      reasons: ['baseline_score']
    }));
  }

  // Detect recently modified files via git
  let recentFiles = new Set();
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel 2>nul', {
      encoding: 'utf-8', timeout: 5000, cwd: rootDir, stdio: 'pipe', windowsHide: true
    }).trim();
    const diffOut = execSync('git diff --name-only HEAD~5 2>nul', {
      encoding: 'utf-8', timeout: 5000, cwd: gitRoot, stdio: 'pipe', windowsHide: true
    }).trim();
    if (diffOut) {
      diffOut.split('\n').forEach(line => {
        const absPath = path.resolve(gitRoot, line.trim());
        recentFiles.add(absPath.replace(/\\/g, '/'));
      });
    }
  } catch {
    // Git not available — skip recently_modified bonus
  }

  const docSet = new Set(docFiles || []);
  const scored = [];

  for (const filePath of files) {
    let score = 0;
    const reasons = [];
    const baseName = path.basename(filePath);
    const normalizedPath = filePath.replace(/\\/g, '/');

    // Read file content
    let content = null;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      // Binary or unreadable — skip content-based scoring
    }

    if (content) {
      const contentLower = content.toLowerCase();

      // Keyword in content (+10)
      for (const kw of keywordsLower) {
        if (contentLower.includes(kw)) {
          score += 10;
          reasons.push(`keyword_match: "${kw}" in content`);
          break;
        }
      }
    }

    // Keyword in filename (+8)
    const baseLower = baseName.toLowerCase();
    for (const kw of keywordsLower) {
      if (baseLower.includes(kw)) {
        score += 8;
        reasons.push(`filename_match: "${kw}" in name`);
        break;
      }
    }

    // Recently modified (+5)
    if (recentFiles.has(normalizedPath)) {
      score += 5;
      reasons.push('recently_modified');
    }

    // Doc match (+4)
    if (docSet.has(normalizedPath)) {
      score += 4;
      reasons.push('documentation_file');
    }

    // Dependency check (+3) — does another file import this one?
    if (content) {
      const bareName = path.basename(filePath, path.extname(filePath));
      const importPatterns = [
        new RegExp(`require\\(['"]\\.\\.?/.*${escapeRegex(bareName)}`, 'i'),
        new RegExp(`from ['"].*${escapeRegex(bareName)}['"]`, 'i'),
        new RegExp(`import\\(['"].*${escapeRegex(bareName)}`, 'i')
      ];

      for (const otherFile of files.slice(0, 50)) {
        if (otherFile === filePath) continue;
        try {
          const otherContent = fs.readFileSync(otherFile, 'utf-8');
          if (importPatterns.some(pat => pat.test(otherContent))) {
            score += 3;
            reasons.push(`dependency: imported by ${path.basename(otherFile)}`);
            break;
          }
        } catch {
          // Skip unreadable
        }
      }
    }

    scored.push({ path: normalizedPath, baseName, score, reasons });
  }

  return scored;
}

// ---------------------------------------------------------------------------
// CB.3: Elimination
// ---------------------------------------------------------------------------

/**
 * Eliminate low-scoring files and enforce max_files limit.
 *
 * @param {Array<{ path: string, score: number }>} scored - Scored files
 * @param {Object} config - Configuration
 * @returns {{ kept: Array, eliminated: Array }}
 */
function cb3Elimination(scored, config) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!scored || scored.length === 0) {
    return { kept: [], eliminated: [] };
  }

  // Filter below min_score
  const qualified = scored.filter(s => s.score >= (cfg.min_score || 3));

  // Sort by score descending
  qualified.sort((a, b) => b.score - a.score);

  // Enforce max_files
  const kept = qualified.slice(0, cfg.max_files || 15);
  const eliminated = [
    ...scored.filter(s => s.score < (cfg.min_score || 3)),
    ...qualified.slice(cfg.max_files || 15)
  ];

  return { kept, eliminated };
}

// ---------------------------------------------------------------------------
// CB.4-CB.6: Order, Compress, Assemble
// ---------------------------------------------------------------------------

/**
 * Order files by score, compress content, and assemble final context.
 *
 * @param {Array} kept - Files kept after elimination
 * @param {Array} eliminated - Eliminated files
 * @param {string[]} keywords - Search keywords
 * @param {Object} config - Configuration
 * @returns {{ context: Object, summary: string }}
 */
function cb4to6(kept, eliminated, keywords, config) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const strategy = cfg.compression_strategy || 'smart';
  const maxLines = cfg.compression_max_lines || 200;

  // Already sorted by score from CB.3

  const filesWithContent = (kept || []).map((f, i) => {
    const entry = {
      rank: i + 1,
      path: f.path,
      score: f.score,
      reasons: f.reasons || []
    };

    try {
      const rawContent = fs.readFileSync(f.path, 'utf-8');
      entry.originalLines = rawContent.split('\n').length;
      entry.originalChars = rawContent.length;
      entry.content = rawContent;

      // Apply compression
      entry.compressed_content = compressContent(rawContent, maxLines, strategy, keywords);
      entry.compressedLines = entry.compressed_content.split('\n').length;
    } catch (err) {
      entry.content = `// [Error reading file: ${err.message}]`;
      entry.compressed_content = entry.content;
      entry.originalLines = 0;
      entry.compressedLines = 1;
    }

    return entry;
  });

  const context = {
    metadata: {
      generated_at: new Date().toISOString(),
      keywords: keywords || [],
      total_scored: (kept || []).length + (eliminated || []).length,
      kept: (kept || []).length,
      eliminated: (eliminated || []).length,
      compression: {
        strategy,
        max_content_lines: maxLines
      }
    },
    files: filesWithContent,
    excluded: (eliminated || []).map(f => ({
      path: f.path,
      score: f.score,
      reason: f.score < (cfg.min_score || 3)
        ? 'score below minimum'
        : 'exceeded max files limit'
    }))
  };

  return { context };
}

// ---------------------------------------------------------------------------
// Content Compression (mirrors context-compressor.js)
// ---------------------------------------------------------------------------

/**
 * Compress file content using the specified strategy.
 *
 * @param {string} content - Raw file content
 * @param {number} maxLines - Maximum output lines
 * @param {string} strategy - Compression strategy
 * @param {string[]} keywords - Keywords for semantic compression
 * @returns {string} Compressed content
 */
function compressContent(content, maxLines, strategy, keywords) {
  if (!content || typeof content !== 'string') return '';
  if (maxLines <= 0) return '';

  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;

  const kw = (keywords || []).map(k => String(k).toLowerCase()).filter(Boolean);

  switch (strategy) {
    case 'truncate':
      return compressTruncate(lines, maxLines);

    case 'keyword_lines':
      return compressKeywordLines(lines, kw, maxLines);

    case 'section_extract':
      return compressSectionExtract(lines, kw, maxLines);

    case 'smart':
      return compressSmart(lines, kw, maxLines);

    default:
      return compressTruncate(lines, maxLines);
  }
}

function compressTruncate(lines, maxLines) {
  if (lines.length <= maxLines) return lines.join('\n');
  const kept = lines.slice(0, maxLines);
  kept.push(`// ... [${lines.length - maxLines} lines truncated]`);
  return kept.join('\n');
}

function compressKeywordLines(lines, keywords, maxLines) {
  if (keywords.length === 0) return compressTruncate(lines, maxLines);

  const selectedIndices = new Set();
  const window = 3;

  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (keywords.some(kw => lower.includes(kw))) {
      for (let j = Math.max(0, i - window); j <= Math.min(lines.length - 1, i + window); j++) {
        selectedIndices.add(j);
      }
    }
  }

  if (selectedIndices.size === 0) return compressTruncate(lines, maxLines);

  const sorted = [...selectedIndices].sort((a, b) => a - b);
  const result = [];
  let lastIdx = -1;

  for (const idx of sorted) {
    if (result.length >= maxLines) {
      result.push(`// ... [max ${maxLines} lines reached]`);
      break;
    }
    if (lastIdx >= 0 && idx > lastIdx + 1) {
      result.push(`// ... [${idx - lastIdx - 1} lines omitted]`);
    }
    result.push(lines[idx]);
    lastIdx = idx;
  }

  return result.join('\n');
}

function compressSectionExtract(lines, keywords, maxLines) {
  if (keywords.length === 0) return compressTruncate(lines, maxLines);

  // Identify sections by heading patterns
  const headingRE = /^(?:#{1,6}\s+|(?:[A-Z][A-Z\s\-/]+)$|(?:={3,}|-{3,})$|^\/\*{2,}\s*|^\/\/+\s*[-=*!_]{3,}|^--\s+|^;+\s*[-=*!_]{3,})/;

  const sections = [];
  let currentSection = { heading: '(top)', lineIndices: [] };

  for (let i = 0; i < lines.length; i++) {
    if (headingRE.test(lines[i])) {
      if (currentSection.lineIndices.length > 0) sections.push(currentSection);
      currentSection = { heading: lines[i].trim(), lineIndices: [i] };
    } else {
      currentSection.lineIndices.push(i);
    }
  }
  if (currentSection.lineIndices.length > 0) sections.push(currentSection);

  // Score sections by keyword density
  const scored = sections.map(sec => {
    let matches = 0;
    for (const idx of sec.lineIndices) {
      const lower = lines[idx].toLowerCase();
      if (keywords.some(kw => lower.includes(kw))) matches++;
    }
    return { ...sec, matchCount: matches, density: matches / Math.max(1, sec.lineIndices.length) };
  });

  const result = [];
  for (const sec of scored) {
    if (sec.matchCount === 0) {
      result.push('');
      result.push(`// ... section "${sec.heading}" (0 keyword matches)`);
      continue;
    }
    if (result.length >= maxLines) break;
    result.push('');
    for (const idx of sec.lineIndices) {
      if (result.length >= maxLines) {
        result.push(`// ... [max ${maxLines} lines]`);
        break;
      }
      result.push(lines[idx]);
    }
  }

  return result.join('\n');
}

function compressSmart(lines, keywords, maxLines) {
  if (keywords.length === 0) return compressTruncate(lines, maxLines);
  if (lines.length <= maxLines) return lines.join('\n');

  // Combine section extraction and keyword lines
  const headingRE = /^(?:#{1,6}\s+|^\/\*{2,}\s*|^\/\/+\s*[-=*!_]{3,}|^--\s+)/;
  const selectedIndices = new Set();

  // Phase 1: Section extraction
  let currentSection = { lineIndices: [] };
  const sections = [];
  for (let i = 0; i < lines.length; i++) {
    if (headingRE.test(lines[i])) {
      if (currentSection.lineIndices.length > 0) sections.push(currentSection);
      currentSection = { lineIndices: [i] };
    } else {
      currentSection.lineIndices.push(i);
    }
  }
  if (currentSection.lineIndices.length > 0) sections.push(currentSection);

  for (const sec of sections) {
    let hasKeyword = false;
    for (const idx of sec.lineIndices) {
      if (keywords.some(kw => lines[idx].toLowerCase().includes(kw))) {
        hasKeyword = true;
        break;
      }
    }
    if (hasKeyword) {
      for (const idx of sec.lineIndices) selectedIndices.add(idx);
    }
  }

  // Phase 2: Keyword lines for remaining
  const window = 2;
  for (let i = 0; i < lines.length; i++) {
    if (selectedIndices.has(i)) continue;
    if (keywords.some(kw => lines[i].toLowerCase().includes(kw))) {
      for (let j = Math.max(0, i - window); j <= Math.min(lines.length - 1, i + window); j++) {
        selectedIndices.add(j);
      }
    }
  }

  if (selectedIndices.size === 0) return compressTruncate(lines, maxLines);

  const sorted = [...selectedIndices].sort((a, b) => a - b);
  const result = [];
  let lastIdx = -1;

  for (const idx of sorted) {
    if (result.length >= maxLines) {
      result.push(`// ... [limit ${maxLines} lines]`);
      break;
    }
    if (lastIdx >= 0 && idx > lastIdx + 1) {
      result.push(`// ... [${idx - lastIdx - 1} lines omitted]`);
    }
    result.push(lines[idx]);
    lastIdx = idx;
  }

  return result.join('\n');
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Gather context for a task — runs CB.1 through CB.6.
 * This is the primary entry point.
 *
 * @param {Object} task - Task analysis (or object with relevant fields)
 * @param {Object} [options]
 * @param {string} [options.rootDir] - Project root (default: process.cwd())
 * @param {Object} [options.config] - Configuration overrides
 * @param {string[]} [options.keywords] - Explicit keywords (if not in task)
 * @returns {{ context: Object, files: string[], metadata: Object }}
 */
function gatherContext(task, options) {
  const opts = options || {};
  const rootDir = opts.rootDir || process.cwd();
  const config = { ...DEFAULT_CONFIG, ...(opts.config || {}) };

  // Extract keywords from task or options
  const keywords = opts.keywords || extractKeywords(task);

  // ── Cache check ───────────────────────────────────────────────────────
  const cacheKey = JSON.stringify({ keywords: keywords.slice().sort(), rootDir });
  const cached = _contextCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    return cached.result;
  }

  if (!fs.existsSync(rootDir)) {

    return { context: null, files: [], metadata: { error: `Root dir not found: ${rootDir}` } };
  }

  // CB.1: Discovery
  const { files, docFiles } = cb1Discovery(config, rootDir);

  if (files.length === 0) {
    const emptyResult = {
      context: { metadata: { generated_at: new Date().toISOString(), keywords, total_scored: 0, kept: 0, eliminated: 0 }, files: [], excluded: [] },
      files: [],
      metadata: { discovered: 0, scored: 0, kept: 0 }
    };

    // Cache the empty result too
    _contextCache.set(cacheKey, { result: emptyResult, timestamp: Date.now() });
    return emptyResult;
  }

  // CB.2: Scoring
  const scored = cb2Scoring(files, docFiles, keywords, config, rootDir);

  // CB.3: Elimination
  const { kept, eliminated } = cb3Elimination(scored, config);

  // CB.4-CB.6: Order, Compress, Assemble
  const { context } = cb4to6(kept, eliminated, keywords, config);

  const result = {
    context,
    files: kept.map(f => f.path),
    metadata: {
      discovered: files.length,
      scored: scored.length,
      kept: kept.length,
      eliminated: eliminated.length,
      keywords
    }
  };

  // ── Cache store ───────────────────────────────────────────────────────
  _contextCache.set(cacheKey, { result, timestamp: Date.now() });

  // Limit cache size (FIFO eviction)
  if (_contextCache.size > CACHE_MAX_ENTRIES) {
    const firstKey = _contextCache.keys().next().value;
    _contextCache.delete(firstKey);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Alias Functions (matching the spec)
// ---------------------------------------------------------------------------

/**
 * Score relevance of files to a task.
 *
 * @param {string[]} files
 * @param {Object} task
 * @returns {Array} Scored files
 */
function scoreRelevance(files, task) {
  const keywords = extractKeywords(task);
  return cb2Scoring(files, [], keywords, DEFAULT_CONFIG, process.cwd());
}

/**
 * Optimize context to fit within token budget.
 *
 * @param {Object} context - Context object from gatherContext()
 * @param {number} maxTokens - Token budget (approximate)
 * @returns {Object} Optimized context
 */
function optimizeContext(context, maxTokens) {
  if (!context || !context.files || context.files.length === 0) return context;

  // Estimate current token usage (4 chars ≈ 1 token)
  let currentTokens = 0;
  for (const file of context.files) {
    currentTokens += Math.ceil((file.compressed_content || '').length / 4);
  }

  if (currentTokens <= maxTokens) return context;

  // Truncate file contents proportionally
  const factor = maxTokens / currentTokens;
  const optimized = JSON.parse(JSON.stringify(context));

  for (const file of optimized.files) {
    const content = file.compressed_content || '';
    const targetChars = Math.max(200, Math.round(content.length * factor));
    if (content.length > targetChars) {
      file.compressed_content = content.slice(0, targetChars) +
        `\n// ... [truncated for token budget: ${content.length - targetChars} chars]`;
    }
  }

  return optimized;
}

/**
 * Assemble context into a format ready for prompt injection.
 *
 * @param {Object} context - Optimized context
 * @param {Object} task - Task analysis
 * @returns {string} Formatted context string
 */
function assembleContext(context, task) {
  if (!context || !context.files || context.files.length === 0) {
    return '// No context files available for this task.';
  }

  let output = `## Context Files (${context.files.length} relevant)\n\n`;

  for (const file of context.files) {
    const path = file.path || file.path || 'unknown';
    const score = file.score || 0;
    const content = file.compressed_content || file.content || '';

    output += `### ${file.rank || ''}. \`${path}\` (score: ${score})\n`;

    if (file.reasons && file.reasons.length > 0) {
      output += `_Relevance: ${file.reasons.join(', ')}_\n\n`;
    }

    if (content) {
      output += '```\n' + content + '\n```\n\n';
    }
  }

  return output;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract keywords from a task analysis object.
 *
 * @param {Object} task
 * @returns {string[]}
 */
function extractKeywords(task) {
  const keywords = new Set();

  if (!task) return [];

  if (task.goal && typeof task.goal === 'string') {
    task.goal.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3)
      .forEach(w => keywords.add(w));
  }

  if (task.taskType) keywords.add(task.taskType);

  if (task.constraints && Array.isArray(task.constraints)) {
    task.constraints.forEach(c => {
      const parts = c.split(':');
      if (parts[1]) keywords.add(parts[1].toLowerCase());
    });
  }

  return [...keywords].slice(0, 10);
}

/**
 * Escape special regex characters.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

// ── Cache management ─────────────────────────────────────────────────────────

/**
 * Clear the context cache.
 * Useful for testing or forcing a fresh context gather.
 */
function clearCache() {
  _contextCache.clear();
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // CB pipeline functions
  cb1Discovery,
  cb2Scoring,
  cb3Elimination,
  cb4to6,

  // Main API
  gatherContext,
  scoreRelevance,
  optimizeContext,
  assembleContext,
  clearCache,

  // Compression
  compressContent,

  // Utilities
  walkDirectory,
  patternToTest,
  extractKeywords,

  // Config
  DEFAULT_CONFIG
};
