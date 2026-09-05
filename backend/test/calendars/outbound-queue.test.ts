import { randomUUID } from 'crypto';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Regression coverage for two bugs a reviewer caught in queueOutboundSweep
 * before this shipped — both invisible to outbound-worker.test.ts, which
 * calls processCalendarOutboundJob directly and never goes through the real
 * queue:
 *
 *  1. The job id used a colon (`calendar-outbound:<id>`), copied from the
 *     task brief. bullmq >=5.66 rejects ':' in a custom job id outright —
 *     see queueInventoryCheck's NB in jobs/index.ts. Every enqueue would
 *     have thrown, and since this call sits inside calendar-sync.worker.ts's
 *     try block right after a *successful* Google pull, the throw would
 *     have landed in that catch and reported the pull itself as failed —
 *     for every Google calendar, every hour.
 *
 *  2. The fixed job id is what serialises sweeps per calendar (BullMQ
 *     refuses to queue a second job sharing a live id), but with
 *     removeOnComplete/removeOnFail set to a retained count, a finished
 *     job's record survives and BullMQ's addStandardJob dedups a later
 *     `add()` against it too — see the queueReceiptReprocess comment in
 *     jobs/index.ts for the same trap hit before. The result: the very
 *     first sweep for a calendar runs, and every hourly enqueue after that
 *     is a silent no-op, forever.
 */

const { calendarOutboundQueue, queueOutboundSweep } = await import('../../src/jobs/index.js');

describe('queueOutboundSweep', () => {
  afterEach(async () => {
    const jobs = await calendarOutboundQueue.getJobs(['waiting', 'active', 'completed', 'failed']);
    await Promise.all(jobs.map((job) => job.remove()));
  });

  it('uses a hyphenated job id — bullmq rejects a colon in a custom id', async () => {
    const calendarId = randomUUID();

    await queueOutboundSweep(calendarId);

    const job = await calendarOutboundQueue.getJob(`calendar-outbound-${calendarId}`);
    expect(job).toBeTruthy();
    expect(job!.data).toEqual({ calendarId });
  });

  it('removes jobs immediately on settle, so a retained completed/failed job cannot swallow the next enqueue', () => {
    // Asserts the queue's actual configuration rather than driving a real
    // job through a worker to 'completed' — that would just re-prove BullMQ
    // does what its docs say. What matters here is that this queue opted in
    // to immediate removal instead of the retained-count default the brief's
    // snippet had.
    expect(calendarOutboundQueue.defaultJobOptions?.removeOnComplete).toBe(true);
    expect(calendarOutboundQueue.defaultJobOptions?.removeOnFail).toBe(true);
  });
});
