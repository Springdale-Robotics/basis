import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/config/database.js';
import { bugReports } from '../../src/db/schema/index.js';
import { setupRouteTest, json, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

/**
 * Cross-household isolation for the bug-report detail route (GET /:id): the
 * detail payload carries the screenshot and full console log, so household A
 * must never be able to read household B's report, and non-admins must not
 * read it at all.
 */

let ctx: RouteTestContext;
let adminA: TestUser;
let memberA: TestUser;
let adminB: TestUser;

let aReportId: string;
let bReportId: string;

async function makeReport(householdId: string, userId: string): Promise<string> {
  const [row] = await db
    .insert(bugReports)
    .values({
      householdId,
      userId,
      description: 'tenancy test report',
      url: 'https://app.test/page',
      consoleLog: [{ level: 'error', ts: 0, message: 'boom' }],
      screenshot: 'data:image/jpeg;base64,dGVzdA==',
    })
    .returning({ id: bugReports.id });
  return row.id;
}

beforeAll(async () => {
  ctx = await setupRouteTest();
  const householdA = await ctx.createHousehold('Bug Reports A');
  const householdB = await ctx.createHousehold('Bug Reports B');
  adminA = await ctx.createUser(householdA, 'admin');
  memberA = await ctx.createUser(householdA, 'member');
  adminB = await ctx.createUser(householdB, 'admin');

  aReportId = await makeReport(householdA, memberA.id);
  bReportId = await makeReport(householdB, adminB.id);
});

afterAll(async () => {
  await ctx.close();
});

describe('GET /api/v1/bug-reports/:id', () => {
  it("404s another household's report", async () => {
    const res = await adminA.fetch(`/api/v1/bug-reports/${bReportId}`);
    expect(res.status).toBe(404);
  });

  it('403s a non-admin, even within the household', async () => {
    const res = await memberA.fetch(`/api/v1/bug-reports/${aReportId}`);
    expect(res.status).toBe(403);
  });

  it("returns the own household's report with screenshot and console log", async () => {
    const res = await adminA.fetch(`/api/v1/bug-reports/${aReportId}`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.report.id).toBe(aReportId);
    expect(body.data.report.screenshot).toBe('data:image/jpeg;base64,dGVzdA==');
    expect(body.data.report.consoleLog).toHaveLength(1);
  });
});
