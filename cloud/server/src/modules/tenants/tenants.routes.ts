import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config/index.js';
import { fail } from '../../lib/errors.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { rateLimit } from '../../middleware/rate-limit.middleware.js';
import { createTenantSchema, subdomainSchema } from './tenants.schema.js';
import {
  checkSubdomainAvailability,
  createTenant,
  getTenantSummary,
  issueClaimCode,
  revokeTunnelTokens,
} from './tenants.service.js';

export async function tenantsRoutes(app: FastifyInstance): Promise<void> {
  const checkLimiter = rateLimit({ name: 'subdomain-check', max: 60, windowMs: 60_000 });
  const claimCodeLimiter = rateLimit({
    name: 'claim-code',
    max: 10,
    windowMs: 60 * 60_000,
    key: (request) => request.account?.id ?? request.ip,
  });

  app.get('/subdomains/check', { preHandler: [checkLimiter] }, async (request, reply) => {
    const parsed = z
      .object({ name: subdomainSchema })
      .safeParse(request.query as Record<string, string>);
    if (!parsed.success) {
      return fail(reply, 400, 'INVALID_INPUT', 'Provide a subdomain to check');
    }
    const result = await checkSubdomainAvailability(parsed.data.name);
    return { success: true, data: result };
  });

  app.post('/tenants', { preHandler: [authMiddleware] }, async (request, reply) => {
    const parsed = createTenantSchema.safeParse(request.body);
    if (!parsed.success) {
      return fail(reply, 400, 'SUBDOMAIN_INVALID', 'Enter a valid subdomain');
    }
    const result = await createTenant(request.account!.id, parsed.data.subdomain);
    if (typeof result === 'string') {
      const messages: Record<typeof result, string> = {
        SUBDOMAIN_INVALID:
          'Subdomains are 3-30 characters: lowercase letters, digits, and single hyphens',
        SUBDOMAIN_RESERVED: 'That name is reserved',
        SUBDOMAIN_TAKEN: 'That name is already taken',
        TENANT_EXISTS: 'This account already has an address',
      };
      return fail(reply, result === 'TENANT_EXISTS' ? 409 : 400, result, messages[result]);
    }
    return {
      success: true,
      data: {
        tenant: {
          id: result.id,
          subdomain: result.subdomain,
          hostname: `${result.subdomain}.${config.RELAY_SERVER_ADDR}`,
          status: result.status,
        },
      },
    };
  });

  app.get('/tenants/me', { preHandler: [authMiddleware] }, async (request) => {
    const tenant = await getTenantSummary(request.account!.id, config.RELAY_SERVER_ADDR);
    return { success: true, data: { tenant } };
  });

  app.post(
    '/tenants/me/claim-code',
    { preHandler: [authMiddleware, claimCodeLimiter] },
    async (request, reply) => {
      const result = await issueClaimCode(request.account!.id);
      if (result === 'NO_TENANT') {
        return fail(reply, 409, 'TENANT_REQUIRED', 'Claim an address first');
      }
      if (result === 'SUBSCRIPTION_REQUIRED') {
        return fail(
          reply,
          409,
          'SUBSCRIPTION_REQUIRED',
          'An active subscription is required before connecting a box'
        );
      }
      return {
        success: true,
        data: { code: result.code, expiresAt: result.expiresAt.toISOString() },
      };
    }
  );

  app.post(
    '/tenants/me/revoke-token',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const revoked = await revokeTunnelTokens(request.account!.id);
      if (!revoked) return fail(reply, 409, 'TENANT_REQUIRED', 'Claim an address first');
      return { success: true, data: { revoked: true } };
    }
  );
}
