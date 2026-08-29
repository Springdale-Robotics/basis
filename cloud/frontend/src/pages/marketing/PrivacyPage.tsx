import { Link } from 'react-router-dom';

const EFFECTIVE = '28 August 2026';
const SUPPORT_EMAIL = 'admin@home-basis.com';

export function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
        Privacy policy
      </h1>
      <p className="mt-3 text-sm text-stone-500">Effective {EFFECTIVE}</p>

      <div className="mt-8 space-y-10 leading-relaxed text-stone-700">
        <section>
          <h2 className="text-xl font-semibold text-stone-900">
            The short version
          </h2>
          <p className="mt-3">
            Basis is a household app that runs on your own hardware. Your
            calendars, recipes, photos, lists and everything else live on your
            box, in your home. We do not have a copy and cannot read them.
          </p>
          <p className="mt-3">
            This policy covers the small amount of information the optional{' '}
            <strong>Basis Remote</strong> subscription service holds, and how
            data from connected accounts such as Google Calendar is handled.
            For the technical detail behind these claims, see{' '}
            <Link to="/security" className="underline hover:text-stone-900">
              Security &amp; privacy
            </Link>
            .
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-900">
            Basis on your own hardware
          </h2>
          <p className="mt-3">
            The Basis app is self-hosted. Household data is written to a
            database and file storage on your machine and is never transmitted
            to us as part of normal operation. We are not a party to it — the
            person who runs the box decides who may use it and what happens to
            the data on it.
          </p>
          <p className="mt-3">
            There are two deliberate exceptions, described under{' '}
            <em>Bug reports and error reports</em> below. They are the only
            paths by which anything from your box reaches infrastructure we
            operate.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-900">
            Basis Remote (the subscription)
          </h2>
          <p className="mt-3">
            Basis Remote gives your box a public address of its own and relays
            traffic to it. If you subscribe, we hold:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              Your account email address and a hashed password. Passwords are
              stored as argon2 hashes; we cannot recover the original.
            </li>
            <li>The subdomain you chose, and your subscription status.</li>
            <li>
              Tunnel tokens, stored as hashes rather than in a form we could
              replay.
            </li>
            <li>
              Monthly bandwidth totals and the time your box last checked in —
              enough to enforce the plan&rsquo;s cap and show you whether the
              box is online.
            </li>
          </ul>
          <p className="mt-3">
            Traffic between your box and the people using it passes through our
            relay in transit. It is not stored, logged in content form, or
            inspected.
          </p>
          <p className="mt-3">
            Two third parties are involved: <strong>Stripe</strong> handles
            payment, and card details go to them and never to us; and{' '}
            <strong>Resend</strong> delivers account email such as password
            resets.
          </p>
          <p className="mt-3">
            Revoking your tunnel token from the dashboard disconnects the box
            within about a minute and blocks it from reconnecting. To close an
            account entirely, email {SUPPORT_EMAIL}.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-900">
            Google user data
          </h2>
          <p className="mt-3">
            If you connect Google Calendar, Basis requests two scopes:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <code className="font-mono text-sm">
                .../auth/calendar.readonly
              </code>{' '}
              — to read your calendars and events so they can be shown in
              Basis.
            </li>
            <li>
              <code className="font-mono text-sm">.../auth/calendar.events</code>{' '}
              — to create and change events, so edits made in Basis can reach
              your Google calendar.
            </li>
          </ul>
          <p className="mt-3">
            <strong>
              Calendar data moves directly between Google and your own box.
            </strong>{' '}
            It does not pass through, and is not stored on, any server we
            operate. Your Google access and refresh tokens are held encrypted
            on your box and are never sent to us.
          </p>
          <p className="mt-3">
            Signing in requires one step that touches our infrastructure, and
            it is deliberately built to learn as little as possible. Google
            requires a single fixed web address to return to after you approve
            access, and a self-hosted box has no such address. So we host a
            static page at{' '}
            <code className="font-mono text-sm">connect.home-basis.com</code>{' '}
            that does nothing but forward your browser back to your own box. It
            has no server behind it and no database. Your box&rsquo;s address
            travels in the part of the link browsers never transmit to a web
            server, and is held only in your own browser&rsquo;s local storage
            for the moments between leaving for Google and coming back — keyed
            to that sign-in attempt, and cleared as soon as it is used. The
            page also removes Google&rsquo;s authorization code from the
            address bar and your browser history once it has been handed on. We
            keep no access logs for it.
          </p>
          <p className="mt-3">
            We do not sell Google user data, share it with third parties, use
            it for advertising, or use it to train AI or machine-learning
            models. No person at Basis reads it. There is nowhere for us to
            read it from.
          </p>
          <p className="mt-3">
            You can disconnect a calendar at any time from Settings →
            Calendars in Basis, which deletes the stored tokens; events already
            in your Basis calendar remain, no longer synced. You can also
            revoke access directly at{' '}
            <a
              href="https://myaccount.google.com/permissions"
              className="underline hover:text-stone-900"
              target="_blank"
              rel="noreferrer"
            >
              myaccount.google.com/permissions
            </a>
            .
          </p>
          <p className="mt-3">
            Basis&rsquo;s use of information received from Google APIs adheres
            to the{' '}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              className="underline hover:text-stone-900"
              target="_blank"
              rel="noreferrer"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-900">
            Bug reports and error reports
          </h2>
          <p className="mt-3">
            These are the only ways information leaves your box for our
            infrastructure, and both are worth understanding before you use
            them.
          </p>
          <p className="mt-3">
            <strong>Bug reports you send deliberately.</strong> Using the
            in-app bug reporter sends your description along with{' '}
            <strong>a screenshot of the page you were on</strong>, recent
            browser console output, the page address, your browser version, and
            the Basis version. These become issues in a private repository that
            only we can read. Because the screenshot captures whatever was on
            screen, it may contain household data — check what is visible
            before sending one.
          </p>
          <p className="mt-3">
            <strong>Server error reports.</strong> If your box is configured to
            report server errors, it sends the error message, its stack trace,
            and the route that failed. It does not send request contents or
            query strings. This is off unless an error reporting address is
            configured on the box.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-900">Cookies</h2>
          <p className="mt-3">
            The account dashboard on this site sets one session cookie so you
            stay signed in. There is no advertising, tracking, or analytics on
            this site, and the sign-in relay page sets no cookies at all.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-stone-900">
            Changes and contact
          </h2>
          <p className="mt-3">
            If this policy changes in a way that affects what we hold or how it
            is handled, the effective date above changes with it. Questions
            about anything here: {SUPPORT_EMAIL}.
          </p>
        </section>
      </div>
    </div>
  );
}
