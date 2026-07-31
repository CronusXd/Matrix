/**
 * OpenRouter Provider Adapter
 *
 * Communicates with the OpenRouter API (OpenAI-compatible format).
 * Endpoint: https://openrouter.ai/api/v1/chat/completions
 *
 * OpenRouter provides access to many models from different providers
 * through a single API key.
 */

const { ProviderError } = require('../utils/errors');
const { callProvider } = require('./_http');
const logger = require('../utils/logger');

const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api';

const metadata = {
  displayName: 'OpenRouter',
  defaultModel: 'openai/gpt-4o',
  baseUrl: BASE_URL
};

/**
 * Send a chat completion request to OpenRouter.
 *
 * @param {Array<Object>} messages — Chat messages
 * @param {Object} params — { apiKey, model, temperature, max_tokens }
 * @returns {Promise<Object>} { content, usage: { prompt_tokens, completion_tokens } }
 */
async function chat(messages, params) {
  const {
    apiKey,
    model = 'openai/gpt-4o',
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
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://matrix.local',
      'X-Title': 'Matrix Gateway'
    },
    body: requestBody,
    provider: 'openrouter'
  });

  const data = JSON.parse(response.body);

  if (data.error) {
    throw new ProviderError(
      `OpenRouter API error: ${data.error.message || JSON.stringify(data.error)}`
    );
  }

  const choice = data.choices && data.choices[0];
  if (!choice || !choice.message) {
    throw new ProviderError('OpenRouter returned an empty response');
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
 * List available OpenRouter models.
 *
 * @param {string} apiKey — Provider API key
 * @returns {Promise<Array<Object>>}
 */
async function models(apiKey) {
  try {
    const response = await callProvider({
      url: `${BASE_URL}/v1/models`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      provider: 'openrouter'
    });

    const data = JSON.parse(response.body);
    return (data.data || []).map(m => ({
      id: m.id,
      object: 'model',
      created: m.created || 0,
      owned_by: m.id ? m.id.split('/')[0] : 'openrouter'
    }));
  } catch (err) {
    logger.warn({ msg: 'Failed to fetch OpenRouter models, using defaults', error: err.message });
    return [
      { id: 'openai/gpt-4o', object: 'model', created: 0, owned_by: 'openai' },
      { id: 'anthropic/claude-sonnet-4', object: 'model', created: 0, owned_by: 'anthropic' },
      { id: 'deepseek/deepseek-chat', object: 'model', created: 0, owned_by: 'deepseek' },
      { id: 'google/gemini-pro', object: 'model', created: 0, owned_by: 'google' }
    ];
  }
}

/**
 * Health check for the OpenRouter provider.
 *
 * @returns {Promise<boolean>}
 */
async function health() {
  try {
    await callProvider({
      url: `${BASE_URL}/v1/models`,
      method: 'GET',
      timeout: 5000,
      provider: 'openrouter'
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = { chat, models, health, metadata };
