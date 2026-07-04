import { GITHUB_URL } from '@/lib/site';

export function SecurityPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
        Security & privacy
      </h1>

      <div className="mt-8 space-y-10 leading-relaxed text-stone-700">
        <section>
          <h2 className="text-xl font-semibold text-stone-900">Threat model</h2>
          <p className="mt-3">
            Basis is a household-scale self-hosted app. The expected admin is
            the person installing it; the expected users are people they live
            with. Basis is not designed for use by people who are adversarial
            to each other.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-900">
            What lives where
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <strong>Database (on your box):</strong> per-household data —
              events, recipes, tasks, lists, inventory, user records (with
              argon2-hashed passwords), session tokens.
            </li>
            <li>
              <strong>File storage (on your box):</strong> uploaded photos,
              videos, files.
            </li>
            <li>
              <strong>
                <code className="font-mono text-sm">.env</code> (on your box):
              </strong>{' '}
              secrets — database password, session secret, encryption key.
              Owned by the <code className="font-mono text-sm">basis</code>{' '}
              system user with 600 permissions.
            </li>
            <li>
              <strong>GitHub:</strong> only what you push (code changes, if
              any).
            </li>
            <li>
              <strong>Cloudflare / Tailscale / Basis Remote:</strong> traffic
              metadata if you use one of them for remote access. Basis itself
              doesn't send your data to any of them.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-900">
            Authentication
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              Cookie sessions, signed with a per-install secret. 7-day default
              expiry.
            </li>
            <li>Passwords hashed with argon2id at the standard parameters.</li>
            <li>
              App passwords for CalDAV — scoped per device, revocable, and
              never able to mint other app passwords.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-900">
            Update integrity
          </h2>
          <p className="mt-3">
            Updates pull tarballs from GitHub Releases over HTTPS. The release
            workflow publishes a SHA-256 sum alongside each tarball, and the
            in-UI updater verifies it before extraction — a checksum mismatch,
            or a missing sum, aborts the update before any code is installed.
            Before running migrations the updater also takes a pre-update
            database snapshot, so a rollback can restore the old schema as
            well as the old code.
          </p>
        </section>

        <section className="rounded-xl border border-pine-200 bg-pine-50 p-6">
          <h2 className="text-xl font-semibold text-pine-950">Basis Remote</h2>
          <p className="mt-3 text-pine-950/80">
            Basis Remote works over an outbound-only tunnel: your box dials
            out to our relay, so nothing on your network is exposed and no
            ports are forwarded. Each box authenticates with its own tunnel
            token — revocable from your dashboard at any time, and stored only
            as a hash on our side. Traffic to{' '}
            <code className="font-mono text-sm">
              yourname.home-basis.com
            </code>{' '}
            is relayed through our server and TLS terminates at our relay; we
            meter transfer volume for billing but do not inspect or log
            request contents. If relaying through us isn't acceptable for your
            threat model, self-hosting with Tailscale is built in and free
            forever — we'd rather say that plainly than pretend the trade-off
            doesn't exist.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-900">
            Reporting a vulnerability
          </h2>
          <p className="mt-3">
            Open a GitHub Security Advisory at{' '}
            <a
              href={`${GITHUB_URL}/security/advisories/new`}
              target="_blank"
              rel="noreferrer"
              className="text-pine-700 underline hover:text-pine-800"
            >
              github.com/Springdale-Robotics/basis/security/advisories/new
            </a>
            . We take reports at household scale as seriously as anyone at
            enterprise scale.
          </p>
        </section>
      </div>
    </div>
  );
}
