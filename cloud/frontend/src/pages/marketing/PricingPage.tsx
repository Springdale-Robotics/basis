import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { GITHUB_URL } from '@/lib/site';

const faqs = [
  {
    question: 'What happens when I hit the transfer cap?',
    answer:
      'On Basic, transfers are throttled to 4 Mbps for the rest of the month — the app stays perfectly usable for calendars, tasks, recipes, and photos, but streaming your movie library becomes impractical. Nothing is cut off, and the cap resets on the first of the month. Streaming’s 2 TB is a fair-use cap: we don’t auto-throttle, and we’ll reach out before doing anything if usage is consistently far beyond it.',
  },
  {
    question: 'What happens if I cancel?',
    answer:
      'Your tunnel keeps working until the end of the period you’ve paid for, then stops. Your subdomain stays reserved for you for 90 days in case you come back; after that it can be claimed by someone else. Your data never leaves your box, so there is nothing to export — Basis keeps working exactly as before on your LAN or over Tailscale.',
  },
  {
    question: 'What about privacy?',
    answer:
      'Honest answer: Basis Remote relays your traffic through our server, and TLS terminates at our relay — so, unlike a fully self-hosted setup, we are technically in a position to see traffic in transit. We don’t inspect or log request contents; we meter transfer volume for billing. If that trade-off isn’t right for you, self-hosting with Tailscale is built into Basis and remains free forever. We built both paths on purpose.',
  },
  {
    question: 'Why annual only?',
    answer:
      'Basis Remote is priced to cover relay bandwidth and DNS with minimal overhead, not to be a growth machine. Annual billing keeps prices low and paperwork boring.',
  },
];

function CheckItem({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2.5 text-sm text-stone-700">
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        className="mt-0.5 h-4 w-4 shrink-0 text-pine-600"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 111.4-1.4l2.8 2.79 6.8-6.8a1 1 0 011.4 0z"
          clipRule="evenodd"
        />
      </svg>
      <span>{children}</span>
    </li>
  );
}

export function PricingPage() {
  return (
    <div className="mx-auto max-w-page px-4 py-16 sm:px-6">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
          Basis is free. Remote access, your way.
        </h1>
        <p className="mt-4 leading-relaxed text-stone-600">
          The app is MIT-licensed and self-hosted — there is no paid version of
          Basis itself, and there never will be. Basis Remote is an optional
          service for households that want a real{' '}
          <span className="font-mono text-sm text-pine-800">
            lastname.home-basis.com
          </span>{' '}
          address without port forwarding or a VPN app on every phone.
        </p>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-3">
        {/* Self-hosted */}
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-6">
          <h2 className="text-lg font-semibold text-stone-900">Self-hosted</h2>
          <p className="mt-1 text-sm text-stone-500">The whole app, forever</p>
          <p className="mt-4 text-3xl font-bold text-stone-900">
            Free
            <span className="text-sm font-normal text-stone-500"> — MIT-licensed</span>
          </p>
          <ul className="mt-6 space-y-2.5">
            <CheckItem>Every feature, on your hardware</CheckItem>
            <CheckItem>Tailscale mode: free remote access via your own tailnet</CheckItem>
            <CheckItem>Cloudflare Tunnel and custom-domain modes</CheckItem>
            <CheckItem>Updates and backups in the UI</CheckItem>
            <CheckItem>No account with us required</CheckItem>
          </ul>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-8 block rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-center text-sm font-medium text-stone-900 transition-colors hover:border-stone-400"
          >
            Install from GitHub
          </a>
        </div>

        {/* Basic */}
        <div className="rounded-xl border border-stone-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-stone-900">
            Basis Remote — Basic
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            The household app, from anywhere
          </p>
          <p className="mt-4 text-3xl font-bold text-stone-900">
            $20
            <span className="text-sm font-normal text-stone-500">/year</span>
          </p>
          <ul className="mt-6 space-y-2.5">
            <CheckItem>
              Your own <span className="font-mono">lastname.home-basis.com</span>
            </CheckItem>
            <CheckItem>Outbound tunnel — no port forwarding, TLS included</CheckItem>
            <CheckItem>250 GB/month transfer</CheckItem>
            <CheckItem>
              Plenty for calendars, recipes, and photos on the go — not for
              streaming your movie library
            </CheckItem>
            <CheckItem>Over the cap: throttled to 4 Mbps, app stays usable</CheckItem>
          </ul>
          <Link
            to="/app/signup"
            className="mt-8 block rounded-lg border border-pine-700 px-4 py-2.5 text-center text-sm font-medium text-pine-800 transition-colors hover:bg-pine-50"
          >
            Get started
          </Link>
        </div>

        {/* Streaming */}
        <div className="relative rounded-xl border-2 border-pine-700 bg-white p-6">
          <span className="absolute -top-3 left-6 rounded-full bg-pine-700 px-3 py-0.5 text-xs font-medium text-white">
            For media libraries
          </span>
          <h2 className="text-lg font-semibold text-stone-900">
            Basis Remote — Streaming
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            Movies and music away from home
          </p>
          <p className="mt-4 text-3xl font-bold text-stone-900">
            $36
            <span className="text-sm font-normal text-stone-500">/year</span>
          </p>
          <ul className="mt-6 space-y-2.5">
            <CheckItem>Everything in Basic</CheckItem>
            <CheckItem>2 TB/month transfer (fair use)</CheckItem>
            <CheckItem>Stream your video and music libraries remotely</CheckItem>
            <CheckItem>No automatic throttling</CheckItem>
          </ul>
          <Link
            to="/app/signup"
            className="mt-8 block rounded-lg bg-pine-700 px-4 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-pine-800"
          >
            Get started
          </Link>
        </div>
      </div>

      <p className="mt-6 text-sm text-stone-500">
        Both plans are billed annually. One subdomain per account. Cancel any
        time from your dashboard — your subdomain stays reserved for 90 days.
      </p>

      {/* FAQ */}
      <div className="mt-20 max-w-3xl">
        <h2 className="text-2xl font-bold tracking-tight text-stone-900">
          Questions, answered plainly
        </h2>
        <dl className="mt-8 space-y-8">
          {faqs.map((faq) => (
            <div key={faq.question}>
              <dt className="font-semibold text-stone-900">{faq.question}</dt>
              <dd className="mt-2 leading-relaxed text-stone-600">
                {faq.answer}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
