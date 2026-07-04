import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __setFetchForTests,
  claimBox,
  ClaimError,
  CloudUnreachableError,
  HeartbeatAuthError,
  sendHeartbeat,
} from '../../src/lib/basis-cloud.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CLAIM_OK = {
  success: true,
  data: {
    tenantId: 'ten_123',
    subdomain: 'smith',
    hostname: 'smith.home-basis.com',
    relay: { serverAddr: 'home-basis.com', serverPort: 7000 },
    tunnelToken: 'tok_abc',
  },
};

afterEach(() => {
  __setFetchForTests(null);
});

describe('claimBox', () => {
  it('returns the claim payload on success', async () => {
    const fetchMock = vi.fn(async (url: any, init: any) => {
      expect(String(url)).toContain('/api/v1/boxes/claim');
      expect(JSON.parse(init.body).claimCode).toBe('AAAA-BBBB-CCCC');
      return jsonResponse(200, CLAIM_OK);
    });
    __setFetchForTests(fetchMock as never);

    const result = await claimBox('AAAA-BBBB-CCCC');
    expect(result.subdomain).toBe('smith');
    expect(result.relay.serverPort).toBe(7000);
  });

  it('maps known cloud error codes onto ClaimError', async () => {
    __setFetchForTests(
      vi.fn(async () =>
        jsonResponse(400, {
          success: false,
          error: { code: 'CLAIM_CODE_USED', message: 'already used' },
        })
      ) as never
    );
    await expect(claimBox('AAAA-BBBB-CCCC')).rejects.toMatchObject({
      name: 'ClaimError',
      code: 'CLAIM_CODE_USED',
    });
  });

  it('maps unknown error codes to CLOUD_ERROR', async () => {
    __setFetchForTests(
      vi.fn(async () =>
        jsonResponse(500, { success: false, error: { code: 'WEIRD', message: 'nope' } })
      ) as never
    );
    await expect(claimBox('AAAA-BBBB-CCCC')).rejects.toMatchObject({
      code: 'CLOUD_ERROR',
    });
  });

  it('maps network failures to CLOUD_UNREACHABLE', async () => {
    __setFetchForTests(
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }) as never
    );
    await expect(claimBox('AAAA-BBBB-CCCC')).rejects.toMatchObject({
      code: 'CLOUD_UNREACHABLE',
    });
  });

  it('rejects an incomplete claim payload', async () => {
    __setFetchForTests(
      vi.fn(async () =>
        jsonResponse(200, { success: true, data: { tenantId: 'x' } })
      ) as never
    );
    await expect(claimBox('AAAA-BBBB-CCCC')).rejects.toBeInstanceOf(ClaimError);
  });
});

describe('sendHeartbeat', () => {
  it('sends the bearer token and parses the result', async () => {
    const fetchMock = vi.fn(async (url: any, init: any) => {
      expect(String(url)).toContain('/api/v1/boxes/heartbeat');
      expect(init.headers.Authorization).toBe('Bearer tok_abc');
      return jsonResponse(200, {
        success: true,
        data: { status: 'active', tier: 'basic', usage: { monthGB: 12.5, capGB: 250 } },
      });
    });
    __setFetchForTests(fetchMock as never);

    const result = await sendHeartbeat('tok_abc');
    expect(result.status).toBe('active');
    expect(result.usage.capGB).toBe(250);
  });

  it('throws HeartbeatAuthError on 401', async () => {
    __setFetchForTests(vi.fn(async () => jsonResponse(401, { success: false })) as never);
    await expect(sendHeartbeat('tok_bad')).rejects.toBeInstanceOf(HeartbeatAuthError);
  });

  it('throws CloudUnreachableError on network failure', async () => {
    __setFetchForTests(
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }) as never
    );
    await expect(sendHeartbeat('tok_abc')).rejects.toBeInstanceOf(CloudUnreachableError);
  });

  it('throws CloudUnreachableError on 5xx', async () => {
    __setFetchForTests(vi.fn(async () => jsonResponse(503, { success: false })) as never);
    await expect(sendHeartbeat('tok_abc')).rejects.toBeInstanceOf(CloudUnreachableError);
  });
});
