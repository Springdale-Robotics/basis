import type { FastifyInstance } from 'fastify';
import { isIP } from 'net';
import { config } from '../../config/index.js';
import { constantTimeEqual } from '../../lib/tokens.js';
import { logger } from '../../lib/logger.js';
import {
  handleCloseProxy,
  handleLogin,
  handleNewProxy,
  handlePing,
} from './frp.service.js';

function isLoopback(ip: string): boolean {
  if (isIP(ip) === 0) return false;
  return ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.') || ip === '::ffff:127.0.0.1';
}

/**
 * frps httpPlugin endpoint. Three layers keep this off the internet:
 *  1. Caddy returns 404 for /frp-plugin/* on the public vhost
 *  2. we require the request to originate from loopback (frps runs alongside)
 *  3. the path embeds a shared secret only frps.toml knows
 */
export async function frpPluginRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Params: { secret: string };
    Querystring: { op?: string };
    Body: { op?: string; content?: Record<string, unknown> };
  }>('/frp-plugin/:secret/handler', async (request, reply) => {
    // request.ip honors trustProxy=false here — raw socket address.
    if (!isLoopback(request.ip)) {
      reply.code(404).send();
      return;
    }
    if (!constantTimeEqual(request.params.secret, config.FRP_PLUGIN_SECRET)) {
      reply.code(404).send();
      return;
    }

    const op = request.query.op ?? request.body?.op;
    const content = (request.body?.content ?? {}) as Record<string, never>;

    switch (op) {
      case 'Login':
        return handleLogin(content);
      case 'NewProxy':
        return handleNewProxy(content);
      case 'Ping':
        return handlePing(content);
      case 'CloseProxy':
        return handleCloseProxy(content);
      default:
        // Ops we didn't subscribe to (or future ones) — allow unchanged.
        logger.debug({ op }, 'frp plugin: unhandled op allowed');
        return { reject: false, unchange: true };
    }
  });
}
