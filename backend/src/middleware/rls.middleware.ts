import { FastifyRequest, FastifyReply } from 'fastify';
import { sql } from '../config/database.js';
import { logger } from '../lib/logger.js';

export async function setRlsContext(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.user) {
    return;
  }

  try {
    // Set PostgreSQL session variables for RLS policies
    await sql`
      SELECT
        set_config('app.current_user_id', ${request.user.id}, true),
        set_config('app.current_household_id', ${request.user.householdId}, true),
        set_config('app.current_role', ${request.user.role}, true)
    `;

    if (request.user.deviceId) {
      await sql`
        SELECT set_config('app.current_device_id', ${request.user.deviceId}, true)
      `;
    }
  } catch (error) {
    logger.error({ error }, 'Failed to set RLS context');
    // Don't throw - let the request continue without RLS context
  }
}

export async function clearRlsContext(): Promise<void> {
  try {
    await sql`
      SELECT
        set_config('app.current_user_id', '', true),
        set_config('app.current_household_id', '', true),
        set_config('app.current_role', '', true),
        set_config('app.current_device_id', '', true)
    `;
  } catch (error) {
    logger.error({ error }, 'Failed to clear RLS context');
  }
}
