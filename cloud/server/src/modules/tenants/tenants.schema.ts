import { z } from 'zod';

export const subdomainSchema = z
  .string()
  .max(60)
  .transform((s) => s.trim().toLowerCase());

export const createTenantSchema = z.object({
  subdomain: subdomainSchema,
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;
