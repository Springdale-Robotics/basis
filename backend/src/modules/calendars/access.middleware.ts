import type { FastifyRequest } from 'fastify';
import { Errors } from '../../lib/errors.js';
import {
  getEffectivePermission,
} from './access.service.js';
import type { CalendarPermissionLevel } from '../../db/schema/index.js';

const LEVEL_RANK: Record<CalendarPermissionLevel, number> = {
  view_busy: 1,
  view: 2,
  edit: 3,
};

/**
 * Gate REST event handlers behind the same permission model the CalDAV server
 * uses. Reads the calendarId from the route params, looks up the effective
 * permission for the authenticated user, throws 403 if it doesn't meet the
 * required level.
 *
 * A calendar with no `calendar_access` rows is permissive by default (every
 * household member has `edit`), so this is backward compatible.
 *
 * Usage:
 *   { preHandler: [authMiddleware, requireCalendarAccess('view')] }
 *   { preHandler: [authMiddleware, requireCalendarAccess('edit')] }
 *
 * Routes must surface the calendar id on `request.params.id` or `.calendarId`.
 */
export function requireCalendarAccess(min: CalendarPermissionLevel) {
  return async (request: FastifyRequest): Promise<void> => {
    if (!request.user) throw Errors.unauthorized();
    const params = (request.params as Record<string, string> | undefined) ?? {};
    const calendarId = params.id ?? params.calendarId;
    if (!calendarId) {
      throw Errors.validation('Calendar id missing on request');
    }
    const level = await getEffectivePermission(
      request.user.id,
      request.user.householdId,
      calendarId
    );
    if (!level) {
      throw Errors.forbidden('No access to this calendar');
    }
    if (LEVEL_RANK[level] < LEVEL_RANK[min]) {
      throw Errors.forbidden(`Requires ${min} permission on this calendar`);
    }
  };
}
