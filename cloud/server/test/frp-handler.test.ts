import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../src/lib/tokens.js';
import type { TenantState } from '../src/services/tenant-state.js';

const state: { tenant: TenantState | null } = { tenant: null };
const reconnectRequests = new Set<string>();

vi.mock('../src/services/tenant-state.js', () => ({
  getTenantState: vi.fn(async () => state.tenant),
  setConnection: vi.fn(),
  consumeReconnectRequest: vi.fn((id: string) => reconnectRequests.delete(id)),
  requestReconnect: vi.fn((id: string) => reconnectRequests.add(id)),
  invalidateTenantState: vi.fn(),
}));

vi.mock('../src/db/index.js', () => {
  const chain = {
    update: () => chain,
    set: () => chain,
    where: () => Promise.resolve([]),
  };
  return { db: chain, sql: {} };
});

import {
  handleLogin,
  handleNewProxy,
  handlePing,
} from '../src/modules/frp/frp.service.js';

const TOKEN = 'brt_valid-token';

function tenant(overrides: Partial<TenantState> = {}): TenantState {
  return {
    id: 'ten-1',
    subdomain: 'smith',
    status: 'active',
    throttled: false,
    validTokenHashes: new Set([sha256Hex(TOKEN)]),
    ...overrides,
  };
}

const loginContent = (token = TOKEN) => ({
  user: 'ten-1',
  metas: { token },
  client_address: '1.2.3.4:5678',
});

const proxyContent = (overrides: Record<string, unknown> = {}) => ({
  user: { user: 'ten-1', metas: { token: TOKEN } },
  proxy_name: 'ten-1.web',
  proxy_type: 'http',
  subdomain: 'smith',
  ...overrides,
});

beforeEach(() => {
  state.tenant = tenant();
  reconnectRequests.clear();
});

describe('Login', () => {
  it('allows an active tenant with a valid token', async () => {
    expect(await handleLogin(loginContent())).toEqual({ reject: false, unchange: true });
  });

  it('rejects a bad token', async () => {
    const decision = await handleLogin(loginContent('brt_wrong'));
    expect(decision).toMatchObject({ reject: true });
  });

  it('rejects unknown tenants and suspended/canceled/unpaid ones', async () => {
    state.tenant = null;
    expect(await handleLogin(loginContent())).toMatchObject({ reject: true });

    for (const status of ['suspended', 'canceled', 'unpaid'] as const) {
      state.tenant = tenant({ status });
      expect(await handleLogin(loginContent())).toMatchObject({ reject: true });
    }
  });

  it('allows past_due (grace period)', async () => {
    state.tenant = tenant({ status: 'past_due' });
    expect(await handleLogin(loginContent())).toEqual({ reject: false, unchange: true });
  });

  it('uses a coarse reject reason (no tenant-existence oracle)', async () => {
    state.tenant = null;
    const unknownTenant = await handleLogin(loginContent());
    state.tenant = tenant();
    const badToken = await handleLogin(loginContent('brt_wrong'));
    expect(unknownTenant).toEqual(badToken);
  });
});

describe('NewProxy', () => {
  it('allows the canonical web proxy', async () => {
    expect(await handleNewProxy(proxyContent())).toEqual({ reject: false, unchange: true });
  });

  it('rejects non-http proxy types (no TCP port squatting)', async () => {
    expect(await handleNewProxy(proxyContent({ proxy_type: 'tcp' }))).toMatchObject({
      reject: true,
    });
  });

  it('rejects unexpected proxy names', async () => {
    expect(await handleNewProxy(proxyContent({ proxy_name: 'ten-1.ssh' }))).toMatchObject({
      reject: true,
    });
  });

  it("rejects another tenant's subdomain", async () => {
    expect(await handleNewProxy(proxyContent({ subdomain: 'jones' }))).toMatchObject({
      reject: true,
    });
  });

  it('rejects custom domains', async () => {
    expect(
      await handleNewProxy(proxyContent({ custom_domains: ['evil.example.com'] }))
    ).toMatchObject({ reject: true });
  });

  it('injects a server-enforced bandwidth limit when throttled', async () => {
    state.tenant = tenant({ throttled: true });
    const decision = await handleNewProxy(proxyContent());
    expect(decision).toMatchObject({
      unchange: false,
      content: { bandwidth_limit_mode: 'server' },
    });
    const limit = (decision as { content: { bandwidth_limit: string } }).content
      .bandwidth_limit;
    // 4 Mbps default → 512 KB/s
    expect(limit).toBe('512KB');
  });
});

describe('Ping', () => {
  const pingContent = { user: { user: 'ten-1', metas: { token: TOKEN } } };

  it('allows a healthy tenant', async () => {
    expect(await handlePing(pingContent)).toEqual({ reject: false, unchange: true });
  });

  it('rejects once when a reconnect was requested, then allows again', async () => {
    reconnectRequests.add('ten-1');
    expect(await handlePing(pingContent)).toMatchObject({ reject: true });
    expect(await handlePing(pingContent)).toEqual({ reject: false, unchange: true });
  });

  it('rejects suspended tenants (this is the kick)', async () => {
    state.tenant = tenant({ status: 'suspended' });
    expect(await handlePing(pingContent)).toMatchObject({ reject: true });
  });

  it('rejects after token revocation', async () => {
    state.tenant = tenant({ validTokenHashes: new Set() });
    expect(await handlePing(pingContent)).toMatchObject({ reject: true });
  });
});
