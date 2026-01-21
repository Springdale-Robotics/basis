import pino from 'pino';
import { AsyncLocalStorage } from 'async_hooks';
import { config } from '../config/index.js';

interface RequestContext {
  requestId?: string;
  userId?: string;
  householdId?: string;
}

export const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

export const logger = pino({
  level: config.LOG_LEVEL,
  formatters: {
    level: (label) => ({ level: label }),
  },
  mixin: () => {
    const store = asyncLocalStorage.getStore();
    return store || {};
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'passwordHash',
      'token',
      'credentials',
      'secret',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.credentials',
      '*.secret',
    ],
    remove: true,
  },
  transport:
    config.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return asyncLocalStorage.run(context, fn);
}

export function getContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}

export function setContextValue<K extends keyof RequestContext>(
  key: K,
  value: RequestContext[K]
): void {
  const store = asyncLocalStorage.getStore();
  if (store) {
    store[key] = value;
  }
}
