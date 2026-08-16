import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileNav } from './MobileNav';
import { OfflineIndicator } from './OfflineIndicator';
import { ImportProgressIndicator } from '@/components/recipes/ImportProgressIndicator';
import { MusicPlayer } from '@/components/music/MusicPlayer';
import { BugReportButton } from '@/components/shared/BugReportButton';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { useUIStore } from '@/stores/uiStore';
import { useDevice } from '@/hooks/useDevice';
import { useBottomStack } from '@/hooks/useBottomStack';
import { cn } from '@/lib/utils';

export function AppShell() {
  const { sidebarCollapsed } = useUIStore();
  const { isMobile } = useDevice();
  const { stackHeight } = useBottomStack();
  const location = useLocation();

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar - hidden on mobile */}
      {!isMobile && <Sidebar />}

      {/* Main content area */}
      <div
        className={cn(
          'flex flex-1 flex-col min-w-0 transition-all duration-300',
          !isMobile && (sidebarCollapsed ? 'ml-16' : 'ml-64')
        )}
      >
        <Header />
        <main
          className="flex-1 overflow-auto p-4 md:p-6"
          // Keep content clear of the fixed bottom bars (mobile nav and/or
          // music player), whichever are currently mounted.
          style={{ paddingBottom: `calc(1.5rem + ${stackHeight}px)` }}
        >
          {/* Keyed on the path so a page-level crash is isolated to that
              page and resets when the user navigates elsewhere. */}
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      {isMobile && <MobileNav />}

      {/* Persistent music player */}
      <MusicPlayer />

      {/* Offline / sync status */}
      <OfflineIndicator />
      <ImportProgressIndicator />

      {/* Floating bug-report button */}
      <BugReportButton />
    </div>
  );
}
