/**
 * Authentication Middleware
 *
 * Validates Matrix API keys from the Authorization header.
 * Format: "Bearer mx_..."
 * Attaches user context to the request on success.
 */

const apiKeyManager = require('../auth/api-key-manager');
const logger = require('../utils/logger');

/**
 * Fastify preHandler hook that validates the Matrix API key.
 *
 * Expects header: Authorization: Bearer mx_...
 * On success, attaches `req.userContext` with userId, keyId, etc.
 * On failure, returns 401 with a JSON error.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @param {Function} done
 */
async function authMiddleware(request, reply) {
  // Extract the Authorization header
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    logger.warn('Missing Authorization header');
    return reply.code(401).send({
      error: {
        message: 'Missing Authorization header. Use: Bearer mx_...',
        type: 'UNAUTHORIZED',
        code: 401
      }
    });
  }

  // Parse "Bearer <token>"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    logger.warn({ msg: 'Invalid Authorization format', header: authHeader.substring(0, 20) });
    return reply.code(401).send({
      error: {
        message: 'Invalid Authorization format. Use: Bearer mx_...',
        type: 'UNAUTHORIZED',
        code: 401
      }
    });
  }

  const rawKey = parts[1];

  try {
    const userContext = apiKeyManager.validateKey(rawKey);
    // Attach user context to request for downstream handlers
    request.userContext = userContext;
    logger.debug({ msg: 'Auth successful', user_id: userContext.userId, key_id: userContext.keyId });
  } catch (err) {
    logger.warn({ msg: 'Auth failed', error: err.message });
    return reply.code(err.statusCode || 401).send({
      error: {
        message: err.message,
        type: err.code || 'UNAUTHORIZED',
        code: err.statusCode || 401
      }
    });
  }
}

module.exports = authMiddleware;
