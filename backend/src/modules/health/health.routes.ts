import { FastifyInstance } from 'fastify';
import { checkDatabaseConnection } from '../../config/database.js';
import { checkRedisConnection } from '../../config/redis.js';
import { authMiddleware, requireAdmin } from '../../middleware/auth.middleware.js';
import { getCircuitBreakerStatus } from '../../lib/circuit-breaker.js';
import { getMetrics } from '../../lib/metrics.js';
import { config } from '../../config/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';

const startTime = Date.now();

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // Basic health check (public)
  app.get('/', async () => {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    };
  });

  // Liveness probe (Kubernetes)
  app.get('/live', async () => {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
    };
  });

  // Readiness probe (Kubernetes)
  app.get('/ready', async (request, reply) => {
    const checks: Record<string, { status: string; latency_ms?: number }> = {};

    // Check database
    const dbStart = Date.now();
    const dbOk = await checkDatabaseConnection();
    checks.database = {
      status: dbOk ? 'up' : 'down',
      latency_ms: Date.now() - dbStart,
    };

    // Check Redis
    const redisStart = Date.now();
    const redisOk = await checkRedisConnection();
    checks.redis = {
      status: redisOk ? 'up' : 'down',
      latency_ms: Date.now() - redisStart,
    };

    const allOk = dbOk && redisOk;

    if (!allOk) {
      reply.status(503);
    }

    return {
      status: allOk ? 'ready' : 'not_ready',
      checks,
    };
  });

  // Detailed health (admin only)
  app.get(
    '/detailed',
    {
      preHandler: [authMiddleware, requireAdmin()],
    },
    async () => {
      const checks: Record<string, any> = {};

      // Database
      const dbStart = Date.now();
      const dbOk = await checkDatabaseConnection();
      checks.database = {
        status: dbOk ? 'connected' : 'disconnected',
        latency_ms: Date.now() - dbStart,
      };

      // Redis
      const redisStart = Date.now();
      const redisOk = await checkRedisConnection();
      checks.redis = {
        status: redisOk ? 'connected' : 'disconnected',
        latency_ms: Date.now() - redisStart,
      };

      // Storage
      let storage: any = {};
      try {
        const storagePath = config.STORAGE_PATH;
        const stats = await fs.statfs(path.resolve(storagePath));
        storage = {
          total_bytes: stats.bsize * stats.blocks,
          free_bytes: stats.bsize * stats.bfree,
          used_bytes: stats.bsize * (stats.blocks - stats.bfree),
        };
      } catch {
        storage = { status: 'unavailable' };
      }

      return {
        status: 'healthy',
        version: '1.0.0',
        uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
        timestamp: new Date().toISOString(),
        services: checks,
        storage,
        circuit_breakers: getCircuitBreakerStatus(),
      };
    }
  );

  // Prometheus metrics
  if (config.ENABLE_METRICS) {
    app.get('/metrics', async (request, reply) => {
      const metrics = await getMetrics();
      reply.header('Content-Type', 'text/plain');
      return metrics;
    });
  }
}
