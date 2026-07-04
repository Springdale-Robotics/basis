import { config } from '../config/index.js';

/**
 * Thin client for the frps admin API (loopback :7500). Used by the usage
 * meter; failures are expected while frps restarts, so callers treat errors
 * as "skip this poll".
 */

export interface FrpsProxyInfo {
  name: string; // "<tenantId>.web"
  conf?: { subdomain?: string };
  todayTrafficIn: number;
  todayTrafficOut: number;
  curConns: number;
  status: string; // "online" | "offline"
}

let _fetch: typeof fetch = fetch;

export function __setFetchForTests(fn: typeof fetch | null): void {
  _fetch = fn ?? fetch;
}

export async function listHttpProxies(): Promise<FrpsProxyInfo[]> {
  const auth = Buffer.from(
    `${config.FRPS_ADMIN_USER}:${config.FRPS_ADMIN_PASSWORD}`
  ).toString('base64');
  const res = await _fetch(`${config.FRPS_ADMIN_URL}/api/proxy/http`, {
    headers: { Authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`frps admin API ${res.status}`);
  const body = (await res.json()) as {
    proxies?: Array<{
      name: string;
      conf?: { subdomain?: string };
      todayTrafficIn?: number;
      todayTrafficOut?: number;
      curConns?: number;
      status?: string;
    }>;
  };
  return (body.proxies ?? []).map((p) => ({
    name: p.name,
    conf: p.conf,
    todayTrafficIn: p.todayTrafficIn ?? 0,
    todayTrafficOut: p.todayTrafficOut ?? 0,
    curConns: p.curConns ?? 0,
    status: p.status ?? 'offline',
  }));
}
