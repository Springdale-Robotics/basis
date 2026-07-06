import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { authRateLimiter } from '../../middleware/rate-limit.middleware.js';
import {
  loginSchema,
  registerWithInviteSchema,
  type LoginInput,
  type RegisterWithInviteInput,
} from './auth.schema.js';
import * as authService from './auth.service.js';
import { config } from '../../config/index.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Login
  app.post<{ Body: LoginInput }>(
    '/login',
    {
      preHandler: [authRateLimiter],
    },
    async (request, reply) => {
      const input = loginSchema.parse(request.body);
      const result = await authService.login(
        input,
        request.ip,
        request.headers['user-agent']
      );

      // Set session cookie. `secure` is keyed off the actual request scheme
      // (request.protocol honors X-Forwarded-Proto via trustProxy), NOT
      // NODE_ENV: a production install reached over plain HTTP on the LAN — the
      // documented default before remote access is set up — must not set the
      // Secure flag, or the browser silently drops the cookie and login fails.
      reply.setCookie('session', result.session.id, {
        httpOnly: true,
        secure: request.protocol === 'https',
        sameSite: 'lax',
        path: '/',
        maxAge: config.SESSION_MAX_AGE_MS / 1000,
      });

      return {
        success: true,
        data: {
          user: result.user,
          household: result.household,
        },
      };
    }
  );

  // NOTE: there is deliberately no open `/register` endpoint. Joining an
  // existing household requires an invite (`/register/invite` below); the
  // first admin is created through the setup flow, which is gated on the
  // instance having no household yet. An open registration path let anyone
  // who knew a householdId (returned by /auth/me to every member) mint
  // themselves a full `member` account — including kids/visitors escalating
  // their own role.

  // Validate invite code (public endpoint)
  app.get<{ Params: { code: string } }>(
    '/invite/:code',
    {
      preHandler: [authRateLimiter],
    },
    async (request) => {
      const { code } = request.params;
      const result = await authService.validateInviteCode(code);

      if (!result.valid || !result.invite) {
        const errorMessages: Record<authService.InviteValidationError, string> = {
          NOT_FOUND: 'Invite not found',
          EXPIRED: 'This invite has expired',
          USED: 'This invite has already been used',
          REVOKED: 'This invite has been revoked',
        };
        return {
          success: false,
          error: {
            code: `INVITE_${result.error}`,
            message: errorMessages[result.error!],
          },
        };
      }

      return {
        success: true,
        data: {
          invite: {
            role: result.invite.role,
            householdName: result.invite.household.name,
            expiresAt: result.invite.expiresAt,
          },
        },
      };
    }
  );

  // Register with invite code
  app.post<{ Body: RegisterWithInviteInput }>(
    '/register/invite',
    {
      preHandler: [authRateLimiter],
    },
    async (request, reply) => {
      const input = registerWithInviteSchema.parse(request.body);
      const result = await authService.registerWithInvite(
        input,
        request.ip,
        request.headers['user-agent']
      );

      // Set session cookie
      reply.setCookie('session', result.session.id, {
        httpOnly: true,
        secure: request.protocol === 'https',
        sameSite: 'lax',
        path: '/',
        maxAge: config.SESSION_MAX_AGE_MS / 1000,
      });

      return {
        success: true,
        data: {
          user: result.user,
          household: result.household,
        },
      };
    }
  );

  // Logout
  app.post(
    '/logout',
    {
      preHandler: [authMiddleware],
    },
    async (request, reply) => {
      await authService.logout(request.user!.sessionId);

      reply.clearCookie('session', {
        path: '/',
      });

      return {
        success: true,
        data: { message: 'Logged out successfully' },
      };
    }
  );

  // Refresh session
  app.post(
    '/refresh',
    {
      preHandler: [authMiddleware],
    },
    async (request, reply) => {
      const session = await authService.refreshSession(request.user!.sessionId);

      if (!session) {
        reply.clearCookie('session', { path: '/' });
        return {
          success: false,
          error: { code: 'AUTH_1002', message: 'Session expired' },
        };
      }

      reply.setCookie('session', session.id, {
        httpOnly: true,
        secure: request.protocol === 'https',
        sameSite: 'lax',
        path: '/',
        maxAge: config.SESSION_MAX_AGE_MS / 1000,
      });

      return {
        success: true,
        data: { expiresAt: session.expiresAt },
      };
    }
  );

  // Get current user
  app.get(
    '/me',
    {
      preHandler: [authMiddleware],
    },
    async (request) => {
      return {
        success: true,
        data: {
          user: {
            id: request.user!.id,
            householdId: request.user!.householdId,
            email: request.user!.email,
            displayName: request.user!.displayName,
            role: request.user!.role,
          },
        },
      };
    }
  );

  // NOTE: there is deliberately no email-token password reset. No mailer
  // exists on a Basis box, so the old /forgot-password endpoint claimed to
  // send an email it never sent. Recovery for a locked-out member is an
  // admin reset: POST /users/:id/reset-password (Settings → Members).

  // Get active sessions
  app.get(
    '/sessions',
    {
      preHandler: [authMiddleware],
    },
    async (request) => {
      const sessions = await authService.getUserSessions(request.user!.id);

      return {
        success: true,
        data: {
          sessions: sessions.map((s) => ({
            id: s.id,
            deviceId: s.deviceId,
            ipAddress: s.ipAddress,
            createdAt: s.createdAt,
            lastActiveAt: s.lastActiveAt,
            isCurrent: s.id === request.user!.sessionId,
          })),
        },
      };
    }
  );

  // Revoke a session
  app.delete<{ Params: { id: string } }>(
    '/sessions/:id',
    {
      preHandler: [authMiddleware],
    },
    async (request) => {
      await authService.revokeSession(request.user!.id, request.params.id);

      return {
        success: true,
        data: { message: 'Session revoked' },
      };
    }
  );

  // Logout all sessions
  app.post(
    '/logout-all',
    {
      preHandler: [authMiddleware],
    },
    async (request, _reply) => {
      await authService.logoutAllSessions(
        request.user!.id,
        request.user!.sessionId
      );

      return {
        success: true,
        data: { message: 'All other sessions logged out' },
      };
    }
  );

  // Logout all including current
  app.post(
    '/logout-all-including-current',
    {
      preHandler: [authMiddleware],
    },
    async (request, reply) => {
      await authService.logoutAllSessions(request.user!.id);

      reply.clearCookie('session', { path: '/' });

      return {
        success: true,
        data: { message: 'All sessions logged out' },
      };
    }
  );
}
