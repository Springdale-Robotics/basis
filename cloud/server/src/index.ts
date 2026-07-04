import { buildApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { sql } from './db/index.js';
import { startUsageMeter, stopUsageMeter } from './services/usage-meter.service.js';

let isShuttingDown = false;

async function main(): Promise<void> {
  logger.info({ env: config.NODE_ENV }, 'Starting Basis Remote control plane...');

  const app = await buildApp();
  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info({ host: config.HOST, port: config.PORT }, 'Control plane listening');

  startUsageMeter();

  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    const timeout = setTimeout(() => process.exit(0), 10_000);
    try {
      stopUsageMeter();
      await app.close();
      await sql.end({ timeout: 5 });
      clearTimeout(timeout);
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      clearTimeout(timeout);
      process.exit(1);
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => void shutdown(signal));
  }
  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'Uncaught exception');
    void shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled rejection');
    void shutdown('unhandledRejection');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
