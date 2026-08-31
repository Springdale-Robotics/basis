import { describe, expect, it, vi } from 'vitest';

/**
 * 2026-08-31 amendment to the phase 2 plan, "the all-day defect": Basis's own
 * form (EventForm.tsx's handleFormSubmit) stores a one-day all-day event as
 * noon-to-noon on the SAME date — an INCLUSIVE end — while Google's
 * `end.date` is EXCLUSIVE. Before this fix, createGoogleEvent/
 * updateGoogleEvent took the date portion of `event.end` as-is, so a
 * one-day event pushed as `start.date == end.date` (zero-length) and a
 * multi-day event landed a day short.
 *
 * The fix (toGoogleAllDayEndDate in google-sync.service.ts) tells the two
 * representations apart by wall-clock time: a Google-pulled end is always
 * exact UTC midnight (parsed from a date-only string), and a Basis-form end
 * is deliberately never midnight (EventForm stamps noon specifically to
 * dodge UTC-midnight day-shifting). So: already-midnight passes through
 * unchanged; anything else gets pushed out one day to become exclusive.
 *
 * This test exercises the real createGoogleEvent/updateGoogleEvent against
 * a mocked googleapis client and asserts on the exact requestBody sent —
 * the boundary is the whole point, so assert on the literal date strings,
 * not just "truthy".
 */

const insert = vi.fn();
const patch = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials(): void {}
      },
    },
    calendar: vi.fn(() => ({
      events: { insert, patch },
    })),
  },
}));

process.env.GOOGLE_CLIENT_ID ||= 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET ||= 'test-google-client-secret';

const { createGoogleEvent, updateGoogleEvent } = await import(
  '../../src/modules/calendars/google-sync.service.js'
);

describe('createGoogleEvent: all-day inclusive-to-exclusive conversion', () => {
  it('a one-day event (Basis-form noon-to-noon, same date) pushes as a one-day exclusive range', async () => {
    insert.mockReset();
    insert.mockResolvedValue({ data: { id: 'g-1', updated: '2026-09-01T12:00:00.000Z' } });

    // Basis-form origin: start === end, both noon (never midnight).
    const start = new Date('2026-09-01T12:00:00.000Z');
    const end = new Date('2026-09-01T12:00:00.000Z');

    await createGoogleEvent('token', 'cal-1', {
      summary: 'One day',
      start,
      end,
      allDay: true,
    });

    expect(insert).toHaveBeenCalledTimes(1);
    const body = insert.mock.calls[0][0].requestBody;
    expect(body.start).toEqual({ date: '2026-09-01' });
    // Exclusive end for a one-day event is the NEXT day, not the same day.
    expect(body.end).toEqual({ date: '2026-09-02' });
  });

  it('a three-day event (Basis-form inclusive last day) pushes with an exclusive end one day past the last actual day', async () => {
    insert.mockReset();
    insert.mockResolvedValue({ data: { id: 'g-2', updated: '2026-09-03T12:00:00.000Z' } });

    // Days 1-3 inclusive: start = day1 noon, end = day3 noon (inclusive).
    const start = new Date('2026-09-01T12:00:00.000Z');
    const end = new Date('2026-09-03T12:00:00.000Z');

    await createGoogleEvent('token', 'cal-1', {
      summary: 'Three days',
      start,
      end,
      allDay: true,
    });

    const body = insert.mock.calls[0][0].requestBody;
    expect(body.start).toEqual({ date: '2026-09-01' });
    // Exclusive end must be day4 — one past the last actual day (day3).
    expect(body.end).toEqual({ date: '2026-09-04' });
  });

  it('a Google-pulled row (already exclusive, exact UTC midnight) passes through unchanged', async () => {
    insert.mockReset();
    insert.mockResolvedValue({ data: { id: 'g-3', updated: '2026-09-01T00:00:00.000Z' } });

    // Google-pull origin: both start and end at exact UTC midnight; end is
    // already one day past the last actual day (a one-day event here).
    const start = new Date('2026-09-01T00:00:00.000Z');
    const end = new Date('2026-09-02T00:00:00.000Z');

    await createGoogleEvent('token', 'cal-1', {
      summary: 'Round-tripped from Google',
      start,
      end,
      allDay: true,
    });

    const body = insert.mock.calls[0][0].requestBody;
    expect(body.start).toEqual({ date: '2026-09-01' });
    // Must NOT be pushed to 2026-09-03 — it was already exclusive.
    expect(body.end).toEqual({ date: '2026-09-02' });
  });

  it('a non-all-day event is untouched by the all-day conversion', async () => {
    insert.mockReset();
    insert.mockResolvedValue({ data: { id: 'g-4', updated: null } });

    const start = new Date('2026-09-01T10:00:00.000Z');
    const end = new Date('2026-09-01T11:00:00.000Z');

    await createGoogleEvent('token', 'cal-1', {
      summary: 'Timed event',
      start,
      end,
      allDay: false,
    });

    const body = insert.mock.calls[0][0].requestBody;
    expect(body.start).toEqual({ dateTime: start.toISOString() });
    expect(body.end).toEqual({ dateTime: end.toISOString() });
  });
});

describe('updateGoogleEvent: shares the same conversion (was unguarded before this fix)', () => {
  it('a one-day update (Basis-form noon-to-noon) sends an exclusive one-day range', async () => {
    patch.mockReset();
    patch.mockResolvedValue({ data: { id: 'g-1', updated: '2026-09-01T12:00:00.000Z' } });

    const start = new Date('2026-09-05T12:00:00.000Z');
    const end = new Date('2026-09-05T12:00:00.000Z');

    await updateGoogleEvent('token', 'cal-1', 'g-1', {
      start,
      end,
      allDay: true,
    });

    const body = patch.mock.calls[0][0].requestBody;
    expect(body.start).toEqual({ date: '2026-09-05' });
    expect(body.end).toEqual({ date: '2026-09-06' });
  });

  it('a multi-day update (Basis-form inclusive last day) pushes the end out by one day', async () => {
    patch.mockReset();
    patch.mockResolvedValue({ data: { id: 'g-2', updated: '2026-09-05T12:00:00.000Z' } });

    const start = new Date('2026-09-05T12:00:00.000Z');
    const end = new Date('2026-09-07T12:00:00.000Z'); // inclusive last day = day 3 of 3

    await updateGoogleEvent('token', 'cal-1', 'g-2', {
      start,
      end,
      allDay: true,
    });

    const body = patch.mock.calls[0][0].requestBody;
    expect(body.start).toEqual({ date: '2026-09-05' });
    expect(body.end).toEqual({ date: '2026-09-08' });
  });

  it('a Google-pulled row being patched (already exclusive) is not double-shifted', async () => {
    patch.mockReset();
    patch.mockResolvedValue({ data: { id: 'g-3', updated: '2026-09-05T00:00:00.000Z' } });

    const start = new Date('2026-09-05T00:00:00.000Z');
    const end = new Date('2026-09-06T00:00:00.000Z');

    await updateGoogleEvent('token', 'cal-1', 'g-3', {
      start,
      end,
      allDay: true,
    });

    const body = patch.mock.calls[0][0].requestBody;
    expect(body.end).toEqual({ date: '2026-09-06' });
  });
});
