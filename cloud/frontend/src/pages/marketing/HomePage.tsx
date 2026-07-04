import { Link } from 'react-router-dom';
import { CopyButton } from '@/components/ui';
import { GITHUB_URL, INSTALL_SNIPPET } from '@/lib/site';

const pitch = [
  {
    title: 'One install command, then UI for everything else.',
    body: 'Paste a single command on a box you control. After that, every piece of configuration — remote access, updates, backups, even a system shell — happens in the browser. No SSH, no YAML.',
  },
  {
    title: 'Designed for households, not enterprises.',
    body: 'Per-member permissions, group overrides, a rewards & chore chart mode you can turn off when the kids grow up, and sensible defaults for the way real families use things.',
  },
  {
    title: 'Yours to keep.',
    body: 'MIT-licensed, runs entirely on hardware you own. No cloud account required. Remote access is optional — and you choose how: Basis Remote, Tailscale, Cloudflare Tunnel, or your own domain.',
  },
];

const features = [
  {
    title: 'Calendar',
    body: 'Shared household calendar with two-way CalDAV/ICS sync. iOS, macOS, Outlook, Thunderbird, and Google Calendar can all subscribe and edit.',
  },
  {
    title: 'Recipes & meal plan',
    body: 'Recipe library with URL import, meal planning per day and meal, and a cook mode that turns any recipe into a step-through.',
  },
  {
    title: 'Tasks & chores',
    body: 'Assignable tasks with due dates and real recurrence. Rewards mode awards points for chores — built for households with kids, easy to switch off.',
  },
  {
    title: 'Inventory & shopping list',
    body: 'Track what is in the pantry, fridge, or wherever. A smart shopping list infers when you are running low.',
  },
  {
    title: 'Lists',
    body: 'Checklists, wishlists, and notes for everything that is not a task. Offline sync, so it works on bad signal at the grocery store.',
  },
  {
    title: 'Files, photos, music',
    body: 'Browser-based file storage with thumbnails, a photo gallery, and video and music transcoding so clients can stream.',
  },
  {
    title: 'Per-member permissions',
    body: 'Admin, member, kid, visitor. Override any feature per user or per group: "kid can view but not edit the calendar."',
  },
  {
    title: 'Remote access, minus the hard parts',
    body: 'Pick a mode in settings and the guided setup does the rest — including installing what is missing — from a terminal you watch in the browser.',
  },
];

function TerminalCard() {
  return (
    <div className="overflow-hidden rounded-xl border border-stone-700 bg-stone-950 shadow-xl">
      <div className="flex items-center gap-2 border-b border-stone-800 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-stone-700" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-stone-700" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-stone-700" aria-hidden="true" />
        <span className="ml-2 font-mono text-xs text-stone-500">
          your box in the closet
        </span>
      </div>
      <div className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed">
        {INSTALL_SNIPPET.split('\n').map((line) => (
          <div key={line} className="whitespace-pre text-stone-200">
            <span className="select-none text-pine-400">$ </span>
            {line}
          </div>
        ))}
        <div className="mt-3 text-emerald-400">✓ Basis is installed</div>
        <div className="text-stone-400">
          {'  '}Open your browser to finish setup:
        </div>
        <div className="text-stone-200">
          {'    '}http://192.168.1.50:3000{'  '}
          <span className="text-stone-500">(LAN)</span>
        </div>
      </div>
    </div>
  );
}

export function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="mx-auto grid max-w-page items-center gap-12 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-2 lg:pt-24">
        <div>
          <p className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-pine-700">
            Self-hosted · MIT-licensed
          </p>
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-stone-900 sm:text-5xl">
            Everything your household runs on, in one app you actually own.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-stone-600">
            Basis is a self-hosted household app: calendar with CalDAV sync,
            recipes with meal planning, chores and tasks, inventory and
            shopping lists, photos and files. One install command on a box you
            control — everything after that is configured in the web UI.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/app/signup"
              className="rounded-lg bg-pine-700 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-pine-800"
            >
              Get your address
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-stone-300 px-5 py-3 text-sm font-medium text-stone-900 transition-colors hover:border-stone-400 hover:bg-stone-50"
            >
              View on GitHub
            </a>
          </div>
        </div>
        <TerminalCard />
      </section>

      {/* Three-bullet pitch */}
      <section className="border-y border-stone-200 bg-stone-50">
        <div className="mx-auto grid max-w-page gap-10 px-4 py-16 sm:px-6 md:grid-cols-3">
          {pitch.map((item) => (
            <div key={item.title}>
              <h2 className="text-base font-semibold text-stone-900">
                {item.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-page px-4 py-20 sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight text-stone-900">
          The whole household, one app
        </h2>
        <p className="mt-2 max-w-2xl text-stone-600">
          Not a plugin platform, not a smart-home hub — the logistics your
          family already runs on, done properly.
        </p>
        <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-stone-200 bg-stone-200 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <div key={feature.title} className="bg-white p-6">
              <h3 className="text-sm font-semibold text-stone-900">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">
                {feature.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Install */}
      <section className="border-y border-stone-200 bg-stone-50">
        <div className="mx-auto max-w-page px-4 py-16 sm:px-6">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-stone-900">
                Installed in about five minutes
              </h2>
              <p className="mt-3 leading-relaxed text-stone-600">
                Runs comfortably on a Raspberry Pi 4, a mini PC, or that old
                laptop in the drawer. Ubuntu or Debian, one command, and the
                installer handles packages, the database, secrets, and systemd.
                Updates and backups ship in the UI.
              </p>
              <p className="mt-3 text-sm text-stone-500">
                Prefer Docker? That works too —{' '}
                <Link to="/docs" className="text-pine-700 underline hover:text-pine-800">
                  see the docs
                </Link>
                .
              </p>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white">
              <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2">
                <span className="font-mono text-xs text-stone-500">
                  Ubuntu / Debian / Raspberry Pi OS
                </span>
                <CopyButton text={INSTALL_SNIPPET} />
              </div>
              <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-stone-800">
                {INSTALL_SNIPPET}
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* Basis Remote */}
      <section className="mx-auto max-w-page px-4 py-20 sm:px-6">
        <div className="overflow-hidden rounded-2xl bg-pine-950 px-6 py-14 text-center sm:px-12">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-pine-300">
            Basis Remote
          </p>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Your house, at your family's name
          </h2>
          <div className="mx-auto mt-8 max-w-full overflow-x-auto">
            <p className="whitespace-nowrap font-mono text-2xl sm:text-4xl">
              <span className="rounded-lg border border-pine-600 bg-pine-900 px-3 py-1 text-pine-50">
                lastname
              </span>
              <span className="text-pine-400">.home-basis.com</span>
            </p>
          </div>
          <p className="mx-auto mt-8 max-w-2xl leading-relaxed text-pine-100">
            Basis Remote gives your install a permanent address on the
            internet. Your box opens an outbound tunnel to our relay — no port
            forwarding, no router settings, nothing exposed. Paste one code
            into Basis settings and the calendar, recipes, and photos work from
            anywhere, for everyone in the household.
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-pine-300">
            From $20/year. Prefer to keep everything free? Tailscale mode is
            built in and always will be.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              to="/app/signup"
              className="rounded-lg bg-white px-5 py-3 text-sm font-medium text-pine-900 transition-colors hover:bg-pine-50"
            >
              Claim your address
            </Link>
            <Link
              to="/pricing"
              className="rounded-lg border border-pine-600 px-5 py-3 text-sm font-medium text-pine-100 transition-colors hover:bg-pine-900"
            >
              See pricing
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
