import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError, ErrorCode } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const requestId = request.requestId;
  const timestamp = new Date().toISOString();

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    const details = error.errors.map((e) => ({
      path: e.path.join('.'),
      message: e.message,
    }));

    reply.status(400).send({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Validation failed',
        details: { errors: details },
      },
      meta: { requestId, timestamp },
    });
    return;
  }

  // Handle custom application errors
  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logger.error({ error, requestId }, 'Server error');
    } else {
      logger.warn({ error, requestId }, 'Client error');
    }

    reply.status(error.statusCode).send({
      success: false,
      error: error.toJSON(),
      meta: { requestId, timestamp },
    });
    return;
  }

  // Handle Fastify validation errors
  if ('validation' in error && error.validation) {
    reply.status(400).send({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: error.message,
        details: { validation: error.validation },
      },
      meta: { requestId, timestamp },
    });
    return;
  }

  // Handle unknown errors
  logger.error({ error, requestId }, 'Unhandled error');

  reply.status(500).send({
    success: false,
    error: {
      code: ErrorCode.SYSTEM_INTERNAL_ERROR,
      message: 'Internal server error',
    },
    meta: { requestId, timestamp },
  });
}

export function notFoundHandler(
  request: FastifyRequest,
  reply: FastifyReply
): void {
  reply.status(404).send({
    success: false,
    error: {
      code: ErrorCode.RESOURCE_NOT_FOUND,
      message: `Route ${request.method} ${request.url} not found`,
    },
    meta: {
      requestId: request.requestId,
      timestamp: new Date().toISOString(),
    },
  });
}
