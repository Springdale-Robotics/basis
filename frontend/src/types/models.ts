export type UserRole = 'admin' | 'member' | 'kid' | 'visitor';
export type PermissionLevel = 'none' | 'view' | 'edit' | 'admin';
export type ResourceType =
  | 'calendar'
  | 'recipe'
  | 'inventory'
  | 'task'
  | 'list'
  | 'file'
  | 'household';

export interface Household {
  id: string;
  name: string;
  timezone: string;
  settings: HouseholdSettings;
  createdAt: string;
  updatedAt: string;
}

export interface HouseholdSettings {
  features: {
    calendar: boolean;
    recipes: boolean;
    inventory: boolean;
    tasks: boolean;
    rewards: boolean;
    smartHome: boolean;
    files: boolean;
  };
  theme?: ThemeConfig;
}

export interface ThemeConfig {
  colors: {
    primary: string;
    primaryForeground: string;
    secondary: string;
    secondaryForeground: string;
    accent: string;
    accentForeground: string;
    background: string;
    foreground: string;
    card: string;
    cardForeground: string;
    muted: string;
    mutedForeground: string;
    destructive: string;
    destructiveForeground: string;
    border: string;
    input: string;
    ring: string;
  };
  typography: {
    fontFamily: string;
    fontFamilyMono: string;
    fontSizeBase: string;
    fontSizeScale: number;
  };
  spacing: {
    unit: number;
    borderRadius: string;
    borderRadiusLg: string;
    borderRadiusSm: string;
  };
  mode: 'light' | 'dark' | 'system';
}

export interface User {
  id: string;
  householdId: string;
  email: string;
  displayName: string;
  role: UserRole;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  userId: string;
  deviceId?: string;
  ipAddress?: string;
  userAgent?: string;
  expiresAt: string;
  createdAt: string;
}

export interface Device {
  id: string;
  householdId: string;
  name: string;
  type: 'browser' | 'tablet' | 'kiosk' | 'mobile';
  isFixed: boolean;
  settings: DeviceSettings;
  lastSeenAt?: string;
  createdAt: string;
}

export interface DeviceSettings {
  screensaverEnabled: boolean;
  screensaverTimeoutMinutes: number;
  screensaverAlbumId?: string;
  defaultCalendarView: 'month' | 'week' | 'day';
  allowedPages?: string[];
  deniedPages?: string[];
}

export interface Calendar {
  id: string;
  householdId: string;
  ownerId?: string;
  name: string;
  color: string;
  pattern?: string;
  type: 'individual' | 'group' | 'synced';
  isDefault: boolean;
  isReadOnly: boolean;
  isSynced: boolean;
  syncProvider?: 'google' | 'outlook';
  syncCalendarId?: string;
  lastSyncAt?: string;
  syncError?: string;
  createdAt: string;
  updatedAt: string;
}

export type RecurrenceStatus = 'master' | 'exception' | 'cancelled';

export interface CalendarEvent {
  id: string;
  calendarId: string;
  createdById?: string;
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  color?: string;
  // RFC 5545 Recurrence fields
  recurrenceRule?: string;
  recurrenceExDates?: string;  // JSON array of excluded ISO date strings
  recurrenceRDates?: string;   // JSON array of additional ISO date strings
  // Exception instance fields (for modified occurrences of recurring events)
  recurringEventId?: string;   // Links exception to master event
  originalStartTime?: string;  // Original occurrence time (unique identifier)
  recurrenceStatus?: RecurrenceStatus;  // 'master' | 'exception' | 'cancelled'
  externalId?: string;
  createdAt: string;
  updatedAt: string;
  // Enriched fields from details endpoint
  creator?: UserSummary;
  attendees?: EventAttendee[];
  reminders?: EventReminder[];
  // Virtual instance fields (populated during expansion)
  isVirtualInstance?: boolean;
  masterEvent?: CalendarEvent;
}

export interface UserSummary {
  id: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
}

export interface EventAttendee {
  id: string;
  eventId: string;
  userId?: string;
  email?: string;
  displayName?: string;
  rsvpStatus: RsvpStatus;
  rsvpAt?: string;
  isOrganizer: boolean;
  notified: boolean;
  createdAt: string;
  updatedAt: string;
  user?: UserSummary;
}

export type RsvpStatus = 'pending' | 'accepted' | 'declined' | 'maybe';

export interface EventReminder {
  id: string;
  eventId: string;
  userId?: string;
  reminderType: ReminderType;
  minutesBefore: number;
  sent: boolean;
  sentAt?: string;
  createdAt: string;
}

export type ReminderType = 'notification' | 'email' | 'push';

export interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  byDay?: string[];
  byMonth?: number[];
  byMonthDay?: number[];
  until?: string;
  count?: number;
}

export interface Recipe {
  id: string;
  householdId: string;
  title: string;
  description?: string;
  imageUrl?: string;
  servings: number;
  prepTime?: number;
  cookTime?: number;
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  totalTimeMinutes?: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  ingredients: RecipeIngredient[];
  instructions: RecipeInstruction[];
  timers: RecipeTimer[];
  tags: string[];
  sourceUrl?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeIngredient {
  id: string;
  inventoryItemId?: string;
  name: string;
  amount: number;
  unit: string;
  notes?: string;
  optional: boolean;
}

export interface RecipeInstruction {
  step: number;
  text: string;
  timerIds?: string[];
}

export interface RecipeTimer {
  id: string;
  name: string;
  durationSeconds: number;
}

export interface MealPlan {
  id: string;
  householdId: string;
  date: string;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  recipeId: string;
  recipe?: Recipe;
  servings: number;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

export interface StorageArea {
  id: string;
  householdId: string;
  name: string;
  icon?: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryItem {
  id: string;
  householdId: string;
  name: string;
  category?: string;
  barcode?: string;
  defaultUnit: string;
  unit?: string;
  icon?: string;
  imageUrl?: string;
  keepInStock: boolean;
  keepInStockThreshold?: number;
  minStockLevel?: number;
  defaultAreaId?: string;
  stockEntries?: StockEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface StockEntry {
  id: string;
  inventoryItemId: string;
  areaId: string;
  quantity: number;
  unit: string;
  expiryDate?: string;
  expiresAt?: string;
  purchaseDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShoppingListItem {
  id: string;
  householdId: string;
  inventoryItemId?: string;
  name: string;
  quantity: number;
  unit?: string;
  category?: string;
  checked: boolean;
  source: 'manual' | 'meal_plan' | 'low_stock' | 'recipe';
  addedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  householdId: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: string;
  isChore: boolean;
  recurrence?: RecurrenceRule | string;
  assignedTo?: string;
  assigneeId?: string;
  rewardPoints?: number;
  points?: number;
  completedAt?: string;
  completedBy?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserRewards {
  userId: string;
  currentPoints: number;
  lifetimePoints: number;
  achievements: Achievement[];
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  pointsRequired?: number;
  tasksRequired?: number;
  earnedAt?: string;
}

export interface List {
  id: string;
  householdId: string;
  name: string;
  type: 'checklist' | 'reminder' | 'notes';
  icon?: string;
  color?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListItem {
  id: string;
  listId: string;
  content: string;
  text: string;
  checked: boolean;
  dueDate?: string;
  reminderAt?: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface FileItem {
  id: string;
  householdId: string;
  parentId?: string;
  name: string;
  type: 'file' | 'folder';
  mimeType?: string;
  size: number;
  path: string;
  thumbnailUrl?: string;
  metadata?: FileMetadata;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Folder {
  id: string;
  householdId: string;
  parentId?: string;
  name: string;
  path: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface FileMetadata {
  width?: number;
  height?: number;
  duration?: number;
  artist?: string;
  album?: string;
  exif?: Record<string, unknown>;
}

export interface Album {
  id: string;
  householdId: string;
  name: string;
  coverImageId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  userId?: string;
  householdId: string;
  type: NotificationType;
  title: string;
  body?: string;
  data?: NotificationData;
  read: boolean;
  readAt?: string;
  actionUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export type NotificationType =
  | 'low_stock'
  | 'expiring_soon'
  | 'task_due'
  | 'sync_error'
  | 'backup_complete'
  | 'connection_request'
  | 'event_reminder'
  | 'general';

export interface NotificationData {
  resourceType?: string;
  resourceId?: string;
  itemId?: string;
  itemName?: string;
  currentQuantity?: number;
  minQuantity?: number;
  unit?: string;
  actions?: NotificationAction[];
}

export interface NotificationAction {
  id: string;
  label: string;
  endpoint?: string;
}

export interface HouseholdConnection {
  id: string;
  sourceHouseholdId: string;
  targetHouseholdId: string;
  status: 'pending' | 'accepted' | 'rejected';
  permissions: ConnectionPermissions;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionPermissions {
  shareCalendars: boolean;
  shareRecipes: boolean;
  shareFiles: boolean;
}

export interface BackupConfig {
  partnerId: string;
  categories: string[];
  encryptionKeyHash: string;
  lastBackupAt?: string;
  status: 'active' | 'paused' | 'error';
}
