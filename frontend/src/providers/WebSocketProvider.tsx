import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { toast } from '@/hooks/useToast';
import type { ServerToClientEvents, ClientToServerEvents } from '@/types/socket';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface WebSocketContextType {
  socket: TypedSocket | null;
  isConnected: boolean;
}

const WebSocketContext = createContext<WebSocketContextType>({
  socket: null,
  isConnected: false,
});

interface WebSocketProviderProps {
  children: ReactNode;
}

export function WebSocketProvider({ children }: WebSocketProviderProps) {
  const [socket, setSocket] = useState<TypedSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const queryClient = useQueryClient();
  const { isAuthenticated, household } = useAuthStore();
  const { addNotification } = useNotificationStore();

  useEffect(() => {
    if (!isAuthenticated || !household) {
      setSocket(null);
      setIsConnected(false);
      return;
    }

    // Create socket connection
    const newSocket: TypedSocket = io('/', {
      autoConnect: true,
      withCredentials: true,
    });

    setSocket(newSocket);

    // Track whether this socket has connected before so we can tell a
    // reconnect apart from the initial connect.
    let hasConnectedBefore = false;

    newSocket.on('connect', () => {
      console.log('WebSocket connected');
      setIsConnected(true);
      newSocket.emit('join:household', household.id);

      if (hasConnectedBefore) {
        // We were disconnected and may have missed events — refetch everything.
        queryClient.invalidateQueries();
      }
      hasConnectedBefore = true;
    });

    newSocket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.warn('WebSocket connection error:', error.message);
    });

    // Calendar events
    newSocket.on('calendar:event', (data) => {
      // Invalidate relevant queries when calendar events change
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['eventDetails', data.calendarId, data.eventId] });
      if (data.action === 'created' || data.action === 'deleted') {
        queryClient.invalidateQueries({ queryKey: ['calendars'] });
      }
    });

    newSocket.on('calendar:update', (data) => {
      queryClient.invalidateQueries({ queryKey: ['calendars', data.calendarId] });
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
    });

    newSocket.on('calendar:delete', () => {
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
    });

    // Recipe events
    newSocket.on('recipe:update', (data) => {
      queryClient.invalidateQueries({ queryKey: ['recipes', data.recipeId] });
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
    });

    newSocket.on('recipe:delete', () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
    });

    // Meal plan events
    newSocket.on('meal-plan:update', () => {
      queryClient.invalidateQueries({ queryKey: ['meal-plans'] });
    });

    // Inventory events
    newSocket.on('inventory:update', () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['storage-areas'] });
    });

    newSocket.on('shopping-list:update', () => {
      queryClient.invalidateQueries({ queryKey: ['shopping-list'] });
    });

    // Confidence-aware inventory events
    newSocket.on('inventory:confidence-updated', () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['item-confidence'] });
    });

    newSocket.on('inventory:reconciled', () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['item-confidence'] });
    });

    newSocket.on('inventory:out-of-stock', () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['shopping-list'] });
    });

    newSocket.on('shopping:look-ahead-suggestion', () => {
      queryClient.invalidateQueries({ queryKey: ['shopping-list'] });
      queryClient.invalidateQueries({ queryKey: ['look-ahead-suggestions'] });
    });

    // Task events
    newSocket.on('task:update', (data) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', data.taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    });

    newSocket.on('task:delete', () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    });

    // List events
    newSocket.on('list:update', (data) => {
      queryClient.invalidateQueries({ queryKey: ['lists', data.listId] });
      queryClient.invalidateQueries({ queryKey: ['lists'] });
    });

    newSocket.on('list:delete', () => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
    });

    // File events
    newSocket.on('file:update', (data) => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      if (data.folderId) {
        queryClient.invalidateQueries({ queryKey: ['files', data.folderId] });
      }
    });

    newSocket.on('file:delete', () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
    });

    // Notification events
    newSocket.on('notification:new', ({ notification }) => {
      const now = new Date().toISOString();
      addNotification({
        id: notification.id,
        type: notification.type as import('@/types/models').NotificationType,
        title: notification.title,
        body: notification.body ?? undefined,
        data: notification.data ?? undefined,
        userId: '',
        householdId: household.id,
        read: false,
        createdAt: notification.createdAt ?? now,
        updatedAt: notification.createdAt ?? now,
      });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast({
        title: notification.title,
        description: notification.body ?? undefined,
      });
    });

    // Household events
    newSocket.on('household:update', () => {
      queryClient.invalidateQueries({ queryKey: ['household'] });
      queryClient.invalidateQueries({ queryKey: ['household-members'] });
    });

    newSocket.on('user:update', () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    });

    return () => {
      newSocket.disconnect();
      setSocket(null);
      setIsConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, household?.id]);

  return (
    <WebSocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  return useContext(WebSocketContext);
}
