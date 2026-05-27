// Comprehensive parser test battery.
// Run: cd frontend && npx tsx scripts/test-parser.ts

import { parseTaskInput, flipRecurrenceMode } from '../src/lib/taskParser';

const NOW = new Date('2026-05-27T10:00:00');

type Expect =
  | { kind: 'date'; year?: number; month?: number; day?: number; hasTime?: boolean }
  | { kind: 'no-date' }
  | { kind: 'rec'; mode: 'schedule' | 'reset_on_complete'; rule?: string; cadence?: number }
  | { kind: 'no-rec' }
  | { kind: 'both' };

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function check(input: string, expect: Expect): string {
  const r = parseTaskInput(input, NOW);
  switch (expect.kind) {
    case 'date': {
      if (!r.date) return `❌ "${input}" — expected date, got none`;
      const d = r.date.dueDate;
      if (expect.year !== undefined && d.getFullYear() !== expect.year)
        return `❌ "${input}" — year ${d.getFullYear()} ≠ ${expect.year}`;
      if (expect.month !== undefined && d.getMonth() + 1 !== expect.month)
        return `❌ "${input}" — month ${d.getMonth() + 1} ≠ ${expect.month}`;
      if (expect.day !== undefined && d.getDate() !== expect.day)
        return `❌ "${input}" — day ${d.getDate()} ≠ ${expect.day}`;
      if (expect.hasTime !== undefined && r.date.hasTime !== expect.hasTime)
        return `⚠️  "${input}" — hasTime mismatch (got ${r.date.hasTime})`;
      return `✅ "${input}" → ${ymd(d)}${r.date.hasTime ? ' ' + d.toLocaleTimeString() : ''}  (matched "${r.date.matchedText}")`;
    }
    case 'no-date':
      return r.date
        ? `❌ "${input}" — expected NO date, got ${ymd(r.date.dueDate)} (matched "${r.date.matchedText}")`
        : `✅ "${input}" → no date (good)`;
    case 'rec': {
      if (!r.recurrence) return `❌ "${input}" — expected recurrence, got none`;
      if (r.recurrence.mode !== expect.mode)
        return `❌ "${input}" — mode mismatch (got ${r.recurrence.mode})`;
      if (expect.rule && r.recurrence.rule !== expect.rule)
        return `❌ "${input}" — got "${r.recurrence.rule}", expected "${expect.rule}"`;
      if (expect.cadence !== undefined && r.recurrence.cadenceDays !== expect.cadence)
        return `❌ "${input}" — cadence ${r.recurrence.cadenceDays} ≠ ${expect.cadence}`;
      return `✅ "${input}" → ${r.recurrence.mode === 'schedule' ? r.recurrence.rule : r.recurrence.cadenceDays + 'd'}`;
    }
    case 'no-rec':
      return r.recurrence
        ? `❌ "${input}" — expected NO recurrence, got ${r.recurrence.mode === 'schedule' ? r.recurrence.rule : r.recurrence.cadenceDays + 'd'} (matched "${r.recurrence.matchedText}")`
        : `✅ "${input}" → no recurrence (good)`;
    case 'both': {
      const lines: string[] = [];
      lines.push(r.date ? `   date: ${ymd(r.date.dueDate)}` : `   ❌ no date`);
      lines.push(
        r.recurrence
          ? `   rec:  ${r.recurrence.mode === 'schedule' ? r.recurrence.rule : r.recurrence.cadenceDays + 'd'}`
          : `   ❌ no rec`,
      );
      return `🔬 "${input}"\n${lines.join('\n')}`;
    }
  }
}

function section(title: string) {
  console.log(`\n${'═'.repeat(70)}\n${title}\n${'═'.repeat(70)}`);
}

// ============================================================
section('DATE — basic patterns');
// ============================================================
[
  ['today', { kind: 'date', year: 2026, month: 5, day: 27 }],
  ['tomorrow', { kind: 'date', year: 2026, month: 5, day: 28 }],
  ['tonight', { kind: 'date', year: 2026, month: 5, day: 27, hasTime: true }],
  ['in 3 days', { kind: 'date', year: 2026, month: 5, day: 30 }],
  ['in 2 weeks', { kind: 'date', year: 2026, month: 6, day: 10 }],
  ['next monday', { kind: 'date', year: 2026, month: 6, day: 1 }],
  ['friday', { kind: 'date', year: 2026, month: 5, day: 29 }],
  ['May 10', { kind: 'date', year: 2027, month: 5, day: 10 }],
  ['Mar 12', { kind: 'date', year: 2027, month: 3, day: 12 }],
  ['Jun 1', { kind: 'date', year: 2026, month: 6, day: 1 }],
  ['8pm', { kind: 'no-date' }],
  ['tomorrow 8pm', { kind: 'date', year: 2026, month: 5, day: 28, hasTime: true }],
  ['5pm tomorrow', { kind: 'date', year: 2026, month: 5, day: 28, hasTime: true }],
  ['friday 5pm', { kind: 'date', year: 2026, month: 5, day: 29, hasTime: true }],
  ['noon', { kind: 'no-date' }],
  ['today at noon', { kind: 'date', year: 2026, month: 5, day: 27, hasTime: true }],
].forEach(([i, e]) => console.log(check(i as string, e as Expect)));

// ============================================================
section('DATE — Tier 2 fixes: ordinals, day-month order, numeric');
// ============================================================
[
  ['May 10th', { kind: 'date', year: 2027, month: 5, day: 10 }],
  ['May 1st', { kind: 'date', year: 2027, month: 5, day: 1 }],
  ['Jan 2nd', { kind: 'date', year: 2027, month: 1, day: 2 }],
  ['Mar 3rd', { kind: 'date', year: 2027, month: 3, day: 3 }],
  ['10 May', { kind: 'date', year: 2027, month: 5, day: 10 }],
  ['10th May', { kind: 'date', year: 2027, month: 5, day: 10 }],
  ['10 of May', { kind: 'date', year: 2027, month: 5, day: 10 }],
  ['10th of May', { kind: 'date', year: 2027, month: 5, day: 10 }],
  ['5/10', { kind: 'date', year: 2027, month: 5, day: 10 }],
  ['5/10/27', { kind: 'date', year: 2027, month: 5, day: 10 }],
  ['5/10/2027', { kind: 'date', year: 2027, month: 5, day: 10 }],
  ['12/25/2026', { kind: 'date', year: 2026, month: 12, day: 25 }],
  ['2027-05-10', { kind: 'date', year: 2027, month: 5, day: 10 }],
].forEach(([i, e]) => console.log(check(i as string, e as Expect)));

// ============================================================
section('DATE — Tier 3 fixes: explicit year');
// ============================================================
[
  ['May 10 2028', { kind: 'date', year: 2028, month: 5, day: 10 }],
  ['May 10, 2028', { kind: 'date', year: 2028, month: 5, day: 10 }],
  ['May 10 2020', { kind: 'date', year: 2020, month: 5, day: 10 }],
  ['10 May 2028', { kind: 'date', year: 2028, month: 5, day: 10 }],
  ['10th May 2028', { kind: 'date', year: 2028, month: 5, day: 10 }],
  ['March 15, 2030', { kind: 'date', year: 2030, month: 3, day: 15 }],
].forEach(([i, e]) => console.log(check(i as string, e as Expect)));

// ============================================================
section('DATE — Tier 1 fixes: day-of-month validation, explicit beats implicit');
// ============================================================
[
  ['Feb 30', { kind: 'no-date' }],
  ['Apr 31', { kind: 'no-date' }],
  ['Feb 29 2027', { kind: 'no-date' }], // 2027 is not a leap year
  ['Feb 29 2028', { kind: 'date', year: 2028, month: 2, day: 29 }], // 2028 is a leap year
  ['May 32', { kind: 'no-date' }],
  ['Friday May 10', { kind: 'date', year: 2027, month: 5, day: 10 }], // explicit beats implicit
  ['Friday next week', { kind: 'date', year: 2026, month: 6, day: 5 }], // next-week bump
  ['Monday next week', { kind: 'date', year: 2026, month: 6, day: 1 }], // next-week bump
].forEach(([i, e]) => console.log(check(i as string, e as Expect)));

// ============================================================
section('DATE — false-positive checks (still must NOT match)');
// ============================================================
[
  ['maybe later', { kind: 'no-date' }],
  ['mayor election', { kind: 'no-date' }],
  ['contact May about the project', { kind: 'no-date' }],
  ['marching band', { kind: 'no-date' }],
  ['my fridge', { kind: 'no-date' }],
  ['wedding venue', { kind: 'no-date' }],
  ['monetary policy', { kind: 'no-date' }],
  ['suntan lotion', { kind: 'no-date' }],
  ['tomorrows news', { kind: 'no-date' }],
  ['fries with that', { kind: 'no-date' }],
  ['April fools', { kind: 'no-date' }],
  ['Mark wedding anniversary', { kind: 'no-date' }],
  ['Buy gifts for May\'s birthday', { kind: 'no-date' }],
].forEach(([i, e]) => console.log(check(i as string, e as Expect)));

// ============================================================
section('DATE — new patterns: false-positive risks');
// ============================================================
[
  // Day-month order can collide with bare numbers. Acceptable tradeoffs:
  ['buy 10 oranges', { kind: 'no-date' }],     // "oranges" has no month substr at boundary
  ['buy 10 octopuses', { kind: 'no-date' }],   // "octopuses" — "oct" lacks trailing boundary
  ['10 melons', { kind: 'no-date' }],
  // Known leak: "10 mars bars" — but `\bmar\b` requires boundary, "mars" fails
  ['10 mars bars', { kind: 'no-date' }],
  // Numeric slash false positives:
  ['7/10 score', { kind: 'date', year: 2026, month: 7, day: 10 }], // accepted — user must X-dismiss
  // ISO-shaped numbers that aren't dates:
  ['build 2027-05-10 binary', { kind: 'date', year: 2027, month: 5, day: 10 }], // accepted (rare phrasing)
].forEach(([i, e]) => console.log(check(i as string, e as Expect)));

// ============================================================
section('RECURRENCE — all working patterns');
// ============================================================
[
  ['every Monday', { kind: 'rec', mode: 'schedule', rule: 'FREQ=WEEKLY;BYDAY=MO' }],
  ['every Mon', { kind: 'rec', mode: 'schedule', rule: 'FREQ=WEEKLY;BYDAY=MO' }],
  ['every Mondays', { kind: 'rec', mode: 'schedule', rule: 'FREQ=WEEKLY;BYDAY=MO' }], // R1
  ['each Monday', { kind: 'rec', mode: 'schedule', rule: 'FREQ=WEEKLY;BYDAY=MO' }],
  ['every weekday', { kind: 'rec', mode: 'schedule', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }],
  ['every weekend', { kind: 'rec', mode: 'schedule', rule: 'FREQ=WEEKLY;BYDAY=SA,SU' }],
  ['every Mon, Wed, Fri', { kind: 'rec', mode: 'schedule', rule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' }],
  ['every Monday and Friday', { kind: 'rec', mode: 'schedule', rule: 'FREQ=WEEKLY;BYDAY=MO,FR' }],
  ['every other Monday', { kind: 'rec', mode: 'schedule', rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO' }],
  ['every 2 Mondays', { kind: 'rec', mode: 'schedule', rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO' }],
  ['every two Mondays', { kind: 'rec', mode: 'schedule', rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO' }],
  ['every day', { kind: 'rec', mode: 'schedule', rule: 'FREQ=DAILY' }],
  ['every week', { kind: 'rec', mode: 'schedule', rule: 'FREQ=WEEKLY' }],
  ['every month', { kind: 'rec', mode: 'schedule', rule: 'FREQ=MONTHLY' }],
  ['every year', { kind: 'rec', mode: 'schedule', rule: 'FREQ=YEARLY' }],
  ['every 3 days', { kind: 'rec', mode: 'reset_on_complete', cadence: 3 }],
  ['every other week', { kind: 'rec', mode: 'reset_on_complete', cadence: 14 }],
  ['every 2 months', { kind: 'rec', mode: 'schedule', rule: 'FREQ=MONTHLY;INTERVAL=2' }],
  ['every 2 years', { kind: 'rec', mode: 'schedule', rule: 'FREQ=YEARLY;INTERVAL=2' }],
  ['daily', { kind: 'rec', mode: 'schedule', rule: 'FREQ=DAILY' }],
  ['weekly', { kind: 'rec', mode: 'schedule', rule: 'FREQ=WEEKLY' }],
  ['biweekly', { kind: 'rec', mode: 'schedule', rule: 'FREQ=WEEKLY;INTERVAL=2' }],
  ['monthly', { kind: 'rec', mode: 'schedule', rule: 'FREQ=MONTHLY' }],
  ['yearly', { kind: 'rec', mode: 'schedule', rule: 'FREQ=YEARLY' }],
  ['annually', { kind: 'rec', mode: 'schedule', rule: 'FREQ=YEARLY' }],
].forEach(([i, e]) => console.log(check(i as string, e as Expect)));

// ============================================================
section('RECURRENCE — false-positive checks');
// ============================================================
[
  ['weekly newspaper', { kind: 'rec', mode: 'schedule' }], // accepted tradeoff
  ['everyday objects', { kind: 'no-rec' }],
  ['Mayday Mayday', { kind: 'no-rec' }],
  ['eventually do it', { kind: 'no-rec' }],
  ['half-yearly report', { kind: 'no-rec' }], // R2 fix
  ['quarter-yearly', { kind: 'no-rec' }],     // same lookbehind
  ['weekly-review', { kind: 'rec', mode: 'schedule' }], // allowed (asymmetric boundary)
  ['Cozy interior', { kind: 'no-rec' }],
].forEach(([i, e]) => console.log(check(i as string, e as Expect)));

// ============================================================
section('CROSS-DETECTOR');
// ============================================================
[
  'Renew passport by May 12',
  'Renew passport by May 12th',
  'Renew passport by 5/12',
  'Take out trash every Tuesday',
  'Pay rent monthly on the 1st',
  'Call mom every Sunday at 5pm',
  'Water plants every 3 days',
  'every Monday in May',
  'every Friday next week',
  'Friday May 10',
  'Anniversary May 10 2028',
].forEach((i) => console.log(check(i, { kind: 'both' })));

// ============================================================
section('FLIP — verify locked cases');
// ============================================================
[
  'every Monday',
  'every Mon, Wed, Fri',
  'every month',
  'every year',
  'every other Monday',
  'every 3 days',
  'biweekly',
].forEach((c) => {
  const r = parseTaskInput(c).recurrence;
  if (!r) {
    console.log(`${c.padEnd(28)} : no recurrence`);
    return;
  }
  const f = flipRecurrenceMode(r);
  const orig = r.mode === 'schedule' ? r.rule : `${r.cadenceDays}d`;
  const flipped = f
    ? f.mode === 'schedule'
      ? f.rule
      : `${f.cadenceDays}d`
    : '🔒 LOCKED';
  console.log(`${c.padEnd(28)} ${(orig ?? '').padEnd(35)} → ${flipped}`);
});
