import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Calendar,
  ChefHat,
  UtensilsCrossed,
  Package,
  ShoppingCart,
  CheckSquare,
  ListTodo,
  FolderOpen,
  Image,
  Video,
  Film,
  Music,
  Home,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/uiStore';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { useFeaturePermissions } from '@/hooks/useFeaturePermissions';
import { ROUTE_TO_FEATURE } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const iconMap = {
  LayoutDashboard,
  Calendar,
  ChefHat,
  UtensilsCrossed,
  Package,
  ShoppingCart,
  CheckSquare,
  ListTodo,
  FolderOpen,
  Image,
  Video,
  Film,
  Music,
  Home,
  Settings,
};

interface NavItem {
  label: string;
  href: string;
  icon: keyof typeof iconMap;
  feature?: string;
}

const mainNavItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: 'LayoutDashboard' },
  { label: 'Calendar', href: '/calendar', icon: 'Calendar', feature: 'calendar' },
  { label: 'Recipes', href: '/recipes', icon: 'ChefHat', feature: 'recipes' },
  { label: 'Meal Plan', href: '/meal-plan', icon: 'UtensilsCrossed', feature: 'recipes' },
  { label: 'Inventory', href: '/inventory', icon: 'Package', feature: 'inventory' },
  { label: 'Shopping List', href: '/shopping-list', icon: 'ShoppingCart', feature: 'inventory' },
  { label: 'Tasks', href: '/tasks', icon: 'CheckSquare', feature: 'tasks' },
  { label: 'Lists', href: '/lists', icon: 'ListTodo' },
];

const mediaNavItems: NavItem[] = [
  { label: 'Files', href: '/files', icon: 'FolderOpen', feature: 'files' },
  { label: 'Photos', href: '/photos', icon: 'Image', feature: 'files' },
  { label: 'Videos', href: '/videos', icon: 'Video', feature: 'files' },
  { label: 'Movies & TV', href: '/movies', icon: 'Film', feature: 'files' },
  { label: 'Music', href: '/music', icon: 'Music', feature: 'files' },
];

const bottomNavItems: NavItem[] = [
  { label: 'Settings', href: '/settings', icon: 'Settings' },
];

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebarCollapsed } = useUIStore();
  const features = useFeatureFlags();
  const { hasAccess, isLoading: permissionsLoading } = useFeaturePermissions();
  const location = useLocation();

  const filterByFeature = (items: NavItem[]) =>
    items.filter((item) => {
      // Feature toggle must be enabled (existing behavior)
      if (item.feature && !features[item.feature as keyof typeof features]) return false;

      // User must have permission (new behavior)
      const permFeature = ROUTE_TO_FEATURE[item.href];
      if (permFeature && !hasAccess(permFeature)) return false;

      return true;
    });

  const renderNavItem = (item: NavItem) => {
    const Icon = iconMap[item.icon];
    const isActive = location.pathname === item.href || location.pathname.startsWith(`${item.href}/`);

    const link = (
      <NavLink
        to={item.href}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-secondary text-secondary-foreground'
            : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
          sidebarCollapsed && 'justify-center px-2'
        )}
      >
        <Icon className="h-5 w-5 shrink-0" />
        {!sidebarCollapsed && <span>{item.label}</span>}
      </NavLink>
    );

    if (sidebarCollapsed) {
      return (
        <Tooltip key={item.href}>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
      );
    }

    return <div key={item.href}>{link}</div>;
  };

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r bg-card transition-all duration-300',
          sidebarCollapsed ? 'w-16' : 'w-64'
        )}
      >
        {/* Logo */}
        <div className={cn('flex h-16 items-center border-b px-4', sidebarCollapsed && 'justify-center')}>
          {sidebarCollapsed ? (
            <Home className="h-6 w-6" />
          ) : (
            <span className="text-xl font-bold">Home Manager</span>
          )}
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 py-4">
          <nav className="space-y-1 px-2">
            {filterByFeature(mainNavItems).map(renderNavItem)}
          </nav>

          <Separator className="my-4" />

          <nav className="space-y-1 px-2">
            {filterByFeature(mediaNavItems).map(renderNavItem)}
          </nav>
        </ScrollArea>

        {/* Bottom navigation */}
        <div className="border-t py-4">
          <nav className="space-y-1 px-2">
            {filterByFeature(bottomNavItems).map(renderNavItem)}
          </nav>
        </div>

        {/* Collapse toggle */}
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-center"
            onClick={toggleSidebarCollapsed}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4 mr-2" />
                <span>Collapse</span>
              </>
            )}
          </Button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
