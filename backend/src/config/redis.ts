import { Redis, type RedisOptions } from 'ioredis';
import { config } from './index.js';
import { logger } from '../lib/logger.js';

const redisOptions: RedisOptions = {
  maxRetriesPerRequest: null, // Required for BullMQ
  retryStrategy(times: number) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  lazyConnect: true,
};

// NOTE: `redis` is exported with a widened type on purpose. bullmq bundles its
// own copy of ioredis, so its `Redis` type is nominally distinct from the one
// resolved here; exporting a concrete `Redis` would be rejected by bullmq's
// `ConnectionOptions`. The runtime value is a normal ioredis client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const redis: any = new Redis(config.REDIS_URL, redisOptions);

redis.on('connect', () => {
  logger.info('Redis connected');
});

redis.on('error', (err: Error) => {
  logger.error({ err }, 'Redis connection error');
});

redis.on('close', () => {
  logger.info('Redis connection closed');
});

export async function checkRedisConnection(): Promise<boolean> {
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

export async function closeRedisConnection(): Promise<void> {
  await redis.quit();
}
