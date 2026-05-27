import { buildApp } from './app.js';
import { initializeWebSocket } from './websocket/index.js';
import { initializeWorkers, scheduleRecurringJobs, shutdownWorkers } from './jobs/index.js';
import { redis } from './config/redis.js';
import { logger } from './lib/logger.js';
import { config } from './config/index.js';
import { db } from './config/database.js';
import { households } from './db/schema/index.js';
import { resumeTunnel, stopTunnel as stopCloudflareTunnel } from './lib/cloudflared.js';

const signals = ['SIGINT', 'SIGTERM'];
let isShuttingDown = false;

async function main(): Promise<void> {
  logger.info({ env: config.NODE_ENV }, 'Starting HomeManager backend...');

  try {
    // Build Fastify app
    const app = await buildApp();

    // Wait for Fastify to be ready (plugins loaded, routes registered)
    await app.ready();

    // Initialize WebSocket on Fastify's internal HTTP server
    initializeWebSocket(app.server);
    logger.info('WebSocket server attached');

    // Initialize background workers
    await initializeWorkers();

    // Schedule recurring jobs
    await scheduleRecurringJobs();

    // Start server
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    logger.info({ port: config.PORT }, 'Server listening');

    // Resume Cloudflare tunnel if one was previously configured. Looks at the
    // first household with a stored token — matches Tailscale's single-host
    // assumption (one backend, one tunnel).
    void (async () => {
      try {
        const all = await db.query.households.findMany({ columns: { settings: true } });
        for (const h of all) {
          const remote = (h.settings as any)?.remoteAccess;
          const token = remote?.cloudflare?.tunnelToken;
          if (token && remote?.mode === 'cloudflare') {
            await resumeTunnel(token);
            break;
          }
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to resume Cloudflare tunnel');
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
        // Stop the Cloudflare tunnel child before everything else so it gets a
        // clean SIGTERM rather than being orphaned.
        stopCloudflareTunnel();

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
      shutdown('uncaughtException');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      const stack = reason instanceof Error ? reason.stack : undefined;
      logger.fatal({ reason, message, stack }, 'Unhandled promise rejection');
      shutdown('unhandledRejection');
    });
  } catch (error) {
    logger.fatal({ error, errorMessage: error instanceof Error ? error.message : String(error), errorStack: error instanceof Error ? error.stack : undefined }, 'Failed to start server');
    process.exit(1);
  }
}

main();
