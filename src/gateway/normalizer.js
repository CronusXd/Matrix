/**
 * Request Normalizer
 *
 * Transforms an OpenAI-compatible chat/completions request
 * into the internal Task representation used by the Matrix pipeline.
 *
 * This is the boundary between the external API contract (OpenAI)
 * and the internal representation that flows through providers.
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Normalize an OpenAI-compatible chat/completions request.
 *
 * @param {Object} request — The raw request body
 * @param {Object} userContext — { userId, keyId, userName, userEmail }
 * @param {Object} userConfig — { provider, model, max_tokens, temperature }
 * @returns {Object} Internal Task representation
 */
function normalize(request, userContext, userConfig) {
  const now = new Date().toISOString();

  const task = {
    /** Unique task identifier */
    taskId: uuidv4(),

    /** Authenticated user ID from API key validation */
    userId: userContext.userId,

    /** The user's configured provider (can be overridden per request) */
    provider: request.provider || userConfig.provider || 'deepseek',

    /** The model to use (request override > user config > provider default) */
    model: request.model || userConfig.model || 'deepseek-chat',

    /** Chat messages in OpenAI format */
    messages: normalizeMessages(request.messages || []),

    /** Generation parameters */
    config: {
      temperature: request.temperature !== undefined
        ? Math.max(0, Math.min(2, request.temperature))
        : (userConfig.temperature || 0.7),

      max_tokens: request.max_tokens !== undefined
        ? Math.max(1, request.max_tokens)
        : (userConfig.max_tokens || 4096),

      top_p: request.top_p !== undefined
        ? Math.max(0, Math.min(1, request.top_p))
        : undefined
    },

    /** Whether to stream the response */
    stream: request.stream === true,

    /** Request metadata */
    metadata: {
      timestamp: now,
      source: 'api',
      keyId: userContext.keyId,
      keyName: userContext.keyName
    }
  };

  return task;
}

/**
 * Normalize and validate the messages array.
 * Ensures each message has the required role and content fields.
 *
 * @param {Array} messages — Raw messages from request
 * @returns {Array<Object>} Validated messages
 */
function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [{ role: 'user', content: 'Hello' }];
  }

  return messages.map((msg, idx) => {
    const role = msg.role || 'user';

    // Handle content that might be an array (multimodal) or string
    let content = msg.content;
    if (typeof content === 'string') {
      // OK as-is
    } else if (Array.isArray(content)) {
      // Multimodal content — keep as-is for provider to handle
    } else if (content === null || content === undefined) {
      content = '';
    } else {
      content = String(content);
    }

    return {
      role,
      content,
      ...(msg.name ? { name: msg.name } : {})
    };
  });
}

module.exports = { normalize };
