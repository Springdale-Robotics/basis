import type { FastifyInstance } from 'fastify';
import { authMiddleware, requireAdmin } from '../../middleware/auth.middleware.js';
import { listAvailableInstallers, CLOUDFLARED_LOCAL_PATH } from './installer-commands.js';
import { promises as fs } from 'fs';

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
}
