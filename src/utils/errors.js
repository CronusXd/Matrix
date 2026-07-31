/**
 * Application Error Types
 *
 * Custom error classes that carry HTTP status codes
 * for consistent error responses through the API gateway.
 */

/**
 * Base application error.
 * All custom errors should extend this class.
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }

  /** Convert to JSON-safe representation for API responses */
  toJSON() {
    return {
      error: {
        message: this.message,
        type: this.code,
        code: this.statusCode
      }
    };
  }
}

/** 400 — Bad Request (invalid input, missing fields) */
class BadRequestError extends AppError {
  constructor(message = 'Bad request', code = 'BAD_REQUEST') {
    super(message, 400, code);
  }
}

/** 401 — Unauthorized (missing or invalid API key) */
class UnauthorizedError extends AppError {
  constructor(message = 'Invalid or missing API key', code = 'UNAUTHORIZED') {
    super(message, 401, code);
  }
}

/** 403 — Forbidden (valid key but insufficient permissions) */
class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions', code = 'FORBIDDEN') {
    super(message, 403, code);
  }
}

/** 404 — Not Found */
class NotFoundError extends AppError {
  constructor(message = 'Resource not found', code = 'NOT_FOUND') {
    super(message, 404, code);
  }
}

/** 429 — Too Many Requests */
class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded', code = 'RATE_LIMITED') {
    super(message, 429, code);
  }
}

/** 502 — Bad Gateway (provider returned an error) */
class ProviderError extends AppError {
  constructor(message = 'Upstream provider error', code = 'PROVIDER_ERROR') {
    super(message, 502, code);
  }
}

/** 503 — Service Unavailable */
class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable', code = 'SERVICE_UNAVAILABLE') {
    super(message, 503, code);
  }
}

/** 504 — Gateway Timeout (provider took too long) */
class GatewayTimeoutError extends AppError {
  constructor(message = 'Upstream provider timed out', code = 'GATEWAY_TIMEOUT') {
    super(message, 504, code);
  }
}

module.exports = {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ProviderError,
  ServiceUnavailableError,
  GatewayTimeoutError
};
