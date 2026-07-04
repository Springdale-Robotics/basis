export interface Account {
  id: string;
  email: string;
}

export type TenantStatus =
  | 'unpaid'
  | 'active'
  | 'past_due'
  | 'suspended'
  | 'canceled';

export type Tier = 'basic' | 'streaming';

export interface TenantUsage {
  monthGB: number;
  capGB: number | null;
  warned80: boolean;
}

export interface Tenant {
  id: string;
  subdomain: string;
  hostname: string;
  status: TenantStatus;
  throttled: boolean;
  connected: boolean;
  lastConnectedAt: string | null;
  lastHeartbeatAt: string | null;
  tier: Tier | null;
  isComp: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  usage: TenantUsage;
}

export interface SubdomainCheck {
  available: boolean;
  reason?: string;
}

export interface ClaimCode {
  code: string;
  expiresAt: string;
}
