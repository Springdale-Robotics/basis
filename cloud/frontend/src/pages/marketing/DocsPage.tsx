import { Link } from 'react-router-dom';
import { CopyButton } from '@/components/ui';
import { GITHUB_URL, INSTALL_SNIPPET } from '@/lib/site';

const remoteModes = [
  {
    name: 'Basis Remote',
    tag: 'Recommended',
    body: 'A permanent lastname.home-basis.com address over an outbound tunnel — no port forwarding, no VPN app on every phone, works for the whole household including guests. Paid ($20 or $36/year); claim your address, then paste one code into Basis Settings → Remote Access.',
  },
  {
    name: 'Tailscale',
    tag: 'Free',
    body: 'Your devices join a private tailnet and reach Basis directly, with a real HTTPS certificate for your tailnet hostname. Free for a typical household; every user needs the Tailscale app. Guided setup from the Remote Access settings page.',
  },
  {
    name: 'Cloudflare Tunnel',
    tag: 'Free',
    body: 'Publishes Basis to the public internet through Cloudflare, no port forwarding. Requires a Cloudflare account and your own domain on Cloudflare DNS. Note Cloudflare’s terms restrict proxying streamed media.',
  },
  {
    name: 'Custom domain',
    tag: 'DIY',
    body: 'You already run a reverse proxy and own a domain. Point it at Basis, and the settings page hands you copy-pastable Caddy and nginx snippets templated to your hostname.',
  },
];

export function DocsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
        Docs
      </h1>
      <p className="mt-4 leading-relaxed text-stone-600">
        The short version lives here; the full documentation lives in the{' '}
        <a
          href={`${GITHUB_URL}#readme`}
          target="_blank"
          rel="noreferrer"
          className="text-pine-700 underline hover:text-pine-800"
        >
          GitHub README
        </a>
        .
      </p>

      <section className="mt-12">
        <h2 className="text-xl font-semibold text-stone-900">Install</h2>
        <p className="mt-3 leading-relaxed text-stone-700">
          On Ubuntu, Debian, or Raspberry Pi OS, run this on the box that will
          host Basis:
        </p>
        <div className="mt-4 rounded-xl border border-stone-200 bg-white">
          <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2">
            <span className="font-mono text-xs text-stone-500">terminal</span>
            <CopyButton text={INSTALL_SNIPPET} />
          </div>
          <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-stone-800">
            {INSTALL_SNIPPET}
          </pre>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-stone-600">
          The installer sets up Node, PostgreSQL, Redis, ffmpeg, a{' '}
          <code className="font-mono">basis</code> system user, secrets, and
          systemd units, then prints the URL to finish setup in your browser.
          About five minutes on first run. Docker and macOS paths are covered
          in the README.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold text-stone-900">Remote access</h2>
        <p className="mt-3 leading-relaxed text-stone-700">
          By default Basis is reachable only on your LAN. Four supported ways
          to use it from anywhere — all configured from Settings → Remote
          Access, with guided installs for anything that's missing:
        </p>
        <div className="mt-6 space-y-4">
          {remoteModes.map((mode) => (
            <div
              key={mode.name}
              className="rounded-xl border border-stone-200 bg-white p-5"
            >
              <div className="flex items-center gap-3">
                <h3 className="font-semibold text-stone-900">{mode.name}</h3>
                <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600">
                  {mode.tag}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">
                {mode.body}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-stone-600">
          Ready for the recommended path?{' '}
          <Link
            to="/app/signup"
            className="text-pine-700 underline hover:text-pine-800"
          >
            Claim your address
          </Link>{' '}
          or{' '}
          <Link
            to="/pricing"
            className="text-pine-700 underline hover:text-pine-800"
          >
            compare plans
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
