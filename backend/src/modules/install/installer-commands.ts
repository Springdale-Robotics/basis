import { resolve } from 'path';
import { promises as fs } from 'fs';

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
echo "Checking GitHub for the latest Basis release..."
LATEST=$(curl -fsSL https://api.github.com/repos/Springdale-Robotics/basis/releases \\
  | grep -oE '"browser_download_url": ?"[^"]+basis-[^"]+\\.tar\\.gz"' \\
  | head -1 \\
  | sed -E 's/.*"(.+)"/\\1/')
if [ -z "$LATEST" ]; then
  echo "Could not find a release tarball. Aborting."
  exit 1
fi
echo "Latest tarball: $LATEST"

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
npm ci --no-audit --no-fund --omit=optional
echo "Building backend..."
npm run build

echo "Running database migrations..."
npm run db:migrate

echo "Swapping current symlink atomically..."
ln -sfn "versions/$NEW_VERSION" /opt/basis/current.new
mv -T /opt/basis/current.new /opt/basis/current

echo ""
echo "✓ Update staged. Restarting basis.service in 3 seconds..."
echo "  (Connection to this terminal will drop when the service restarts.)"
# Detach the restart so it survives this PTY being killed by the service exit.
# Runs unattended thanks to the narrow NOPASSWD rule the installer drops at
# /etc/sudoers.d/basis — without it this sudo can't read a password (stdin is
# /dev/null) and the new code would never start.
# reset-failed first (best-effort) so a latched start-limit from an earlier
# aborted attempt doesn't make the restart fail with "start request repeated too
# quickly"; || true covers older installs whose sudoers predates that rule.
# Then the parser sidecar best-effort (same older-sudoers caveat), then the
# critical units last in their always-allowed form.
nohup bash -c 'sleep 3 && { sudo systemctl reset-failed basis basis-worker || true; } && { sudo systemctl restart basis-ingredient-parser || true; } && sudo systemctl restart basis basis-worker' </dev/null >/dev/null 2>&1 &
disown
echo "Update complete — now at $NEW_VERSION"
echo "Roll back if needed: point /opt/basis/current at the previous version,"
echo "restore $SNAPSHOT, then 'sudo systemctl restart basis basis-worker'."
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
];

/**
 * Resolve any per-runtime placeholders in the command. Returns a fresh argv;
 * the original allowlist entry is never mutated.
 */
export async function buildArgv(id: string): Promise<[string, ...string[]]> {
  const cmd = COMMANDS.find((c) => c.id === id);
  if (!cmd) throw new Error(`Unknown installer: ${id}`);

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

  return cmd.argv;
}

export function listAvailableInstallers(): Array<{ id: string; description: string }> {
  return COMMANDS.map(({ id, description }) => ({ id, description }));
}

export async function runPostCheck(id: string): Promise<boolean | undefined> {
  const cmd = COMMANDS.find((c) => c.id === id);
  return cmd?.postCheck?.();
}
