import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/errors.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { createCheckoutSession, createPortalSession } from './billing.service.js';

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  app.post('/checkout', { preHandler: [authMiddleware] }, async (request, reply) => {
    const parsed = z
      .object({ tier: z.enum(['basic', 'streaming']) })
      .safeParse(request.body);
    if (!parsed.success) {
      return fail(reply, 400, 'INVALID_INPUT', 'Pick a tier');
    }
    const result = await createCheckoutSession(
      request.account!.id,
      request.account!.email,
      parsed.data.tier
    );
    if (result === 'TENANT_REQUIRED') {
      return fail(reply, 409, 'TENANT_REQUIRED', 'Claim an address first');
    }
    if (result === 'ALREADY_SUBSCRIBED') {
      return fail(reply, 409, 'ALREADY_SUBSCRIBED', 'This address already has a subscription');
    }
    return { success: true, data: { url: result.url } };
  });

  app.post('/portal', { preHandler: [authMiddleware] }, async (request, reply) => {
    const result = await createPortalSession(request.account!.id);
    if (result === 'NO_BILLING') {
      return fail(reply, 409, 'NO_BILLING', 'No billing to manage for this account');
    }
    return { success: true, data: { url: result.url } };
  });
}
