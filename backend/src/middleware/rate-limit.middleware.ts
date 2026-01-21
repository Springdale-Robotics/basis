import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/index.js';
import { redis } from '../config/redis.js';
import { Errors } from '../lib/errors.js';

interface RateLimitOptions {
  max?: number;
  windowMs?: number;
  keyGenerator?: (request: FastifyRequest) => string;
}

export function createRateLimiter(options: RateLimitOptions = {}) {
  const {
    max = config.RATE_LIMIT_MAX,
    windowMs = config.RATE_LIMIT_WINDOW_MS,
    keyGenerator = defaultKeyGenerator,
  } = options;

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (config.DISABLE_RATE_LIMIT) {
      return;
    }

    const key = `ratelimit:${keyGenerator(request)}`;
    const windowSeconds = Math.ceil(windowMs / 1000);

    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, windowSeconds);
    }

    const ttl = await redis.ttl(key);
    const remaining = Math.max(0, max - current);

    reply.header('X-RateLimit-Limit', max);
    reply.header('X-RateLimit-Remaining', remaining);
    reply.header('X-RateLimit-Reset', Math.ceil(Date.now() / 1000) + ttl);

    if (current > max) {
      throw Errors.rateLimit();
    }
  };
}

function defaultKeyGenerator(request: FastifyRequest): string {
  // Use user ID if authenticated, otherwise use IP
  const userId = (request as any).user?.id;
  if (userId) {
    return `user:${userId}`;
  }

  const ip = request.ip || request.headers['x-forwarded-for'] || 'unknown';
  return `ip:${ip}`;
}

// Stricter rate limiter for auth endpoints
export const authRateLimiter = createRateLimiter({
  max: 10,
  windowMs: 60 * 1000, // 1 minute
  keyGenerator: (request) => {
    const ip = request.ip || request.headers['x-forwarded-for'] || 'unknown';
    return `auth:${ip}`;
  },
});

// Rate limiter for API endpoints
export const apiRateLimiter = createRateLimiter();
