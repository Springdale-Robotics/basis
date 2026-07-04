import {
  LayoutDashboard,
  Calendar,
  ChefHat,
  UtensilsCrossed,
  Package,
  ShoppingCart,
  CheckSquare,
  Trophy,
  ListTodo,
  FolderOpen,
  Image,
  Video,
  Film,
  Music,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { useFeatureFlags, type FeatureFlags } from '@/hooks/useFeatureFlags';
import { useFeaturePermissions } from '@/hooks/useFeaturePermissions';
import { ROUTE_TO_FEATURE } from '@/lib/constants';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Household feature toggle (Settings → Features) that must be enabled. */
  flag?: keyof FeatureFlags;
  /**
   * Short label for the mobile bottom bar. Items with a `mobileLabel` appear
   * as primary tabs in MobileNav; everything else lives in the "More" sheet.
   */
  mobileLabel?: string;
}

const mainNavItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, mobileLabel: 'Home' },
  { label: 'Calendar', href: '/calendar', icon: Calendar, flag: 'calendar', mobileLabel: 'Calendar' },
  { label: 'Recipes', href: '/recipes', icon: ChefHat, flag: 'recipes', mobileLabel: 'Recipes' },
  { label: 'Meal Plan', href: '/meal-plan', icon: UtensilsCrossed, flag: 'recipes' },
  { label: 'Inventory', href: '/inventory', icon: Package, flag: 'inventory' },
  { label: 'Shopping List', href: '/shopping-list', icon: ShoppingCart, flag: 'inventory', mobileLabel: 'Shop' },
  { label: 'Tasks', href: '/tasks', icon: CheckSquare, flag: 'tasks' },
  { label: 'Rewards', href: '/rewards', icon: Trophy, flag: 'rewards' },
  { label: 'Lists', href: '/lists', icon: ListTodo },
];

const mediaNavItems: NavItem[] = [
  { label: 'Files', href: '/files', icon: FolderOpen, flag: 'files' },
  { label: 'Photos', href: '/photos', icon: Image, flag: 'files' },
  { label: 'Videos', href: '/videos', icon: Video, flag: 'files' },
  { label: 'Movies & TV', href: '/movies', icon: Film, flag: 'files' },
  { label: 'Music', href: '/music', icon: Music, flag: 'files' },
];

const bottomNavItems: NavItem[] = [
  { label: 'Settings', href: '/settings', icon: Settings },
];

export interface NavGroups {
  /** Primary app sections. */
  main: NavItem[];
  /** Media/library sections. */
  media: NavItem[];
  /** Pinned to the bottom (Settings). */
  bottom: NavItem[];
  /** Items promoted to the mobile bottom bar (subset of `main`). */
  mobileBar: NavItem[];
}

/**
 * Single source of truth for app navigation, shared by the desktop Sidebar
 * and the mobile bottom bar / "More" sheet. An item is visible only when the
 * household feature flag is enabled AND the current user has permission for
 * the route's feature.
 */
export function useNavItems(): NavGroups {
  const features = useFeatureFlags();
  const { hasAccess } = useFeaturePermissions();

  const isVisible = (item: NavItem): boolean => {
    // Household-level feature toggle
    if (item.flag && !features[item.flag]) return false;
    // Per-user permission
    const permFeature = ROUTE_TO_FEATURE[item.href];
    if (permFeature && !hasAccess(permFeature)) return false;
    return true;
  };

  const main = mainNavItems.filter(isVisible);
  return {
    main,
    media: mediaNavItems.filter(isVisible),
    bottom: bottomNavItems.filter(isVisible),
    mobileBar: main.filter((item) => item.mobileLabel),
  };
}
