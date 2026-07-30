/**
 * Matrix Task Classifier — Deterministic Task Complexity Analyzer
 * ==============================================================
 * Classifica tarefas SEM LLM, baseado em padrões textuais.
 * Zero dependências npm. CommonJS module.
 *
 * @version 1.0.0
 * @see adaptive-pipeline.yaml
 */

/**
 * @typedef {'simple'|'medium'|'complex'} Classification
 */

/**
 * @typedef {Object} ClassificationResult
 * @property {Classification} classification
 * @property {number} confidence - 0.0 to 1.0
 * @property {Object} signals
 * @property {string[]} signals.trivial
 * @property {string[]} signals.complex
 * @property {Object} signals.score
 * @property {number} signals.score.trivial
 * @property {number} signals.score.complex
 * @property {Classification} pipeline - recommended pipeline
 * @property {string} reason - human-readable explanation
 */

/**
 * @typedef {Object} PipelineConfig
 * @property {boolean} skipJudge
 * @property {boolean} skipCodeReview
 * @property {number} maxRetries
 * @property {boolean} [requireDesignDoc]
 * @property {string[]} phases
 */

// ──────────────────────────────────────────────
// Default Pipeline Configs
// ──────────────────────────────────────────────

const PIPELINE_CONFIGS = {
  simple: {
    skipJudge: true,
    skipCodeReview: true,
    maxRetries: 0,
    phases: ['identify', 'analyze_quick', 'execute', 'verify', 'deliver'],
  },
  medium: {
    skipJudge: false,
    skipCodeReview: false,
    maxRetries: 3,
    phases: [
      'identify',
      'analyze',
      'execute',
      'verify',
      'judge',
      'review',
      'deliver',
    ],
  },
  complex: {
    skipJudge: false,
    skipCodeReview: false,
    maxRetries: 5,
    requireDesignDoc: true,
    phases: [
      'identify',
      'analyze_deep',
      'execute',
      'verify',
      'judge',
      'review',
      'deliver',
    ],
  },
};

// ──────────────────────────────────────────────
// Regex Patterns
// ──────────────────────────────────────────────

/** Words that signal a trivial/simple task */
const TRIVIAL_WORDS = [
  'corrigir',
  'ajustar',
  'renomear',
  'typo',
  'simples',
  'rapido',
  'rápido',
  'simplesmente',
  'trivial',
  'pequeno',
  'pequena',
  'cosmetico',
  'cosmético',
  'formatar',
  'correção',
  'correcao',
  'tweak',
  'minor',
];

/** Words that signal a complex task */
const COMPLEX_WORDS = [
  'arquitetura',
  'arquitetural',
  'design',
  'nova funcionalidade',
  'nova feature',
  'refatorar',
  'refatoração',
  'refatoracao',
  'migrar',
  'migração',
  'migracao',
  'segurança',
  'seguranca',
  'security',
  'performance',
  'escalar',
  'escalabilidade',
  'distribuido',
  'distribuído',
  'distributed',
  'integrar',
  'integração',
  'integracao',
  'multi',
  'agente',
  'orquestração',
  'orquestracao',
  'pipeline',
  'paralelo',
  'concorrente',
  'cache',
  'otimizar',
  'otimização',
  'otimizacao',
  'reestruturar',
  'redesenhar',
  'reescrever',
  'reimplementar',
  'modularizar',
  'componentizar',
  'assíncrono',
  'async',
  'webhook',
  'evento',
  'event-driven',
  'microserviço',
  'microservice',
  'containers',
  'deploy',
  'ci/cd',
  'testes',
  'cobertura',
  'monitoramento',
  'observabilidade',
];

/** Single-file pattern: "em X" or "de X" where X is a file path */
const SINGLE_FILE_RE = /(?:em|de|no|na|do|da|para)\s+([^\s,;]+\.(?:js|ts|tsx|jsx|css|scss|less|md|php|html|vue|svelte|py|rb|go|rs|java|kt|sql|yaml|yml|json|xml|env|gitignore|bat|sh|ps1))\b/i;

/** Explicit file extension pattern for counting mentions */
const FILE_MENTION_RE = /[\w\-.]+\.(?:js|ts|tsx|jsx|css|scss|less|md|php|html|vue|svelte|py|rb|go|rs|java|kt|sql|yaml|yml|json|xml|env|gitignore|bat|sh|ps1)\b/gi;

/** Character count threshold */
const SHORT_DESC_THRESHOLD = 30;
const LONG_DESC_THRESHOLD = 200;

/** Multi-file threshold (3+) */
const MULTI_FILE_THRESHOLD = 3;

// ──────────────────────────────────────────────
// TaskClassifier Class
// ──────────────────────────────────────────────

class TaskClassifier {
  /**
   * @param {Object} [config] - Optional config overrides
   * @param {boolean} [config.verbose=false] - Extra debug info
   */
  constructor(config = {}) {
    this.config = {
      verbose: false,
      ...config,
    };

    // Compile patterns once
    this._trivialWordsRE = new RegExp(
      `\\b(${TRIVIAL_WORDS.join('|')})\\b`,
      'gi'
    );
    this._complexWordsRE = new RegExp(
      `\\b(${COMPLEX_WORDS.join('|')})\\b`,
      'gi'
    );
  }

  /**
   * Classify a task demand string.
   *
   * @param {string} demand - The task description / demand text
   * @returns {ClassificationResult}
   */
  classify(demand) {
    if (!demand || typeof demand !== 'string') {
      return this._fallback('empty demand');
    }

    const text = demand.trim();
    if (text.length === 0) {
      return this._fallback('empty string');
    }

    const signals = this.analyzeSignals(text);
    const classification = this._decide(signals);
    const pipeline = classification; // same as classification
    const reason = this._buildReason(classification, signals);

    const result = {
      classification,
      confidence: this._computeConfidence(classification, signals),
      signals: {
        trivial: signals.trivialWords,
        complex: signals.complexWords,
        score: {
          trivial: signals.score.trivial,
          complex: signals.score.complex,
        },
      },
      pipeline,
      reason,
    };

    if (this.config.verbose) {
      result._debug = {
        length: text.length,
        fileCount: signals.fileCount,
      };
    }

    return result;
  }

  /**
   * Analyze textual signals from the demand.
   *
   * @param {string} text
   * @returns {Object}
   */
  analyzeSignals(text) {
    const fileMatches = [...text.matchAll(FILE_MENTION_RE)];
    const uniqueFiles = new Set(
      fileMatches.map((m) => m[0].toLowerCase())
    );
    const fileCount = uniqueFiles.size;

    // Detect single file pattern (em X / de X)
    const singleFileMatch = SINGLE_FILE_RE.exec(text);
    const singleFileHint = singleFileMatch !== null;

    // Count trivial and complex word occurrences
    const trivialWords = [
      ...new Set(
        (text.match(this._trivialWordsRE) || []).map((w) =>
          w.toLowerCase()
        )
      ),
    ];
    const complexWords = [
      ...new Set(
        (text.match(this._complexWordsRE) || []).map((w) =>
          w.toLowerCase()
        )
      ),
    ];

    const len = text.length;

    return {
      length: len,
      fileCount,
      uniqueFiles: [...uniqueFiles],
      singleFileHint,
      trivialWords,
      complexWords,
      score: {
        trivial: this._scoreTrivial(text, len, fileCount, singleFileHint, trivialWords),
        complex: this._scoreComplex(text, len, fileCount, complexWords),
      },
    };
  }

  // ─── Private helpers ──────────────────────

  /**
   * Score trivial/simple signals.
   * @private
   */
  _scoreTrivial(text, length, fileCount, singleFileHint, trivialWords) {
    let score = 0;

    // Short description (< 30 chars)
    if (length > 0 && length < SHORT_DESC_THRESHOLD) {
      score += 2;
    }

    // Trivial keywords found
    if (trivialWords.length > 0) {
      score += trivialWords.length;
    }

    // Single file pattern match
    if (singleFileHint) {
      score += 1;
    }

    // Only 1 file mentioned
    if (fileCount === 1) {
      score += 1;
    }

    return score;
  }

  /**
   * Score complex signals.
   * @private
   */
  _scoreComplex(text, length, fileCount, complexWords) {
    let score = 0;

    // Complex keywords found
    if (complexWords.length > 0) {
      score += complexWords.length;
    }

    // Long description (> 200 chars)
    if (length > LONG_DESC_THRESHOLD) {
      score += 1;
    }

    // 3+ files mentioned
    if (fileCount >= MULTI_FILE_THRESHOLD) {
      score += 2;
    }

    return score;
  }

  /**
   * Decide classification based on signal scores.
   * @private
   */
  _decide(signals) {
    const { score } = signals;

    // SIMPLE check — any one is enough
    const isSimple =
      score.trivial >= 1 &&
      score.complex === 0; // no complex signals at all

    // Clean simple (explicitly simple with no complex)
    if (isSimple) {
      return 'simple';
    }

    // COMPLEX check — 2 or more complex signals
    if (score.complex >= 2) {
      return 'complex';
    }

    // If complex signals == 1, check if there are also trivial signals
    // If trivial >= complex, it's MEDIUM (not complex)
    if (score.complex === 1 && score.trivial >= 1) {
      return 'medium';
    }

    // If complex == 1 and trivial == 0
    if (score.complex === 1) {
      // Single complex signal could tip to complex depending on context
      // But default safe is medium
      return 'medium';
    }

    // Default: MEDIUM
    return 'medium';
  }

  /**
   * Compute confidence level.
   * High confidence when signals are unambiguous.
   * @private
   */
  _computeConfidence(classification, signals) {
    const { score } = signals;

    switch (classification) {
      case 'simple':
        // High confidence when trivial score >= 2 and complex is 0
        if (score.trivial >= 2 && score.complex === 0) return 0.95;
        if (score.trivial >= 1 && score.complex === 0) return 0.85;
        return 0.7;

      case 'complex':
        // High confidence when complex score >= 3
        if (score.complex >= 3) return 0.95;
        if (score.complex >= 2) return 0.85;
        return 0.7;

      case 'medium':
      default:
        // Medium is the safe default — moderate confidence
        if (score.trivial > 0 && score.complex > 0) return 0.65;
        return 0.75;
    }
  }

  /**
   * Build human-readable reason string.
   * @private
   */
  _buildReason(classification, signals) {
    const parts = [];

    if (signals.trivialWords.length > 0) {
      parts.push(
        `palavras simples: ${signals.trivialWords.join(', ')}`
      );
    }
    if (signals.complexWords.length > 0) {
      parts.push(
        `palavras complexas: ${signals.complexWords.join(', ')}`
      );
    }
    if (signals.length > 0 && signals.length < SHORT_DESC_THRESHOLD) {
      parts.push(`descricao curta (${signals.length} caracteres)`);
    }
    if (signals.length > LONG_DESC_THRESHOLD) {
      parts.push(`descricao longa (${signals.length} caracteres)`);
    }
    if (signals.singleFileHint) {
      parts.push('1 arquivo mencionado explicitamente');
    }
    if (signals.fileCount === 1) {
      parts.push('apenas 1 arquivo');
    }
    if (signals.fileCount >= MULTI_FILE_THRESHOLD) {
      parts.push(`${signals.fileCount} arquivos mencionados`);
    }

    const reason =
      parts.length > 0
        ? parts.join('; ')
        : 'nenhum sinal especifico detectado, usando fallback seguro';

    return `[${classification}] ${reason}`;
  }

  /**
   * Get pipeline configuration for a given classification.
   *
   * @param {Classification} classification
   * @returns {PipelineConfig}
   */
  getPipelineConfig(classification) {
    const key =
      classification === 'simple'
        ? 'simple'
        : classification === 'complex'
          ? 'complex'
          : 'medium';

    return { ...PIPELINE_CONFIGS[key] };
  }

  /**
   * Fallback for invalid input.
   * @private
   */
  _fallback(reason) {
    return {
      classification: 'medium',
      confidence: 0.5,
      signals: {
        trivial: [],
        complex: [],
        score: { trivial: 0, complex: 0 },
      },
      pipeline: 'medium',
      reason: `[medium] fallback: ${reason}`,
    };
  }
}

// ──────────────────────────────────────────────
// Standalone classify function
// ──────────────────────────────────────────────

/**
 * Quick-access classify function.
 *
 * @param {string} demand
 * @param {Object} [options]
 * @returns {ClassificationResult}
 */
function classify(demand, options = {}) {
  const classifier = new TaskClassifier(options);
  return classifier.classify(demand);
}

// ──────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────

module.exports = {
  TaskClassifier,
  classify,
};
