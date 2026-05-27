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
