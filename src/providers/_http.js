/**
 * Shared HTTP Client for Provider Adapters
 *
 * Handles retries, timeouts, and consistent error handling
 * for all provider API calls.
 */

const https = require('https');
const http = require('http');
const config = require('../config');
const logger = require('../utils/logger');
const { ProviderError, GatewayTimeoutError } = require('../utils/errors');

/**
 * Make an HTTP request with retry and timeout support.
 *
 * @param {Object} options
 * @param {string} options.url — Full URL
 * @param {string} options.method — HTTP method (GET, POST)
 * @param {Object} options.headers — Request headers
 * @param {Object} [options.body] — JSON body (for POST)
 * @param {number} [options.timeout] — Timeout in ms (default: config.providerTimeout)
 * @param {string} options.provider — Provider name for logging
 * @param {number} [options.retries] — Number of retries (default: config.providerMaxRetries)
 * @returns {Promise<{ statusCode: number, body: string, headers: Object }>}
 */
async function callProvider(options) {
  const {
    url,
    method = 'GET',
    headers = {},
    body = null,
    timeout = config.providerTimeout,
    provider = 'unknown',
    retries = config.providerMaxRetries
  } = options;

  const parsedUrl = new URL(url);
  const isHttps = parsedUrl.protocol === 'https:';
  const transport = isHttps ? https : http;

  const bodyString = body ? JSON.stringify(body) : null;

  const requestOptions = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (isHttps ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    method,
    headers: {
      ...headers,
      'User-Agent': 'Matrix-Gateway/3.0.0'
    },
    timeout
  };

  if (bodyString) {
    requestOptions.headers['Content-Length'] = Buffer.byteLength(bodyString);
  }

  logger.debug({
    msg: 'Provider request',
    provider,
    method,
    url: `${parsedUrl.hostname}${parsedUrl.pathname}`
  });

  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      logger.warn({
        msg: 'Retrying provider request',
        provider,
        attempt,
        delay_ms: delay
      });
      await sleep(delay);
    }

    try {
      const result = await makeRequest(transport, requestOptions, bodyString, provider);
      return result;
    } catch (err) {
      lastError = err;

      // Don't retry on 4xx errors (client errors)
      if (err.responseStatus && err.responseStatus >= 400 && err.responseStatus < 500) {
        break;
      }

      // Don't retry on timeouts unless we have retries left
      if (err.code === 'GATEWAY_TIMEOUT' && attempt >= retries) {
        break;
      }
    }
  }

  if (lastError) {
    if (lastError instanceof GatewayTimeoutError) throw lastError;
    if (lastError instanceof ProviderError) throw lastError;
    throw new ProviderError(
      `Provider "${provider}" request failed: ${lastError.message}`
    );
  }
}

/**
 * Make a single HTTP request.
 *
 * @param {Object} transport — http or https module
 * @param {Object} options — Request options
 * @param {string|null} bodyString — JSON body string
 * @param {string} provider — Provider name
 * @returns {Promise<{ statusCode: number, body: string, headers: Object }>}
 */
function makeRequest(transport, options, bodyString, provider) {
  return new Promise((resolve, reject) => {
    const req = transport.request(options, (res) => {
      const chunks = [];

      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');

        if (res.statusCode >= 500) {
          const err = new ProviderError(
            `Provider "${provider}" returned ${res.statusCode}: ${body.substring(0, 200)}`
          );
          err.responseStatus = res.statusCode;
          err.responseBody = body;
          reject(err);
          return;
        }

        resolve({
          statusCode: res.statusCode,
          body,
          headers: res.headers
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      const err = new GatewayTimeoutError(
        `Provider "${provider}" timed out after ${options.timeout}ms`
      );
      err.code = 'GATEWAY_TIMEOUT';
      reject(err);
    });

    req.on('error', (err) => {
      reject(new ProviderError(
        `Provider "${provider}" connection error: ${err.message}`
      ));
    });

    if (bodyString) {
      req.write(bodyString);
    }

    req.end();
  });
}

/**
 * Sleep for a given number of milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { callProvider };
