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

    /** The user's configured provider — always takes priority over request hints */
    provider: userConfig.provider || request.provider || 'deepseek',

    /** The model to use (user config > request override > provider default) */
    model: mapModelName(request.model, userConfig.provider || request.provider || 'deepseek') || userConfig.model || 'deepseek-chat',

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

/**
 * Map OpenCode model names to the actual provider model names.
 * OpenCode uses prefixed names like oc/deepseek-v4-flash-free,
 * but providers expect their native model IDs.
 *
 * @param {string} requestModel - Model name from the request
 * @param {string} provider - Target provider (deepseek, openai, anthropic, openrouter)
 * @returns {string} Mapped model name for the provider
 */
function mapModelName(requestModel, provider) {
  if (!requestModel || typeof requestModel !== 'string') return requestModel;

  const model = requestModel.toLowerCase();
  
  // If model already matches provider's native format, return as-is
  // (e.g., "deepseek-chat", "gpt-4o", "claude-sonnet-4-20250514")
  if (!model.includes('/')) return requestModel;

  // ── OpenCode-prefixed models ──────────────────────────────────
  // oc/ = OpenCode (DeepSeek models proxied through OpenCode)
  // ag/ = Anthropic/Google
  // gc/ = Google Cloud
  
  const mappings = {
    // DeepSeek models
    'oc/deepseek-v4-flash-free': { deepseek: 'deepseek-chat', openrouter: 'deepseek/deepseek-chat' },
    'oc/deepseek-v4-pro': { deepseek: 'deepseek-chat', openrouter: 'deepseek/deepseek-chat' },
    
    // Claude models
    'ag/claude-sonnet-4-6': { anthropic: 'claude-sonnet-4-20250514' },
    'kr/claude-sonnet-4.5-thinking-agentic': { anthropic: 'claude-sonnet-4-20250514' },
    'ag/claude-opus-4-20250514': { anthropic: 'claude-opus-4-20250514' },
    
    // Gemini models
    'gc/gemini-2.5-flash': { openrouter: 'google/gemini-2.5-flash' },
    
    // OpenAI models
    'oc/gpt-4o': { openai: 'gpt-4o' },
    'oc/gpt-4o-mini': { openai: 'gpt-4o-mini' }
  };

  // Exact match
  if (mappings[requestModel] && mappings[requestModel][provider]) {
    return mappings[requestModel][provider];
  }

  // Case-insensitive exact match
  const lowerMappings = {};
  for (const [key, map] of Object.entries(mappings)) {
    lowerMappings[key.toLowerCase()] = map;
  }
  if (lowerMappings[model] && lowerMappings[model][provider]) {
    return lowerMappings[model][provider];
  }

  // Partial match: try to find a mapping for the model part
  for (const [key, map] of Object.entries(mappings)) {
    const modelPart = key.split('/')[1];
    if (modelPart && model.includes(modelPart)) {
      if (map[provider]) return map[provider];
    }
  }

  // Fallback: if the model has a prefix like oc/, strip it and use the rest
  const slashIdx = requestModel.indexOf('/');
  if (slashIdx > 0 && slashIdx < 10) {
    const bareModel = requestModel.substring(slashIdx + 1);
    // If the bare name looks like a valid model name, use it
    if (bareModel.length > 3) return bareModel;
  }

  // Last resort: return original model name
  return requestModel;
}

module.exports = { normalize, mapModelName };
