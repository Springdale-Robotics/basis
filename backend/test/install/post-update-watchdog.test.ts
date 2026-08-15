import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, mkdirSync, readlinkSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The watchdog restarts the services after an update, health-checks the new
 * version, and rolls the symlink back if it never comes up. It carried env
 * overrides "used by the test harness" since it was written — with no harness.
 * This is it.
 *
 * systemd is faked by a recording script; the health check is pointed at a
 * file:// URL, which curl -fsS succeeds on iff the file exists.
 */

const WATCHDOG = resolve(__dirname, '../../deploy/native/post-update-watchdog.sh');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'basis-watchdog-'));
  mkdirSync(join(dir, 'versions/0.1.20-alpha'), { recursive: true });
  mkdirSync(join(dir, 'versions/0.1.21-alpha'), { recursive: true });
  symlinkSync('versions/0.1.21-alpha', join(dir, 'current'));
  writeFileSync(
    join(dir, 'fake-systemctl.sh'),
    `#!/usr/bin/env bash\necho "$@" >> "${join(dir, 'systemctl.log')}"\nexit 0\n`,
    { mode: 0o755 }
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function runWatchdog(opts: { prevTarget?: string; healthy: boolean }) {
  const healthFile = join(dir, 'health');
  if (opts.healthy) writeFileSync(healthFile, 'ok');

  const env = {
    ...process.env,
    BASIS_SYSTEMCTL: `bash ${join(dir, 'fake-systemctl.sh')}`,
    BASIS_CURRENT_LINK: join(dir, 'current'),
    BASIS_HEALTH_URL: `file://${healthFile}`,
    BASIS_HEALTH_RETRIES: '1',
    BASIS_HEALTH_INTERVAL: '0',
    BASIS_RESTART_DELAY: '0',
    BASIS_PREV_TARGET: opts.prevTarget ?? '',
    BASIS_NEW_VERSION: '0.1.21-alpha',
  };

  let status = 0;
  let stdout = '';
  try {
    stdout = execFileSync('bash', [WATCHDOG], { env, encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    const e = error as { status: number; stdout: string };
    status = e.status;
    stdout = e.stdout ?? '';
  }

  const log = existsSync(join(dir, 'systemctl.log'))
    ? readFileSync(join(dir, 'systemctl.log'), 'utf8')
    : '';
  return { status, stdout, log, currentTarget: readlinkSync(join(dir, 'current')) };
}

describe('post-update watchdog', () => {
  it('restarts the worker before basis, and succeeds when healthy', () => {
    const result = runWatchdog({ prevTarget: 'versions/0.1.20-alpha', healthy: true });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('0.1.21-alpha is healthy');

    // Order is load-bearing on the legacy path, where restarting basis kills
    // the caller before anything queued after it can run — which is why the
    // worker used to be left on stale code after every update.
    const lines = result.log.trim().split('\n');
    const workerAt = lines.findIndex((l) => l === 'restart basis-worker');
    const basisAt = lines.findIndex((l) => l === 'restart basis');
    expect(workerAt).toBeGreaterThan(-1);
    expect(basisAt).toBeGreaterThan(workerAt);

    // Leaves the new version in place.
    expect(result.currentTarget).toBe('versions/0.1.21-alpha');
  });

  it('rolls the symlink back when the new version never becomes healthy', () => {
    const result = runWatchdog({ prevTarget: 'versions/0.1.20-alpha', healthy: false });

    expect(result.status).toBe(1);
    expect(result.currentTarget).toBe('versions/0.1.20-alpha');
    expect(result.stdout).toContain('rolling back to versions/0.1.20-alpha');
  });

  it('cannot roll back when no previous version was recorded', () => {
    const result = runWatchdog({ prevTarget: '', healthy: false });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('cannot auto-roll back');
    expect(result.currentTarget).toBe('versions/0.1.21-alpha');
  });

  it.each([
    ['/etc/systemd/system', 'an absolute path outside versions/'],
    ['versions/../../../etc', 'a traversal out of versions/'],
    ['../../etc/passwd', 'a relative escape'],
  ])('refuses %s as a rollback target (%s)', (prevTarget) => {
    // PREV_TARGET arrives in a file written by the unprivileged basis user and
    // is handed to `ln -sfn` running as root under the systemd unit.
    const result = runWatchdog({ prevTarget, healthy: false });

    expect(result.stdout).toContain('refusing suspicious rollback target');
    expect(result.currentTarget).toBe('versions/0.1.21-alpha');
  });
});
