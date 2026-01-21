import { emitToHousehold, emitToUser, emitToRoom, broadcastToConnectedHouseholds } from './index.js';
import { db } from '../config/database.js';
import { connectedHouseholds, sharedResources } from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';

// Event type definitions
export interface CalendarEventPayload {
  eventId: string;
  calendarId: string;
  action: 'created' | 'updated' | 'deleted';
  event?: Record<string, unknown>;
}

export interface InventoryEventPayload {
  itemId: string;
  locationId?: string;
  action: 'created' | 'updated' | 'deleted' | 'quantity_changed' | 'low_stock' | 'expiring';
  item?: Record<string, unknown>;
}

export interface TaskEventPayload {
  taskId: string;
  action: 'created' | 'updated' | 'deleted' | 'completed' | 'assigned';
  task?: Record<string, unknown>;
}

export interface RecipeEventPayload {
  recipeId: string;
  action: 'created' | 'updated' | 'deleted' | 'shared';
  recipe?: Record<string, unknown>;
}

export interface FileEventPayload {
  fileId: string;
  folderId?: string;
  action: 'uploaded' | 'deleted' | 'moved';
  file?: Record<string, unknown>;
}

export interface NotificationEventPayload {
  notificationId: string;
  notification: Record<string, unknown>;
}

export interface ListEventPayload {
  listId: string;
  itemId?: string;
  action: 'created' | 'updated' | 'deleted' | 'item_added' | 'item_removed' | 'item_checked';
  list?: Record<string, unknown>;
  item?: Record<string, unknown>;
}

export interface DeviceEventPayload {
  deviceId: string;
  action: 'registered' | 'updated' | 'removed' | 'status_changed';
  device?: Record<string, unknown>;
}

export interface SyncEventPayload {
  syncId: string;
  resourceType: string;
  resourceId: string;
  action: 'pending' | 'completed' | 'failed';
  fromHouseholdId: string;
}

// Calendar events
export function emitCalendarEvent(householdId: string, payload: CalendarEventPayload): void {
  emitToHousehold(householdId, 'calendar:event', payload);
  emitToRoom(`calendar:${payload.calendarId}`, 'calendar:event', payload);
}

// Inventory events
export function emitInventoryEvent(householdId: string, payload: InventoryEventPayload): void {
  emitToHousehold(householdId, 'inventory:update', payload);

  if (payload.locationId) {
    emitToRoom(`inventory:location:${payload.locationId}`, 'inventory:update', payload);
  }
}

export function emitLowStockAlert(householdId: string, payload: InventoryEventPayload): void {
  emitToHousehold(householdId, 'inventory:low_stock', payload);
}

export function emitExpiringAlert(householdId: string, payload: InventoryEventPayload): void {
  emitToHousehold(householdId, 'inventory:expiring', payload);
}

// Task events
export function emitTaskEvent(householdId: string, payload: TaskEventPayload): void {
  emitToHousehold(householdId, 'task:update', payload);

  // Also notify assigned user
  if (payload.task?.assignedTo) {
    emitToUser(payload.task.assignedTo as string, 'task:assigned', payload);
  }
}

export function emitTaskCompleted(householdId: string, payload: TaskEventPayload): void {
  emitToHousehold(householdId, 'task:completed', payload);
}

// Recipe events
export async function emitRecipeEvent(householdId: string, payload: RecipeEventPayload): Promise<void> {
  emitToHousehold(householdId, 'recipe:update', payload);

  // If recipe is shared, notify connected households
  if (payload.action === 'updated' || payload.action === 'deleted') {
    const sharedWith = await db.query.sharedResources.findMany({
      where: and(
        eq(sharedResources.resourceType, 'recipe'),
        eq(sharedResources.resourceId, payload.recipeId),
        eq(sharedResources.fromHouseholdId, householdId)
      ),
    });

    const connectedIds = sharedWith.map(s => s.toHouseholdId);
    if (connectedIds.length > 0) {
      await broadcastToConnectedHouseholds(householdId, 'recipe:shared_update', payload, connectedIds);
    }
  }
}

// File events
export function emitFileEvent(householdId: string, payload: FileEventPayload): void {
  emitToHousehold(householdId, 'file:update', payload);

  if (payload.folderId) {
    emitToRoom(`folder:${payload.folderId}`, 'file:update', payload);
  }
}

// Notification events
export function emitNotification(householdId: string, userId: string | null, payload: NotificationEventPayload): void {
  if (userId) {
    emitToUser(userId, 'notification:new', payload);
  } else {
    emitToHousehold(householdId, 'notification:new', payload);
  }
}

// List events
export function emitListEvent(householdId: string, payload: ListEventPayload): void {
  emitToHousehold(householdId, 'list:update', payload);
  emitToRoom(`list:${payload.listId}`, 'list:update', payload);
}

// Device events
export function emitDeviceEvent(householdId: string, payload: DeviceEventPayload): void {
  emitToHousehold(householdId, 'device:update', payload);
}

// Sync events
export function emitSyncEvent(householdId: string, payload: SyncEventPayload): void {
  emitToHousehold(householdId, 'sync:update', payload);
}

// Household-wide events
export function emitHouseholdEvent(householdId: string, event: string, data: unknown): void {
  emitToHousehold(householdId, event, data);
}

// User online/offline status
export function emitUserStatus(householdId: string, userId: string, online: boolean): void {
  emitToHousehold(householdId, 'user:status', {
    userId,
    online,
    timestamp: new Date(),
  });
}

// Rewards/achievements
export function emitRewardEvent(
  householdId: string,
  userId: string,
  payload: { points: number; reason: string; lifetimePoints: number }
): void {
  emitToHousehold(householdId, 'reward:earned', { userId, ...payload });
  emitToUser(userId, 'reward:earned', payload);
}

export function emitAchievementUnlocked(
  householdId: string,
  userId: string,
  payload: { achievementId: string; achievement: Record<string, unknown> }
): void {
  emitToHousehold(householdId, 'achievement:unlocked', { userId, ...payload });
  emitToUser(userId, 'achievement:unlocked', payload);
}
