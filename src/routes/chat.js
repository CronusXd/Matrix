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

    // Non-streaming: call the provider
    const result = await provider.chat(task.messages, {
      apiKey: providerApiKey,
      model: task.model,
      temperature: task.config.temperature,
      max_tokens: task.config.max_tokens
    });

    const elapsed = Date.now() - startTime;
    logger.info({
      msg: 'Chat completion done',
      task_id: task.taskId,
      provider: task.provider,
      model: task.model,
      elapsed_ms: elapsed,
      tokens: result.usage
    });

    // Step 7: Format OpenAI-compatible response
    const response = formatCompletionResponse(task, result);
    return reply.send(response);

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
  // For a basic implementation, we simulate streaming by sending the full
  // response as chunks. Full streaming with provider-level SSE proxying
  // can be added later.
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

module.exports = chatCompletions;
