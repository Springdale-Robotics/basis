import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { redis } from '../config/redis.js';
import { db } from '../config/database.js';
import { sessions } from '../db/schema/index.js';
import { eq, and, gt } from 'drizzle-orm';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { registerInstallNamespace } from '../modules/install/install.ws.js';

export interface AuthenticatedSocket extends Socket {
  userId?: string;
  householdId?: string;
  deviceId?: string;
  sessionId?: string;
}

export interface WebSocketEvent {
  type: string;
  payload: unknown;
  householdId: string;
  userId?: string;
  timestamp: Date;
}

let io: Server | null = null;

export function getIO(): Server {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
}

export function initializeWebSocket(server: HttpServer): Server {
  io = new Server(server, {
    cors: {
      origin: config.CORS_ORIGINS.split(','),
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Authentication middleware
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const sessionToken = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

      if (!sessionToken) {
        return next(new Error('Authentication required'));
      }

      // Look up session in Redis first (for speed)
      const cachedSession = await redis.get(`session:${sessionToken}`);

      if (cachedSession) {
        const session = JSON.parse(cachedSession);
        socket.userId = session.userId;
        socket.householdId = session.householdId;
        socket.deviceId = session.deviceId;
        socket.sessionId = session.id;
        return next();
      }

      // Fall back to database
      const session = await db.query.sessions.findFirst({
        where: and(
          eq(sessions.token, sessionToken),
          gt(sessions.expiresAt, new Date())
        ),
      });

      if (!session) {
        return next(new Error('Invalid or expired session'));
      }

      // Cache session
      await redis.setex(
        `session:${sessionToken}`,
        3600,
        JSON.stringify({
          id: session.id,
          userId: session.userId,
          householdId: session.householdId,
          deviceId: session.deviceId,
        })
      );

      socket.userId = session.userId;
      socket.householdId = session.householdId;
      socket.deviceId = session.deviceId || undefined;
      socket.sessionId = session.id;

      next();
    } catch (error) {
      logger.error({ error }, 'WebSocket authentication error');
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    const log = logger.child({ socketId: socket.id, userId: socket.userId });
    log.info('Client connected');

    // Join household room
    if (socket.householdId) {
      socket.join(`household:${socket.householdId}`);
      log.debug({ householdId: socket.householdId }, 'Joined household room');
    }

    // Join user-specific room
    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
    }

    // Track online status
    if (socket.userId && socket.householdId) {
      trackOnlineStatus(socket.userId, socket.householdId, true);
    }

    // Handle client events
    socket.on('subscribe', (rooms: string[]) => {
      for (const room of rooms) {
        // Only allow subscribing to rooms within their household
        if (room.startsWith(`household:${socket.householdId}`)) {
          socket.join(room);
          log.debug({ room }, 'Subscribed to room');
        }
      }
    });

    socket.on('unsubscribe', (rooms: string[]) => {
      for (const room of rooms) {
        socket.leave(room);
        log.debug({ room }, 'Unsubscribed from room');
      }
    });

    // Typing indicators
    socket.on('typing:start', (data: { roomId: string }) => {
      socket.to(data.roomId).emit('typing:start', {
        userId: socket.userId,
        roomId: data.roomId,
      });
    });

    socket.on('typing:stop', (data: { roomId: string }) => {
      socket.to(data.roomId).emit('typing:stop', {
        userId: socket.userId,
        roomId: data.roomId,
      });
    });

    // Ping/pong for connection health
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
    });

    socket.on('disconnect', (reason) => {
      log.info({ reason }, 'Client disconnected');

      if (socket.userId && socket.householdId) {
        trackOnlineStatus(socket.userId, socket.householdId, false);
      }
    });

    socket.on('error', (error) => {
      log.error({ error }, 'Socket error');
    });
  });

  // Register the guided-install namespace (/install) for PTY-based installer
  // terminals. Admin-only auth lives inside the namespace setup.
  registerInstallNamespace(io);

  logger.info('WebSocket server initialized');
  return io;
}

// Track user online status
async function trackOnlineStatus(userId: string, householdId: string, online: boolean): Promise<void> {
  const key = `online:${householdId}`;

  if (online) {
    await redis.sadd(key, userId);
    await redis.expire(key, 86400); // 24 hours
  } else {
    // Check if user has other active connections
    const sockets = await getIO().in(`user:${userId}`).fetchSockets();
    if (sockets.length === 0) {
      await redis.srem(key, userId);
    }
  }

  // Broadcast status change
  emitToHousehold(householdId, 'user:status', {
    userId,
    online,
    timestamp: new Date(),
  });
}

// Emit event to all members of a household
export function emitToHousehold(householdId: string, event: string, data: unknown): void {
  if (!io) return;
  io.to(`household:${householdId}`).emit(event, data);
}

// Emit event to a specific user
export function emitToUser(userId: string, event: string, data: unknown): void {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
}

// Emit event to a specific room
export function emitToRoom(room: string, event: string, data: unknown): void {
  if (!io) return;
  io.to(room).emit(event, data);
}

// Get online users for a household
export async function getOnlineUsers(householdId: string): Promise<string[]> {
  const members = await redis.smembers(`online:${householdId}`);
  return members;
}

// Broadcast to connected households (for sync)
export async function broadcastToConnectedHouseholds(
  fromHouseholdId: string,
  event: string,
  data: unknown,
  connectedHouseholdIds: string[]
): Promise<void> {
  if (!io) return;

  for (const householdId of connectedHouseholdIds) {
    io.to(`household:${householdId}`).emit(event, {
      ...data as object,
      fromHouseholdId,
    });
  }
}
