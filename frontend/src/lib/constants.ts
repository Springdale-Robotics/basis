export const API_BASE_URL = '/api/v1';

export const USER_ROLES = {
  ADMIN: 'admin',
  MEMBER: 'member',
  KID: 'kid',
  VISITOR: 'visitor',
} as const;

export const PERMISSION_LEVELS = {
  NONE: 'none',
  VIEW: 'view',
  EDIT: 'edit',
  ADMIN: 'admin',
} as const;

export const RESOURCE_TYPES = {
  CALENDAR: 'calendar',
  RECIPE: 'recipe',
  INVENTORY: 'inventory',
  TASK: 'task',
  LIST: 'list',
  FILE: 'file',
  HOUSEHOLD: 'household',
} as const;

export const NAV_ITEMS = [
  { label: 'Dashboard', href: '/dashboard', icon: 'LayoutDashboard' },
  { label: 'Calendar', href: '/calendar', icon: 'Calendar' },
  { label: 'Recipes', href: '/recipes', icon: 'ChefHat' },
  { label: 'Meal Plan', href: '/meal-plan', icon: 'UtensilsCrossed' },
  { label: 'Inventory', href: '/inventory', icon: 'Package' },
  { label: 'Shopping List', href: '/shopping-list', icon: 'ShoppingCart' },
  { label: 'Tasks', href: '/tasks', icon: 'CheckSquare' },
  { label: 'Lists', href: '/lists', icon: 'ListTodo' },
  { label: 'Files', href: '/files', icon: 'FolderOpen' },
] as const;

export const SETTINGS_NAV = [
  { label: 'Profile', href: '/settings/profile' },
  { label: 'Theme', href: '/settings/theme' },
  { label: 'Notifications', href: '/settings/notifications' },
  { label: 'Household', href: '/settings/household' },
  { label: 'Members', href: '/settings/members' },
  { label: 'Groups', href: '/settings/groups' },
  { label: 'Feature Permissions', href: '/settings/permissions' },
  { label: 'Storage', href: '/settings/storage' },
  { label: 'Calendars', href: '/settings/calendars' },
  { label: 'Devices', href: '/settings/devices' },
  { label: 'Remote Access', href: '/settings/remote-access' },
  { label: 'Backup', href: '/settings/backup' },
  { label: 'Connections', href: '/settings/connections' },
  { label: 'Features', href: '/settings/features' },
  { label: 'Sessions', href: '/settings/sessions' },
  { label: 'Terminal', href: '/settings/terminal' },
] as const;

export const FEATURES = [
  { id: 'recipes', label: 'Recipes', description: 'Access to recipe database' },
  { id: 'inventory', label: 'Inventory', description: 'Stock management and areas' },
  { id: 'meal_plan', label: 'Meal Plan', description: 'Meal scheduling' },
  { id: 'shopping_list', label: 'Shopping List', description: 'Shopping items' },
  { id: 'files', label: 'Files', description: 'File storage and media' },
  { id: 'calendars', label: 'Calendars', description: 'Calendar events' },
  { id: 'lists', label: 'Lists', description: 'General purpose lists' },
  { id: 'tasks', label: 'Tasks', description: 'Tasks and chores' },
  { id: 'settings', label: 'Settings', description: 'Household settings' },
] as const;

export type Feature = typeof FEATURES[number]['id'];

export const STALE_TIME = {
  SHORT: 1000 * 60, // 1 minute
  MEDIUM: 1000 * 60 * 5, // 5 minutes
  LONG: 1000 * 60 * 30, // 30 minutes
} as const;

// Map routes to feature permission keys for permission checking
export const ROUTE_TO_FEATURE: Record<string, Feature> = {
  '/calendar': 'calendars',
  '/recipes': 'recipes',
  '/meal-plan': 'meal_plan',
  '/inventory': 'inventory',
  '/shopping-list': 'shopping_list',
  '/tasks': 'tasks',
  '/rewards': 'tasks',
  '/lists': 'lists',
  '/files': 'files',
  '/photos': 'files',
  '/videos': 'files',
  '/movies': 'files',
  '/music': 'files',
  '/settings': 'settings',
};

// Settings pages that should only be visible to admins
export const ADMIN_ONLY_SETTINGS = [
  '/settings/household',
  '/settings/members',
  '/settings/groups',
  '/settings/permissions',
  '/settings/storage',
  '/settings/devices',
  '/settings/backup',
  '/settings/features',
  '/settings/terminal',
];
