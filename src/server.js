/**
 * Matrix Gateway — HTTP Server
 *
 * Fastify-based HTTP server that exposes an OpenAI-compatible API.
 *
 * Endpoints:
 *   GET  /health               — Health check
 *   GET  /v1/models            — List available models
 *   POST /v1/chat/completions  — Chat completions (OpenAI-compatible)
 *
 * Middleware:
 *   - Authentication (API key validation via Bearer token)
 *   - Rate limiting (per-key request counting)
 */

const Fastify = require('fastify');
const cors = require('@fastify/cors');

const config = require('./config');
const logger = require('./utils/logger');
const path = require('path');
const fs = require('fs');
const authMiddleware = require('./middleware/auth');
const rateLimitMiddleware = require('./middleware/rate-limit');
const chatCompletions = require('./routes/chat');
const listModels = require('./routes/models');
const dashboard = require('./routes/dashboard');
const { initDb, closeDb } = require('./db/database');

/**
 * Build and configure the Fastify server instance.
 *
 * @returns {import('fastify').FastifyInstance}
 */
function buildServer() {
  const server = Fastify({
    logger: false, // We use our own structured logger
    trustProxy: true,
    requestIdHeader: 'x-request-id',
    genReqId: () => `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  });

  // ── CORS ──────────────────────────────────────────────
  server.register(cors, {
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400
  });

  // ── Request logging ───────────────────────────────────
  server.addHook('onRequest', async (request) => {
    request.startTime = Date.now();
    logger.debug({
      msg: 'Incoming request',
      method: request.method,
      url: request.url,
      requestId: request.id,
      ip: request.ip
    });
  });

  server.addHook('onResponse', async (request, reply) => {
    const elapsed = Date.now() - (request.startTime || Date.now());
    logger.info({
      msg: 'Response sent',
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      elapsed_ms: elapsed,
      requestId: request.id
    });
  });

  // ── Dashboard Route (auth required) ──────────────────
  server.get('/dashboard', async (request, reply) => {
    await authMiddleware(request, reply);
    if (reply.sent) return;
    const htmlPath = path.join(__dirname, '..', 'dashboard', 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');
    return reply.type('text/html').send(html);
  });
  server.get('/health', async () => {
    return {
      status: 'ok',
      service: 'matrix-gateway',
      version: '3.0.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    };
  });

  // ── Protected routes ──────────────────────────────────
  // All /v1/* routes require authentication and rate limiting
  server.addHook('preHandler', async (request, reply) => {
    // Skip auth for health check and non-API routes
    if (!request.url.startsWith('/v1/')) return;

    // Rate limit check
    await rateLimitMiddleware(request, reply);
    if (reply.sent) return;

    // Auth check
    await authMiddleware(request, reply);
    if (reply.sent) return;
  });

  // ── API Routes ────────────────────────────────────────
  server.get('/v1/models', listModels);
  server.post('/v1/chat/completions', chatCompletions);

  // ── Dashboard API Routes ───────────────────────────────
  server.get('/api/keys', dashboard.listKeys);
  server.post('/api/keys', dashboard.createKey);
  server.delete('/api/keys/:id', dashboard.revokeKey);
  server.get('/api/config', dashboard.getUserConfig);
  server.put('/api/config', dashboard.updateUserConfig);
  server.get('/api/usage', dashboard.getUsage);
  server.get('/api/status', dashboard.getStatus);

  // ── 404 handler ───────────────────────────────────────
  server.setNotFoundHandler(async (request, reply) => {
    return reply.code(404).send({
      error: {
        message: `Route not found: ${request.method} ${request.url}`,
        type: 'NOT_FOUND',
        code: 404
      }
    });
  });

  // ── Global error handler ──────────────────────────────
  server.setErrorHandler(async (error, request, reply) => {
    logger.errorObj(error, {
      url: request.url,
      method: request.method,
      requestId: request.id
    });

    const statusCode = error.statusCode || 500;
    return reply.code(statusCode).send({
      error: {
        message: config.nodeEnv === 'production'
          ? 'Internal server error'
          : error.message,
        type: error.code || 'INTERNAL_ERROR',
        code: statusCode
      }
    });
  });

  return server;
}

/**
 * Start the server.
 */
async function start() {
  const server = buildServer();

  // ── Graceful shutdown ─────────────────────────────────
  const shutdown = async (signal) => {
    logger.info({ msg: 'Shutdown signal received', signal });

    try {
      await server.close();
      closeDb();
      logger.info('Server shut down gracefully');
      process.exit(0);
    } catch (err) {
      logger.errorObj(err, { context: 'shutdown' });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // ── Initialize database ────────────────────────────────
  try {
    await initDb();
    logger.info('Database initialized');
  } catch (err) {
    logger.errorObj(err, { context: 'database init' });
    process.exit(1);
  }

  // ── Start listening ───────────────────────────────────
  try {
    await server.listen({ port: config.port, host: config.host });
    logger.info({
      msg: 'Matrix Gateway started',
      port: config.port,
      host: config.host,
      env: config.nodeEnv,
      db: config.dbPath
    });
  } catch (err) {
    logger.errorObj(err, { context: 'server start' });
    closeDb();
    process.exit(1);
  }

  return server;
}

// ── Entry point ─────────────────────────────────────────
if (require.main === module) {
  start();
}

module.exports = { buildServer, start };
