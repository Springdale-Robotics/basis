import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware, requireAuthenticated } from '../../middleware/auth.middleware.js';
import { authRateLimiter } from '../../middleware/rate-limit.middleware.js';
import {
  loginSchema,
  registerSchema,
  registerWithInviteSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  type LoginInput,
  type RegisterInput,
  type RegisterWithInviteInput,
  type ForgotPasswordInput,
  type ResetPasswordInput,
  type ChangePasswordInput,
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

      // Set session cookie
      reply.setCookie('session', result.session.id, {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
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

  // Register (during setup or invite)
  app.post<{ Body: RegisterInput }>(
    '/register',
    {
      preHandler: [authRateLimiter],
    },
    async (request, reply) => {
      const input = registerSchema.parse(request.body);
      const result = await authService.register(input);

      // Set session cookie
      reply.setCookie('session', result.session.id, {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
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
        secure: config.NODE_ENV === 'production',
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
        secure: config.NODE_ENV === 'production',
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

  // Forgot password
  app.post<{ Body: ForgotPasswordInput }>(
    '/forgot-password',
    {
      preHandler: [authRateLimiter],
    },
    async (request) => {
      const { email } = forgotPasswordSchema.parse(request.body);
      const token = await authService.createPasswordResetToken(email);

      // Always return success to prevent email enumeration
      // In production, you would send an email with the reset link
      if (token) {
        // TODO: Send email with reset link
        // For now, just log it in development
        if (config.NODE_ENV === 'development') {
          console.log(`Password reset token for ${email}: ${token}`);
        }
      }

      return {
        success: true,
        data: {
          message: 'If an account exists, a password reset email has been sent',
        },
      };
    }
  );

  // Reset password
  app.post<{ Body: ResetPasswordInput }>(
    '/reset-password',
    {
      preHandler: [authRateLimiter],
    },
    async (request) => {
      const { token, password } = resetPasswordSchema.parse(request.body);
      const success = await authService.resetPassword(token, password);

      if (!success) {
        return {
          success: false,
          error: {
            code: 'AUTH_1007',
            message: 'Invalid or expired reset token',
          },
        };
      }

      return {
        success: true,
        data: { message: 'Password has been reset successfully' },
      };
    }
  );

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
    async (request, reply) => {
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
