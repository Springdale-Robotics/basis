import { z } from 'zod';

export const emailSchema = z
  .string()
  .email('Enter a valid email address')
  .max(255)
  .transform((s) => s.trim().toLowerCase());

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200);

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;
