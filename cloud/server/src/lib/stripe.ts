import Stripe from 'stripe';
import { config } from '../config/index.js';

export const stripe = new Stripe(config.STRIPE_SECRET_KEY, {
  typescript: true,
});

export type Tier = 'basic' | 'streaming';

export function priceIdForTier(tier: Tier): string {
  return tier === 'basic'
    ? config.STRIPE_PRICE_BASIC_ANNUAL
    : config.STRIPE_PRICE_STREAMING_ANNUAL;
}

export function tierForPriceId(priceId: string): Tier | null {
  if (priceId === config.STRIPE_PRICE_BASIC_ANNUAL) return 'basic';
  if (priceId === config.STRIPE_PRICE_STREAMING_ANNUAL) return 'streaming';
  return null;
}

export function capGbForTier(tier: Tier | null): number {
  if (tier === 'streaming') return config.CAP_STREAMING_GB;
  return config.CAP_BASIC_GB;
}
