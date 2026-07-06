/**
 * Shared GitHub-release resolution for the self-update flow.
 *
 * Both the update-check endpoint (`GET /install/version`) and the actual
 * updater (`update-self` in installer-commands) MUST resolve the target
 * release the same way — by semver, honoring the prerelease toggle. They used
 * to diverge: the endpoint sorted by semver ("Don't trust GitHub's array
 * order") while the update script grepped the *first* tarball GitHub happened
 * to return (`head -1`), so the button could promise v0.1.14 and the script
 * install a different build. This module is the single source of truth.
 */
import { compareVersions } from '../../lib/semver.js';

export const GITHUB_REPO = 'Springdale-Robotics/basis';

export interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  prerelease: boolean;
  published_at: string;
  html_url: string;
  assets: Array<{ name: string; browser_download_url: string; size: number }>;
}

export interface ResolvedRelease {
  release: GitHubRelease;
  /** tag_name with any leading `v` stripped. */
  version: string;
  /** browser_download_url of the `.tar.gz` asset, or null if the release has none. */
  tarballUrl: string | null;
}

/**
 * Fetch releases and return the genuinely-highest one by semver (optionally
 * excluding prereleases), with its tarball asset URL resolved.
 */
export async function resolveLatestRelease(
  includePrerelease: boolean,
): Promise<ResolvedRelease | null> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=10`;
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status}`);
  }
  const releases = (await res.json()) as GitHubRelease[];
  const filtered = includePrerelease ? releases : releases.filter((r) => !r.prerelease);
  const release =
    filtered.slice().sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0] ?? null;
  if (!release) return null;

  return {
    release,
    version: release.tag_name.replace(/^v/, ''),
    tarballUrl: release.assets.find((a) => a.name.endsWith('.tar.gz'))?.browser_download_url ?? null,
  };
}
