import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMMANDS as INSTALLER_COMMANDS } from '../../src/modules/install/installer-commands.js';

/**
 * installer-commands.ts is one enormous JS template literal containing shell.
 * A stray backtick, `${` or backslash inside it silently emits a corrupt script
 * — which once shipped a release that crash-looped on boot and had to be rolled
 * back by hand, because a broken updater cannot fix itself.
 *
 * `node --check` on the compiled module (already in the update smoke test)
 * catches JS syntax errors. It cannot catch shell that parses as valid JS and
 * garbage as bash. These tests run the emitted shell through `bash -n`.
 */

function scriptFor(id: string): string {
  const command = INSTALLER_COMMANDS.find((c) => c.id === id);
  if (!command) throw new Error(`no installer command with id ${id}`);
  // argv is [interpreter, flag, script] for the shell-script commands.
  return command.argv[command.argv.length - 1];
}

function assertParsesAsBash(script: string) {
  const dir = mkdtempSync(join(tmpdir(), 'basis-script-'));
  const file = join(dir, 'script.sh');
  try {
    writeFileSync(file, script);
    execFileSync('bash', ['-n', file], { stdio: 'pipe' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('emitted installer shell scripts', () => {
  const shellCommands = INSTALLER_COMMANDS.filter(
    (c) => c.argv[0] === 'bash' || c.argv[0] === 'sh'
  );

  it('has shell commands to check', () => {
    expect(shellCommands.length).toBeGreaterThan(0);
  });

  for (const command of shellCommands) {
    it(`${command.id} parses as bash`, () => {
      assertParsesAsBash(command.argv[command.argv.length - 1]);
    });
  }
});

describe('update-self hands off to the post-update unit', () => {
  const script = scriptFor('update-self');

  it('starts basis-post-update.service with the exact argv sudoers permits', () => {
    // sudoers matches on the full command line, so this string and the rule in
    // install.sh must agree character for character. Two forms would drift.
    expect(script).toContain('sudo systemctl start --no-block basis-post-update.service');
  });

  it('writes the watchdog args atomically', () => {
    // A half-written env file could be read by the unit; write then move.
    expect(script).toContain('/opt/basis/post-update.env.tmp');
    expect(script).toMatch(/mv -f \/opt\/basis\/post-update\.env\.tmp \/opt\/basis\/post-update\.env/);
  });

  it('refreshes the stable watchdog copy so fixes ship via the Update button', () => {
    expect(script).toContain('/opt/basis/post-update-watchdog.sh');
  });

  it('restarts the worker before basis on the legacy fallback path', () => {
    // That path runs inside basis.service's cgroup: restarting basis kills the
    // shell, so anything sequenced after it never runs. Restarting basis first
    // is what left the worker on stale code after every update.
    const fallback = script.slice(script.indexOf('Last resort'));
    const workerAt = fallback.indexOf('restart basis-worker &&');
    const basisAt = fallback.indexOf('restart basis"');
    expect(workerAt).toBeGreaterThan(-1);
    expect(fallback.slice(workerAt)).toContain('restart basis');
    expect(basisAt === -1 || basisAt > workerAt).toBe(true);
  });

  it('migrates before swapping the symlink', () => {
    // A failed migration must abort while the old version is still live.
    expect(script.indexOf('npm run db:migrate')).toBeLessThan(
      script.indexOf('mv -T /opt/basis/current.new /opt/basis/current')
    );
  });
});
