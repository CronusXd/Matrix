/**
 * Response Formatter
 *
 * Transforms internal provider results into OpenAI-compatible
 * chat/completions response format.
 *
 * Ensures every response follows the OpenAI API contract exactly.
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Format a provider result as an OpenAI-compatible chat/completions response.
 *
 * @param {Object} task — The internal Task that was executed
 * @param {Object} result — The provider's result { content, model, usage }
 * @returns {Object} OpenAI-compatible response
 */
function formatCompletionResponse(task, result) {
  const now = Math.floor(Date.now() / 1000);

  return {
    id: `chatcmpl-${task.taskId.substring(0, 8)}`,
    object: 'chat.completion',
    created: now,
    model: result.model || task.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: result.content
        },
        finish_reason: 'stop',
        logprobs: null
      }
    ],
    usage: {
      prompt_tokens: result.usage ? result.usage.prompt_tokens : 0,
      completion_tokens: result.usage ? result.usage.completion_tokens : 0,
      total_tokens: result.usage ? result.usage.total_tokens : 0
    },
    system_fingerprint: `fp_matrix_${task.provider}`
  };
}

/**
 * Format a streaming SSE chunk in OpenAI-compatible format.
 *
 * @param {string} taskId — The task ID
 * @param {string} model — Model name
 * @param {string} content — Content delta
 * @param {Object} usage — Optional usage info
 * @returns {string} SSE-formatted string
 */
function formatStreamChunk(taskId, model, content, usage = null) {
  const now = Math.floor(Date.now() / 1000);
  const chunkId = `chatcmpl-${taskId.substring(0, 8)}`;

  const delta = content !== null
    ? { role: 'assistant', content }
    : {};

  const chunk = {
    id: chunkId,
    object: 'chat.completion.chunk',
    created: now,
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: content === null ? 'stop' : null,
        logprobs: null
      }
    ]
  };

  if (usage) {
    chunk.usage = usage;
  }

  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/**
 * Format the final SSE stream termination marker.
 *
 * @returns {string}
 */
function formatStreamDone() {
  return 'data: [DONE]\n\n';
}

/**
 * Format an error response in OpenAI-compatible format.
 *
 * @param {string} message — Error message
 * @param {string} type — Error type code
 * @param {number} code — HTTP status code
 * @returns {Object}
 */
function formatErrorResponse(message, type, code) {
  return {
    error: {
      message,
      type,
      code
    }
  };
}

/**
 * Format the /v1/models response in OpenAI-compatible format.
 *
 * @param {Array<Object>} models — Array of model objects
 * @returns {Object}
 */
function formatModelsResponse(models) {
  return {
    object: 'list',
    data: models.map(m => ({
      id: m.id,
      object: m.object || 'model',
      created: m.created || 0,
      owned_by: m.owned_by || 'matrix'
    }))
  };
}

module.exports = {
  formatCompletionResponse,
  formatStreamChunk,
  formatStreamDone,
  formatErrorResponse,
  formatModelsResponse
};
