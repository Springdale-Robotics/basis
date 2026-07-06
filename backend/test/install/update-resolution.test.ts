import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveLatestRelease } from '../../src/modules/install/github-release.js';

/**
 * July 2026 review, platform HIGH #1: the update-check endpoint resolved the
 * target release by semver while the update script grepped GitHub's first
 * tarball (head -1) — so the button could promise vX and install vY. Both now
 * go through resolveLatestRelease; buildArgv injects the resolved URL and
 * refuses downgrades. These tests pin that behavior.
 */

function ghRelease(tag: string, prerelease: boolean, hasTarball = true) {
  const ver = tag.replace(/^v/, '');
  return {
    tag_name: tag,
    name: tag,
    body: '',
    prerelease,
    published_at: '2026-01-01',
    html_url: `https://github.com/x/releases/${tag}`,
    assets: hasTarball
      ? [{ name: `basis-${ver}.tar.gz`, browser_download_url: `https://github.com/x/dl/${tag}/basis-${ver}.tar.gz`, size: 1 }]
      : [],
  };
}

function mockFetch(releases: unknown[]) {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => releases,
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('resolveLatestRelease', () => {
  it('picks the highest semver, not GitHub array order', async () => {
    // Newest is deliberately NOT first in the array (the head -1 trap).
    mockFetch([ghRelease('v0.1.9-alpha', true), ghRelease('v0.1.14-alpha', true), ghRelease('v0.1.10-alpha', true)]);
    const resolved = await resolveLatestRelease(true);
    expect(resolved?.version).toBe('0.1.14-alpha');
    expect(resolved?.tarballUrl).toContain('basis-0.1.14-alpha.tar.gz');
  });

  it('excludes prereleases when asked', async () => {
    mockFetch([ghRelease('v0.2.0-alpha', true), ghRelease('v0.1.12', false)]);
    const stable = await resolveLatestRelease(false);
    expect(stable?.version).toBe('0.1.12');
    const withPre = await resolveLatestRelease(true);
    expect(withPre?.version).toBe('0.2.0-alpha');
  });

  it('returns null tarballUrl for a release with no .tar.gz asset', async () => {
    mockFetch([ghRelease('v0.1.14-alpha', true, false)]);
    const resolved = await resolveLatestRelease(true);
    expect(resolved?.version).toBe('0.1.14-alpha');
    expect(resolved?.tarballUrl).toBeNull();
  });

  it('returns null when there are no releases', async () => {
    mockFetch([]);
    expect(await resolveLatestRelease(true)).toBeNull();
  });
});

describe('buildArgv(update-self) release injection + guard', () => {
  it('injects the semver-resolved tarball URL and version into the script', async () => {
    vi.doMock('../../src/lib/app-version.js', () => ({ getAppVersion: async () => '0.1.12-alpha' }));
    mockFetch([ghRelease('v0.1.9-alpha', true), ghRelease('v0.1.14-alpha', true)]);
    const { buildArgv } = await import('../../src/modules/install/installer-commands.js');

    const argv = await buildArgv('update-self', { prerelease: true });
    const script = argv[2];
    expect(argv[0]).toBe('bash');
    expect(script).toContain("EXPECTED_VERSION='0.1.14-alpha'");
    expect(script).toContain('basis-0.1.14-alpha.tar.gz');
    // The old GitHub-grep resolution must be gone (the updater no longer
    // resolves the release itself).
    expect(script).not.toContain('api.github.com/repos');
    expect(script).toContain('LATEST="$TARBALL_URL"');
  });

  it('refuses a downgrade / no-op (installed >= latest)', async () => {
    vi.doMock('../../src/lib/app-version.js', () => ({ getAppVersion: async () => '0.1.14-alpha' }));
    mockFetch([ghRelease('v0.1.14-alpha', true), ghRelease('v0.1.9-alpha', true)]);
    const { buildArgv } = await import('../../src/modules/install/installer-commands.js');

    await expect(buildArgv('update-self', { prerelease: true })).rejects.toThrow(/latest version|downgrade/i);
  });

  it('throws when the resolved release has no installable tarball', async () => {
    vi.doMock('../../src/lib/app-version.js', () => ({ getAppVersion: async () => '0.1.12-alpha' }));
    mockFetch([ghRelease('v0.1.14-alpha', true, false)]);
    const { buildArgv } = await import('../../src/modules/install/installer-commands.js');

    await expect(buildArgv('update-self', { prerelease: true })).rejects.toThrow(/no installable/i);
  });
});
