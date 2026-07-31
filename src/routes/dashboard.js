/**
 * Dashboard API Routes
 *
 * Provides endpoints for the Matrix Dashboard UI:
 *   GET  /api/keys       — List API keys for authenticated user
 *   POST /api/keys       — Generate new API key
 *   DELETE /api/keys/:id — Revoke an API key
 *   GET  /api/config     — Get user configuration
 *   PUT  /api/config     — Update user configuration
 *   GET  /api/usage      — Get usage statistics
 *   GET  /api/status     — Get system status
 */

const apiKeyManager = require('../auth/api-key-manager');
const { getConfig, updateConfig } = require('../db/configs');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * GET /api/keys — List API keys for authenticated user
 */
async function listKeys(request, reply) {
  try {
    const keys = apiKeyManager.listKeys(request.userContext.userId);
    return reply.send({ keys });
  } catch (err) {
    logger.errorObj(err, { context: 'listKeys' });
    return reply.code(500).send({ error: { message: err.message } });
  }
}

/**
 * POST /api/keys — Generate a new API key
 */
async function createKey(request, reply) {
  try {
    const { name, expiresInDays } = request.body || {};
    const { rawKey, record } = apiKeyManager.generateKey({
      userId: request.userContext.userId,
      name: name || 'Dashboard-generated key',
      expiresInDays: expiresInDays || null
    });

    // Return raw key once — user must save it
    return reply.code(201).send({
      key: {
        id: record.id,
        prefix: record.key_prefix,
        name: record.name,
        rawKey: rawKey,  // Only time the raw key is shown
        createdAt: record.created_at,
        expiresAt: record.expires_at
      },
      warning: 'Save this key now. It will not be shown again.'
    });
  } catch (err) {
    logger.errorObj(err, { context: 'createKey' });
    return reply.code(500).send({ error: { message: err.message } });
  }
}

/**
 * DELETE /api/keys/:id — Revoke an API key
 */
async function revokeKey(request, reply) {
  try {
    const { id } = request.params;
    apiKeyManager.revokeKey(id);
    return reply.send({ success: true, message: 'Key revoked' });
  } catch (err) {
    logger.errorObj(err, { context: 'revokeKey' });
    return reply.code(err.statusCode || 500).send({ error: { message: err.message } });
  }
}

/**
 * GET /api/config — Get user configuration
 */
async function getUserConfig(request, reply) {
  try {
    const cfg = getConfig(request.userContext.userId);
    // NEVER return encrypted API key to client
    return reply.send({
      provider: cfg.provider,
      model: cfg.model,
      maxTokens: cfg.max_tokens,
      temperature: cfg.temperature,
      hasProviderKey: !!cfg.api_key_encrypted,
      createdAt: cfg.created_at,
      updatedAt: cfg.updated_at
    });
  } catch (err) {
    logger.errorObj(err, { context: 'getUserConfig' });
    return reply.code(500).send({ error: { message: err.message } });
  }
}

/**
 * PUT /api/config — Update user configuration
 */
async function updateUserConfig(request, reply) {
  try {
    const { provider, model, apiKey, maxTokens, temperature } = request.body || {};
    const cfg = updateConfig(request.userContext.userId, {
      provider,
      model,
      api_key: apiKey,  // Will be encrypted before storage
      max_tokens: maxTokens,
      temperature
    });

    return reply.send({
      provider: cfg.provider,
      model: cfg.model,
      maxTokens: cfg.max_tokens,
      temperature: cfg.temperature,
      hasProviderKey: !!cfg.api_key_encrypted,
      updatedAt: cfg.updated_at
    });
  } catch (err) {
    logger.errorObj(err, { context: 'updateUserConfig' });
    return reply.code(500).send({ error: { message: err.message } });
  }
}

/**
 * GET /api/usage — Get usage statistics (placeholder)
 * Will be enhanced with real metrics in Phase 9-10.
 */
async function getUsage(request, reply) {
  try {
    // Placeholder — real metrics will come from observability
    return reply.send({
      totalRequests: 0,
      totalTokens: 0,
      totalCost: 0,
      averageLatency: 0,
      amplificationScore: 0,
      gapReduction: 0,
      lastUpdated: new Date().toISOString()
    });
  } catch (err) {
    logger.errorObj(err, { context: 'getUsage' });
    return reply.code(500).send({ error: { message: err.message } });
  }
}

/**
 * GET /api/status — Get system status
 */
async function getStatus(request, reply) {
  try {
    return reply.send({
      status: 'ok',
      version: '3.0.0',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      nodeVersion: process.version,
      platform: process.platform,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.errorObj(err, { context: 'getStatus' });
    return reply.code(500).send({ error: { message: err.message } });
  }
}

module.exports = {
  listKeys,
  createKey,
  revokeKey,
  getUserConfig,
  updateUserConfig,
  getUsage,
  getStatus
};
