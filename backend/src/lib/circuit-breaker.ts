import CircuitBreaker from 'opossum';
import { logger } from './logger.js';

interface CircuitBreakerConfig {
  timeout: number;
  errorThresholdPercentage: number;
  resetTimeout: number;
  volumeThreshold: number;
}

const defaultConfig: CircuitBreakerConfig = {
  timeout: 10000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
};

export const circuitConfigs: Record<string, CircuitBreakerConfig> = {
  googleCalendar: {
    ...defaultConfig,
    timeout: 15000,
  },
  outlookCalendar: {
    ...defaultConfig,
    timeout: 15000,
  },
  homeAssistant: {
    ...defaultConfig,
    timeout: 5000,
    resetTimeout: 10000,
  },
  openFoodFacts: {
    ...defaultConfig,
    timeout: 8000,
  },
  connectedHousehold: {
    ...defaultConfig,
    timeout: 20000,
    resetTimeout: 60000,
  },
  spotify: {
    ...defaultConfig,
    timeout: 10000,
  },
};

const breakers = new Map<string, CircuitBreaker>();

export function createCircuitBreaker<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  serviceName: string
): CircuitBreaker<TArgs, TResult> {
  const existingBreaker = breakers.get(serviceName);
  if (existingBreaker) {
    return existingBreaker as CircuitBreaker<TArgs, TResult>;
  }

  const config = circuitConfigs[serviceName] || defaultConfig;
  const breaker = new CircuitBreaker(fn, config);

  breaker.on('open', () => {
    logger.warn({ service: serviceName }, 'Circuit breaker opened');
  });

  breaker.on('halfOpen', () => {
    logger.info({ service: serviceName }, 'Circuit breaker half-open, testing');
  });

  breaker.on('close', () => {
    logger.info({ service: serviceName }, 'Circuit breaker closed, service recovered');
  });

  breaker.on('timeout', () => {
    logger.warn({ service: serviceName }, 'Circuit breaker timeout');
  });

  breaker.on('reject', () => {
    logger.warn({ service: serviceName }, 'Circuit breaker rejected request');
  });

  breaker.on('fallback', () => {
    logger.info({ service: serviceName }, 'Circuit breaker fallback executed');
  });

  breakers.set(serviceName, breaker);
  return breaker;
}

export function getCircuitBreakerStatus(): Record<
  string,
  { state: string; failures: number }
> {
  const status: Record<string, { state: string; failures: number }> = {};

  for (const [name, breaker] of breakers) {
    status[name] = {
      state: breaker.opened ? 'open' : breaker.halfOpen ? 'half-open' : 'closed',
      failures: breaker.stats.failures,
    };
  }

  return status;
}

export async function withCircuitBreaker<T>(
  serviceName: string,
  fn: () => Promise<T>,
  fallback?: () => T | Promise<T>
): Promise<T> {
  const breaker = createCircuitBreaker(fn, serviceName);

  if (fallback) {
    breaker.fallback(fallback);
  }

  return breaker.fire();
}
