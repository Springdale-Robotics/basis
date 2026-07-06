import { z } from 'zod';
import { emailSchema, passwordSchema } from '../../lib/validators.js';

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
  deviceId: z.string().uuid().optional(),
});

export const registerWithInviteSchema = z.object({
  inviteCode: z.string().length(32, 'Invalid invite code'),
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().min(1).max(255),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterWithInviteInput = z.infer<typeof registerWithInviteSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
