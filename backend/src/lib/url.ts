import type { FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import { households } from '../db/schema/index.js';
import type { HouseholdSettings } from '../db/schema/households.js';

/**
 * Derive the canonical base URL for outbound links (ICS feeds, CalDAV PROPFIND
 * hrefs, OAuth callbacks, share URLs).
 *
 * Resolution order:
 *  1. household.settings.remoteAccess.publicUrl — operator-configured per topology
 *  2. request.protocol + request.hostname — honors X-Forwarded-* via Fastify trustProxy
 *
 * Returns the base with no trailing slash (e.g. "https://example.com").
 * Operators behind non-standard ports must set publicUrl explicitly — Fastify's
 * hostname extraction does not include the port.
 */
export async function getCanonicalUrl(
  request: FastifyRequest,
  householdId?: string,
): Promise<string> {
  if (householdId) {
    const household = await db.query.households.findFirst({
      where: eq(households.id, householdId),
      columns: { settings: true },
    });
    const publicUrl = (household?.settings as HouseholdSettings | undefined)
      ?.remoteAccess?.publicUrl;
    if (publicUrl) {
      return publicUrl.replace(/\/+$/, '');
    }
  }
  return `${request.protocol}://${request.hostname}`;
}
