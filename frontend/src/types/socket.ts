export interface ServerToClientEvents {
  'calendar:event': (data: {
    eventId: string;
    calendarId: string;
    action: 'created' | 'updated' | 'deleted';
    event?: Record<string, unknown>;
  }) => void;
  'calendar:update': (data: { calendarId: string; eventId?: string }) => void;
  'calendar:delete': (data: { calendarId: string; eventId: string }) => void;

  'recipe:update': (data: { recipeId: string }) => void;
  'recipe:delete': (data: { recipeId: string }) => void;

  'inventory:update': (data: { itemId?: string; areaId?: string }) => void;
  'inventory:confidence-updated': (data: { itemId: string; confidence: number; band: string }) => void;
  'inventory:reconciled': (data: { itemId: string; confidence: number }) => void;
  'inventory:out-of-stock': (data: { itemId: string; itemName: string }) => void;
  'shopping-list:update': () => void;
  'shopping:look-ahead-suggestion': (data: { recipeId: string; recipeTitle: string; sharedCount: number }) => void;

  'task:update': (data: { taskId: string }) => void;
  'task:delete': (data: { taskId: string }) => void;

  'list:update': (data: { listId: string }) => void;
  'list:delete': (data: { listId: string }) => void;

  'file:update': (data: { fileId: string; parentId?: string }) => void;
  'file:delete': (data: { fileId: string; parentId?: string }) => void;

  'notification': (notification: {
    id: string;
    type: string;
    title: string;
    body?: string;
    data?: Record<string, unknown>;
  }) => void;

  'cooking:timer:alert': (data: { timerId: string; name: string }) => void;
  'cooking:timer:update': (data: {
    sessionId: string;
    timerId: string;
    remainingSeconds: number;
    isRunning: boolean;
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

  'cooking:timer:start': (data: { sessionId: string; timerId: string }) => void;
  'cooking:timer:pause': (data: { sessionId: string; timerId: string }) => void;
  'cooking:timer:reset': (data: { sessionId: string; timerId: string }) => void;
  'cooking:timer:alert': (data: { sessionId: string; timerId: string }) => void;

  'typing:start': (data: { resourceType: string; resourceId: string }) => void;
  'typing:stop': (data: { resourceType: string; resourceId: string }) => void;
}
