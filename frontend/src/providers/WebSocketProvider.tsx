import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useCookingStore } from '@/stores/cookingStore';
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
  const socketRef = useRef<TypedSocket | null>(null);
  const queryClient = useQueryClient();
  const { isAuthenticated, household } = useAuthStore();
  const { addNotification } = useNotificationStore();
  const { updateTimerRemaining, markTimerComplete, activeSession } = useCookingStore();

  useEffect(() => {
    if (!isAuthenticated || !household) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    // Create socket connection
    const socket: TypedSocket = io('/', {
      autoConnect: true,
      withCredentials: true,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('WebSocket connected');
      socket.emit('join:household', household.id);
    });

    socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
    });

    // Calendar events
    socket.on('calendar:event', (data) => {
      // Invalidate relevant queries when calendar events change
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['eventDetails', data.calendarId, data.eventId] });
      if (data.action === 'created' || data.action === 'deleted') {
        queryClient.invalidateQueries({ queryKey: ['calendars'] });
      }
    });

    socket.on('calendar:update', (data) => {
      queryClient.invalidateQueries({ queryKey: ['calendars', data.calendarId] });
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
    });

    socket.on('calendar:delete', (data) => {
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
    });

    // Recipe events
    socket.on('recipe:update', (data) => {
      queryClient.invalidateQueries({ queryKey: ['recipes', data.recipeId] });
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
    });

    socket.on('recipe:delete', (data) => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
    });

    // Inventory events
    socket.on('inventory:update', () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['stock'] });
    });

    socket.on('shopping-list:update', () => {
      queryClient.invalidateQueries({ queryKey: ['shopping-list'] });
    });

    // Task events
    socket.on('task:update', (data) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', data.taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    });

    socket.on('task:delete', () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    });

    // List events
    socket.on('list:update', (data) => {
      queryClient.invalidateQueries({ queryKey: ['lists', data.listId] });
      queryClient.invalidateQueries({ queryKey: ['lists'] });
    });

    socket.on('list:delete', () => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
    });

    // File events
    socket.on('file:update', (data) => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      if (data.parentId) {
        queryClient.invalidateQueries({ queryKey: ['files', data.parentId] });
      }
    });

    socket.on('file:delete', (data) => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
    });

    // Notification events
    socket.on('notification', (notification: { id: string; type: string; title: string; body?: string; data?: Record<string, unknown> }) => {
      const now = new Date().toISOString();
      addNotification({
        id: notification.id,
        type: notification.type as import('@/types/models').NotificationType,
        title: notification.title,
        body: notification.body,
        data: notification.data,
        userId: '',
        householdId: household.id,
        read: false,
        createdAt: now,
        updatedAt: now,
      });
      toast({
        title: notification.title,
        description: notification.body,
      });
    });

    // Cooking timer events
    socket.on('cooking:timer:alert', (data) => {
      if (activeSession) {
        markTimerComplete(activeSession.id, data.timerId);
        toast({
          title: 'Timer Complete',
          description: `${data.name} timer has finished!`,
        });
        // Play sound
        const audio = new Audio('/sounds/timer-complete.mp3');
        audio.play().catch(() => {});
      }
    });

    socket.on('cooking:timer:update', (data) => {
      updateTimerRemaining(data.sessionId, data.timerId, data.remainingSeconds);
    });

    // Household events
    socket.on('household:update', () => {
      queryClient.invalidateQueries({ queryKey: ['household'] });
    });

    socket.on('user:update', () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [isAuthenticated, household?.id]);

  const value: WebSocketContextType = {
    socket: socketRef.current,
    isConnected: socketRef.current?.connected ?? false,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  return useContext(WebSocketContext);
}
