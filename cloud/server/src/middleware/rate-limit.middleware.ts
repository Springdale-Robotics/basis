import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { config } from '../config/index.js';

/**
 * Minimal fixed-window in-memory limiter. Single-process by design (one VPS,
 * one service) — swap for a Redis-backed limiter before running replicas.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Bound memory: sweep expired buckets occasionally.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref();

export function rateLimit(opts: {
  /** Bucket namespace, e.g. 'auth' or 'claim'. */
  name: string;
  max: number;
  windowMs: number;
  /** Defaults to per-IP. */
  key?: (request: FastifyRequest) => string;
}): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (config.DISABLE_RATE_LIMIT) return;
    const key = `${opts.name}:${opts.key ? opts.key(request) : request.ip}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > opts.max) {
      reply.code(429).send({
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests — try again later' },
      });
    }
  };
}
