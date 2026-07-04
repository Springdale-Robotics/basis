import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { tenantsRoutes } from './modules/tenants/tenants.routes.js';
import { boxesRoutes } from './modules/boxes/boxes.routes.js';
import { billingRoutes } from './modules/billing/billing.routes.js';
import { stripeWebhookRoutes } from './modules/billing/stripe-webhook.routes.js';
import { frpPluginRoutes } from './modules/frp/frp.routes.js';
import { gateRoutes } from './modules/frp/gate.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // Behind Caddy on the same host. trustProxy=false on purpose: the frp
    // plugin route's loopback check must see the raw socket address, and
    // nothing here needs the forwarded client IP badly enough to trade that
    // away. (Rate limits key on the Caddy-forwarded ip only if we trust the
    // proxy — instead we accept per-edge-IP granularity.)
    trustProxy: false,
    logger: false,
    bodyLimit: 64 * 1024,
  });

  app.setErrorHandler((error, request, reply) => {
    if (error.statusCode && error.statusCode < 500) {
      reply.code(error.statusCode).send({
        success: false,
        error: { code: error.code ?? 'BAD_REQUEST', message: error.message },
      });
      return;
    }
    logger.error({ err: error, url: request.url }, 'Unhandled route error');
    reply.code(500).send({
      success: false,
      error: { code: 'INTERNAL', message: 'Something went wrong' },
    });
  });

  await app.register(fastifyCookie, { secret: config.SESSION_SECRET });

  // Cheap CSRF barrier: cookies are SameSite=Lax AND every state-changing
  // cookie-authed request must carry a custom header (impossible to attach
  // cross-origin without CORS approval). Token/signature-authed routes
  // (boxes, stripe webhook, frp plugin) are exempt.
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
      return;
    }
    const url = request.url;
    if (
      url.startsWith('/api/v1/boxes/') ||
      url.startsWith('/api/stripe/') ||
      url.startsWith('/frp-plugin/')
    ) {
      return;
    }
    if (request.headers['x-requested-with'] !== 'fetch') {
      reply.code(403).send({
        success: false,
        error: { code: 'CSRF', message: 'Missing X-Requested-With header' },
      });
    }
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(tenantsRoutes, { prefix: '/api' });
  await app.register(billingRoutes, { prefix: '/api/billing' });
  await app.register(stripeWebhookRoutes, { prefix: '/api/stripe' });
  await app.register(boxesRoutes, { prefix: '/api/v1/boxes' });
  await app.register(frpPluginRoutes);
  await app.register(gateRoutes);
  await app.register(healthRoutes);

  // Serve the built SPA in production (FRONTEND_DIST set by the installer).
  if (config.FRONTEND_DIST) {
    const dist = resolve(config.FRONTEND_DIST);
    if (existsSync(dist)) {
      await app.register(fastifyStatic, { root: dist, prefix: '/' });
      app.setNotFoundHandler((request, reply) => {
        // API 404s stay JSON; everything else falls back to the SPA router.
        if (request.url.startsWith('/api/') || request.url.startsWith('/frp-plugin/')) {
          reply.code(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Not found' },
          });
          return;
        }
        reply.header('Cache-Control', 'no-cache').type('text/html').sendFile('index.html');
      });
    } else {
      logger.warn({ dist }, 'FRONTEND_DIST set but missing — SPA not served');
    }
  }

  return app;
}
