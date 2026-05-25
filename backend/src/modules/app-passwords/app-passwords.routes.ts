import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import {
  createAppPassword,
  listAppPasswords,
  revokeAppPassword,
} from './app-passwords.service.js';

const createSchema = z.object({
  label: z.string().min(1).max(255).trim(),
  scopes: z.array(z.enum(['caldav'])).min(1).default(['caldav']),
});

/**
 * App-password management lives under the authenticated user's profile.
 * All routes require a cookie session — an app password CANNOT be used to
 * mint or revoke other app passwords. Mounted at /api/v1/users/me/app-passwords.
 */
export async function appPasswordsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [authMiddleware] }, async (request) => {
    const items = await listAppPasswords(request.user!.id);
    return { success: true, data: { appPasswords: items } };
  });

  app.post('/', { preHandler: [authMiddleware] }, async (request) => {
    const input = createSchema.parse(request.body);
    const { summary, secret } = await createAppPassword(
      request.user!.id,
      input.label,
      input.scopes
    );
    return { success: true, data: { appPassword: summary, secret } };
  });

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware] },
    async (request) => {
      const ok = await revokeAppPassword(request.user!.id, request.params.id);
      if (!ok) throw Errors.notFound('App password');
      return { success: true, data: { message: 'App password revoked' } };
    }
  );
}
