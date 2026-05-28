import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { bugReports } from '../../db/schema/index.js';
import { authMiddleware, requireAdmin } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { getAppVersion } from '../../lib/app-version.js';
import { queueBugReportDelivery } from '../../jobs/index.js';

const MAX_DESCRIPTION = 5_000;
const MAX_CONSOLE_ENTRIES = 200;
const MAX_CONSOLE_MESSAGE = 4_000;
const MAX_SCREENSHOT_BYTES = 1_500_000; // ~1.1 MB raw after base64 decode

const consoleEntrySchema = z.object({
  level: z.enum(['log', 'info', 'warn', 'error', 'unhandled', 'rejection']),
  ts: z.number(),
  message: z.string().max(MAX_CONSOLE_MESSAGE),
});

const createBugReportSchema = z.object({
  description: z.string().min(1).max(MAX_DESCRIPTION),
  url: z.string().max(2_000),
  userAgent: z.string().max(500).optional(),
  consoleLog: z.array(consoleEntrySchema).max(MAX_CONSOLE_ENTRIES).default([]),
  screenshot: z.string().max(MAX_SCREENSHOT_BYTES).optional(),
  viewport: z
    .object({
      w: z.number().int().nonnegative(),
      h: z.number().int().nonnegative(),
    })
    .optional(),
});

export async function bugReportsRoutes(app: FastifyInstance): Promise<void> {
  // Create — any authenticated user can submit
  app.post(
    '/',
    { preHandler: [authMiddleware] },
    async (request) => {
      const input = createBugReportSchema.parse(request.body);
      const version = await getAppVersion();

      const [row] = await db
        .insert(bugReports)
        .values({
          householdId: request.user!.householdId,
          userId: request.user!.id,
          description: input.description,
          url: input.url,
          userAgent: input.userAgent,
          appVersion: version,
          consoleLog: input.consoleLog,
          screenshot: input.screenshot,
          viewport: input.viewport,
        })
        .returning();

      // Fire-and-forget — the worker handles GitHub. Submission must not
      // block on network.
      await queueBugReportDelivery(row.id);

      return { success: true, data: { id: row.id, status: row.status } };
    }
  );

  // List — admin only, used by the settings page
  app.get(
    '/',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const rows = await db.query.bugReports.findMany({
        where: eq(bugReports.householdId, request.user!.householdId),
        orderBy: [desc(bugReports.createdAt)],
        limit: 200,
      });

      // Strip large fields from the list view — clients can fetch detail
      // separately if we ever add that page.
      const summarized = rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        description: r.description,
        url: r.url,
        appVersion: r.appVersion,
        status: r.status,
        githubIssueNumber: r.githubIssueNumber,
        githubIssueUrl: r.githubIssueUrl,
        lastError: r.lastError,
        attempts: r.attempts,
        createdAt: r.createdAt,
        consoleLogCount: r.consoleLog?.length ?? 0,
        hasScreenshot: !!r.screenshot,
      }));

      return { success: true, data: { reports: summarized } };
    }
  );

  // Retry — re-enqueue a previously failed report
  app.post(
    '/:id/retry',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

      const row = await db.query.bugReports.findFirst({
        where: and(
          eq(bugReports.id, id),
          eq(bugReports.householdId, request.user!.householdId)
        ),
      });
      if (!row) throw Errors.notFound('Bug report', id);

      await db
        .update(bugReports)
        .set({ status: 'pending', lastError: null, updatedAt: new Date() })
        .where(eq(bugReports.id, id));

      await queueBugReportDelivery(id);
      return { success: true, data: { id, status: 'pending' as const } };
    }
  );

  // Delete
  app.delete(
    '/:id',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

      const result = await db
        .delete(bugReports)
        .where(
          and(
            eq(bugReports.id, id),
            eq(bugReports.householdId, request.user!.householdId)
          )
        )
        .returning({ id: bugReports.id });

      if (result.length === 0) throw Errors.notFound('Bug report', id);
      return { success: true, data: { id } };
    }
  );
}
