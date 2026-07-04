import { api } from './client';
import type { Tier } from './types';

export function createCheckout(tier: Tier) {
  return api.post<{ url: string }>('/api/billing/checkout', { tier });
}

export function createPortal() {
  return api.post<{ url: string }>('/api/billing/portal');
}
