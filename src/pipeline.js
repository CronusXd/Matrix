/**
 * Matrix Pipeline Integrator — Model Amplification Engine
 * ========================================================
 * Orquestra: TaskIntelligence → Strategy → Context → Prompt → Model → Validation → Refinement
 *
 * Este é o ORQUESTRADOR INTERNO da Matrix. Conecta todos os módulos de amplificação.
 *
 * Feature flag: MATRIX_ENABLE_AMPLIFICATION=false (default=true)
 * Se desabilitado, amplify() retorna null e o proxy simples é usado.
 *
 * CommonJS module. Zero additional npm dependencies.
 *
 * @version 1.0.0
 */

'use strict';

const path = require('path');
const logger = require('./utils/logger');

// ── Feature Flag ──────────────────────────────────────────────────────────────

/**
 * Verifica se o pipeline de amplificação está habilitado.
 * Controlado pela env var MATRIX_ENABLE_AMPLIFICATION.
 *
 * @returns {boolean}
 */
function isAmplificationEnabled() {
  // Amplification is ON by default. Set MATRIX_ENABLE_AMPLIFICATION=false to disable.
  return process.env.MATRIX_ENABLE_AMPLIFICATION !== 'false';
}

// ── Main Pipeline ─────────────────────────────────────────────────────────────

/**
 * Executa o pipeline completo de amplificação para uma requisição.
 *
 * @param {Array} messages — Array de mensagens no formato OpenAI
 * @param {Object} options — Opções do pipeline
 * @param {string} options.apiKey — API key do provider
 * @param {string} options.model — Modelo a ser usado
 * @param {Object} options.provider — Provider adapter (com método .chat())
 * @param {string} [options.projectRoot] — Diretório raiz do projeto (default: cwd)
 * @returns {Promise<Object|null>} Resultado amplificado ou null se desabilitado/erro
 */
async function amplify(messages, options) {
  // ── Feature flag check ──────────────────────────────────────────────────
  if (!isAmplificationEnabled()) {
    logger.debug({ msg: 'Amplification disabled — returning null', reason: 'feature_flag_off' });
    return null;
  }

  // ── Validate input ──────────────────────────────────────────────────────
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    logger.warn({ msg: 'Amplification called with invalid messages', has_messages: !!messages });
    return null;
  }

  if (!options || !options.provider) {
    logger.warn({ msg: 'Amplification called without provider', has_options: !!options });
    return null;
  }

  const startTime = Date.now();

  try {
    // ── Step 1: Task Intelligence ─────────────────────────────────────────
    const taskIntelligence = require('./intelligence/task-intelligence');
    const task = taskIntelligence.analyzeTask(messages);

    logger.debug({
      msg: 'Task analyzed',
      taskType: task.taskType,
      complexity: task.complexity,
      risk: task.risk,
      requiresContext: task.requiresContext,
      estimatedTokens: task.estimatedTokens
    });

    // ── Step 2: Model Profile ─────────────────────────────────────────────
    const profileModule = require('./model/profile');
    const model = options.model || 'unknown';
    const profile = profileModule.getProfile(model);

    logger.debug({
      msg: 'Model profile loaded',
      model,
      coding: profile.coding,
      reasoning: profile.reasoning,
      planning: profile.planning,
      matchedVia: profile.matchedVia || 'direct'
    });

    // ── Step 3: Strategy Selection ────────────────────────────────────────
    const strategyEngine = require('./strategy/strategy-engine');
    const strategy = strategyEngine.selectStrategy(task);

    logger.debug({
      msg: 'Strategy selected',
      strategy: strategy.name,
      rationale: strategy.rationale,
      estimatedCost: strategy.cost
    });

    // ── Step 4: Model Strategy Adaptation ─────────────────────────────────
    const adapterModule = require('./model/adapter');
    const adapted = adapterModule.adaptStrategy(strategy, profile, { task });

    logger.debug({
      msg: 'Strategy adapted for model',
      adaptations: adapted.adaptations,
      confidence: adapted.confidence
    });

    // ── Step 5: Context Gathering (apenas se strategy requer) ─────────────
    const contextEngine = require('./context/context-engine');
    const contextQuality = require('./context/context-quality');

    let context = null;
    const strategyDef = strategy.definition || {};

    if (strategyDef.requiresContext !== false) {
      try {
        // P4.1: Validate and sanitize projectRoot — only allow within current working dir
        let rootDir = options.projectRoot || process.cwd();
        const resolved = path.resolve(rootDir);
        const allowedBase = path.resolve(process.cwd());

        // Append separator to prevent sibling directory bypass (Matrix2 matching Matrix)
        // Normalize to lowercase for case-insensitive comparison on Windows
        const normalizedResolved = resolved.toLowerCase() + path.sep;
        const normalizedBase = allowedBase.toLowerCase() + path.sep;

        if (!normalizedResolved.startsWith(normalizedBase)) {
          logger.warn({
            msg: 'projectRoot outside allowed base — using cwd',
            resolved,
            allowedBase
          });
          rootDir = process.cwd();
        } else {
          rootDir = resolved;
        }

        const keywords = extractKeywordsFromTask(task);

        logger.debug({
          msg: 'Gathering context',
          rootDir,
          keywords_count: keywords.length
        });

        const ctxResult = contextEngine.gatherContext(task, {
          rootDir,
          keywords
        });

        if (ctxResult.context && ctxResult.context.files && ctxResult.context.files.length > 0) {
          const quality = contextQuality.evaluateContext(ctxResult.context, task);
          ctxResult.quality = quality;

          logger.debug({
            msg: 'Context gathered',
            files: ctxResult.context.files.length,
            quality_sufficient: quality.sufficient,
            completeness: quality.completeness,
            relevance: quality.relevance
          });
        } else {
          logger.debug({ msg: 'No context files gathered', reason: 'no_matching_files' });
        }

        context = ctxResult.context;
      } catch (ctxErr) {
        logger.warn({
          msg: 'Context gathering failed — proceeding without context',
          error: ctxErr.message
        });
        context = null;
      }
    }

    // ── Step 6: Prompt Compilation ────────────────────────────────────────
    const promptCompiler = require('./prompt/prompt-compiler');
    const compiled = promptCompiler.compilePrompt(task, context, strategy);

    logger.debug({
      msg: 'Prompt compiled',
      estimatedTokens: compiled.estimatedTokens,
      hasContext: compiled.metadata.hasContext,
      contextFileCount: compiled.metadata.contextFileCount
    });

    // ── Model adaptation do prompt ────────────────────────────────────────
    const systemAdapted = adapterModule.adaptPrompt(compiled.systemPrompt, profile);
    const userAdapted = adapterModule.adaptPrompt(compiled.userPrompt, profile);

    logger.debug({
      msg: 'Prompt adapted for model',
      system_changes: systemAdapted.changes,
      user_changes: userAdapted.changes
    });

    // ── Step 7: Provider Adapter + Provider Call ──────────────────────────
    const providerAdapter = require('./providers/adapter');
    const adapter = providerAdapter.createAdapter(options.provider, {
      apiKey: options.apiKey,
      model: options.model
    });

    const callInput = {
      system: systemAdapted.adaptedPrompt,
      user: userAdapted.adaptedPrompt
    };

    logger.debug({ msg: 'Calling provider via adapter', model: options.model });

    const result = await adapter.call(callInput);

    logger.debug({
      msg: 'Provider call completed',
      content_length: result.content ? result.content.length : 0,
      usage: result.usage
    });

    // ── Step 8: Validation (apenas se strategy requer) ────────────────────
    let validation = null;
    let evaluation = null;
    const effectiveDef = adapted.adaptedStrategy || strategyDef;

    if (effectiveDef.requiresValidation !== false) {
      try {
        const validator = require('./validation/validator');
        const evaluator = require('./validation/result-evaluator');

        validation = await validator.validateResult(result, task, context);
        evaluation = evaluator.evaluate(validation, task);

        logger.debug({
          msg: 'Validation completed',
          verdict: evaluation.verdict,
          score: evaluation.score,
          issues: evaluation.issues
        });

        // Se SUCCESS ou score >= 8, retornar imediatamente
        if (evaluation.verdict === 'SUCCESS' || evaluation.score >= 8) {
          return buildAmplifiedResponse(result, task, strategy, profile, context, validation, evaluation, 0);
        }
      } catch (valErr) {
        logger.warn({
          msg: 'Validation failed — proceeding without validation',
          error: valErr.message
        });
        validation = null;
        evaluation = null;
      }
    }

    // ── Step 9: Refinement Loop (se validação falhou) ────────────────────
    if (evaluation && (evaluation.verdict !== 'SUCCESS' && evaluation.score < 8)) {
      try {
        const refinement = require('./feedback/refinement-loop');
        const refined = await refinement.refine(task, adapter, context, strategy, {
          maxIterations: 3
        });

        if (refined.success) {
          logger.info({
            msg: 'Refinement succeeded',
            iterations: refined.iterations,
            bestIteration: refined.bestIteration
          });

          return buildAmplifiedResponse(
            refined.result,
            task,
            strategy,
            profile,
            context,
            null,
            null,
            refined.iterations
          );
        }

        // Retornar o melhor resultado mesmo se refinement falhou
        logger.warn({
          msg: 'Refinement did not achieve success threshold',
          iterations: refined.iterations,
          note: refined.note
        });

        return buildAmplifiedResponse(
          refined.result || result,
          task,
          strategy,
          profile,
          context,
          validation,
          evaluation,
          refined.iterations
        );
      } catch (refineErr) {
        logger.warn({
          msg: 'Refinement loop error — returning pre-refinement result',
          task_id: task.goal?.slice(0, 50),
          error: refineErr.message
        });
        const response = buildAmplifiedResponse(result, task, strategy, profile, context, validation, evaluation, 0);
        if (response.metadata) {
          response.metadata.refinementError = refineErr.message;
          response.metadata.refinementAborted = true;
        }
        return response;
      }
    }

    // ── Fallback: retornar resultado sem refinement ───────────────────────
    return buildAmplifiedResponse(result, task, strategy, profile, context, validation, evaluation, 0);

  } catch (err) {
    const elapsed = Date.now() - startTime;

    logger.errorObj(err, {
      context: 'amplification_pipeline',
      elapsed_ms: elapsed,
      model: options.model
    });

    // Retornar null para fallback ao proxy simples
    return null;
  }
}

// ── Response Builder ──────────────────────────────────────────────────────────

/**
 * Constrói o objeto de resposta amplificada com metadados completos.
 *
 * @param {Object} result — Resultado do provider
 * @param {Object} task — Task analysis
 * @param {Object} strategy — Strategy selection
 * @param {Object} profile — Model profile
 * @param {Object|null} context — Contexto reunido
 * @param {Object|null} validation — Resultado da validação
 * @param {Object|null} evaluation — Resultado da avaliação
 * @param {number} refinementIterations — Iterações de refinement
 * @returns {Object} Resposta amplificada
 */
function buildAmplifiedResponse(
  result,
  task,
  strategy,
  profile,
  context,
  validation,
  evaluation,
  refinementIterations
) {
  return {
    content: result.content,
    usage: result.usage,
    metadata: {
      amplified: true,
      strategy: strategy.name,
      taskType: task.taskType,
      complexity: task.complexity,
      risk: task.risk,
      modelProfile: {
        coding: profile.coding,
        reasoning: profile.reasoning,
        planning: profile.planning
      },
      contextFiles: context && context.files ? context.files.length : 0,
      validationScore: evaluation ? evaluation.score : null,
      validationVerdict: evaluation ? evaluation.verdict : null,
      refinementIterations,
      timestamp: new Date().toISOString()
    }
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extrai keywords de um objeto TaskAnalysis para busca de contexto.
 *
 * @param {Object} task — Task analysis
 * @returns {string[]}
 */
function extractKeywordsFromTask(task) {
  const keywords = new Set();

  if (!task) return [];

  // Extrair do goal
  if (task.goal && typeof task.goal === 'string') {
    task.goal
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3)
      .forEach(w => keywords.add(w));
  }

  // Adicionar taskType
  if (task.taskType) {
    keywords.add(task.taskType);
  }

  // Extrair de constraints
  if (task.constraints && Array.isArray(task.constraints)) {
    task.constraints.forEach(c => {
      const parts = c.split(':');
      if (parts[1]) keywords.add(parts[1].toLowerCase());
    });
  }

  return [...keywords].slice(0, 10);
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  amplify,
  isAmplificationEnabled
};
