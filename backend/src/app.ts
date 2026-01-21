import { randomUUID } from 'crypto';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyCompress from '@fastify/compress';
import fastifyMultipart from '@fastify/multipart';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';

import { config, isDev } from './config/index.js';
import { logger } from './lib/logger.js';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { recordHttpRequest } from './lib/metrics.js';

// Import route modules
import { authRoutes } from './modules/auth/auth.routes.js';
import { householdsRoutes } from './modules/households/households.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { devicesRoutes } from './modules/devices/devices.routes.js';
import { calendarsRoutes } from './modules/calendars/calendars.routes.js';
import { syncRoutes } from './modules/calendars/sync.routes.js';
import { recipesRoutes } from './modules/recipes/recipes.routes.js';
import { inventoryRoutes } from './modules/inventory/inventory.routes.js';
import { tasksRoutes } from './modules/tasks/tasks.routes.js';
import { filesRoutes } from './modules/files/files.routes.js';
import { listsRoutes } from './modules/lists/lists.routes.js';
import { notificationsRoutes } from './modules/notifications/notifications.routes.js';
import { settingsRoutes } from './modules/settings/settings.routes.js';
import { backupRoutes } from './modules/backup/backup.routes.js';
import { connectionsRoutes } from './modules/connections/connections.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { setupRoutes } from './modules/setup/setup.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // We use our own logger
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });

  // Request ID middleware (run first)
  app.addHook('onRequest', requestIdMiddleware);

  // Security headers
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: isDev ? false : undefined,
  });

  // CORS
  const corsOrigins = config.CORS_ORIGINS
    ? config.CORS_ORIGINS.split(',').map((o) => o.trim())
    : [];

  await app.register(fastifyCors, {
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
  });

  // Compression
  await app.register(fastifyCompress);

  // Cookies
  await app.register(fastifyCookie, {
    secret: config.SESSION_SECRET,
  });

  // File uploads
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: config.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
    },
  });

  // Swagger documentation (development only)
  if (isDev) {
    await app.register(fastifySwagger, {
      openapi: {
        info: {
          title: 'Home Manager API',
          description: 'Self-hosted household management server',
          version: '1.0.0',
        },
        servers: [
          {
            url: `http://localhost:${config.PORT}`,
            description: 'Development server',
          },
        ],
        components: {
          securitySchemes: {
            cookieAuth: {
              type: 'apiKey',
              in: 'cookie',
              name: 'session',
            },
          },
        },
      },
    });

    await app.register(fastifySwaggerUi, {
      routePrefix: '/api/docs',
    });
  }

  // Request logging and metrics
  app.addHook('onResponse', (request, reply, done) => {
    const duration = reply.elapsedTime;
    const { method, url } = request;
    const statusCode = reply.statusCode;

    logger.info({
      requestId: request.requestId,
      method,
      url,
      statusCode,
      duration: `${duration.toFixed(2)}ms`,
    });

    recordHttpRequest(method, url, statusCode, duration);
    done();
  });

  // Error handling
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  // Register routes
  await app.register(healthRoutes, { prefix: '/api/v1/health' });
  await app.register(setupRoutes, { prefix: '/api/v1/setup' });
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(householdsRoutes, { prefix: '/api/v1/households' });
  await app.register(usersRoutes, { prefix: '/api/v1/users' });
  await app.register(devicesRoutes, { prefix: '/api/v1/devices' });
  await app.register(calendarsRoutes, { prefix: '/api/v1/calendars' });
  await app.register(syncRoutes, { prefix: '/api/v1/calendars' });
  await app.register(recipesRoutes, { prefix: '/api/v1/recipes' });
  await app.register(inventoryRoutes, { prefix: '/api/v1/inventory' });
  await app.register(tasksRoutes, { prefix: '/api/v1/tasks' });
  await app.register(filesRoutes, { prefix: '/api/v1/files' });
  await app.register(listsRoutes, { prefix: '/api/v1/lists' });
  await app.register(notificationsRoutes, { prefix: '/api/v1/notifications' });
  await app.register(settingsRoutes, { prefix: '/api/v1/settings' });
  await app.register(backupRoutes, { prefix: '/api/v1/backup' });
  await app.register(connectionsRoutes, { prefix: '/api/v1/connections' });

  return app;
}
