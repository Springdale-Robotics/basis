import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { MarketingLayout } from '@/components/MarketingLayout';
import { Spinner } from '@/components/ui';
import { useMe } from '@/hooks/queries';
import { AboutPage } from '@/pages/marketing/AboutPage';
import { DocsPage } from '@/pages/marketing/DocsPage';
import { HomePage } from '@/pages/marketing/HomePage';
import { PricingPage } from '@/pages/marketing/PricingPage';
import { SecurityPage } from '@/pages/marketing/SecurityPage';
import { LoginPage, SignupPage } from '@/pages/app/AuthPage';
import { ForgotPasswordPage } from '@/pages/app/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/app/ResetPasswordPage';
import { DashboardPage } from '@/pages/app/DashboardPage';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();

  if (me.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <Spinner className="h-6 w-6 text-pine-700" />
      </div>
    );
  }
  if (!me.data) {
    return (
      <Navigate
        to="/app/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }
  return <>{children}</>;
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<MarketingLayout />}>
          <Route index element={<HomePage />} />
          <Route path="pricing" element={<PricingPage />} />
          <Route path="docs" element={<DocsPage />} />
          <Route path="security" element={<SecurityPage />} />
          <Route path="about" element={<AboutPage />} />
        </Route>

        <Route path="/app/login" element={<LoginPage />} />
        <Route path="/app/signup" element={<SignupPage />} />
        <Route path="/app/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/app/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/app"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
