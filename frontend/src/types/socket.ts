export interface ServerToClientEvents {
  'calendar:event': (data: {
    eventId: string;
    calendarId: string;
    action: 'created' | 'updated' | 'deleted';
    event?: Record<string, unknown>;
  }) => void;
  'calendar:update': (data: { calendarId: string; eventId?: string }) => void;
  'calendar:delete': (data: { calendarId: string; eventId: string }) => void;

  'recipe:update': (data: { recipeId: string; action?: string }) => void;
  'recipe:delete': (data: { recipeId: string }) => void;

  'meal-plan:update': (data: {
    mealPlanId?: string;
    action: 'created' | 'updated' | 'deleted' | 'cooked';
  }) => void;

  'inventory:update': (data: { itemId?: string; areaId?: string; action?: string }) => void;
  'inventory:confidence-updated': (data: { itemId: string; confidence: number; band: string }) => void;
  'inventory:reconciled': (data: { itemId: string; confidence: number }) => void;
  'inventory:out-of-stock': (data: { itemId: string; itemName: string }) => void;
  'shopping-list:update': () => void;
  'shopping:look-ahead-suggestion': (data: { recipeId: string; recipeTitle: string; sharedCount: number }) => void;

  'task:update': (data: { taskId: string }) => void;
  'task:delete': (data: { taskId: string }) => void;

  'list:update': (data: { listId: string; itemId?: string; action?: string }) => void;
  'list:delete': (data: { listId: string }) => void;

  'file:update': (data: { fileId?: string; folderId?: string; action?: string }) => void;
  'file:delete': (data: { fileId?: string; parentId?: string }) => void;

  'notification:new': (data: {
    notificationId: string;
    notification: {
      id: string;
      type: string;
      title: string;
      body?: string | null;
      data?: Record<string, unknown> | null;
      createdAt?: string;
    };
  }) => void;

  'connection:status': (data: {
    connectionId: string;
    status: 'online' | 'offline';
  }) => void;

  'household:update': (data: { householdId: string }) => void;
  'user:update': (data: { userId: string }) => void;
}

export interface ClientToServerEvents {
  'join:household': (householdId: string) => void;
  'leave:household': (householdId: string) => void;

  'typing:start': (data: { resourceType: string; resourceId: string }) => void;
  'typing:stop': (data: { resourceType: string; resourceId: string }) => void;
}
