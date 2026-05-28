// Dedicated background-job worker process.
//
// Used by the native systemd install (basis-worker.service → `node
// dist/worker.js`), where the API process runs with WORKERS_IN_PROCESS=false
// so jobs aren't processed twice. In single-process deployments (dev, Docker)
// the API process runs the workers itself and this file isn't used.
import { initializeWorkers, scheduleRecurringJobs, shutdownWorkers } from './jobs/index.js';
import { redis } from './config/redis.js';
import { logger } from './lib/logger.js';
import { config } from './config/index.js';

const signals = ['SIGINT', 'SIGTERM'] as const;
let isShuttingDown = false;

async function main(): Promise<void> {
  logger.info({ env: config.NODE_ENV }, 'Starting Basis worker...');

  try {
    await initializeWorkers();
    await scheduleRecurringJobs();
    logger.info('Worker process ready — processing background jobs');

    const shutdown = async (signal: string): Promise<void> => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      logger.info({ signal }, 'Worker received shutdown signal');

      const timeoutMs = config.NODE_ENV === 'development' ? 2000 : 30000;
      const shutdownTimeout = setTimeout(() => {
        logger.warn('Worker shutdown timeout exceeded, forcing exit');
        process.exit(0);
      }, timeoutMs);

      try {
        await shutdownWorkers();
        await redis.quit();
        clearTimeout(shutdownTimeout);
        logger.info('Worker graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error({ error }, 'Error during worker shutdown');
        clearTimeout(shutdownTimeout);
        process.exit(1);
      }
    };

    for (const signal of signals) {
      process.on(signal, () => shutdown(signal));
    }

    process.on('uncaughtException', (error) => {
      logger.fatal({ error, message: error?.message, stack: error?.stack }, 'Worker uncaught exception');
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      const stack = reason instanceof Error ? reason.stack : undefined;
      logger.fatal({ reason, message, stack }, 'Worker unhandled promise rejection');
      shutdown('unhandledRejection');
    });
  } catch (error) {
    logger.fatal(
      { error, errorMessage: error instanceof Error ? error.message : String(error) },
      'Failed to start worker'
    );
    process.exit(1);
  }
}

main();
