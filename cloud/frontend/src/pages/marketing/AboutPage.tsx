import { GITHUB_URL } from '@/lib/site';

export function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
        About
      </h1>
      <div className="mt-8 space-y-5 leading-relaxed text-stone-700">
        <p>
          Basis is built by Springdale Robotics. It started the way most
          self-hosted software starts: a family that wanted its calendar,
          chore chart, recipes, and photos in one place — without renting them
          back from a subscription service — and a box in the closet that
          wasn't doing enough.
        </p>
        <p>
          Why "Basis"? It's the household OS everything else builds on top of
          — as in "on a daily basis," and "the basis of." It's also short.
        </p>
        <p>
          The app is MIT-licensed and developed in the open at{' '}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="text-pine-700 underline hover:text-pine-800"
          >
            github.com/Springdale-Robotics/basis
          </a>
          . Basis Remote — the paid tunnel service — exists to fund that work
          and to make remote access easy for households that don't want to run
          a VPN. The free, fully self-hosted path is a design commitment, not
          a trial.
        </p>
        <p>
          Questions, bugs, ideas: open an issue on GitHub. Be decent to each
          other — the household-scale assumption applies to the project too.
        </p>
      </div>
    </div>
  );
}
