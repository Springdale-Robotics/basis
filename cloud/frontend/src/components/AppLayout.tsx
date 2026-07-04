import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { logout } from '@/api/auth';
import { useMe, queryKeys } from '@/hooks/queries';
import { Wordmark } from '@/components/MarketingLayout';

export function AppLayout() {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSettled: () => {
      queryClient.setQueryData(queryKeys.me, null);
      queryClient.removeQueries({ queryKey: queryKeys.tenant });
      navigate('/');
    },
  });

  return (
    <div className="flex min-h-screen flex-col bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label="Basis home" className="flex items-center gap-3">
            <Wordmark />
            <span className="rounded-full bg-pine-100 px-2.5 py-0.5 text-xs font-medium text-pine-800">
              Remote
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-stone-500 sm:block">
              {me.data?.email}
            </span>
            <button
              type="button"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900 disabled:opacity-60"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        <Outlet />
      </main>
      <footer className="py-6 text-center text-xs text-stone-400">
        © 2026 Springdale Robotics ·{' '}
        <Link to="/security" className="hover:text-stone-600">
          Security
        </Link>{' '}
        ·{' '}
        <Link to="/pricing" className="hover:text-stone-600">
          Pricing
        </Link>
      </footer>
    </div>
  );
}
