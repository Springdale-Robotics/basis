import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { GITHUB_URL } from '@/lib/site';

const navLinks = [
  { to: '/', label: 'Home', end: true },
  { to: '/pricing', label: 'Pricing' },
  { to: '/docs', label: 'Docs' },
  { to: '/security', label: 'Security' },
];

export function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className={cn(
          'grid h-6 w-6 place-items-center rounded-md text-sm font-bold',
          dark ? 'bg-white text-pine-900' : 'bg-pine-700 text-white',
        )}
      >
        B
      </span>
      <span
        className={cn(
          'text-lg font-semibold tracking-tight',
          dark ? 'text-white' : 'text-stone-900',
        )}
      >
        Basis
      </span>
    </span>
  );
}

export function MarketingLayout() {
  const [menuOpen, setMenuOpen] = useState(false);

  const linkClasses = ({ isActive }: { isActive: boolean }) =>
    cn(
      'rounded-md px-3 py-2 text-sm font-medium transition-colors',
      isActive
        ? 'text-pine-800'
        : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900',
    );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-page items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label="Basis home" onClick={() => setMenuOpen(false)}>
            <Wordmark />
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={linkClasses}
              >
                {link.label}
              </NavLink>
            ))}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-md px-3 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900"
            >
              GitHub
            </a>
            <Link
              to="/app/login"
              className="ml-2 rounded-md px-3 py-2 text-sm font-medium text-stone-600 hover:text-stone-900"
            >
              Sign in
            </Link>
            <Link
              to="/app/signup"
              className="ml-1 rounded-lg bg-pine-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pine-800"
            >
              Get your address
            </Link>
          </nav>

          <button
            type="button"
            className="rounded-md p-2 text-stone-600 hover:bg-stone-100 md:hidden"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
              {menuOpen ? (
                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
              ) : (
                <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>
        </div>

        {menuOpen && (
          <nav
            className="border-t border-stone-200 bg-white px-4 py-3 md:hidden"
            aria-label="Main"
          >
            <div className="flex flex-col gap-1">
              {navLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  className={linkClasses}
                  onClick={() => setMenuOpen(false)}
                >
                  {link.label}
                </NavLink>
              ))}
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="rounded-md px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100"
              >
                GitHub
              </a>
              <Link
                to="/app/login"
                className="rounded-md px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100"
                onClick={() => setMenuOpen(false)}
              >
                Sign in
              </Link>
              <Link
                to="/app/signup"
                className="mt-1 rounded-lg bg-pine-700 px-4 py-2 text-center text-sm font-medium text-white"
                onClick={() => setMenuOpen(false)}
              >
                Get your address
              </Link>
            </div>
          </nav>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-stone-200 bg-stone-50">
        <div className="mx-auto flex max-w-page flex-col gap-4 px-4 py-8 text-sm text-stone-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© 2026 Springdale Robotics. Basis is MIT-licensed.</p>
          <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Footer">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-stone-900">
              GitHub
            </a>
            <a
              href={`${GITHUB_URL}/blob/main/LICENSE`}
              target="_blank"
              rel="noreferrer"
              className="hover:text-stone-900"
            >
              License
            </a>
            <Link to="/security" className="hover:text-stone-900">
              Security
            </Link>
            <Link to="/about" className="hover:text-stone-900">
              About
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
