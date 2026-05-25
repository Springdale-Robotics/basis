import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setExecForTests,
  configureServe,
  getServeStatus,
  getTailscaleStatus,
} from '../../src/lib/tailscale.js';

type MockExec = (cmd: string) => Promise<{ stdout: string; stderr: string }>;

function mockExec(impl: MockExec): MockExec {
  return vi.fn(impl) as unknown as MockExec;
}

afterEach(() => {
  __setExecForTests(null);
});

describe('tailscale detection', () => {
  it('returns available=true when daemon is Running with a DNSName', async () => {
    __setExecForTests(
      mockExec(async (cmd) => {
        expect(cmd).toContain('tailscale status --json');
        return {
          stdout: JSON.stringify({
            BackendState: 'Running',
            MagicDNSSuffix: 'example.ts.net',
            Self: {
              DNSName: 'host.example.ts.net.',
              TailscaleIPs: ['100.64.0.5'],
            },
          }),
          stderr: '',
        };
      }) as never
    );
    const status = await getTailscaleStatus();
    expect(status.available).toBe(true);
    expect(status.hostname).toBe('host.example.ts.net');
    expect(status.tailnet).toBe('example.ts.net');
    expect(status.tailscaleIPs).toEqual(['100.64.0.5']);
    expect(status.issues).toEqual([]);
  });

  it('reports needs_login when BackendState is NeedsLogin', async () => {
    __setExecForTests(
      mockExec(async () => ({
        stdout: JSON.stringify({ BackendState: 'NeedsLogin' }),
        stderr: '',
      })) as never
    );
    const status = await getTailscaleStatus();
    expect(status.available).toBe(false);
    expect(status.issues).toContain('needs_login');
  });

  it('reports daemon_offline when BackendState is Stopped', async () => {
    __setExecForTests(
      mockExec(async () => ({
        stdout: JSON.stringify({ BackendState: 'Stopped' }),
        stderr: '',
      })) as never
    );
    const status = await getTailscaleStatus();
    expect(status.available).toBe(false);
    expect(status.issues).toContain('daemon_offline');
  });

  it('reports not_installed when CLI is missing (ENOENT)', async () => {
    __setExecForTests(
      mockExec(async () => {
        const err = Object.assign(new Error('spawn tailscale ENOENT'), { code: 'ENOENT' });
        throw err;
      }) as never
    );
    const status = await getTailscaleStatus();
    expect(status.available).toBe(false);
    expect(status.issues).toContain('not_installed');
  });
});

describe('serve status parsing', () => {
  it('reads configured=false when CLI returns empty object', async () => {
    __setExecForTests(mockExec(async () => ({ stdout: '{}', stderr: '' })) as never);
    const status = await getServeStatus();
    expect(status.configured).toBe(false);
  });

  it('reads configured=true when serve is set up', async () => {
    __setExecForTests(
      mockExec(async () => ({
        stdout: JSON.stringify({
          TCP: { '443': { HTTPS: true } },
          Web: {
            'host.example.ts.net:443': {
              Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } },
            },
          },
        }),
        stderr: '',
      })) as never
    );
    const status = await getServeStatus();
    expect(status.configured).toBe(true);
    expect(status.httpsPort).toBe(443);
    expect(status.target).toBe('http://127.0.0.1:3000');
  });
});

describe('configureServe', () => {
  it('shells out to serve when not already configured', async () => {
    const calls: string[] = [];
    __setExecForTests(
      mockExec(async (cmd) => {
        calls.push(cmd);
        if (cmd.includes('status')) return { stdout: '{}', stderr: '' };
        if (cmd.includes('serve') && cmd.includes('--https=443'))
          return { stdout: '', stderr: '' };
        return { stdout: '', stderr: '' };
      }) as never
    );
    const result = await configureServe(3000);
    expect(result.success).toBe(true);
    expect(calls.some((c) => c.includes('--https=443'))).toBe(true);
    expect(calls.some((c) => c.includes('http://localhost:3000'))).toBe(true);
  });

  it('returns operator issue when CLI rejects with permission denied', async () => {
    __setExecForTests(
      mockExec(async (cmd) => {
        if (cmd.includes('status')) return { stdout: '{}', stderr: '' };
        const err = Object.assign(new Error('exit code 1'), {
          stderr: 'permission denied: need operator',
          code: 1,
        });
        throw err;
      }) as never
    );
    const result = await configureServe(3000);
    expect(result.success).toBe(false);
    expect(result.issue).toBe('needs_operator');
    expect(result.error).toContain('operator');
  });

  it('is idempotent when current config already matches', async () => {
    let serveCalled = false;
    __setExecForTests(
      mockExec(async (cmd) => {
        if (cmd.includes('status')) {
          return {
            stdout: JSON.stringify({
              TCP: { '443': { HTTPS: true } },
              Web: {
                'host.example.ts.net:443': {
                  Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } },
                },
              },
            }),
            stderr: '',
          };
        }
        if (!cmd.includes('status')) serveCalled = true;
        return { stdout: '', stderr: '' };
      }) as never
    );
    const result = await configureServe(3000);
    expect(result.success).toBe(true);
    expect(serveCalled).toBe(false);
  });
});
