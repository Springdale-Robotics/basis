import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/index.js';
import { fail } from '../../lib/errors.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { rateLimit } from '../../middleware/rate-limit.middleware.js';
import { logger } from '../../lib/logger.js';
import { sendMail } from '../../lib/email.js';
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from './auth.schema.js';
import {
  createAccount,
  createPasswordResetToken,
  createSession,
  destroySession,
  resetPassword,
  verifyCredentials,
} from './auth.service.js';

function setSessionCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  sessionId: string
): void {
  reply.setCookie('session', sessionId, {
    httpOnly: true,
    secure: request.protocol === 'https',
    sameSite: 'lax',
    path: '/',
    maxAge: config.SESSION_MAX_AGE_MS / 1000,
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const authLimiter = rateLimit({ name: 'auth', max: 10, windowMs: 60_000 });

  app.post('/signup', { preHandler: [authLimiter] }, async (request, reply) => {
    const parsed = signupSchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const code = issue?.path[0] === 'password' ? 'WEAK_PASSWORD' : 'INVALID_INPUT';
      return fail(reply, 400, code, issue?.message ?? 'Invalid input');
    }
    const { email, password } = parsed.data;

    const account = await createAccount(email, password);
    if (account === 'email_taken') {
      return fail(reply, 409, 'EMAIL_TAKEN', 'An account with that email already exists');
    }

    const session = await createSession(account.id, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    setSessionCookie(request, reply, session.id);
    return { success: true, data: { account: { id: account.id, email: account.email } } };
  });

  app.post('/login', { preHandler: [authLimiter] }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return fail(reply, 400, 'INVALID_INPUT', 'Enter your email and password');
    }
    const { email, password } = parsed.data;

    const account = await verifyCredentials(email, password);
    if (!account) {
      return fail(reply, 401, 'INVALID_CREDENTIALS', 'Wrong email or password');
    }

    const session = await createSession(account.id, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    setSessionCookie(request, reply, session.id);
    return { success: true, data: { account: { id: account.id, email: account.email } } };
  });

  app.post('/logout', async (request, reply) => {
    const sessionId = request.cookies['session'];
    if (sessionId) await destroySession(sessionId);
    reply.clearCookie('session', { path: '/' });
    return { success: true, data: {} };
  });

  app.post(
    '/forgot-password',
    { preHandler: [authLimiter] },
    async (request) => {
      const parsed = forgotPasswordSchema.safeParse(request.body);
      // Always respond the same way, even on bad input — no enumeration signal.
      if (parsed.success) {
        const result = await createPasswordResetToken(parsed.data.email);
        if (result) {
          const link = `${config.APP_ORIGIN}/app/reset-password?token=${encodeURIComponent(result.token)}`;
          try {
            await sendMail({
              to: result.account.email,
              subject: 'Reset your Basis Remote password',
              text:
                `Hi,\n\n` +
                `We got a request to reset the password for your Basis Remote account.\n` +
                `Use this link to set a new password:\n\n` +
                `${link}\n\n` +
                `This link expires in 1 hour. If you didn't request this, you can ignore this email — your password won't change.\n\n` +
                `— Basis Remote`,
            });
          } catch (error) {
            logger.error({ err: error }, 'Failed to send password-reset email');
          }
        }
      }
      return { success: true, data: { sent: true } };
    },
  );

  app.post(
    '/reset-password',
    { preHandler: [authLimiter] },
    async (request, reply) => {
      const parsed = resetPasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const code = issue?.path[0] === 'password' ? 'WEAK_PASSWORD' : 'INVALID_INPUT';
        return fail(reply, 400, code, issue?.message ?? 'Invalid input');
      }
      const result = await resetPassword(parsed.data.token, parsed.data.password);
      if (result === 'expired') {
        return fail(reply, 400, 'RESET_TOKEN_EXPIRED', 'This reset link has expired');
      }
      if (result === 'invalid') {
        return fail(reply, 400, 'RESET_TOKEN_INVALID', 'This reset link is invalid or already used');
      }
      return { success: true, data: {} };
    },
  );

  app.get('/me', { preHandler: [authMiddleware] }, async (request) => {
    return {
      success: true,
      data: { account: { id: request.account!.id, email: request.account!.email } },
    };
  });
}
