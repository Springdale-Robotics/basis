import { resolve } from 'path';
import { promises as fs } from 'fs';
import { config } from '../../config/index.js';
import { getAppVersion } from '../../lib/app-version.js';
import { compareVersions } from '../../lib/semver.js';
import { resolveLatestRelease } from './github-release.js';

/** Single-quote a value for safe interpolation into a bash script. */
function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Allowlisted "guided install" commands.
 *
 * Important: do not introduce a freeform-shell command. Every entry here is a
 * fixed argv that's executed in a PTY for the user to watch (and, where
 * needed, type their sudo password into). Any new install command must be
 * added here explicitly — the websocket transport refuses unknown ids.
 */
export interface InstallerCommand {
  id: string;
  description: string;
  /** argv passed to the PTY. We use `bash -lc` for shell-piped installs so
   *  `curl | sudo bash` works as expected. */
  argv: [string, ...string[]];
  /** Optional readiness check run after exit — return true if the install
   *  appears to have succeeded. */
  postCheck?: () => Promise<boolean>;
}

/** Where downloaded binaries live. Resolved against the backend's CWD so the
 *  same path works in dev (`npm run dev`) and production. */
export const LOCAL_BIN_DIR = resolve(process.cwd(), 'bin');
export const CLOUDFLARED_LOCAL_PATH = resolve(LOCAL_BIN_DIR, 'cloudflared');
export const FRPC_LOCAL_PATH = resolve(LOCAL_BIN_DIR, 'frpc');

/**
 * Pinned frp release for the Basis Remote tunnel client. Pinned (not
 * `latest`) because the asset filenames embed the version and because a pin
 * is what makes the sha256 verification below meaningful. Keep in sync with
 * the relay's pin in cloud/deploy/provision.sh so client/server stay within
 * a compatible protocol range.
 */
export const FRP_VERSION = '0.61.1';

async function ensureBinDir(): Promise<void> {
  await fs.mkdir(LOCAL_BIN_DIR, { recursive: true });
}

function cloudflaredAsset(platform: NodeJS.Platform, arch: string): string {
  // Cloudflared release naming, see github.com/cloudflare/cloudflared/releases
  if (platform === 'linux') {
    if (arch === 'arm64' || arch === 'aarch64') return 'cloudflared-linux-arm64';
    if (arch === 'arm') return 'cloudflared-linux-arm';
    return 'cloudflared-linux-amd64';
  }
  if (platform === 'darwin') {
    // No separate arm64 build — Cloudflare ships a universal tgz, but the
    // amd64 binary runs under Rosetta. Keep it simple.
    return 'cloudflared-darwin-amd64.tgz';
  }
  throw new Error(`Unsupported platform: ${platform}/${arch}`);
}

function frpAsset(platform: NodeJS.Platform, arch: string): string {
  // frp release naming, see github.com/fatedier/frp/releases:
  //   frp_<version>_<os>_<arch>.tar.gz  (tarball contains both frps and frpc)
  if (platform === 'linux') {
    if (arch === 'arm64' || arch === 'aarch64') return `frp_${FRP_VERSION}_linux_arm64`;
    if (arch === 'arm') return `frp_${FRP_VERSION}_linux_arm`;
    return `frp_${FRP_VERSION}_linux_amd64`;
  }
  if (platform === 'darwin') {
    return arch === 'arm64'
      ? `frp_${FRP_VERSION}_darwin_arm64`
      : `frp_${FRP_VERSION}_darwin_amd64`;
  }
  throw new Error(`Unsupported platform: ${platform}/${arch}`);
}

const COMMANDS: InstallerCommand[] = [
  {
    // Freeform shell for the admin-only Terminal settings page. Runs as the
    // backend user — same trust boundary as that user's SSH session. Listed
    // here so it shares the namespace's admin-only auth and PTY plumbing.
    id: 'shell-bash',
    description: 'Open a freeform bash login shell as the backend user.',
    argv: ['bash', '-l'],
  },
  {
    // Self-update: fetches the latest GitHub release tarball, extracts to
    // /opt/basis/versions/<version>/, runs `npm ci` + build + migrations,
    // swaps /opt/basis/current symlink, then triggers a detached systemd
    // restart so the new code takes over.
    //
    // The restart is detached (`nohup ... &` + `disown`) so it survives
    // the PTY being killed when the running backend exits. systemd's
    // Restart=always will then bring the new code up — but for a clean
    // handoff we explicitly `systemctl restart` instead of relying on
    // crash-recovery semantics.
    id: 'update-self',
    description: 'Update Basis to the latest GitHub release.',
    argv: [
      'bash',
      '-lc',
      `set -eo pipefail
# TARBALL_URL / EXPECTED_VERSION / CURRENT_VERSION are injected by buildArgv,
# resolved server-side by the SAME semver logic the update-check endpoint uses
# (github-release.ts). The updater no longer greps GitHub's array order itself,
# so the "Update to vX" button and what actually installs can't diverge.
echo "Installing Basis $EXPECTED_VERSION (resolved by the server; currently on $CURRENT_VERSION)..."
LATEST="$TARBALL_URL"
if [ -z "$LATEST" ]; then
  echo "No release tarball URL was provided. Aborting."
  exit 1
fi
echo "Tarball: $LATEST"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT
echo "Downloading..."
curl -fL "$LATEST" -o "$TMPDIR/release.tar.gz"
echo "Verifying checksum against the published .sha256..."
EXPECTED=$(curl -fsSL "$LATEST.sha256" 2>/dev/null | awk '{print $1}') || true
if [ -z "$EXPECTED" ]; then
  echo "No published checksum for this release — refusing to install unverified code."
  exit 1
fi
ACTUAL=$(sha256sum "$TMPDIR/release.tar.gz" | awk '{print $1}')
if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "Checksum mismatch (expected $EXPECTED, got $ACTUAL). Aborting."
  exit 1
fi
echo "Checksum OK."
echo "Extracting..."
tar -xzf "$TMPDIR/release.tar.gz" -C "$TMPDIR"
EXTRACTED=$(ls -d "$TMPDIR"/basis-* | head -1)
NEW_VERSION=$(cat "$EXTRACTED/VERSION")

# Defense in depth (the server already resolved + guarded this):
# 1) the downloaded tarball must be the version the server resolved, and
# 2) never downgrade — sort -V puts the lower version first.
if [ "$NEW_VERSION" != "$EXPECTED_VERSION" ]; then
  echo "Downloaded tarball is version $NEW_VERSION but the server resolved $EXPECTED_VERSION. Aborting before any change."
  exit 1
fi
if [ "$CURRENT_VERSION" != "dev" ] && [ "$NEW_VERSION" != "$CURRENT_VERSION" ] \\
   && [ "$(printf '%s\\n%s\\n' "$NEW_VERSION" "$CURRENT_VERSION" | sort -V | head -1)" = "$NEW_VERSION" ]; then
  echo "Refusing to downgrade from $CURRENT_VERSION to $NEW_VERSION."
  exit 1
fi
DEST="/opt/basis/versions/$NEW_VERSION"
echo "Staging version $NEW_VERSION at $DEST"
mkdir -p "/opt/basis/versions"
rm -rf "$DEST"
mv "$EXTRACTED" "$DEST"

# Runtime-downloaded binaries (cloudflared) live in the persistent
# /opt/basis/bin, not the version dir — otherwise this update orphans the
# guided "Install cloudflared" download and the tunnel silently fails to start
# (Cloudflare 1033). Point backend/bin at the shared dir.
mkdir -p /opt/basis/bin
rm -rf "$DEST/backend/bin"
ln -sfn /opt/basis/bin "$DEST/backend/bin"

echo "Loading environment..."
set -a; . /opt/basis/.env; set +a

echo "Taking a pre-update database snapshot (migrations are forward-only, so this is your rollback point)..."
mkdir -p /opt/basis/data/backups
SNAPSHOT="/opt/basis/data/backups/pre-update-$NEW_VERSION-$(date +%Y%m%d-%H%M%S).sql.gz"
if ! pg_dump "$DATABASE_URL" | gzip > "$SNAPSHOT"; then
  echo "Pre-update snapshot failed — aborting before any migration runs."
  rm -f "$SNAPSHOT"
  exit 1
fi
echo "Snapshot saved: $SNAPSHOT"

echo "Installing backend dependencies..."
cd "$DEST/backend"
# We sourced /opt/basis/.env above (for the snapshot's DATABASE_URL), which sets
# NODE_ENV=production. Under that, npm ci OMITS devDependencies — including
# typescript, which the build needs (npm run build → tsc). The fresh install.sh
# dodges this only because it runs before .env exists. So force a full install:
#   --include=dev   so tsc et al. are present to build
# And never add --omit=optional: sharp ships its native binary in optional
# platform packages (@img/sharp-linux-*); omitting them yields an empty
# node_modules/@img and the backend crashes on boot (sharp.js throws), taking
# the Cloudflare tunnel down with it (1033).
npm ci --no-audit --no-fund --include=dev
echo "Building backend..."
npm run build

# Smoke-test the staged build BEFORE migrating or swapping the live symlink.
# A broken native dependency (e.g. sharp) or a build that didn't emit dist/
# must never become /opt/basis/current — abort here and the currently-running
# version keeps serving untouched. Migrations are forward-only, so this runs
# before db:migrate too.
echo "Smoke-testing the staged build (syntax + sharp native module + dist entrypoint)..."
test -f "$DEST/backend/dist/index.js" || { echo "Build incomplete: dist/index.js missing. Aborting before going live."; exit 1; }
# Syntax-check the entrypoints AND the updater itself. A syntax error in a
# non-entrypoint file (e.g. a stray backtick in this very file) still emits
# dist/index.js, so the existence check above won't catch it — but it crash-loops
# the backend on boot. node --check parses without executing.
for f in dist/index.js dist/worker.js dist/modules/install/installer-commands.js; do
  node --check "$DEST/backend/$f" || { echo "Staged build has a syntax error in $f. Aborting before going live."; exit 1; }
done
node -e "require('sharp')" \
  || { echo "Staged build can't load the sharp image library (native package missing). Aborting before going live."; exit 1; }
echo "Smoke test passed."

echo "Running database migrations..."
npm run db:migrate

echo "Swapping current symlink atomically..."
# Record where current points BEFORE the swap so the watchdog can roll back to it.
PREV_TARGET=$(readlink /opt/basis/current 2>/dev/null || true)
ln -sfn "versions/$NEW_VERSION" /opt/basis/current.new
mv -T /opt/basis/current.new /opt/basis/current

echo ""
echo "✓ Update staged. Restarting basis.service in 3 seconds..."
echo "  (Connection to this terminal will drop when the service restarts.)"
# Detach the restart so it survives this PTY being torn down once the command
# finishes. We use setsid (not nohup plus disown) on purpose: this script runs
# inside a node-pty PTY whose server kills the whole PTY process group with
# SIGTERM on exit or disconnect. nohup only ignores SIGHUP and disown only edits
# the shell job table, so neither escapes that process group -- the backgrounded
# restarter was being SIGTERMed mid-sleep before it ever issued the restart, so
# the update swapped the symlink but the old process kept running the old code.
# setsid starts a new session, breaking the restarter out of the doomed group.
# (Comment kept free of backtick, dollar-brace and backslash -- this whole shell
# script is a JS template literal, where those would corrupt the emitted code.)
#
# Runs unattended thanks to the narrow NOPASSWD rule the installer drops at
# /etc/sudoers.d/basis -- without it this sudo cannot read a password (stdin is
# /dev/null) and the new code would never start.
# reset-failed first (best-effort) so a latched start-limit from an earlier
# aborted attempt does not make the restart fail with "start request repeated
# too quickly"; the true-fallbacks cover older installs whose sudoers predates
# that rule. Then the parser sidecar best-effort, then the critical units last.
# Prefer the health-checking watchdog (restarts, then auto-reverts the symlink
# to PREV_TARGET if the new version never becomes healthy). Fall back to the
# plain detached restart if this release predates the watchdog script.
WATCHDOG="$DEST/backend/deploy/native/post-update-watchdog.sh"
if [ -f "$WATCHDOG" ]; then
  setsid bash "$WATCHDOG" "$PREV_TARGET" "$NEW_VERSION" </dev/null >/dev/null 2>&1 &
else
  setsid bash -c 'sleep 3 && { sudo systemctl reset-failed basis basis-worker || true; } && { sudo systemctl restart basis-ingredient-parser || true; } && sudo systemctl restart basis basis-worker' </dev/null >/dev/null 2>&1 &
fi
echo "Update complete — now at $NEW_VERSION"
echo "A health watchdog will auto-roll back the code to the previous version if"
echo "this one fails to come up. If a bad migration is the cause, also restore"
echo "$SNAPSHOT, then 'sudo systemctl restart basis basis-worker'."
`,
    ],
  },
  {
    id: 'install-tailscale-linux',
    description: 'Install Tailscale via the official one-liner, then sign in.',
    argv: [
      'bash',
      '-lc',
      // After install, run `tailscale up` so the auth URL gets printed and the
      // GuidedInstallDialog can surface it as a clickable button. We pass
      // --operator=$USER so the backend can later run `tailscale serve` for
      // the HTTPS-on-tailnet flow without sudo.
      `set -e
echo "Installing Tailscale (one-liner from tailscale.com)..."
curl -fsSL https://tailscale.com/install.sh | sudo bash
echo ""
echo "Granting this user permission to manage Tailscale serve..."
sudo tailscale set --operator=$USER
echo ""
echo "Starting Tailscale and getting auth URL..."
sudo tailscale up
echo ""
echo "Tailscale installed and signed in."`,
    ],
  },
  {
    id: 'install-tailscale-darwin',
    description: 'Install Tailscale via Homebrew, then guide sign-in.',
    argv: [
      'bash',
      '-lc',
      `set -e
echo "Installing Tailscale via Homebrew..."
brew install --cask tailscale
echo ""
echo "Launch Tailscale from your Applications folder and sign in."
echo "Once signed in, return here and click 'Check again'."`,
    ],
  },
  {
    id: 'install-cloudflared',
    description: 'Download the cloudflared binary into the app\'s local bin.',
    argv: [
      'bash',
      '-lc',
      // Resolved at spawn time below — see customizeForRuntime.
      '__CLOUDFLARED_INSTALL_PLACEHOLDER__',
    ],
    postCheck: async () => {
      try {
        const stat = await fs.stat(CLOUDFLARED_LOCAL_PATH);
        return stat.isFile();
      } catch {
        return false;
      }
    },
  },
  {
    id: 'install-frpc',
    description: 'Download the frpc tunnel client (Basis Remote) into the app\'s local bin.',
    argv: [
      'bash',
      '-lc',
      // Resolved at spawn time below — see buildArgv.
      '__FRPC_INSTALL_PLACEHOLDER__',
    ],
    postCheck: async () => {
      try {
        const stat = await fs.stat(FRPC_LOCAL_PATH);
        return stat.isFile();
      } catch {
        return false;
      }
    },
  },
];

/**
 * Resolve any per-runtime placeholders in the command. Returns a fresh argv;
 * the original allowlist entry is never mutated.
 */
export async function buildArgv(
  id: string,
  opts?: { prerelease?: boolean },
): Promise<[string, ...string[]]> {
  const cmd = COMMANDS.find((c) => c.id === id);
  if (!cmd) throw new Error(`Unknown installer: ${id}`);

  if (id === 'shell-bash' && !config.ENABLE_ADMIN_TERMINAL) {
    throw new Error('The admin terminal is disabled (ENABLE_ADMIN_TERMINAL=false)');
  }

  if (id === 'update-self') {
    // Resolve the target release HERE, server-side, with the same semver +
    // prerelease logic as GET /install/version — then inject the resolved
    // tarball URL and versions into the script. The URL is never client-
    // supplied (no injection surface); the client only chooses the
    // prerelease preference, matching what the Updates page showed.
    const current = await getAppVersion();
    const includePrerelease = opts?.prerelease !== false; // default true, matches /version
    const resolved = await resolveLatestRelease(includePrerelease);
    if (!resolved || !resolved.tarballUrl) {
      throw new Error('No installable Basis release found on GitHub (no .tar.gz asset).');
    }
    // Downgrade/no-op guard mirrors the UI's updateAvailable check, so the
    // button and the actual install agree on "is there something newer".
    if (current !== 'dev' && compareVersions(resolved.version, current) <= 0) {
      throw new Error(
        `Already on the latest version (installed ${current}, latest ${resolved.version}). Refusing to reinstall or downgrade.`,
      );
    }
    const header =
      [
        `TARBALL_URL=${shSingleQuote(resolved.tarballUrl)}`,
        `EXPECTED_VERSION=${shSingleQuote(resolved.version)}`,
        `CURRENT_VERSION=${shSingleQuote(current)}`,
      ].join('\n') + '\n';
    return ['bash', '-lc', header + cmd.argv[2]];
  }

  if (id === 'install-cloudflared') {
    await ensureBinDir();
    const asset = cloudflaredAsset(process.platform, process.arch);
    const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`;
    const target = CLOUDFLARED_LOCAL_PATH;

    // For the tgz (macOS), extract; for raw binaries, just chmod.
    const script = asset.endsWith('.tgz')
      ? `set -e
echo "Downloading $asset from GitHub releases..."
TMPDIR=$(mktemp -d)
curl -fL "${url}" -o "$TMPDIR/cloudflared.tgz"
tar -xzf "$TMPDIR/cloudflared.tgz" -C "$TMPDIR"
mv "$TMPDIR/cloudflared" "${target}"
chmod +x "${target}"
rm -rf "$TMPDIR"
echo "Installed cloudflared to ${target}"
"${target}" --version`
      : `set -e
echo "Downloading ${asset} from GitHub releases..."
mkdir -p "${LOCAL_BIN_DIR}"
curl -fL "${url}" -o "${target}"
chmod +x "${target}"
echo "Installed cloudflared to ${target}"
"${target}" --version`;

    return ['bash', '-lc', script];
  }

  if (id === 'install-frpc') {
    await ensureBinDir();
    const asset = frpAsset(process.platform, process.arch);
    const base = `https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}`;
    const target = FRPC_LOCAL_PATH;

    // Unlike the cloudflared entry, frp publishes per-release checksums —
    // verify them and refuse an unverified binary (same stance as update-self).
    const script = `set -eo pipefail
echo "Downloading ${asset}.tar.gz from frp v${FRP_VERSION} GitHub release..."
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT
curl -fL "${base}/${asset}.tar.gz" -o "$TMPDIR/frp.tar.gz"
echo "Verifying checksum against the published frp_sha256_checksums.txt..."
curl -fsSL "${base}/frp_sha256_checksums.txt" -o "$TMPDIR/checksums.txt"
EXPECTED=$(grep "  ${asset}.tar.gz\$" "$TMPDIR/checksums.txt" | awk '{print $1}')
if [ -z "$EXPECTED" ]; then
  echo "No published checksum for ${asset}.tar.gz — refusing to install unverified binary."
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL=$(sha256sum "$TMPDIR/frp.tar.gz" | awk '{print $1}')
else
  ACTUAL=$(shasum -a 256 "$TMPDIR/frp.tar.gz" | awk '{print $1}')
fi
if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "Checksum mismatch (expected $EXPECTED, got $ACTUAL). Aborting."
  exit 1
fi
echo "Checksum OK."
tar -xzf "$TMPDIR/frp.tar.gz" -C "$TMPDIR"
mkdir -p "${LOCAL_BIN_DIR}"
mv "$TMPDIR/${asset}/frpc" "${target}"
chmod +x "${target}"
echo "Installed frpc to ${target}"
"${target}" -v`;

    return ['bash', '-lc', script];
  }

  return cmd.argv;
}

export function listAvailableInstallers(): Array<{ id: string; description: string }> {
  return COMMANDS.filter(
    (c) => c.id !== 'shell-bash' || config.ENABLE_ADMIN_TERMINAL
  ).map(({ id, description }) => ({ id, description }));
}

export async function runPostCheck(id: string): Promise<boolean | undefined> {
  const cmd = COMMANDS.find((c) => c.id === id);
  return cmd?.postCheck?.();
}
