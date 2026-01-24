import argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { db } from '../../config/database.js';
import { redis } from '../../config/redis.js';
import { users, sessions, households, memberInvites } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { config } from '../../config/index.js';
import { Errors } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import type { LoginInput, RegisterInput, RegisterWithInviteInput } from './auth.schema.js';
import type { User, Session, Household, MemberInvite } from '../../db/schema/index.js';

export interface AuthResult {
  user: Omit<User, 'passwordHash'>;
  session: Session;
  household: Household;
}

export async function login(
  input: LoginInput,
  ipAddress?: string,
  userAgent?: string
): Promise<AuthResult> {
  const { email, password, deviceId } = input;

  // Find user by email
  const user = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });

  if (!user) {
    logger.warn({ email }, 'Login failed: user not found');
    throw Errors.invalidCredentials();
  }

  // Verify password
  const isValid = await argon2.verify(user.passwordHash, password);
  if (!isValid) {
    logger.warn({ email }, 'Login failed: invalid password');
    throw Errors.invalidCredentials();
  }

  // Get household
  const household = await db.query.households.findFirst({
    where: eq(households.id, user.householdId),
  });

  if (!household) {
    throw Errors.internal('Household not found');
  }

  // Create session
  const session = await createSession(user.id, deviceId, ipAddress, userAgent);

  // Return user without password hash
  const { passwordHash, ...userWithoutPassword } = user;

  return {
    user: userWithoutPassword,
    session,
    household,
  };
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const { email, password, displayName, householdId } = input;

  // Check if household exists
  const household = await db.query.households.findFirst({
    where: eq(households.id, householdId),
  });

  if (!household) {
    throw Errors.notFound('Household', householdId);
  }

  // Check if email already exists in household
  const existingUser = await db.query.users.findFirst({
    where: and(
      eq(users.householdId, householdId),
      eq(users.email, email.toLowerCase())
    ),
  });

  if (existingUser) {
    throw Errors.duplicate('email');
  }

  // Hash password
  const passwordHash = await argon2.hash(password);

  // Check if this is the first user (make them admin)
  const existingUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.householdId, householdId))
    .limit(1);

  const isFirstUser = existingUsers.length === 0;

  // Create user
  const [user] = await db
    .insert(users)
    .values({
      householdId,
      email: email.toLowerCase(),
      passwordHash,
      displayName,
      role: isFirstUser ? 'admin' : 'member',
    })
    .returning();

  // Create session
  const session = await createSession(user.id);

  const { passwordHash: _, ...userWithoutPassword } = user;

  return {
    user: userWithoutPassword,
    session,
    household,
  };
}

export async function logout(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function logoutAllSessions(
  userId: string,
  exceptSessionId?: string
): Promise<void> {
  if (exceptSessionId) {
    await db
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), eq(sessions.id, exceptSessionId)));
  } else {
    await db.delete(sessions).where(eq(sessions.userId, userId));
  }
}

export async function createSession(
  userId: string,
  deviceId?: string,
  ipAddress?: string,
  userAgent?: string
): Promise<Session> {
  const sessionId = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + config.SESSION_MAX_AGE_MS);

  const [session] = await db
    .insert(sessions)
    .values({
      id: sessionId,
      userId,
      deviceId: deviceId || null,
      expiresAt,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
    })
    .returning();

  return session;
}

export async function refreshSession(sessionId: string): Promise<Session | null> {
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });

  if (!session || session.expiresAt < new Date()) {
    return null;
  }

  const newExpiresAt = new Date(Date.now() + config.SESSION_MAX_AGE_MS);

  const [updatedSession] = await db
    .update(sessions)
    .set({ expiresAt: newExpiresAt, lastActiveAt: new Date() })
    .where(eq(sessions.id, sessionId))
    .returning();

  return updatedSession;
}

export async function getUserSessions(userId: string): Promise<Session[]> {
  return db.query.sessions.findMany({
    where: eq(sessions.userId, userId),
    orderBy: (sessions, { desc }) => [desc(sessions.lastActiveAt)],
  });
}

export async function revokeSession(
  userId: string,
  sessionId: string
): Promise<void> {
  await db
    .delete(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
}

export async function createPasswordResetToken(email: string): Promise<string | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });

  if (!user) {
    return null;
  }

  const token = randomBytes(32).toString('hex');
  const key = `password-reset:${token}`;

  // Store token in Redis for 1 hour
  await redis.set(key, user.id, 'EX', 3600);

  return token;
}

export async function resetPassword(
  token: string,
  newPassword: string
): Promise<boolean> {
  const key = `password-reset:${token}`;
  const userId = await redis.get(key);

  if (!userId) {
    return false;
  }

  const passwordHash = await argon2.hash(newPassword);

  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, userId));

  // Delete token
  await redis.del(key);

  // Invalidate all sessions
  await db.delete(sessions).where(eq(sessions.userId, userId));

  return true;
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw Errors.notFound('User', userId);
  }

  const isValid = await argon2.verify(user.passwordHash, currentPassword);
  if (!isValid) {
    throw Errors.validation('Current password is incorrect');
  }

  const passwordHash = await argon2.hash(newPassword);

  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export type InviteValidationError = 'NOT_FOUND' | 'EXPIRED' | 'USED' | 'REVOKED';

export interface InviteValidationResult {
  valid: boolean;
  invite?: MemberInvite & { household: Household };
  error?: InviteValidationError;
}

export async function validateInviteCode(code: string): Promise<InviteValidationResult> {
  const invite = await db.query.memberInvites.findFirst({
    where: eq(memberInvites.inviteCode, code),
  });

  if (!invite) {
    return { valid: false, error: 'NOT_FOUND' };
  }

  if (invite.status === 'revoked') {
    return { valid: false, error: 'REVOKED' };
  }

  if (invite.status === 'accepted') {
    return { valid: false, error: 'USED' };
  }

  if (invite.expiresAt < new Date()) {
    // Auto-update status to expired if not already
    if (invite.status === 'pending') {
      await db
        .update(memberInvites)
        .set({ status: 'expired' })
        .where(eq(memberInvites.id, invite.id));
    }
    return { valid: false, error: 'EXPIRED' };
  }

  const household = await db.query.households.findFirst({
    where: eq(households.id, invite.householdId),
  });

  if (!household) {
    return { valid: false, error: 'NOT_FOUND' };
  }

  return {
    valid: true,
    invite: { ...invite, household },
  };
}

export async function registerWithInvite(
  input: RegisterWithInviteInput,
  ipAddress?: string,
  userAgent?: string
): Promise<AuthResult> {
  const { inviteCode, email, password, displayName } = input;

  // Validate invite
  const validation = await validateInviteCode(inviteCode);
  if (!validation.valid || !validation.invite) {
    const errorMessages: Record<InviteValidationError, string> = {
      NOT_FOUND: 'Invite not found',
      EXPIRED: 'This invite has expired',
      USED: 'This invite has already been used',
      REVOKED: 'This invite has been revoked',
    };
    throw Errors.validation(errorMessages[validation.error!]);
  }

  const invite = validation.invite;
  const household = invite.household;

  // Check if email already exists in household
  const existingUser = await db.query.users.findFirst({
    where: and(
      eq(users.householdId, household.id),
      eq(users.email, email.toLowerCase())
    ),
  });

  if (existingUser) {
    throw Errors.duplicate('email');
  }

  // Hash password
  const passwordHash = await argon2.hash(password);

  // Create user with invite's role
  const [user] = await db
    .insert(users)
    .values({
      householdId: household.id,
      email: email.toLowerCase(),
      passwordHash,
      displayName,
      role: invite.role,
    })
    .returning();

  // Mark invite as accepted
  await db
    .update(memberInvites)
    .set({
      status: 'accepted',
      acceptedAt: new Date(),
    })
    .where(eq(memberInvites.id, invite.id));

  // Create session
  const session = await createSession(user.id, undefined, ipAddress, userAgent);

  const { passwordHash: _, ...userWithoutPassword } = user;

  logger.info({ userId: user.id, inviteId: invite.id }, 'User registered via invite');

  return {
    user: userWithoutPassword,
    session,
    household,
  };
}
