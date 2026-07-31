/**
 * Anthropic Provider Adapter
 *
 * Communicates with the Anthropic Messages API.
 * Endpoint: https://api.anthropic.com/v1/messages
 *
 * Note: Anthropic uses a different request/response format than OpenAI.
 * This adapter translates between the OpenAI-compatible message format
 * and Anthropic's native format.
 */

const { ProviderError } = require('../utils/errors');
const { callProvider } = require('./_http');
const logger = require('../utils/logger');

const BASE_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';

const metadata = {
  displayName: 'Anthropic',
  defaultModel: 'claude-sonnet-4-20250514',
  baseUrl: BASE_URL
};

/**
 * Convert OpenAI-compatible messages to Anthropic format.
 * Anthropic requires: system prompt separate, messages alternating user/assistant.
 *
 * @param {Array<Object>} messages — OpenAI-compatible messages
 * @returns {{ system: string|null, messages: Array<Object> }}
 */
function convertMessages(messages) {
  let system = null;
  const converted = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system ? system + '\n' : '') + msg.content;
    } else if (msg.role === 'user') {
      converted.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      converted.push({ role: 'assistant', content: msg.content });
    }
    // Ignore other roles (function, tool, etc.)
  }

  return { system, messages: converted };
}

/**
 * Send a chat completion request to Anthropic.
 *
 * @param {Array<Object>} messages — OpenAI-compatible messages
 * @param {Object} params — { apiKey, model, temperature, max_tokens }
 * @returns {Promise<Object>} { content, usage: { prompt_tokens, completion_tokens } }
 */
async function chat(messages, params) {
  const {
    apiKey,
    model = 'claude-sonnet-4-20250514',
    temperature = 0.7,
    max_tokens = 4096
  } = params;

  const { system, messages: converted } = convertMessages(messages);

  if (converted.length === 0) {
    throw new ProviderError('No valid user/assistant messages for Anthropic');
  }

  const requestBody = {
    model,
    messages: converted,
    max_tokens,
    temperature,
    stream: false
  };

  if (system) {
    requestBody.system = system;
  }

  const response = await callProvider({
    url: `${BASE_URL}/v1/messages`,
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json'
    },
    body: requestBody,
    provider: 'anthropic'
  });

  const data = JSON.parse(response.body);

  if (data.error) {
    throw new ProviderError(
      `Anthropic API error: ${data.error.message || JSON.stringify(data.error)}`
    );
  }

  // Anthropic response has content blocks; extract text
  const textContent = (data.content || [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  return {
    content: textContent,
    model: data.model || model,
    usage: {
      prompt_tokens: data.usage ? data.usage.input_tokens : 0,
      completion_tokens: data.usage ? data.usage.output_tokens : 0,
      total_tokens: data.usage
        ? (data.usage.input_tokens + data.usage.output_tokens)
        : 0
    }
  };
}

/**
 * List known Anthropic models (no public models endpoint).
 *
 * @returns {Promise<Array<Object>>}
 */
async function models() {
  // Anthropic doesn't have a public models API; return known models
  return [
    { id: 'claude-sonnet-4-20250514', object: 'model', created: 0, owned_by: 'anthropic' },
    { id: 'claude-opus-4-20250514', object: 'model', created: 0, owned_by: 'anthropic' },
    { id: 'claude-3-5-sonnet-20241022', object: 'model', created: 0, owned_by: 'anthropic' },
    { id: 'claude-3-5-haiku-20241022', object: 'model', created: 0, owned_by: 'anthropic' }
  ];
}

/**
 * Health check for the Anthropic provider.
 *
 * @returns {Promise<boolean>}
 */
async function health() {
  try {
    await callProvider({
      url: `${BASE_URL}/v1/messages`,
      method: 'POST',
      headers: {
        'x-api-key': 'health-check',
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json'
      },
      body: { model: 'claude-3-5-haiku-20241022', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] },
      timeout: 5000,
      provider: 'anthropic'
    });
    return true;
  } catch (err) {
    // For health checks, consider any response (even auth errors) as "reachable"
    if (err.responseStatus && err.responseStatus < 500) return true;
    return false;
  }
}

module.exports = { chat, models, health, metadata };
