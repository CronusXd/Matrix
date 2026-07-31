/**
 * Matrix Provider Adapter Bridge
 * ==============================
 * Unifies the protocol provider.call() (used by the amplification pipeline)
 * with provider.chat() (used by the real provider adapters).
 *
 * This bridge allows the amplification pipeline to treat any provider
 * uniformly — regardless of its internal implementation details.
 *
 * CommonJS module. Zero additional npm dependencies.
 *
 * @version 1.0.0
 */

'use strict';

// ---------------------------------------------------------------------------
// Main API: createAdapter
// ---------------------------------------------------------------------------

/**
 * Create an adapter that wraps a real provider for use with the
 * amplification pipeline.
 *
 * The adapter normalizes two input formats into the provider.chat() interface:
 *   1. String → [{ role: 'user', content: input }]
 *   2. { system, user } → [{ role: 'system', content: system }, { role: 'user', content: user }]
 *
 * @param {Object} provider — A real provider with `.chat(messages, params)` method
 * @param {Object} params — { apiKey, model, temperature, max_tokens }
 * @returns {Object} Adapter with .call(), .models(), .health()
 */
function createAdapter(provider, params) {
  if (!provider) {
    throw new Error('Provider is required to create an adapter');
  }
  if (typeof provider.chat !== 'function') {
    throw new Error('Provider must have a chat() method');
  }

  const normalizedParams = normalizeParams(params);

  /**
   * Call the provider with an input string or structured {system, user} object.
   *
   * @param {string|{ system: string, user: string }} input
   * @returns {Promise<{ content: string, usage: Object, model: string, metadata: Object }>}
   */
  async function call(input) {
    const messages = buildMessages(input);

    try {
      const result = await provider.chat(messages, normalizedParams);
      return normalizeResult(result, normalizedParams);
    } catch (err) {
      throw wrapError(err, 'adapter');
    }
  }

  /**
   * List available models via the provider.
   * Preserves the original provider's models() interface.
   *
   * @param {string} [apiKey]
   * @returns {Promise<Array>}
   */
  async function models(apiKey) {
    if (typeof provider.models === 'function') {
      try {
        return await provider.models(apiKey || normalizedParams.apiKey);
      } catch (err) {
        throw wrapError(err, 'adapter.models');
      }
    }
    return [];
  }

  /**
   * Health check via the provider.
   * Preserves the original provider's health() interface.
   *
   * @returns {Promise<boolean>}
   */
  async function health() {
    if (typeof provider.health === 'function') {
      try {
        return await provider.health();
      } catch {
        return false;
      }
    }
    return true; // no health check → assume healthy
  }

  return {
    call,
    models,
    health,

    // Expose for introspection
    _provider: provider,
    _params: normalizedParams
  };
}

// ---------------------------------------------------------------------------
// Message Building
// ---------------------------------------------------------------------------

/**
 * Convert adapter input to provider-compatible messages array.
 *
 * @param {string|{ system?: string, user?: string, messages?: Array }} input
 * @returns {Array<{ role: string, content: string }>}
 */
function buildMessages(input) {
  // Case 1: String input
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }];
  }

  // Case 2: { system, user } object
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    // Check for structured {system, user}
    const hasSystem = typeof input.system === 'string';
    const hasUser = typeof input.user === 'string';

    if (hasSystem || hasUser) {
      const messages = [];
      if (hasSystem && input.system.trim().length > 0) {
        messages.push({ role: 'system', content: input.system });
      }
      if (hasUser) {
        messages.push({ role: 'user', content: input.user });
      }
      if (messages.length > 0) return messages;
    }

    // Check for pre-built messages array
    if (Array.isArray(input.messages) && input.messages.length > 0) {
      return input.messages.map(m => ({
        role: m.role || 'user',
        content: typeof m.content === 'string' ? m.content : String(m.content || '')
      }));
    }

    // Fallback: stringify the object
    return [{ role: 'user', content: JSON.stringify(input) }];
  }

  // Case 3: Array (assume it's already messages array)
  if (Array.isArray(input)) {
    return input.map(m => ({
      role: m.role || 'user',
      content: typeof m.content === 'string' ? m.content : String(m.content || '')
    }));
  }

  // Fallback for anything else
  return [{ role: 'user', content: String(input || '') }];
}

// ---------------------------------------------------------------------------
// Parameter Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize and apply defaults to provider parameters.
 *
 * @param {Object} params — { apiKey, model, temperature, max_tokens }
 * @returns {Object}
 */
function normalizeParams(params) {
  return {
    apiKey: params.apiKey || '',
    model: params.model || 'deepseek-chat',
    temperature: params.temperature !== undefined ? params.temperature : 0.7,
    max_tokens: params.max_tokens !== undefined ? params.max_tokens : 4096
  };
}

// ---------------------------------------------------------------------------
// Result Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize provider result to a consistent shape expected by the pipeline.
 *
 * @param {Object} result — Raw provider result
 * @param {Object} params — The normalized params used for the call
 * @returns {{ content: string, usage: Object, model: string, metadata: Object }}
 */
function normalizeResult(result, params) {
  const usage = result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  return {
    content: result.content || '',
    usage: {
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || 0
    },
    model: result.model || params.model || 'unknown',
    metadata: {
      provider: params.model ? params.model.split('/')[0] : 'unknown',
      adapterVersion: '1.0.0'
    }
  };
}

// ---------------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------------

/**
 * Wrap provider errors with a clear prefix.
 * Ensures any error from provider.chat() or adapter logic is propagated
 * with an identifiable source label.
 *
 * @param {Error} err — Original error
 * @param {string} source — Error source label
 * @returns {Error}
 */
function wrapError(err, source) {
  if (!err) {
    return new Error(`[Matrix Adapter] Unknown error in ${source}`);
  }

  // Already wrapped
  if (err.message && err.message.startsWith('[Matrix Adapter]')) {
    return err;
  }

  const message = err.message || 'Unknown provider error';
  const wrapped = new Error(`[Matrix Adapter] ${message} (source: ${source})`);

  // Preserve original error chain
  wrapped.originalError = err;
  wrapped.statusCode = err.statusCode;
  wrapped.code = err.code;
  wrapped.responseStatus = err.responseStatus;
  wrapped.responseBody = err.responseBody;

  return wrapped;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  createAdapter,
  buildMessages,
  normalizeParams,
  normalizeResult,
  wrapError
};
