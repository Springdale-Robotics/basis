import type { FastifyInstance } from 'fastify';
import { authMiddleware, requireAdmin } from '../../middleware/auth.middleware.js';
import { listAvailableInstallers, CLOUDFLARED_LOCAL_PATH } from './installer-commands.js';
import { promises as fs } from 'fs';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { getAppVersion } from '../../lib/app-version.js';

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  prerelease: boolean;
  published_at: string;
  html_url: string;
  assets: Array<{ name: string; browser_download_url: string; size: number }>;
}

const GITHUB_REPO = 'Springdale-Robotics/basis';

async function fetchLatestRelease(includePrerelease: boolean): Promise<GitHubRelease | null> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=10`;
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status}`);
  }
  const releases = (await res.json()) as GitHubRelease[];
  const filtered = includePrerelease ? releases : releases.filter((r) => !r.prerelease);
  return filtered[0] ?? null;
}

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
      let latest: GitHubRelease | null = null;
      let checkError: string | undefined;
      try {
        latest = await fetchLatestRelease(includePrerelease);
      } catch (err) {
        checkError = err instanceof Error ? err.message : String(err);
        logger.warn({ err }, 'GitHub release check failed');
      }

      // Naive "is update available" — compare strings, since our tags are
      // semver-ish and lexicographic comparison gets us close enough.
      const latestVersion = latest?.tag_name.replace(/^v/, '') ?? null;
      const updateAvailable =
        productionInstall && latestVersion !== null && latestVersion !== current;

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
            tarball: latest.assets.find((a) => a.name.endsWith('.tar.gz'))?.browser_download_url,
          },
          updateAvailable,
          checkError,
        },
      };
    }
  );
}
