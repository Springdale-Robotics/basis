import { Job } from 'bullmq';
import { eq, sql } from 'drizzle-orm';
import { db } from '../config/database.js';
import { bugReports, users, households } from '../db/schema/index.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import type { BugReportJobData } from './index.js';

/**
 * Bug-report delivery worker. POSTs the report to a Cloudflare Worker relay
 * which holds the GitHub PAT and creates the issue. We don't talk to GitHub
 * directly — the PAT can't ship in someone else's .env.
 */

interface RelayResponse {
  issueNumber: number;
  issueUrl: string;
}

export async function processBugReportJob(job: Job<BugReportJobData>): Promise<void> {
  const { reportId } = job.data;
  const log = logger.child({ jobId: job.id, reportId });

  const webhookUrl = config.BUG_REPORT_WEBHOOK_URL;
  if (!webhookUrl) {
    // No relay configured — leave the row pending so admin can retry once
    // BUG_REPORT_WEBHOOK_URL is set. Don't burn retry attempts on this.
    log.warn('BUG_REPORT_WEBHOOK_URL not set — leaving report pending');
    await db
      .update(bugReports)
      .set({
        lastError: 'BUG_REPORT_WEBHOOK_URL not configured on server',
        updatedAt: new Date(),
      })
      .where(eq(bugReports.id, reportId));
    return;
  }

  const report = await db.query.bugReports.findFirst({
    where: eq(bugReports.id, reportId),
  });
  if (!report) {
    log.warn('Report row not found — skipping');
    return;
  }
  if (report.status === 'sent') {
    log.info('Report already sent — skipping');
    return;
  }

  const household = await db.query.households.findFirst({
    where: eq(households.id, report.householdId),
  });
  const user = report.userId
    ? await db.query.users.findFirst({ where: eq(users.id, report.userId) })
    : null;

  await db
    .update(bugReports)
    .set({ attempts: sql`${bugReports.attempts} + 1`, updatedAt: new Date() })
    .where(eq(bugReports.id, reportId));

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'homemanager-bug-reporter',
  };
  if (config.BUG_REPORT_WEBHOOK_SECRET) {
    headers['x-bug-report-secret'] = config.BUG_REPORT_WEBHOOK_SECRET;
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      description: report.description,
      url: report.url,
      userAgent: report.userAgent,
      appVersion: report.appVersion,
      viewport: report.viewport,
      consoleLog: report.consoleLog ?? [],
      // Send a presence flag instead of the data — the relay can't embed it
      // in a GitHub issue anyway and we don't want to waste bandwidth.
      screenshot: report.screenshot ? '[present]' : null,
      householdName: household?.name ?? 'unknown',
      householdId: report.householdId,
      userName: user?.displayName ?? user?.email ?? null,
      userEmail: user?.email ?? null,
      createdAt: report.createdAt.toISOString(),
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '<no body>');
    const truncated = errText.slice(0, 2_000);
    await db
      .update(bugReports)
      .set({
        status: 'failed',
        lastError: `Relay ${res.status}: ${truncated}`,
        updatedAt: new Date(),
      })
      .where(eq(bugReports.id, reportId));
    throw new Error(`Relay ${res.status}: ${truncated}`);
  }

  const result = (await res.json()) as RelayResponse;
  await db
    .update(bugReports)
    .set({
      status: 'sent',
      githubIssueNumber: result.issueNumber,
      githubIssueUrl: result.issueUrl,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(bugReports.id, reportId));

  log.info({ issueNumber: result.issueNumber }, 'Bug report delivered via relay');
}
