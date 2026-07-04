import type { FastifyInstance } from 'fastify';
import { and, eq, ne } from 'drizzle-orm';
import { isIP } from 'net';
import { db } from '../../db/index.js';
import { tenants } from '../../db/schema/index.js';
import { config } from '../../config/index.js';

/**
 * Edge enforcement for tenant HTTP traffic. Caddy `forward_auth`s every
 * request on *.home-basis.com here; a 2xx lets the request proceed to frps,
 * anything else is returned to the visitor.
 *
 * This is the AUTHORITATIVE suspension gate: the frp-plugin Ping rejection
 * relies on the client cooperating (sending heartbeats), whereas this path
 * covers even a hostile frpc that keeps its tunnel open — its traffic dies at
 * the edge regardless.
 */

const GATE_TTL_MS = 30_000;

interface GateEntry {
  allowed: boolean;
  expiresAt: number;
}

const gateCache = new Map<string, GateEntry>();

export function __clearGateCacheForTests(): void {
  gateCache.clear();
}

function isLoopback(ip: string): boolean {
  if (isIP(ip) === 0) return false;
  return ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.') || ip === '::ffff:127.0.0.1';
}

async function subdomainAllowed(subdomain: string): Promise<boolean> {
  const cached = gateCache.get(subdomain);
  if (cached && cached.expiresAt > Date.now()) return cached.allowed;

  const tenant = await db.query.tenants.findFirst({
    where: and(eq(tenants.subdomain, subdomain), ne(tenants.status, 'canceled')),
  });
  const allowed = !!tenant && (tenant.status === 'active' || tenant.status === 'past_due');
  gateCache.set(subdomain, { allowed, expiresAt: Date.now() + GATE_TTL_MS });
  return allowed;
}

const SUSPENDED_PAGE = `<!doctype html><html><head><title>Unavailable</title></head>
<body style="font-family: system-ui; max-width: 32rem; margin: 4rem auto; text-align: center">
<h1>This address is paused</h1>
<p>The Basis Remote subscription for this address is not active right now.</p>
<p>If this is your family's address, sign in at <a href="https://home-basis.com">home-basis.com</a> to fix it.</p>
</body></html>`;

export async function gateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/frp-gate', async (request, reply) => {
    if (!isLoopback(request.ip)) {
      reply.code(404).send();
      return;
    }
    // Caddy's forward_auth sends the original Host in X-Forwarded-Host.
    const rawHost =
      (request.headers['x-forwarded-host'] as string | undefined) ??
      request.headers.host ??
      '';
    const host = rawHost.split(':')[0].toLowerCase();
    const suffix = `.${config.RELAY_SERVER_ADDR}`;
    // In dev the vhost domain differs (lvh.me) — accept any single-label
    // subdomain of whatever domain the request came in on.
    const subdomain = host.endsWith(suffix)
      ? host.slice(0, -suffix.length)
      : host.split('.')[0];

    if (!subdomain || subdomain.includes('.')) {
      reply.code(403).type('text/html').send(SUSPENDED_PAGE);
      return;
    }

    if (await subdomainAllowed(subdomain)) {
      reply.code(204).send();
      return;
    }
    reply.code(403).type('text/html').send(SUSPENDED_PAGE);
  });
}
