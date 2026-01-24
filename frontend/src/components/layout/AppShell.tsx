import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileNav } from './MobileNav';
import { MusicPlayer } from '@/components/music/MusicPlayer';
import { useUIStore } from '@/stores/uiStore';
import { useDevice } from '@/hooks/useDevice';
import { usePlayerStore } from '@/stores/playerStore';
import { cn } from '@/lib/utils';

export function AppShell() {
  const { sidebarCollapsed } = useUIStore();
  const { isMobile } = useDevice();
  const { currentTrack } = usePlayerStore();

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar - hidden on mobile */}
      {!isMobile && <Sidebar />}

      {/* Main content area */}
      <div
        className={cn(
          'flex flex-1 flex-col transition-all duration-300',
          !isMobile && (sidebarCollapsed ? 'ml-16' : 'ml-64')
        )}
      >
        <Header />
        <main
          className={cn(
            'flex-1 overflow-auto p-4 md:p-6',
            currentTrack && 'pb-24' // Extra padding when player is visible
          )}
        >
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation */}
      {isMobile && <MobileNav />}

      {/* Persistent music player */}
      <MusicPlayer />
    </div>
  );
}
