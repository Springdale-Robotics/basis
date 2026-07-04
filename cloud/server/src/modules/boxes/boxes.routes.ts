import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/errors.js';
import { rateLimit } from '../../middleware/rate-limit.middleware.js';
import { processHeartbeat, redeemClaimCode } from './boxes.service.js';

/**
 * Box-facing API — the FIXED contract the Basis backend's basis-cloud.ts is
 * written against. Public (no cookie auth): claim is authenticated by the
 * one-time code, heartbeat by the bearer tunnel token.
 */
export async function boxesRoutes(app: FastifyInstance): Promise<void> {
  const claimLimiter = rateLimit({ name: 'box-claim', max: 10, windowMs: 60 * 60_000 });
  const heartbeatLimiter = rateLimit({ name: 'box-heartbeat', max: 30, windowMs: 60_000 });

  app.post('/claim', { preHandler: [claimLimiter] }, async (request, reply) => {
    const parsed = z
      .object({ claimCode: z.string().min(6).max(20) })
      .safeParse(request.body);
    if (!parsed.success) {
      return fail(reply, 400, 'CLAIM_CODE_INVALID', 'Provide a claim code');
    }

    const result = await redeemClaimCode(parsed.data.claimCode);
    if (typeof result === 'string') {
      const messages = {
        CLAIM_CODE_INVALID: 'That claim code is not valid',
        CLAIM_CODE_EXPIRED: 'That claim code has expired — generate a new one from your dashboard',
        CLAIM_CODE_USED: 'That claim code was already used — generate a new one from your dashboard',
      } as const;
      return fail(reply, 400, result, messages[result]);
    }
    return { success: true, data: result };
  });

  app.post('/heartbeat', { preHandler: [heartbeatLimiter] }, async (request, reply) => {
    const auth = request.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return fail(reply, 401, 'UNAUTHENTICATED', 'Missing bearer token');
    }
    const token = auth.slice('Bearer '.length).trim();
    const result = await processHeartbeat(token);
    if (!result) {
      return fail(reply, 401, 'TOKEN_REVOKED', 'This box is no longer linked');
    }
    return { success: true, data: result };
  });
}
