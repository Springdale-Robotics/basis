import { describe, expect, it } from 'vitest';
import { syncedEventUnchanged } from '../../src/modules/calendars/sync-reconcile.js';

const base = {
  title: 'Standup',
  description: null,
  location: null,
  startTime: new Date('2026-09-01T09:00:00Z'),
  endTime: new Date('2026-09-01T09:15:00Z'),
  allDay: false,
  externalId: 'g-1',
};

describe('syncedEventUnchanged with remote_updated', () => {
  it('treats a row whose remote_updated matches Google as unchanged', () => {
    const stamp = new Date('2026-08-28T12:00:00Z');
    expect(
      syncedEventUnchanged({ ...base, remoteUpdated: stamp }, { ...base, remoteUpdated: stamp })
    ).toBe(true);
  });

  it('treats a newer Google timestamp as changed even if fields look equal', () => {
    expect(
      syncedEventUnchanged(
        { ...base, remoteUpdated: new Date('2026-08-28T12:00:00Z') },
        { ...base, remoteUpdated: new Date('2026-08-28T13:00:00Z') }
      )
    ).toBe(false);
  });

  it('still detects a field change when the timestamps agree', () => {
    const stamp = new Date('2026-08-28T12:00:00Z');
    expect(
      syncedEventUnchanged(
        { ...base, remoteUpdated: stamp },
        { ...base, title: 'Standup (moved)', remoteUpdated: stamp }
      )
    ).toBe(false);
  });

  it('treats a row that has never been pulled as changed', () => {
    expect(
      syncedEventUnchanged(
        { ...base, remoteUpdated: null },
        { ...base, remoteUpdated: new Date('2026-08-28T12:00:00Z') }
      )
    ).toBe(false);
  });
});
