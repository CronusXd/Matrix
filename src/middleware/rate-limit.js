/**
 * Rate Limiting Middleware
 *
 * Limits the number of requests per time window per API key.
 * Uses Fastify's built-in rate limiting when available,
 * or falls back to a simple in-memory implementation.
 */

const config = require('../config');
const logger = require('../utils/logger');

/**
 * In-memory rate limiter store.
 * Tracks request counts per API key prefix within a rolling window.
 *
 * For production, replace with a Redis-backed store.
 */
const store = new Map();

/**
 * Clean up expired entries periodically.
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.resetTime > 0) {
      store.delete(key);
    }
  }
}, config.rateLimit.windowMs).unref();

/**
 * Rate limit middleware using in-memory tracking.
 *
 * Identifies users by their API key prefix (first 8 chars).
 * Returns 429 with Retry-After header when limit exceeded.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @param {Function} done
 */
async function rateLimitMiddleware(request, reply) {
  // Use the authenticated user's key prefix, or fall back to IP
  const identifier = request.userContext
    ? `key:${request.userContext.keyId}`
    : `ip:${request.ip}`;

  const now = Date.now();
  let entry = store.get(identifier);

  if (!entry || now > entry.resetTime) {
    // Start a new window
    entry = {
      count: 1,
      resetTime: now + config.rateLimit.windowMs
    };
    store.set(identifier, entry);
  } else {
    entry.count++;

    if (entry.count > config.rateLimit.max) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);

      logger.warn({
        msg: 'Rate limit exceeded',
        identifier: identifier.substring(0, 12),
        count: entry.count
      });

      return reply
        .code(429)
        .header('Retry-After', String(retryAfter))
        .header('X-RateLimit-Limit', String(config.rateLimit.max))
        .header('X-RateLimit-Remaining', '0')
        .header('X-RateLimit-Reset', String(Math.ceil(entry.resetTime / 1000)))
        .send({
          error: {
            message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
            type: 'RATE_LIMITED',
            code: 429
          }
        });
    }
  }

  // Set rate limit headers on all responses
  reply.header('X-RateLimit-Limit', String(config.rateLimit.max));
  reply.header('X-RateLimit-Remaining', String(Math.max(0, config.rateLimit.max - entry.count)));
  reply.header('X-RateLimit-Reset', String(Math.ceil(entry.resetTime / 1000)));
}

module.exports = rateLimitMiddleware;
