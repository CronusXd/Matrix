/**
 * DeepSeek Provider Adapter
 *
 * Communicates with the DeepSeek API using OpenAI-compatible format.
 * Endpoint: https://api.deepseek.com/v1/chat/completions
 */

const { ProviderError, GatewayTimeoutError } = require('../utils/errors');
const { callProvider } = require('./_http');
const logger = require('../utils/logger');

const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';

const metadata = {
  displayName: 'DeepSeek',
  defaultModel: 'deepseek-chat',
  baseUrl: BASE_URL
};

/**
 * Send a chat completion request to DeepSeek.
 *
 * @param {Array<Object>} messages — Chat messages
 * @param {Object} params — { apiKey, model, temperature, max_tokens }
 * @returns {Promise<Object>} { content, usage: { prompt_tokens, completion_tokens } }
 */
async function chat(messages, params) {
  const {
    apiKey,
    model = 'deepseek-chat',
    temperature = 0.7,
    max_tokens = 4096
  } = params;

  const requestBody = {
    model,
    messages,
    temperature,
    max_tokens,
    stream: false
  };

  const response = await callProvider({
    url: `${BASE_URL}/v1/chat/completions`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: requestBody,
    provider: 'deepseek'
  });

  // Parse OpenAI-compatible response
  const data = JSON.parse(response.body);

  if (data.error) {
    throw new ProviderError(`DeepSeek API error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  const choice = data.choices && data.choices[0];
  if (!choice || !choice.message) {
    throw new ProviderError('DeepSeek returned an empty response');
  }

  return {
    content: choice.message.content || '',
    model: data.model || model,
    usage: {
      prompt_tokens: data.usage ? data.usage.prompt_tokens : 0,
      completion_tokens: data.usage ? data.usage.completion_tokens : 0,
      total_tokens: data.usage ? data.usage.total_tokens : 0
    }
  };
}

/**
 * List available DeepSeek models.
 *
 * @param {string} apiKey — Provider API key
 * @returns {Promise<Array<Object>>} Array of model objects
 */
async function models(apiKey) {
  try {
    const response = await callProvider({
      url: `${BASE_URL}/v1/models`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      provider: 'deepseek'
    });

    const data = JSON.parse(response.body);
    return (data.data || []).map(m => ({
      id: m.id,
      object: 'model',
      created: m.created || 0,
      owned_by: 'deepseek'
    }));
  } catch (err) {
    // Fallback: return known models if API call fails
    logger.warn({ msg: 'Failed to fetch DeepSeek models, using defaults', error: err.message });
    return [
      { id: 'deepseek-chat', object: 'model', created: 0, owned_by: 'deepseek' },
      { id: 'deepseek-reasoner', object: 'model', created: 0, owned_by: 'deepseek' }
    ];
  }
}

/**
 * Health check for the DeepSeek provider.
 *
 * @returns {Promise<boolean>}
 */
async function health() {
  try {
    // Simple connectivity check — don't require auth for health
    await callProvider({
      url: `${BASE_URL}/v1/models`,
      method: 'GET',
      timeout: 5000,
      provider: 'deepseek'
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = { chat, models, health, metadata };
