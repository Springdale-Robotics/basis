import { api } from './client';
import type { ClaimCode, SubdomainCheck, Tenant } from './types';

export function checkSubdomain(name: string) {
  return api.get<SubdomainCheck>(
    `/api/subdomains/check?name=${encodeURIComponent(name)}`,
  );
}

export function createTenant(input: { subdomain: string }) {
  return api.post<{ tenant: Tenant }>('/api/tenants', input);
}

export function getMyTenant() {
  return api.get<{ tenant: Tenant | null }>('/api/tenants/me');
}

export function createClaimCode() {
  return api.post<ClaimCode>('/api/tenants/me/claim-code');
}

export function revokeToken() {
  return api.post<{ revoked: boolean }>('/api/tenants/me/revoke-token');
}
