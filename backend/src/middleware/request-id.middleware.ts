import { FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import { runWithContext } from '../lib/logger.js';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
  }
}

export async function requestIdMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const requestId = (request.headers['x-request-id'] as string) || randomUUID();
  request.requestId = requestId;
  reply.header('x-request-id', requestId);
}

export function withRequestContext<T>(
  request: FastifyRequest,
  fn: () => T | Promise<T>
): T | Promise<T> {
  return runWithContext(
    {
      requestId: request.requestId,
      userId: (request as any).user?.id,
      householdId: (request as any).user?.householdId,
    },
    fn as () => T
  );
}
