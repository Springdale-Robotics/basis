import { randomUUID } from 'crypto';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyCompress from '@fastify/compress';
import fastifyMultipart from '@fastify/multipart';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import { resolve as resolvePath, sep } from 'path';
import { existsSync } from 'fs';

import { config, isDev } from './config/index.js';
import { logger } from './lib/logger.js';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { recordHttpRequest } from './lib/metrics.js';

// Import route modules
import { authRoutes } from './modules/auth/auth.routes.js';
import { householdsRoutes } from './modules/households/households.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { devicesRoutes } from './modules/devices/devices.routes.js';
import { calendarsRoutes } from './modules/calendars/calendars.routes.js';
import { syncRoutes } from './modules/calendars/sync.routes.js';
import { calendarSharingRoutes } from './modules/calendars/sharing.routes.js';
import { calendarPublicRoutes } from './modules/calendars/public.routes.js';
import { recipesRoutes } from './modules/recipes/recipes.routes.js';
import { inventoryRoutes } from './modules/inventory/inventory.routes.js';
import { tasksRoutes } from './modules/tasks/tasks.routes.js';
import { filesRoutes } from './modules/files/files.routes.js';
import { listsRoutes } from './modules/lists/lists.routes.js';
import { notificationsRoutes } from './modules/notifications/notifications.routes.js';
import { settingsRoutes } from './modules/settings/settings.routes.js';
import { backupRoutes } from './modules/backup/backup.routes.js';
import { connectionsRoutes } from './modules/connections/connections.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { setupRoutes } from './modules/setup/setup.routes.js';
import { photosRoutes } from './modules/photos/photos.routes.js';
import { videosRoutes } from './modules/videos/videos.routes.js';
import { moviesRoutes } from './modules/movies/movies.routes.js';
import { musicRoutes } from './modules/music/music.routes.js';
import { groupsRoutes } from './modules/groups/groups.routes.js';
import { permissionsRoutes } from './modules/permissions/permissions.routes.js';
import { imageParseRoutes } from './modules/image-parse/image-parse.routes.js';
import { appPasswordsRoutes } from './modules/app-passwords/app-passwords.routes.js';
import { caldavRoutes, caldavWellKnownRoutes, caldavRootProbeRoutes } from './modules/caldav/caldav.routes.js';
import { connectRoutes, connectDownloadRoutes } from './modules/connect/connect.routes.js';
import { installRoutes } from './modules/install/install.routes.js';
import { systemRoutes } from './modules/system/system.routes.js';
import { systemBackupRoutes } from './modules/system/system-backup.routes.js';
import { bugReportsRoutes } from './modules/bug-reports/bug-reports.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // We use our own logger
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    // Trust X-Forwarded-* from reverse proxies (Caddy, nginx, Cloudflare Tunnel, Tailscale serve).
    // Required for getCanonicalUrl() to honor the proxy-supplied scheme/host when no publicUrl is set.
    trustProxy: true,
  });

  // Request ID middleware (run first)
  app.addHook('onRequest', requestIdMiddleware);

  // CalDAV / WebDAV content types — registered globally so the /.well-known
  // probes and /dav routes both accept iOS's text/xml bodies without Fastify
  // rejecting them with FST_ERR_CTP_INVALID_MEDIA_TYPE before our handlers run.
  app.addContentTypeParser(
    ['application/xml', 'text/xml', 'text/calendar', 'application/octet-stream'],
    { parseAs: 'string' },
    (_req, body, done) => done(null, body)
  );

  // Security headers. Keep Helmet's CSP defaults in production but drop
  // `upgrade-insecure-requests`: Basis is served over plain HTTP on the LAN by
  // default (TLS, when used, is terminated upstream by Tailscale / Cloudflare /
  // a reverse proxy). That directive would force the browser to fetch
  // same-origin assets over https://<host>:3000 — which has no TLS — producing
  // "SSL error" failures for the JS/CSS/manifest. Disabled entirely in dev,
  // where Vite serves the frontend.
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: isDev
      ? false
      : {
          useDefaults: true,
          directives: {
            'upgrade-insecure-requests': null,
            // Cloudflare proxies inject the Web Analytics beacon (beacon.min.js
            // from static.cloudflareinsights.com, posting to cloudflareinsights.com)
            // into proxied HTML. Allow it so it doesn't trip CSP; harmless when
            // the deployment isn't fronted by Cloudflare. Disable Web Analytics
            // in the Cloudflare dashboard instead if you'd rather not run it.
            'script-src': ["'self'", 'https://static.cloudflareinsights.com'],
            'connect-src': ["'self'", 'https://cloudflareinsights.com'],
          },
        },
  });

  // CORS for API routes. strictPreflight: false lets non-browser OPTIONS
  // requests (e.g. CalDAV clients) fall through to their own handlers instead
  // of being rejected with "Invalid Preflight Request".
  const corsOrigins = config.CORS_ORIGINS
    ? config.CORS_ORIGINS.split(',').map((o) => o.trim())
    : [];

  // CORS is registered later, inside a scope that wraps all API routes.
  // CalDAV/WebDAV routes mount outside that scope and bypass CORS entirely —
  // they're native (non-browser) clients that don't send Origin headers.

  // Compression registered inside the API scope below — CalDAV responses
  // shouldn't be gzipped (native clients may not negotiate encoding correctly,
  // and we hit an empty-body bug with fastify-compress + application/xml).

  // Cookies
  await app.register(fastifyCookie, {
    secret: config.SESSION_SECRET,
  });

  // File uploads
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: config.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
    },
  });

  // Swagger documentation (development only)
  if (isDev) {
    await app.register(fastifySwagger, {
      openapi: {
        info: {
          title: 'Basis API',
          description: 'Self-hosted household management server',
          version: '1.0.0',
        },
        servers: [
          {
            url: `http://localhost:${config.PORT}`,
            description: 'Development server',
          },
        ],
        components: {
          securitySchemes: {
            cookieAuth: {
              type: 'apiKey',
              in: 'cookie',
              name: 'session',
            },
          },
        },
      },
    });

    await app.register(fastifySwaggerUi, {
      routePrefix: '/api/docs',
    });
  }

  // Request logging and metrics
  app.addHook('onResponse', (request, reply, done) => {
    const duration = reply.elapsedTime;
    const { method, url } = request;
    const statusCode = reply.statusCode;

    logger.info({
      requestId: request.requestId,
      method,
      url,
      statusCode,
      duration: `${duration.toFixed(2)}ms`,
    });

    recordHttpRequest(method, url, statusCode, duration);
    done();
  });

  // Error handling. The not-found handler is registered later — Fastify allows
  // only one per context, and when we serve the SPA (FRONTEND_DIST) the
  // fallback handler is it; otherwise we install the plain JSON 404 handler.
  app.setErrorHandler(errorHandler);

  // ─── API surface (browser-facing, CORS-enabled) ────────────────────────
  // All /api/* routes live inside a Fastify scope so the CORS plugin is
  // limited to them. CalDAV at /dav/ and /.well-known/caldav stay outside.
  await app.register(async (apiScope) => {
    await apiScope.register(fastifyCors, {
      // Default (no CORS_ORIGINS configured): same-origin only. The backend
      // serves the SPA itself and dev uses Vite's /api proxy, so cross-origin
      // access isn't needed by default. `origin: true` would instead reflect
      // ANY origin and, with credentials enabled, let other websites make
      // credentialed calls to this API — set an explicit allowlist instead.
      origin: corsOrigins.length > 0 ? corsOrigins : false,
      credentials: true,
    });
    await apiScope.register(fastifyCompress);

    await apiScope.register(healthRoutes, { prefix: '/api/v1/health' });
    await apiScope.register(setupRoutes, { prefix: '/api/v1/setup' });
    await apiScope.register(authRoutes, { prefix: '/api/v1/auth' });
    await apiScope.register(householdsRoutes, { prefix: '/api/v1/households' });
    await apiScope.register(usersRoutes, { prefix: '/api/v1/users' });
    await apiScope.register(devicesRoutes, { prefix: '/api/v1/devices' });
    await apiScope.register(calendarsRoutes, { prefix: '/api/v1/calendars' });
    await apiScope.register(syncRoutes, { prefix: '/api/v1/calendars' });
    await apiScope.register(calendarSharingRoutes, { prefix: '/api/v1/calendars' });
    await apiScope.register(calendarPublicRoutes, { prefix: '/api/v1/calendars' });
    await apiScope.register(recipesRoutes, { prefix: '/api/v1/recipes' });
    await apiScope.register(inventoryRoutes, { prefix: '/api/v1/inventory' });
    await apiScope.register(tasksRoutes, { prefix: '/api/v1/tasks' });
    await apiScope.register(filesRoutes, { prefix: '/api/v1/files' });
    await apiScope.register(listsRoutes, { prefix: '/api/v1/lists' });
    await apiScope.register(notificationsRoutes, { prefix: '/api/v1/notifications' });
    await apiScope.register(settingsRoutes, { prefix: '/api/v1/settings' });
    await apiScope.register(backupRoutes, { prefix: '/api/v1/backup' });
    await apiScope.register(connectionsRoutes, { prefix: '/api/v1/connections' });
    await apiScope.register(photosRoutes, { prefix: '/api/v1/photos' });
    await apiScope.register(videosRoutes, { prefix: '/api/v1/videos' });
    await apiScope.register(moviesRoutes, { prefix: '/api/v1/media' });
    await apiScope.register(musicRoutes, { prefix: '/api/v1/music' });
    await apiScope.register(groupsRoutes, { prefix: '/api/v1/groups' });
    await apiScope.register(permissionsRoutes, { prefix: '/api/v1/permissions' });
    await apiScope.register(imageParseRoutes, { prefix: '/api/v1/image-parse' });
    await apiScope.register(appPasswordsRoutes, { prefix: '/api/v1/users/me/app-passwords' });
    await apiScope.register(connectRoutes, { prefix: '/api/v1/users/me/connect' });
    await apiScope.register(connectDownloadRoutes, { prefix: '/api/v1/connect' });
    await apiScope.register(installRoutes, { prefix: '/api/v1/install' });
    await apiScope.register(systemRoutes, { prefix: '/api/v1/system' });
    await apiScope.register(systemBackupRoutes, { prefix: '/api/v1/system/backups' });
    await apiScope.register(bugReportsRoutes, { prefix: '/api/v1/bug-reports' });
  });

  // ─── CalDAV (native-client surface, no CORS) ───────────────────────────
  await app.register(caldavRoutes, { prefix: '/dav' });
  await app.register(caldavWellKnownRoutes, { prefix: '/.well-known' });
  // Catch the legacy probe paths iOS Calendar tries before falling back to
  // /.well-known/caldav (PROPFIND only — GET / still serves the SPA).
  await app.register(caldavRootProbeRoutes);

  // ─── Frontend static serving (production single-port deployment) ───────
  // When FRONTEND_DIST is set (typically by the install script to
  // /opt/basis/current/frontend/dist), serve it at / with SPA fallback so
  // client-side routes resolve to index.html. Skipped in dev — Vite owns
  // :5173 there and proxies /api here.
  let spaFallbackInstalled = false;
  if (config.FRONTEND_DIST) {
    const dist = resolvePath(config.FRONTEND_DIST);
    if (existsSync(dist)) {
      await app.register(fastifyStatic, {
        root: dist,
        prefix: '/',
        wildcard: false,
        setHeaders(res, filePath) {
          // The shell must always be revalidated so a deploy that swaps asset
          // hashes is picked up; hashed assets are content-addressed and safe
          // to cache forever.
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          } else if (filePath.includes(`${sep}assets${sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      });
      app.setNotFoundHandler((request, reply) => {
        // API requests still get JSON 404s. Anything else falls through to
        // the SPA's index.html — React Router resolves the route client-side.
        const url = request.url;
        if (url.startsWith('/api/') || url.startsWith('/dav') || url.startsWith('/socket.io')) {
          return notFoundHandler(request, reply);
        }
        // A request for a file with an extension (e.g. /assets/index-abc.js)
        // that reached here doesn't exist on disk. Return a real 404 rather
        // than the SPA shell — serving index.html (text/html) for a missing
        // .js/.css makes the browser throw "'text/html' is not a valid
        // JavaScript MIME type" after a deploy rotates asset hashes and a
        // stale client (or service worker) still references the old ones.
        const pathname = url.split('?')[0];
        if (/\.[^/]+$/.test(pathname)) {
          return notFoundHandler(request, reply);
        }
        return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
      });
      spaFallbackInstalled = true;
      logger.info({ dist }, 'Serving frontend from FRONTEND_DIST');
    } else {
      logger.warn({ dist }, 'FRONTEND_DIST is set but the directory does not exist');
    }
  }

  // No SPA to fall back to (dev, or FRONTEND_DIST missing): plain JSON 404s.
  if (!spaFallbackInstalled) {
    app.setNotFoundHandler(notFoundHandler);
  }

  return app;
}
