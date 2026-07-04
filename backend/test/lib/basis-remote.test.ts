import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { mkdtempSync, rmSync, statSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Mock the cloud client before importing the supervisor so the heartbeat
// loop never makes real requests.
vi.mock('../../src/lib/basis-cloud.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/lib/basis-cloud.js')>();
  return {
    ...original,
    sendHeartbeat: vi.fn(async () => ({
      status: 'active',
      tier: 'basic',
      usage: { monthGB: 0, capGB: 250 },
    })),
  };
});

import {
  __setExecForTests,
  __setHeartbeatIntervalForTests,
  __setRunDirForTests,
  __setSpawnForTests,
  __setTimingsForTests,
  buildFrpcToml,
  getBasisRemoteStatus,
  startBasisRemote,
  stopBasisRemote,
  validateBasisRemoteConfig,
  type BasisRemoteConfig,
} from '../../src/lib/basis-remote.js';
import { sendHeartbeat, HeartbeatAuthError } from '../../src/lib/basis-cloud.js';

const CFG: BasisRemoteConfig = {
  tenantId: 'ten_123',
  subdomain: 'smith',
  hostname: 'smith.home-basis.com',
  tunnelToken: 'tok_abc-123',
  relay: { serverAddr: 'home-basis.com', serverPort: 7000 },
};

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  killed = false;
  kill(signal?: string): boolean {
    this.killed = true;
    void signal;
    return true;
  }
}

const execInstalled = vi.fn(async () => ({ stdout: '0.61.1\n', stderr: '' }));

let runDir: string;
let spawned: FakeChild[];

function fakeSpawn(): FakeChild {
  const child = new FakeChild();
  spawned.push(child);
  return child;
}

/** Simulate an unexpected child death. */
function crash(child: FakeChild, code = 1): void {
  child.exitCode = code;
  child.emit('exit', code, null);
}

beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), 'basis-remote-test-'));
  spawned = [];
  __setRunDirForTests(runDir);
  __setExecForTests(execInstalled as never);
  __setSpawnForTests(fakeSpawn as never);
  // Fast timings so tests run on real timers without fake-timer/fs races.
  __setTimingsForTests({ graceMs: 25, backoffBaseMs: 10 });
  __setHeartbeatIntervalForTests(10 * 60_000);
  vi.mocked(sendHeartbeat).mockClear();
  vi.mocked(sendHeartbeat).mockResolvedValue({
    status: 'active',
    tier: 'basic',
    usage: { monthGB: 0, capGB: 250 },
  });
});

afterEach(() => {
  stopBasisRemote();
  __setRunDirForTests(null);
  __setExecForTests(null);
  __setSpawnForTests(null);
  __setTimingsForTests(null);
  __setHeartbeatIntervalForTests(null);
  rmSync(runDir, { recursive: true, force: true });
});

describe('config validation + TOML generation', () => {
  it('renders the expected TOML', () => {
    const toml = buildFrpcToml(CFG, 3000);
    expect(toml).toContain('serverAddr = "home-basis.com"');
    expect(toml).toContain('serverPort = 7000');
    expect(toml).toContain('user = "ten_123"');
    expect(toml).toContain('metadatas.token = "tok_abc-123"');
    expect(toml).toContain('subdomain = "smith"');
    expect(toml).toContain('localPort = 3000');
    expect(toml).toContain('type = "http"');
    expect(toml).toContain('name = "web"');
  });

  it.each([
    [{ ...CFG, tenantId: 'a"\nserverAddr = "evil.com' }, 'tenantId'],
    [{ ...CFG, subdomain: 'smith.jones' }, 'subdomain'],
    [{ ...CFG, tunnelToken: 'tok with spaces' }, 'tunnelToken'],
    [{ ...CFG, relay: { serverAddr: 'bad host!', serverPort: 7000 } }, 'serverAddr'],
    [{ ...CFG, relay: { serverAddr: 'home-basis.com', serverPort: 99999 } }, 'serverPort'],
  ])('rejects unsafe values (%#)', (cfg, field) => {
    const err = validateBasisRemoteConfig(cfg as BasisRemoteConfig);
    expect(err).toBeTruthy();
    expect(err).toContain(field);
  });

  it('refuses to start with an injection-shaped config', async () => {
    const status = await startBasisRemote({ ...CFG, subdomain: 'a"]\n[[proxies' });
    expect(status.running).toBe(false);
    expect(status.issues).toContain('spawn_failed');
    expect(spawned).toHaveLength(0);
  });
});

describe('startBasisRemote', () => {
  it('writes the config 0600 and reports running after the grace period', async () => {
    const status = await startBasisRemote(CFG);

    expect(status.running).toBe(true);
    expect(status.hostname).toBe('smith.home-basis.com');
    expect(spawned).toHaveLength(1);

    const configPath = join(runDir, 'frpc.toml');
    expect(readFileSync(configPath, 'utf8')).toContain('subdomain = "smith"');
    const mode = statSync(configPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('reports not_installed without spawning when frpc is missing', async () => {
    __setExecForTests(
      vi.fn(async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }) as never
    );
    const status = await startBasisRemote(CFG);
    expect(status.installed).toBe(false);
    expect(status.issues).toContain('not_installed');
    expect(spawned).toHaveLength(0);
  });

  it('captures recent output in lastError when the child exits early', async () => {
    // Wide grace so the crash below lands before the status resolves, and a
    // slow backoff so the respawn doesn't land before the grace reports it.
    __setTimingsForTests({ graceMs: 300, backoffBaseMs: 5000 });
    const promise = startBasisRemote(CFG);
    await vi.waitFor(() => expect(spawned).toHaveLength(1), { interval: 5, timeout: 1000 });
    spawned[0].stderr.emit('data', Buffer.from('login to server failed: token mismatch\n'));
    crash(spawned[0]);
    const status = await promise;

    expect(status.running).toBe(false);
    expect(status.lastError).toContain('code=1');
    expect(status.lastError).toContain('token mismatch');
  });

  it('respawns after an unexpected exit', async () => {
    await startBasisRemote(CFG);
    expect(spawned).toHaveLength(1);

    crash(spawned[0]);
    await vi.waitFor(() => expect(spawned).toHaveLength(2), { timeout: 2000 });

    crash(spawned[1]);
    await vi.waitFor(() => expect(spawned).toHaveLength(3), { timeout: 2000 });
  });

  it('does not respawn after an intentional stop', async () => {
    await startBasisRemote(CFG);
    expect(spawned).toHaveLength(1);

    stopBasisRemote();
    // Even if the (already killed) child now emits exit, no respawn happens.
    crash(spawned[0]);
    await new Promise((r) => setTimeout(r, 100));
    expect(spawned).toHaveLength(1);
    expect(existsSync(join(runDir, 'frpc.toml'))).toBe(false);
  });
});

describe('heartbeat', () => {
  it('runs immediately on start and surfaces the result in status', async () => {
    await startBasisRemote(CFG);

    expect(sendHeartbeat).toHaveBeenCalledWith('tok_abc-123');
    const status = await getBasisRemoteStatus();
    expect(status.heartbeat?.status).toBe('active');
    expect(status.heartbeat?.usage?.capGB).toBe(250);
    expect(status.heartbeat?.stale).toBe(false);
  });

  it('keeps the tunnel running when suspended', async () => {
    vi.mocked(sendHeartbeat).mockResolvedValue({
      status: 'suspended',
      tier: 'basic',
      usage: { monthGB: 260, capGB: 250 },
    });
    await startBasisRemote(CFG);

    await vi.waitFor(async () => {
      const status = await getBasisRemoteStatus();
      expect(status.heartbeat?.status).toBe('suspended');
      expect(status.running).toBe(true);
    });
  });

  it('stops the tunnel when canceled but keeps the identity for the UI', async () => {
    vi.mocked(sendHeartbeat).mockResolvedValue({
      status: 'canceled',
      tier: 'basic',
      usage: { monthGB: 0, capGB: 250 },
    });
    await startBasisRemote(CFG);

    await vi.waitFor(async () => {
      const status = await getBasisRemoteStatus();
      expect(status.heartbeat?.status).toBe('canceled');
      expect(status.running).toBe(false);
      expect(status.hostname).toBe('smith.home-basis.com');
    });
    // Cancellation must not trigger the respawn path.
    await new Promise((r) => setTimeout(r, 100));
    expect(spawned).toHaveLength(1);
  });

  it('stops the tunnel and flags authFailed on 401', async () => {
    vi.mocked(sendHeartbeat).mockRejectedValue(new HeartbeatAuthError());
    await startBasisRemote(CFG);

    await vi.waitFor(async () => {
      const status = await getBasisRemoteStatus();
      expect(status.heartbeat?.authFailed).toBe(true);
      expect(status.running).toBe(false);
    });
  });

  it('marks the heartbeat stale after two missed intervals', async () => {
    __setHeartbeatIntervalForTests(30);
    await startBasisRemote(CFG);
    await vi.waitFor(async () => {
      const status = await getBasisRemoteStatus();
      expect(status.heartbeat?.status).toBe('active');
    });

    // Subsequent heartbeats fail network-shaped; last-known data is kept.
    vi.mocked(sendHeartbeat).mockRejectedValue(new Error('fetch failed'));
    await vi.waitFor(async () => {
      const status = await getBasisRemoteStatus();
      expect(status.heartbeat?.status).toBe('active');
      expect(status.heartbeat?.stale).toBe(true);
    });
  });
});
