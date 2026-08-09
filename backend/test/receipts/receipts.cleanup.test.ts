import { randomUUID } from 'crypto';
import { mkdir, writeFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/config/database.js';
import { households, users, receiptScans } from '../../src/db/schema/index.js';
import { processCleanupJob } from '../../src/jobs/cleanup.worker.js';

const workDir = join(tmpdir(), 'basis-receipt-cleanup-test');
let householdId: string;
let userId: string;

async function seedScan(opts: {
  status: 'review' | 'confirmed';
  ageDays: number;
  imagePath: string | null;
}): Promise<string> {
  const when = new Date(Date.now() - opts.ageDays * 24 * 60 * 60 * 1000);
  const [scan] = await db
    .insert(receiptScans)
    .values({
      householdId,
      scannedBy: userId,
      status: opts.status,
      imagePath: opts.imagePath,
      createdAt: when,
      updatedAt: when,
      confirmedAt: opts.status === 'confirmed' ? when : null,
    })
    .returning({ id: receiptScans.id });
  return scan.id;
}

async function makeImage(name: string): Promise<string> {
  const path = join(workDir, name);
  await writeFile(path, 'fake image bytes');
  return path;
}

beforeAll(async () => {
  await mkdir(workDir, { recursive: true });
  householdId = randomUUID();
  userId = randomUUID();
  await db.insert(households).values({ id: householdId, name: `Cleanup ${householdId.slice(0, 8)}` });
  await db.insert(users).values({
    id: userId,
    householdId,
    email: `${userId}@test.local`,
    displayName: 'Cleaner',
    passwordHash: 'x',
    role: 'admin',
  });
});

afterAll(async () => {
  await db.delete(households).where(eq(households.id, householdId));
});

describe('old_receipt_scans cleanup', () => {
  it('deletes the image of a long-confirmed scan but keeps the record', async () => {
    const imagePath = await makeImage('confirmed-old.jpg');
    const scanId = await seedScan({ status: 'confirmed', ageDays: 30, imagePath });

    await processCleanupJob({ id: 'test', data: { type: 'old_receipt_scans' } } as never);

    await expect(access(imagePath)).rejects.toThrow();
    const scan = await db.query.receiptScans.findFirst({ where: eq(receiptScans.id, scanId) });
    expect(scan).toBeDefined();
    expect(scan?.imagePath).toBeNull();
  });

  it('keeps the image of a recently confirmed scan', async () => {
    const imagePath = await makeImage('confirmed-new.jpg');
    await seedScan({ status: 'confirmed', ageDays: 1, imagePath });

    await processCleanupJob({ id: 'test', data: { type: 'old_receipt_scans' } } as never);

    await expect(access(imagePath)).resolves.toBeUndefined();
  });

  it('deletes an abandoned review outright', async () => {
    const imagePath = await makeImage('abandoned.jpg');
    const scanId = await seedScan({ status: 'review', ageDays: 45, imagePath });

    await processCleanupJob({ id: 'test', data: { type: 'old_receipt_scans' } } as never);

    const scan = await db.query.receiptScans.findFirst({ where: eq(receiptScans.id, scanId) });
    expect(scan).toBeUndefined();
    await expect(access(imagePath)).rejects.toThrow();
  });

  it('leaves a review from yesterday alone', async () => {
    const scanId = await seedScan({ status: 'review', ageDays: 1, imagePath: null });

    await processCleanupJob({ id: 'test', data: { type: 'old_receipt_scans' } } as never);

    const scan = await db.query.receiptScans.findFirst({ where: eq(receiptScans.id, scanId) });
    expect(scan).toBeDefined();
  });
});
