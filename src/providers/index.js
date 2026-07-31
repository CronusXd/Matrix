/**
 * Provider Factory
 *
 * Selects and returns the appropriate provider adapter based on name.
 * Validates that the requested provider is supported.
 */

const deepseek = require('./deepseek');
const openai = require('./openai');
const anthropic = require('./anthropic');
const openrouter = require('./openrouter');

const { BadRequestError } = require('../utils/errors');

/** Registry of all supported providers */
const providers = {
  deepseek,
  openai,
  anthropic,
  openrouter
};

/**
 * Get a provider adapter by name.
 *
 * @param {string} name — Provider name (case-insensitive)
 * @returns {Object} The provider adapter
 * @throws {BadRequestError} If the provider is not supported
 */
function getProvider(name) {
  const key = (name || '').toLowerCase();

  if (!providers[key]) {
    throw new BadRequestError(
      `Unsupported provider: "${name}". Supported: ${Object.keys(providers).join(', ')}`,
      'UNSUPPORTED_PROVIDER'
    );
  }

  return providers[key];
}

/**
 * List all supported providers with their metadata.
 *
 * @returns {Array<{ name: string }>}
 */
function listProviders() {
  return Object.keys(providers).map(name => ({
    name,
    ...providers[name].metadata
  }));
}

module.exports = { getProvider, listProviders, providers };
