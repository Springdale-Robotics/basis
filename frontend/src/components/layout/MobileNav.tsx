import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Calendar,
  ChefHat,
  ShoppingCart,
  Menu,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/uiStore';
import { useFeaturePermissions } from '@/hooks/useFeaturePermissions';
import { ROUTE_TO_FEATURE } from '@/lib/constants';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Sidebar } from './Sidebar';
import type { Feature } from '@/api/permissions';

interface MobileNavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  feature?: Feature;
}

const navItems: MobileNavItem[] = [
  { label: 'Home', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Calendar', href: '/calendar', icon: Calendar, feature: 'calendars' },
  { label: 'Recipes', href: '/recipes', icon: ChefHat, feature: 'recipes' },
  { label: 'Shop', href: '/shopping-list', icon: ShoppingCart, feature: 'shopping_list' },
];

export function MobileNav() {
  const location = useLocation();
  const { mobileNavOpen, setMobileNavOpen } = useUIStore();
  const { hasAccess } = useFeaturePermissions();

  // Filter nav items based on user permissions
  const filteredNavItems = navItems.filter((item) => {
    if (!item.feature) return true; // No feature restriction
    return hasAccess(item.feature);
  });

  return (
    <>
      {/* Bottom navigation bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around border-t bg-background pb-safe">
        {filteredNavItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            location.pathname === item.href ||
            location.pathname.startsWith(`${item.href}/`);

          return (
            <NavLink
              key={item.href}
              to={item.href}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-5 w-5" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}

        {/* More menu trigger */}
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetTrigger asChild>
            <button
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs',
                'text-muted-foreground hover:text-foreground'
              )}
            >
              <Menu className="h-5 w-5" />
              <span>More</span>
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <MobileSidebar />
          </SheetContent>
        </Sheet>
      </nav>

      {/* Spacer to prevent content from being hidden behind bottom nav */}
      <div className="h-16" />
    </>
  );
}

function MobileSidebar() {
  const { setMobileNavOpen } = useUIStore();

  return (
    <div className="flex h-full flex-col" onClick={() => setMobileNavOpen(false)}>
      <Sidebar />
    </div>
  );
}
