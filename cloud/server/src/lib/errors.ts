import type { FastifyReply } from 'fastify';

/** Uniform error envelope, matching the main app's convention. */
export function fail(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string
): { success: false; error: { code: string; message: string } } {
  reply.code(status);
  return { success: false, error: { code, message } };
}
