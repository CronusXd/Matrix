/**
 * OpenAI Provider Adapter
 *
 * Communicates with the OpenAI API.
 * Endpoint: https://api.openai.com/v1/chat/completions
 */

const { ProviderError } = require('../utils/errors');
const { callProvider } = require('./_http');
const logger = require('../utils/logger');

const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com';

const metadata = {
  displayName: 'OpenAI',
  defaultModel: 'gpt-4o',
  baseUrl: BASE_URL
};

/**
 * Send a chat completion request to OpenAI.
 *
 * @param {Array<Object>} messages — Chat messages
 * @param {Object} params — { apiKey, model, temperature, max_tokens }
 * @returns {Promise<Object>} { content, usage: { prompt_tokens, completion_tokens } }
 */
async function chat(messages, params) {
  const {
    apiKey,
    model = 'gpt-4o',
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
    provider: 'openai'
  });

  const data = JSON.parse(response.body);

  if (data.error) {
    throw new ProviderError(`OpenAI API error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  const choice = data.choices && data.choices[0];
  if (!choice || !choice.message) {
    throw new ProviderError('OpenAI returned an empty response');
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
 * List available OpenAI models.
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
      provider: 'openai'
    });

    const data = JSON.parse(response.body);
    return (data.data || []).map(m => ({
      id: m.id,
      object: 'model',
      created: m.created || 0,
      owned_by: m.owned_by || 'openai'
    }));
  } catch (err) {
    logger.warn({ msg: 'Failed to fetch OpenAI models, using defaults', error: err.message });
    return [
      { id: 'gpt-4o', object: 'model', created: 0, owned_by: 'openai' },
      { id: 'gpt-4o-mini', object: 'model', created: 0, owned_by: 'openai' },
      { id: 'gpt-4-turbo', object: 'model', created: 0, owned_by: 'openai' }
    ];
  }
}

/**
 * Health check for the OpenAI provider.
 *
 * @returns {Promise<boolean>}
 */
async function health() {
  try {
    await callProvider({
      url: `${BASE_URL}/v1/models`,
      method: 'GET',
      timeout: 5000,
      provider: 'openai'
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = { chat, models, health, metadata };
