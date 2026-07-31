/**
 * GET /v1/models — OpenAI-compatible models listing endpoint
 *
 * Returns the list of available models for the authenticated user,
 * based on their configured provider.
 */

const { getProvider } = require('../providers');
const { getConfig, getProviderApiKey } = require('../db/configs');
const { formatModelsResponse } = require('../gateway/responder');
const logger = require('../utils/logger');

/**
 * GET /v1/models route handler.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
async function listModels(request, reply) {
  try {
    // Load user configuration
    const userConfig = getConfig(request.userContext.userId);
    const providerName = userConfig.provider || 'deepseek';

    // Get provider adapter
    const provider = getProvider(providerName);

    // Get provider API key (optional — some providers list models without auth)
    const apiKey = getProviderApiKey(request.userContext.userId);

    // Fetch models from the provider
    const models = await provider.models(apiKey);

    // Optionally merge in models from other supported providers
    // when user has multiple providers configured
    const allModels = [...models];

    logger.info({
      msg: 'Models listed',
      user_id: request.userContext.userId,
      provider: providerName,
      count: allModels.length
    });

    return reply.send(formatModelsResponse(allModels));

  } catch (err) {
    logger.errorObj(err, {
      context: 'listModels',
      user_id: request.userContext?.userId
    });

    const statusCode = err.statusCode || 500;
    return reply.code(statusCode).send({
      error: {
        message: err.message || 'Failed to list models',
        type: err.code || 'INTERNAL_ERROR',
        code: statusCode
      }
    });
  }
}

module.exports = listModels;
