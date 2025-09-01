import { ZodError } from 'zod';
import { ApiError } from '../errors/api-error.js';

/**
 * Central Express error serializer.
 * @type {import('express').ErrorRequestHandler}
 */
export function errorHandler(err, req, res, next) {
  let apiErr = err;

  if (err instanceof ZodError) {
    const message = err.issues.map((i) => i.message).join('; ');
    apiErr = new ApiError('INVALID_INPUT', message, 400);
  } else if (!(err instanceof ApiError)) {
    apiErr = new ApiError('INTERNAL_SERVER_ERROR', 'An unexpected error occurred', 500);
  }

  const status = apiErr.status ?? codeToStatus(apiErr.code);
  res.status(status).json({ ok: false, error: { code: apiErr.code, message: apiErr.message } });
}

/**
 * Map API codes to HTTP statuses.
 * @param {string} code
 */
function codeToStatus(code) {
  if (code === 'INVALID_INPUT') return 400;
  if (code === 'NOT_FOUND') return 404;
  return 500;
}
