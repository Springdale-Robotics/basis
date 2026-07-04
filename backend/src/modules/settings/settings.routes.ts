import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { households, extensions, ddnsConfig, musicIntegrations, files } from '../../db/schema/index.js';
import type { HouseholdSettings } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware, requireAdmin } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { hexColorSchema } from '../../lib/validators.js';
import { config } from '../../config/index.js';
import {
  configureFunnel,
  configureServe,
  disableFunnel,
  disableServe,
  getServeStatus,
  getTailscaleStatus,
} from '../../lib/tailscale.js';
import {
  getCloudflaredStatus,
  startTunnel as startCloudflareTunnel,
  stopTunnel as stopCloudflareTunnel,
} from '../../lib/cloudflared.js';
import {
  getBasisRemoteStatus,
  startBasisRemote,
  stopBasisRemote,
} from '../../lib/basis-remote.js';
import { claimBox, ClaimError } from '../../lib/basis-cloud.js';

const PUBLIC_ICS_PATH = '/api/v1/calendars/public';

type RemoteAccessSettings = NonNullable<HouseholdSettings['remoteAccess']>;

const updateThemeSchema = z.object({
  mode: z.enum(['light', 'dark', 'system']).optional(),
  primaryColor: hexColorSchema.optional(),
  accentColor: hexColorSchema.optional(),
  customCss: z.string().optional(),
});

const updateFeaturesSchema = z.object({
  calendar: z.boolean().optional(),
  recipes: z.boolean().optional(),
  inventory: z.boolean().optional(),
  tasks: z.boolean().optional(),
  rewards: z.boolean().optional(),
  smartHome: z.boolean().optional(),
  nas: z.boolean().optional(),
});

const updateStorageSettingsSchema = z.object({
  limitGb: z.number().positive().nullable().optional(),
  warnAtPercent: z.number().int().min(1).max(99).optional(),
});

const configureDdnsSchema = z.object({
  provider: z.enum(['cloudflare', 'duckdns', 'noip', 'dynu', 'custom']),
  domain: z.string().min(1).max(255),
  credentials: z.string().min(1),
  updateIntervalMinutes: z.number().int().min(5).max(60).default(15),
});

const remoteAccessUrlSchema = z
  .string()
  .url('Must be a valid URL')
  .max(255)
  .refine((u) => /^https?:\/\//.test(u), 'Must start with http:// or https://')
  .refine((u) => !u.endsWith('/'), 'Must not end with a trailing slash');

const updateRemoteAccessSchema = z.object({
  // NB: no writable `basisRemote` object here on purpose — that blob is
  // managed exclusively by the /remote-access/basis-remote/* routes so the
  // UI can never half-write tunnel credentials.
  mode: z.enum(['local_only', 'cloudflare', 'tailscale', 'custom_domain', 'basis_remote']).optional(),
  publicUrl: remoteAccessUrlSchema.optional().nullable(),
  localUrl: remoteAccessUrlSchema.optional().nullable(),
  cloudflare: z
    .object({
      tunnelId: z.string(),
      tunnelToken: z.string(),
    })
    .optional()
    .nullable(),
  tailscale: z
    .object({
      hostname: z.string(),
      tailnet: z.string(),
      magicDnsUrl: z.string(),
    })
    .optional()
    .nullable(),
  customDomain: z
    .object({
      domain: z.string(),
      sslConfigured: z.boolean(),
    })
    .optional()
    .nullable(),
});

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // Get household settings
  app.get(
    '/household',
    { preHandler: [authMiddleware] },
    async (request) => {
      const household = await db.query.households.findFirst({
        where: eq(households.id, request.user!.householdId),
        columns: { settings: true },
      });

      return { success: true, data: { settings: household?.settings || {} } };
    }
  );

  // Update household settings
  app.patch(
    '/household',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const settings = request.body as Record<string, unknown>;

      const current = await db.query.households.findFirst({
        where: eq(households.id, request.user!.householdId),
        columns: { settings: true },
      });

      const newSettings = { ...(current?.settings as object || {}), ...settings };

      const [updated] = await db
        .update(households)
        .set({ settings: newSettings, updatedAt: new Date() })
        .where(eq(households.id, request.user!.householdId))
        .returning();

      return { success: true, data: { settings: updated.settings } };
    }
  );

  // Get theme settings
  app.get(
    '/theme',
    { preHandler: [authMiddleware] },
    async (request) => {
      const household = await db.query.households.findFirst({
        where: eq(households.id, request.user!.householdId),
        columns: { settings: true },
      });

      const settings = household?.settings as any;
      const theme = settings?.theme || {
        mode: 'system',
        primaryColor: '#3B82F6',
        accentColor: '#10B981',
      };

      return { success: true, data: { theme } };
    }
  );

  // Update theme settings
  app.patch(
    '/theme',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const input = updateThemeSchema.parse(request.body);

      const current = await db.query.households.findFirst({
        where: eq(households.id, request.user!.householdId),
        columns: { settings: true },
      });

      const settings = current?.settings as any || {};
      const newTheme = { ...settings.theme, ...input };

      await db
        .update(households)
        .set({
          settings: { ...settings, theme: newTheme },
          updatedAt: new Date(),
        })
        .where(eq(households.id, request.user!.householdId));

      return { success: true, data: { theme: newTheme } };
    }
  );

  // Get enabled features
  app.get(
    '/features',
    { preHandler: [authMiddleware] },
    async (request) => {
      const household = await db.query.households.findFirst({
        where: eq(households.id, request.user!.householdId),
        columns: { settings: true },
      });

      const settings = household?.settings as any;
      const features = settings?.enabledFeatures || {
        calendar: true,
        recipes: true,
        inventory: true,
        tasks: true,
        rewards: false,
        smartHome: true,
        nas: true,
      };

      return { success: true, data: { features } };
    }
  );

  // Update enabled features
  app.patch(
    '/features',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const input = updateFeaturesSchema.parse(request.body);

      const current = await db.query.households.findFirst({
        where: eq(households.id, request.user!.householdId),
        columns: { settings: true },
      });

      const settings = current?.settings as any || {};
      const newFeatures = { ...settings.enabledFeatures, ...input };

      await db
        .update(households)
        .set({
          settings: { ...settings, enabledFeatures: newFeatures },
          updatedAt: new Date(),
        })
        .where(eq(households.id, request.user!.householdId));

      return { success: true, data: { features: newFeatures } };
    }
  );

  // ===== STORAGE SETTINGS =====

  // Get storage settings
  app.get(
    '/storage',
    { preHandler: [authMiddleware] },
    async (request) => {
      const household = await db.query.households.findFirst({
        where: eq(households.id, request.user!.householdId),
        columns: { settings: true },
      });

      const settings = household?.settings as any;
      const storageSettings = settings?.storage || {};

      // Get current usage
      const fileList = await db.query.files.findMany({
        where: eq(files.householdId, request.user!.householdId),
        columns: { sizeBytes: true },
      });
      const currentUsageBytes = fileList.reduce((sum, f) => sum + f.sizeBytes, 0);

      // Get filesystem stats for disk capacity fallback
      let diskCapacityGb: number | null = null;
      try {
        const fs = await import('node:fs/promises');
        const stats = await fs.statfs(config.STORAGE_PATH);
        const totalBytes = stats.blocks * stats.bsize;
        diskCapacityGb = Math.round(totalBytes / (1024 * 1024 * 1024));
      } catch {
        // Filesystem stats unavailable
      }

      return {
        success: true,
        data: {
          storage: {
            limitGb: storageSettings.limitGb ?? null,
            warnAtPercent: storageSettings.warnAtPercent ?? 80,
          },
          systemDefaultGb: config.STORAGE_QUOTA_GB ?? null,
          diskCapacityGb,
          currentUsageBytes,
        },
      };
    }
  );

  // Update storage settings
  app.patch(
    '/storage',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const input = updateStorageSettingsSchema.parse(request.body);

      const current = await db.query.households.findFirst({
        where: eq(households.id, request.user!.householdId),
        columns: { settings: true },
      });

      const settings = current?.settings as any || {};
      const newStorage = { ...settings.storage, ...input };

      // Clean up null values
      if (newStorage.limitGb === null) {
        delete newStorage.limitGb;
      }

      await db
        .update(households)
        .set({
          settings: { ...settings, storage: Object.keys(newStorage).length > 0 ? newStorage : undefined },
          updatedAt: new Date(),
        })
        .where(eq(households.id, request.user!.householdId));

      return { success: true, data: { storage: newStorage } };
    }
  );

  // Get remote access configuration
  app.get(
    '/remote-access',
    { preHandler: [authMiddleware] },
    async (request) => {
      const household = await db.query.households.findFirst({
        where: eq(households.id, request.user!.householdId),
        columns: { settings: true },
      });

      const settings = household?.settings as any;
      const remoteAccess = settings?.remoteAccess || { mode: 'local_only' };

      // Redact the Cloudflare tunnel token before responding — it's
      // stored plaintext in the JSON blob (same as DDNS credentials) but
      // there's no reason for the frontend to ever see it after it's saved.
      const redacted = { ...remoteAccess };
      if (redacted.cloudflare?.tunnelToken) {
        redacted.cloudflare = { ...redacted.cloudflare, tunnelToken: '***' };
      }
      if (redacted.basisRemote?.tunnelToken) {
        redacted.basisRemote = { ...redacted.basisRemote, tunnelToken: '***' };
      }

      return { success: true, data: { remoteAccess: redacted } };
    }
  );

  // Update remote access configuration (deep merge into settings.remoteAccess).
  // Sub-objects passed as null are cleared; omitted fields are preserved.
  app.patch(
    '/remote-access',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const input = updateRemoteAccessSchema.parse(request.body);

      const current = await db.query.households.findFirst({
        where: eq(households.id, request.user!.householdId),
        columns: { settings: true },
      });

      const settings = (current?.settings as Record<string, unknown> | null) ?? {};
      const existingRemoteAccess = (settings.remoteAccess as Record<string, unknown> | undefined) ?? {
        mode: 'local_only',
      };

      const newRemoteAccess: Record<string, unknown> = { ...existingRemoteAccess };
      for (const [key, value] of Object.entries(input)) {
        if (value === null) {
          delete newRemoteAccess[key];
        } else if (value !== undefined) {
          newRemoteAccess[key] = value;
        }
      }

      await db
        .update(households)
        .set({
          settings: { ...settings, remoteAccess: newRemoteAccess as RemoteAccessSettings },
          updatedAt: new Date(),
        })
        .where(eq(households.id, request.user!.householdId));

      return { success: true, data: { remoteAccess: newRemoteAccess } };
    }
  );

  // ─── Tailscale auto-detection + serve config ──────────────────────────

  app.get(
    '/remote-access/tailscale/detect',
    { preHandler: [authMiddleware] },
    async () => {
      const status = await getTailscaleStatus();
      const serve = await getServeStatus();
      return {
        success: true,
        data: {
          ...status,
          serve,
        },
      };
    }
  );

  app.post(
    '/remote-access/tailscale/enable',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request, reply) => {
      const status = await getTailscaleStatus();
      if (!status.available || !status.hostname) {
        reply.code(409);
        return {
          success: false,
          error: {
            code: 'TAILSCALE_UNAVAILABLE',
            message: 'Tailscale is not available on this host',
            issues: status.issues,
          },
        };
      }
      const result = await configureServe(config.PORT);
      if (!result.success) {
        reply.code(409);
        return {
          success: false,
          error: {
            code: 'TAILSCALE_SERVE_FAILED',
            message: result.error ?? 'tailscale serve failed',
            issue: result.issue,
          },
        };
      }

      // Persist the URL into household settings so other code (CalDAV PROPFIND,
      // public-ICS links, etc.) picks it up via getCanonicalUrl().
      const publicUrl = `https://${status.hostname}`;
      const current = await db.query.households.findFirst({
        where: eq(households.id, request.user!.householdId),
        columns: { settings: true },
      });
      const existing = (current?.settings as Record<string, unknown>) ?? {};
      const existingRemote =
        (existing.remoteAccess as Record<string, unknown> | undefined) ?? {};
      const newRemote = {
        ...existingRemote,
        mode: 'tailscale',
        publicUrl,
        tailscale: {
          hostname: status.hostname,
          tailnet: status.tailnet ?? '',
          magicDnsUrl: publicUrl,
        },
      };
      await db
        .update(households)
        .set({
          settings: { ...existing, remoteAccess: newRemote as RemoteAccessSettings },
          updatedAt: new Date(),
        })
        .where(eq(households.id, request.user!.householdId));

      return {
        success: true,
        data: { publicUrl, remoteAccess: newRemote },
      };
    }
  );

  app.post(
    '/remote-access/tailscale/disable',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request, reply) => {
      const result = await disableServe();
      if (!result.success) {
        reply.code(409);
        return {
          success: false,
          error: {
            code: 'TAILSCALE_RESET_FAILED',
            message: result.error ?? 'tailscale serve reset failed',
          },
        };
      }
      // Clear the publicUrl so we don't keep advertising an https URL that no
      // longer terminates anywhere.
      const current = await db.query.households.findFirst({
        where: eq(households.id, request.user!.householdId),
        columns: { settings: true },
      });
      const existing = (current?.settings as Record<string, unknown>) ?? {};
      const existingRemote =
        (existing.remoteAccess as Record<string, unknown> | undefined) ?? {};
      const { publicUrl: _ignored, ...rest } = existingRemote;
      await db
        .update(households)
        .set({
          settings: { ...existing, remoteAccess: rest as RemoteAccessSettings },
          updatedAt: new Date(),
        })
        .where(eq(households.id, request.user!.householdId));
      return { success: true, data: { remoteAccess: rest } };
    }
  );

  app.post(
    '/remote-access/tailscale/funnel/enable',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (_request, reply) => {
      const status = await getTailscaleStatus();
      if (!status.available) {
        reply.code(409);
        return {
          success: false,
          error: {
            code: 'TAILSCALE_UNAVAILABLE',
            message: 'Tailscale is not available on this host',
            issues: status.issues,
          },
        };
      }
      const result = await configureFunnel(PUBLIC_ICS_PATH, config.PORT);
      if (!result.success) {
        reply.code(409);
        return {
          success: false,
          error: {
            code: 'TAILSCALE_FUNNEL_FAILED',
            message: result.error ?? 'tailscale funnel failed',
            issue: result.issue,
          },
        };
      }
      return {
        success: true,
        data: {
          path: PUBLIC_ICS_PATH,
          publicHostname: status.hostname,
        },
      };
    }
  );

  app.post(
    '/remote-access/tailscale/funnel/disable',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (_request, reply) => {
      const result = await disableFunnel(PUBLIC_ICS_PATH);
      if (!result.success) {
        reply.code(409);
        return {
          success: false,
          error: { code: 'TAILSCALE_FUNNEL_RESET_FAILED', message: result.error },
        };
      }
      return { success: true, data: { message: 'Funnel disabled' } };
    }
  );

  // ─── Cloudflare Tunnel: detect + connect/disconnect ──────────────────────

  const connectCloudflareSchema = z.object({
    token: z.string().min(20, 'Token looks too short'),
    publicUrl: remoteAccessUrlSchema,
  });

  app.get(
    '/remote-access/cloudflare/detect',
    { preHandler: [authMiddleware] },
    async () => {
      const status = await getCloudflaredStatus();
      return { success: true, data: status };
    }
  );

  app.post(
    '/remote-access/cloudflare/connect',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request, reply) => {
      const { token, publicUrl } = connectCloudflareSchema.parse(request.body);
      const status = await startCloudflareTunnel(token);
      if (!status.running) {
        reply.code(409);
        return {
          success: false,
          error: {
            code: 'CLOUDFLARE_CONNECT_FAILED',
            message:
              status.lastError ??
              (status.issues[0] === 'not_installed'
                ? 'cloudflared is not installed on this host'
                : 'cloudflared failed to start'),
            issues: status.issues,
          },
        };
      }

      // Persist token + publicUrl into household settings so resumeTunnel()
      // can rehydrate on backend restart.
      const current = await db.query.households.findFirst({
        where: eq(households.id, request.user!.householdId),
        columns: { settings: true },
      });
      const existing = (current?.settings as Record<string, unknown>) ?? {};
      const existingRemote =
        (existing.remoteAccess as Record<string, unknown> | undefined) ?? {};
      const newRemote = {
        ...existingRemote,
        mode: 'cloudflare',
        publicUrl,
        cloudflare: { tunnelToken: token, tunnelId: 'managed' },
      };
      await db
        .update(households)
        .set({ settings: { ...existing, remoteAccess: newRemote as RemoteAccessSettings }, updatedAt: new Date() })
        .where(eq(households.id, request.user!.householdId));

      return { success: true, data: { status, publicUrl } };
    }
  );

  app.post(
    '/remote-access/cloudflare/disconnect',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      stopCloudflareTunnel();

      const current = await db.query.households.findFirst({
        where: eq(households.id, request.user!.householdId),
        columns: { settings: true },
      });
      const existing = (current?.settings as Record<string, unknown>) ?? {};
      const existingRemote =
        (existing.remoteAccess as Record<string, unknown> | undefined) ?? {};
      const { cloudflare: _drop, publicUrl: _drop2, ...rest } = existingRemote;
      await db
        .update(households)
        .set({ settings: { ...existing, remoteAccess: rest as RemoteAccessSettings }, updatedAt: new Date() })
        .where(eq(households.id, request.user!.householdId));

      return { success: true, data: { message: 'Cloudflare tunnel stopped' } };
    }
  );

  // ─── Basis Remote: claim / connect / disconnect / status ─────────────────
  // The paid lastname.home-basis.com tunnel. The box redeems a one-time claim
  // code from the customer's home-basis.com dashboard, persists the returned
  // credentials, then runs frpc against our relay.

  const claimBasisRemoteSchema = z.object({
    claimCode: z
      .string()
      .transform((s) => s.toUpperCase().replace(/[\s-]/g, ''))
      .pipe(z.string().regex(/^[A-Z0-9]{12}$/, 'Claim code should look like XXXX-XXXX-XXXX'))
      .transform((s) => `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`),
  });

  app.get(
    '/remote-access/basis-remote/status',
    { preHandler: [authMiddleware] },
    async (request) => {
      const status = await getBasisRemoteStatus();
      const household = await db.query.households.findFirst({
        where: eq(households.id, request.user!.householdId),
        columns: { settings: true },
      });
      const remote = (household?.settings as any)?.remoteAccess;
      return {
        success: true,
        data: { ...status, claimed: !!remote?.basisRemote?.tunnelToken },
      };
    }
  );

  app.post(
    '/remote-access/basis-remote/claim',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request, reply) => {
      const { claimCode } = claimBasisRemoteSchema.parse(request.body);

      // Claim codes are one-time: refuse before redeeming if frpc isn't even
      // installed, so the user can run the guided install without burning it.
      const preStatus = await getBasisRemoteStatus();
      if (!preStatus.installed) {
        reply.code(409);
        return {
          success: false,
          error: {
            code: 'FRPC_NOT_INSTALLED',
            message: 'frpc is not installed yet — use the guided install first',
          },
        };
      }

      let claim;
      try {
        claim = await claimBox(claimCode);
      } catch (err) {
        if (err instanceof ClaimError) {
          reply.code(err.code === 'CLOUD_UNREACHABLE' || err.code === 'CLOUD_ERROR' ? 502 : 400);
          return { success: false, error: { code: err.code, message: err.message } };
        }
        throw err;
      }

      // Persist BEFORE starting the tunnel: the code is spent — if the spawn
      // fails the credentials must survive so /connect can retry.
      const publicUrl = `https://${claim.hostname}`;
      const current = await db.query.households.findFirst({
        where: eq(households.id, request.user!.householdId),
        columns: { settings: true },
      });
      const existing = (current?.settings as Record<string, unknown>) ?? {};
      const existingRemote =
        (existing.remoteAccess as Record<string, unknown> | undefined) ?? {};
      const newRemote = {
        ...existingRemote,
        mode: 'basis_remote',
        publicUrl,
        basisRemote: claim,
      };
      await db
        .update(households)
        .set({ settings: { ...existing, remoteAccess: newRemote as RemoteAccessSettings }, updatedAt: new Date() })
        .where(eq(households.id, request.user!.householdId));

      // Claimed-but-not-yet-connected is a valid state (e.g. relay briefly
      // unreachable) — return 200 with running=false and let the UI offer retry.
      const status = await startBasisRemote(claim);
      return {
        success: true,
        data: { status, hostname: claim.hostname, publicUrl },
      };
    }
  );

  app.post(
    '/remote-access/basis-remote/connect',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request, reply) => {
      const household = await db.query.households.findFirst({
        where: eq(households.id, request.user!.householdId),
        columns: { settings: true },
      });
      const stored = (household?.settings as any)?.remoteAccess?.basisRemote;
      if (!stored?.tunnelToken) {
        reply.code(409);
        return {
          success: false,
          error: { code: 'NOT_CLAIMED', message: 'This box has not been linked to a Basis Remote subscription yet' },
        };
      }
      const status = await startBasisRemote(stored);
      if (!status.running) {
        reply.code(409);
        return {
          success: false,
          error: {
            code: 'BASIS_REMOTE_CONNECT_FAILED',
            message:
              status.lastError ??
              (status.issues[0] === 'not_installed'
                ? 'frpc is not installed on this host'
                : 'frpc failed to start'),
            issues: status.issues,
          },
        };
      }
      return { success: true, data: { status } };
    }
  );

  app.post(
    '/remote-access/basis-remote/disconnect',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      stopBasisRemote();

      // Local-only: drops the stored credentials and stops frpc. Releasing the
      // subdomain / revoking the token server-side happens on home-basis.com.
      const current = await db.query.households.findFirst({
        where: eq(households.id, request.user!.householdId),
        columns: { settings: true },
      });
      const existing = (current?.settings as Record<string, unknown>) ?? {};
      const existingRemote =
        (existing.remoteAccess as Record<string, unknown> | undefined) ?? {};
      const { basisRemote: _drop, publicUrl: _drop2, ...rest } = existingRemote;
      await db
        .update(households)
        .set({ settings: { ...existing, remoteAccess: rest as RemoteAccessSettings }, updatedAt: new Date() })
        .where(eq(households.id, request.user!.householdId));

      return { success: true, data: { message: 'Basis Remote tunnel stopped' } };
    }
  );

  // ─── Custom Domain: reachability probe ───────────────────────────────────

  const testUrlSchema = z.object({ url: remoteAccessUrlSchema });

  app.post(
    '/remote-access/test-url',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const { url } = testUrlSchema.parse(request.body);
      // HEAD the URL from the server side. We're not trying to validate auth,
      // just that the URL terminates somewhere that responds. 5s timeout —
      // longer than that, the user definitely has a routing problem.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      const start = Date.now();
      try {
        const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
        const elapsedMs = Date.now() - start;
        return {
          success: true,
          data: { ok: true, status: res.status, elapsedMs },
        };
      } catch (err) {
        const elapsedMs = Date.now() - start;
        const e = err as { name?: string; message?: string; cause?: { code?: string } };
        return {
          success: true,
          data: {
            ok: false,
            elapsedMs,
            reason:
              e.name === 'AbortError'
                ? 'Request timed out after 5s'
                : e.cause?.code === 'ENOTFOUND'
                ? 'DNS lookup failed — domain does not resolve'
                : e.cause?.code === 'ECONNREFUSED'
                ? 'Connection refused — nothing listening at that host:port'
                : e.cause?.code === 'CERT_HAS_EXPIRED'
                ? 'TLS certificate has expired'
                : e.cause?.code ?? e.message ?? 'Unknown error',
          },
        };
      } finally {
        clearTimeout(timeout);
      }
    }
  );

  // Get remote access URLs
  app.get(
    '/remote-access/url',
    { preHandler: [authMiddleware] },
    async (request) => {
      const household = await db.query.households.findFirst({
        where: eq(households.id, request.user!.householdId),
        columns: { settings: true },
      });

      const settings = household?.settings as any;
      const remoteAccess = settings?.remoteAccess || {};

      return {
        success: true,
        data: {
          publicUrl: remoteAccess.publicUrl,
          localUrl: remoteAccess.localUrl,
          mode: remoteAccess.mode,
        },
      };
    }
  );

  // ===== DDNS =====

  app.get(
    '/remote-access/ddns',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const config = await db.query.ddnsConfig.findFirst({
        where: eq(ddnsConfig.householdId, request.user!.householdId),
      });

      if (!config) {
        return { success: true, data: { ddns: null } };
      }

      // Don't return credentials
      const { credentials, ...ddns } = config;
      return { success: true, data: { ddns } };
    }
  );

  app.post(
    '/remote-access/ddns',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const input = configureDdnsSchema.parse(request.body);

      // Check if already exists
      const existing = await db.query.ddnsConfig.findFirst({
        where: eq(ddnsConfig.householdId, request.user!.householdId),
      });

      if (existing) {
        throw Errors.duplicate('DDNS configuration');
      }

      const [config] = await db
        .insert(ddnsConfig)
        .values({
          householdId: request.user!.householdId,
          provider: input.provider,
          domain: input.domain,
          credentials: input.credentials, // TODO: encrypt
          updateIntervalMinutes: input.updateIntervalMinutes,
        })
        .returning();

      const { credentials, ...ddns } = config;
      return { success: true, data: { ddns } };
    }
  );

  app.delete(
    '/remote-access/ddns',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      await db
        .delete(ddnsConfig)
        .where(eq(ddnsConfig.householdId, request.user!.householdId));

      return { success: true, data: { message: 'DDNS configuration removed' } };
    }
  );

  // ===== EXTENSIONS =====

  app.get(
    '/extensions',
    { preHandler: [authMiddleware] },
    async (request) => {
      const extensionList = await db.query.extensions.findMany({
        where: eq(extensions.householdId, request.user!.householdId),
      });

      return { success: true, data: { extensions: extensionList } };
    }
  );

  app.get<{ Params: { slug: string } }>(
    '/extensions/:slug',
    { preHandler: [authMiddleware] },
    async (request) => {
      const extension = await db.query.extensions.findFirst({
        where: and(
          eq(extensions.householdId, request.user!.householdId),
          eq(extensions.slug, request.params.slug)
        ),
      });

      if (!extension) throw Errors.notFound('Extension');

      return { success: true, data: { extension } };
    }
  );

  app.patch<{ Params: { slug: string } }>(
    '/extensions/:slug/config',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const config = request.body as Record<string, unknown>;

      const [updated] = await db
        .update(extensions)
        .set({ config, updatedAt: new Date() })
        .where(
          and(
            eq(extensions.householdId, request.user!.householdId),
            eq(extensions.slug, request.params.slug)
          )
        )
        .returning();

      if (!updated) throw Errors.notFound('Extension');

      return { success: true, data: { extension: updated } };
    }
  );

  app.post<{ Params: { slug: string } }>(
    '/extensions/:slug/enable',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      await db
        .update(extensions)
        .set({ isEnabled: true, updatedAt: new Date() })
        .where(
          and(
            eq(extensions.householdId, request.user!.householdId),
            eq(extensions.slug, request.params.slug)
          )
        );

      return { success: true, data: { message: 'Extension enabled' } };
    }
  );

  app.post<{ Params: { slug: string } }>(
    '/extensions/:slug/disable',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      await db
        .update(extensions)
        .set({ isEnabled: false, updatedAt: new Date() })
        .where(
          and(
            eq(extensions.householdId, request.user!.householdId),
            eq(extensions.slug, request.params.slug)
          )
        );

      return { success: true, data: { message: 'Extension disabled' } };
    }
  );

  app.delete<{ Params: { slug: string } }>(
    '/extensions/:slug',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      await db
        .delete(extensions)
        .where(
          and(
            eq(extensions.householdId, request.user!.householdId),
            eq(extensions.slug, request.params.slug)
          )
        );

      return { success: true, data: { message: 'Extension uninstalled' } };
    }
  );

  // ===== MUSIC INTEGRATIONS =====

  app.get(
    '/music/integrations',
    { preHandler: [authMiddleware] },
    async (request) => {
      const integrations = await db.query.musicIntegrations.findMany({
        where: eq(musicIntegrations.householdId, request.user!.householdId),
        columns: {
          id: true,
          provider: true,
          isActive: true,
          connectedAt: true,
          userId: true,
        },
      });

      return { success: true, data: { integrations } };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/music/integrations/:id',
    { preHandler: [authMiddleware] },
    async (request) => {
      await db
        .delete(musicIntegrations)
        .where(
          and(
            eq(musicIntegrations.id, request.params.id),
            eq(musicIntegrations.householdId, request.user!.householdId)
          )
        );

      return { success: true, data: { message: 'Integration disconnected' } };
    }
  );
}
