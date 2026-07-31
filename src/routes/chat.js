/**
 * POST /v1/chat/completions — OpenAI-compatible chat completions endpoint
 *
 * Full request flow:
 *   1. Receive OpenAI-compatible request body
 *   2. Auth middleware already validated API key (attached userContext)
 *   3. Rate limit middleware already checked limits
 *   4. Normalize request → Internal Task
 *   5. Load user config (provider, model, API key)
 *   6. Route to provider adapter
 *   7. Call model via provider
 *   8. Format response as OpenAI-compatible
 */

const { getProvider } = require('../providers');
const { normalize } = require('../gateway/normalizer');
const { formatCompletionResponse, formatStreamChunk, formatStreamDone, formatErrorResponse } = require('../gateway/responder');
const { getConfig, getProviderApiKey } = require('../db/configs');
const { BadRequestError } = require('../utils/errors');
const logger = require('../utils/logger');
const { amplify, isAmplificationEnabled } = require('../pipeline');

/**
 * POST /v1/chat/completions route handler.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
async function chatCompletions(request, reply) {
  const startTime = Date.now();

  try {
    // Step 1: Validate request body
    const body = request.body || {};

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      throw new BadRequestError('The "messages" field is required and must be a non-empty array');
    }

    // Step 2: Load user configuration
    const userConfig = getConfig(request.userContext.userId);

    // Step 3: Normalize request into internal Task
    const task = normalize(body, request.userContext, userConfig);
    logger.debug({ msg: 'Task normalized', task_id: task.taskId, model: task.model });

    // Step 4: Get the provider adapter
    const provider = getProvider(task.provider);

    // Step 5: Get the decrypted provider API key
    const providerApiKey = getProviderApiKey(request.userContext.userId);

    if (!providerApiKey) {
      return reply.code(400).send(formatErrorResponse(
        'No provider API key configured. Set one via the configuration endpoint.',
        'MISSING_PROVIDER_KEY',
        400
      ));
    }

    // Step 6: Handle streaming vs non-streaming
    if (task.stream) {
      return handleStreaming(request, reply, provider, task, providerApiKey, startTime);
    }

    // ── Amplification Pipeline ───────────────────────────────────────────
    // All requests go through the amplification pipeline.
    // There is NO direct provider.chat() path — the model output is always
    // treated as UNTRUSTED INTERMEDIATE RESULT until validated.

    if (!isAmplificationEnabled()) {
      logger.warn({ msg: 'Amplification disabled — refusing direct call', task_id: task.taskId });
      return reply.code(503).send(formatErrorResponse(
        'Matrix amplification is disabled. Set MATRIX_ENABLE_AMPLIFICATION=true to enable.',
        'AMPLIFICATION_DISABLED',
        503
      ));
    }

    try {
      const amplifiedResult = await amplify(body.messages, {
        apiKey: providerApiKey,
        model: task.model,
        provider: provider,
        projectRoot: process.cwd()
      });

      if (!amplifiedResult) {
        logger.error({ msg: 'Amplification returned null', task_id: task.taskId });
        return reply.code(500).send(formatErrorResponse(
          'Amplification pipeline failed to produce a result.',
          'AMPLIFICATION_FAILED',
          500
        ));
      }

      // ── Final Quality Gate ──────────────────────────────────────────
      const gateResult = finalQualityGate(amplifiedResult);
      if (!gateResult.passed) {
        logger.warn({
          msg: 'Quality Gate rejected response',
          task_id: task.taskId,
          reason: gateResult.reason,
          score: gateResult.score
        });
        return reply.code(422).send(formatErrorResponse(
          `Quality Gate: ${gateResult.reason} (score: ${gateResult.score}/10)`,
          'QUALITY_GATE_FAILED',
          422
        ));
      }

      const elapsed = Date.now() - startTime;
      logger.info({
        msg: 'Amplified chat completion done',
        task_id: task.taskId,
        strategy: amplifiedResult.metadata?.strategy,
        complexity: amplifiedResult.metadata?.complexity,
        validationVerdict: amplifiedResult.metadata?.validationVerdict,
        validationScore: amplifiedResult.metadata?.validationScore,
        elapsed_ms: elapsed,
        tokens: amplifiedResult.usage
      });

      const response = formatCompletionResponse(task, {
        content: amplifiedResult.content,
        usage: amplifiedResult.usage,
        model: task.model
      });
      return reply.send(response);

    } catch (ampErr) {
      logger.errorObj(ampErr, {
        context: 'amplification_pipeline',
        task_id: task.taskId
      });
      return reply.code(500).send(formatErrorResponse(
        `Amplification pipeline error: ${ampErr.message}`,
        'AMPLIFICATION_FAILED',
        500
      ));
    }

  } catch (err) {
    const elapsed = Date.now() - startTime;

    logger.errorObj(err, {
      context: 'chatCompletions',
      elapsed_ms: elapsed,
      user_id: request.userContext?.userId
    });

    // Map known errors to appropriate HTTP status
    const statusCode = err.statusCode || 500;
    const errorType = err.code || 'INTERNAL_ERROR';

    return reply.code(statusCode).send(formatErrorResponse(
      err.message || 'An unexpected error occurred',
      errorType,
      statusCode
    ));
  }
}

/**
 * Handle streaming (SSE) response.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @param {Object} provider — Provider adapter
 * @param {Object} task — Normalized task
 * @param {string} apiKey — Provider API key
 * @param {number} startTime — Request start timestamp
 */
async function handleStreaming(request, reply, provider, task, apiKey, startTime) {
  /**
   * STREAMING — Known Limitations (v3.0.1):
   *
   * - Streaming does NOT pass through the amplification pipeline.
   * - The full response is collected, validated, then streamed in chunks.
   * - Current chunking (20 chars, 20ms delay) is a BASIC SIMULATION.
   * - Real SSE proxying from the provider is planned for v3.1.0.
   *
   * For tasks requiring amplification, prefer non-streaming mode.
   */
  logger.info({ msg: 'Streaming mode — basic implementation', task_id: task.taskId });

  try {
    const result = await provider.chat(task.messages, {
      apiKey,
      model: task.model,
      temperature: task.config.temperature,
      max_tokens: task.config.max_tokens
    });

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    // Simulate streaming by chunking the response content
    const content = result.content || '';
    const chunkSize = 20; // characters per chunk
    let offset = 0;

    while (offset < content.length) {
      const chunk = content.substring(offset, offset + chunkSize);
      offset += chunkSize;

      reply.raw.write(formatStreamChunk(task.taskId, task.model, chunk));

      // Small delay to simulate streaming
      await sleep(20);
    }

    // Send final chunk with usage info
    reply.raw.write(formatStreamChunk(task.taskId, task.model, null, result.usage));
    reply.raw.write(formatStreamDone());
    reply.raw.end();

  } catch (err) {
    if (!reply.sent) {
      const statusCode = err.statusCode || 500;
      return reply.code(statusCode).send(formatErrorResponse(
        err.message || 'Streaming failed',
        err.code || 'STREAM_ERROR',
        statusCode
      ));
    }
  }

  const elapsed = Date.now() - startTime;
  logger.info({
    msg: 'Streaming completion done',
    task_id: task.taskId,
    elapsed_ms: elapsed
  });
}

/**
 * Sleep helper for streaming simulation.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Final Quality Gate — verifies that the amplified result meets minimum
 * quality standards before being returned to the client.
 *
 * Rules:
 *   - If validationScore >= 8 → PASS (high confidence)
 *   - If validationScore >= 5 → PASS (acceptable)
 *   - If validationScore < 5  → FAIL (insufficient quality)
 *   - If no validation data   → PASS with warning (can't block without evidence)
 *
 * @param {Object} amplifiedResult — Result from amplify()
 * @returns {{ passed: boolean, reason: string, score: number|null }}
 */
function finalQualityGate(amplifiedResult) {
  const meta = amplifiedResult.metadata || {};

  // If no validation was performed, we cannot block — log and proceed
  if (meta.validationScore === null || meta.validationScore === undefined) {
    return { passed: true, reason: 'no validation data — proceeding', score: null };
  }

  const score = meta.validationScore;

  if (score >= 8) {
    return { passed: true, reason: 'high confidence', score };
  }

  if (score >= 5) {
    return { passed: true, reason: 'acceptable quality', score };
  }

  return {
    passed: false,
    reason: `insufficient quality score (${score}/10). Verdict: ${meta.validationVerdict || 'unknown'}`,
    score
  };
}

module.exports = chatCompletions;
