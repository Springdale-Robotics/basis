import type { FastifyInstance } from 'fastify';
import { authMiddleware, requireAdmin } from '../../middleware/auth.middleware.js';
import { listAvailableInstallers, CLOUDFLARED_LOCAL_PATH } from './installer-commands.js';
import { promises as fs } from 'fs';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { getAppVersion } from '../../lib/app-version.js';
import { compareVersions } from '../../lib/semver.js';
import { resolveLatestRelease, type ResolvedRelease } from './github-release.js';

export async function installRoutes(app: FastifyInstance): Promise<void> {
  // Surface host platform / arch / distro so the frontend can pick the right
  // installer id. Admin-only — we don't surface system internals to non-admin
  // members.
  app.get(
    '/host-info',
    { preHandler: [authMiddleware, requireAdmin()] },
    async () => {
      let distro: string | undefined;
      if (process.platform === 'linux') {
        try {
          const release = await fs.readFile('/etc/os-release', 'utf8');
          const m = release.match(/^ID=("?)(.*?)\1$/m);
          if (m) distro = m[2];
        } catch {
          /* no /etc/os-release — leave undefined */
        }
      }

      let cloudflaredLocal = false;
      try {
        const stat = await fs.stat(CLOUDFLARED_LOCAL_PATH);
        cloudflaredLocal = stat.isFile();
      } catch {
        /* not installed locally */
      }

      return {
        success: true,
        data: {
          platform: process.platform,
          arch: process.arch,
          distro,
          cloudflaredLocalPath: cloudflaredLocal ? CLOUDFLARED_LOCAL_PATH : null,
        },
      };
    }
  );

  app.get(
    '/available',
    { preHandler: [authMiddleware, requireAdmin()] },
    async () => ({
      success: true,
      data: { installers: listAvailableInstallers() },
    })
  );

  // ─── App version + update check ────────────────────────────────────────
  // Surfaces what version of Basis is currently installed and (optionally)
  // what the latest GitHub release is. The frontend Updates page uses this
  // to decide whether to offer the "Update now" button.
  app.get(
    '/version',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const current = await getAppVersion();
      const productionInstall = !!config.FRONTEND_DIST && current !== 'dev';

      const includePrerelease = (request.query as any)?.prerelease !== 'false';
      let resolved: ResolvedRelease | null = null;
      let checkError: string | undefined;
      try {
        resolved = await resolveLatestRelease(includePrerelease);
      } catch (err) {
        checkError = err instanceof Error ? err.message : String(err);
        logger.warn({ err }, 'GitHub release check failed');
      }

      // Only offer an update when the latest release is genuinely NEWER than
      // what's installed — a semver comparison, never a string diff (which
      // would rank 0.1.9 above 0.1.14 and offer a downgrade as an "update").
      const latest = resolved?.release ?? null;
      const latestVersion = resolved?.version ?? null;
      const updateAvailable =
        productionInstall &&
        latestVersion !== null &&
        current !== 'dev' &&
        compareVersions(latestVersion, current) > 0;

      return {
        success: true,
        data: {
          current,
          productionInstall,
          latest: latest && {
            version: latestVersion,
            tag: latest.tag_name,
            name: latest.name,
            body: latest.body,
            prerelease: latest.prerelease,
            publishedAt: latest.published_at,
            url: latest.html_url,
            tarball: resolved?.tarballUrl ?? undefined,
          },
          updateAvailable,
          checkError,
        },
      };
    }
  );
}
