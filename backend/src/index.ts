import { buildApp } from './app.js';
import { initializeWebSocket } from './websocket/index.js';
import { initializeWorkers, scheduleRecurringJobs, shutdownWorkers } from './jobs/index.js';
import { redis } from './config/redis.js';
import { logger } from './lib/logger.js';
import { config } from './config/index.js';
import { db } from './config/database.js';
import { resumeTunnel, stopTunnel as stopCloudflareTunnel } from './lib/cloudflared.js';
import { resumeBasisRemote, stopBasisRemote } from './lib/basis-remote.js';
import { probeSharp } from './lib/sharp.js';
import { reportServerError } from './lib/error-reporter.js';

const signals = ['SIGINT', 'SIGTERM'];
let isShuttingDown = false;

async function main(): Promise<void> {
  logger.info({ env: config.NODE_ENV }, 'Starting Basis backend...');

  try {
    // Build Fastify app
    const app = await buildApp();

    // Wait for Fastify to be ready (plugins loaded, routes registered)
    await app.ready();

    // Initialize WebSocket on Fastify's internal HTTP server
    initializeWebSocket(app.server);
    logger.info('WebSocket server attached');

    // Initialize background workers in-process, unless a dedicated worker
    // process owns them (WORKERS_IN_PROCESS=false, set by the native systemd
    // install where basis-worker.service runs dist/worker.js).
    if (config.WORKERS_IN_PROCESS) {
      await initializeWorkers();
      await scheduleRecurringJobs();
    } else {
      logger.info('WORKERS_IN_PROCESS=false — background jobs run in the dedicated worker process');
    }

    // Start server
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    logger.info({ port: config.PORT }, 'Server listening');

    // Probe the optional native image library (sharp) without blocking or
    // crashing startup — surfaces a missing/broken binary in the journal up
    // front instead of only when a user first uploads an image.
    void probeSharp();

    // Resume the remote-access tunnel if one was previously configured. Looks
    // at the first household with a stored token — matches Tailscale's
    // single-host assumption (one backend, one tunnel).
    void (async () => {
      try {
        const all = await db.query.households.findMany({ columns: { settings: true } });
        for (const h of all) {
          const remote = (h.settings as any)?.remoteAccess;
          if (remote?.mode === 'cloudflare' && remote?.cloudflare?.tunnelToken) {
            await resumeTunnel(remote.cloudflare.tunnelToken);
            break;
          }
          if (remote?.mode === 'basis_remote' && remote?.basisRemote?.tunnelToken) {
            await resumeBasisRemote(remote.basisRemote);
            break;
          }
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to resume remote-access tunnel');
      }
    })();

    // Graceful shutdown handler
    const shutdown = async (signal: string): Promise<void> => {
      if (isShuttingDown) {
        logger.warn('Shutdown already in progress');
        return;
      }
      isShuttingDown = true;

      logger.info({ signal }, 'Received shutdown signal');

      // In development, use a very short timeout (2s) for fast restarts
      const timeoutMs = config.NODE_ENV === 'development' ? 2000 : 30000;
      const shutdownTimeout = setTimeout(() => {
        logger.warn('Shutdown timeout exceeded, forcing exit');
        process.exit(0);
      }, timeoutMs);

      try {
        // Stop the tunnel children before everything else so they get a
        // clean SIGTERM rather than being orphaned.
        stopCloudflareTunnel();
        stopBasisRemote();

        // Stop accepting new connections first
        await Promise.race([
          app.close(),
          new Promise((resolve) => setTimeout(resolve, 1000))
        ]);

        // In dev mode, skip waiting for workers/redis - just exit
        if (config.NODE_ENV === 'development') {
          clearTimeout(shutdownTimeout);
          process.exit(0);
          return;
        }

        // Production: graceful shutdown
        await shutdownWorkers();
        await redis.quit();

        clearTimeout(shutdownTimeout);
        logger.info('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error({ error }, 'Error during shutdown');
        clearTimeout(shutdownTimeout);
        process.exit(1);
      }
    };

    // Register signal handlers
    for (const signal of signals) {
      process.on(signal, () => shutdown(signal));
    }

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.fatal({ error, message: error?.message, stack: error?.stack }, 'Uncaught exception');
      // Report before tearing down (best-effort, short timeout), then shut down
      // regardless of whether delivery succeeded.
      void reportServerError('uncaughtException', error, {}, 2_000).finally(() =>
        shutdown('uncaughtException')
      );
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      const stack = reason instanceof Error ? reason.stack : undefined;
      logger.fatal({ reason, message, stack }, 'Unhandled promise rejection');
      void reportServerError('unhandledRejection', reason, {}, 2_000).finally(() =>
        shutdown('unhandledRejection')
      );
    });
  } catch (error) {
    logger.fatal({ error, errorMessage: error instanceof Error ? error.message : String(error), errorStack: error instanceof Error ? error.stack : undefined }, 'Failed to start server');
    process.exit(1);
  }
}

main();
