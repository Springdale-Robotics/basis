import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { redis } from '../config/redis.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { resolveSession } from '../middleware/auth.middleware.js';
import { registerInstallNamespace } from '../modules/install/install.ws.js';

/** Extract a single cookie value from a Cookie header. */
function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}

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
  // Mirror the HTTP CORS logic in app.ts. When CORS_ORIGINS is unset/empty
  // (the default — the backend serves the SPA itself, so requests are
  // same-origin) we must NOT configure a cors allowlist: the previous
  // `config.CORS_ORIGINS.split(',')` produced `['']` on an empty value, which
  // rejected the WebSocket upgrade's Origin header (the polling handshake has
  // no Origin and slips through, then the ws upgrade 400s). Omitting cors lets
  // socket.io accept same-origin connections; the auth middleware below still
  // gates access. Only restrict by origin when origins are explicitly set.
  const corsOrigins = config.CORS_ORIGINS
    ? config.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : [];
  io = new Server(server, {
    ...(corsOrigins.length > 0
      ? { cors: { origin: corsOrigins, credentials: true } }
      : {}),
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Authentication middleware — same cookie-based session as the HTTP API. The
  // browser sends the `session` cookie in the handshake (the client connects
  // with withCredentials), so read it from the handshake headers. `auth.token`
  // is accepted as a fallback for non-browser clients that pass the session id
  // explicitly. householdId comes from the user, not the session.
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const sessionId =
        parseCookie(socket.handshake.headers.cookie, 'session') ||
        socket.handshake.auth?.token;

      if (!sessionId) {
        return next(new Error('Authentication required'));
      }

      const result = await resolveSession(sessionId);
      if (!result) {
        return next(new Error('Invalid or expired session'));
      }

      socket.userId = result.user.id;
      socket.householdId = result.user.householdId;
      socket.deviceId = result.session.deviceId ?? undefined;
      socket.sessionId = result.session.id;

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
