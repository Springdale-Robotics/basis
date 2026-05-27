// Natural-language date + recurrence detection for the task quick-add input.
//
// Returns suggestions the user can apply via a chip; we never rewrite the
// title automatically. The detector is purposely conservative — only fires on
// patterns we're confident about. False negatives are fine; false positives
// would re-introduce the Todoist "every! Monday" problem.

import type { RecurrenceMode } from '@/types/models';

export interface DateSuggestion {
  /** Resolved due date in the user's local timezone. */
  dueDate: Date;
  /** The substring of the input that matched, for display. */
  matchedText: string;
  /** Optional time-of-day component if the user specified one. */
  hasTime: boolean;
}

export interface RecurrenceSuggestion {
  mode: RecurrenceMode;
  /** RRULE string for 'schedule' mode. */
  rule?: string;
  /** Cadence in days for 'reset_on_complete' mode. */
  cadenceDays?: number;
  /** The substring of the input that matched, for display. */
  matchedText: string;
  /** Plain-English label for the chip. */
  label: string;
}

export interface AssigneeCandidate {
  kind: 'user' | 'group';
  id: string;
  name: string;
}

export interface AssigneeSuggestion extends AssigneeCandidate {
  /** The substring of the input that matched, for display. */
  matchedText: string;
}

export interface ParseResult {
  date?: DateSuggestion;
  recurrence?: RecurrenceSuggestion;
  assignee?: AssigneeSuggestion;
}

const WEEKDAYS = [
  ['sun', 'sunday'],
  ['mon', 'monday'],
  ['tue', 'tues', 'tuesday'],
  ['wed', 'weds', 'wednesday'],
  ['thu', 'thur', 'thurs', 'thursday'],
  ['fri', 'friday'],
  ['sat', 'saturday'],
] as const;

const RRULE_BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const MONTHS = [
  ['jan', 'january'],
  ['feb', 'february'],
  ['mar', 'march'],
  ['apr', 'april'],
  ['may'],
  ['jun', 'june'],
  ['jul', 'july'],
  ['aug', 'august'],
  ['sep', 'sept', 'september'],
  ['oct', 'october'],
  ['nov', 'november'],
  ['dec', 'december'],
] as const;

function weekdayIndex(token: string): number {
  const t = token.toLowerCase();
  return WEEKDAYS.findIndex((variants) => variants.some((v) => v === t));
}

function monthIndex(token: string): number {
  const t = token.toLowerCase();
  return MONTHS.findIndex((variants) => variants.some((v) => v === t));
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function applyTime(d: Date, hour: number, minute: number): Date {
  const x = new Date(d);
  x.setHours(hour, minute, 0, 0);
  return x;
}

interface TimeMatch {
  hour: number;
  minute: number;
  matchedText: string;
}

// Match "8pm", "8:30am", "20:00", "noon", "midnight".
function detectTime(input: string): TimeMatch | null {
  const noon = input.match(/\b(noon)\b/i);
  if (noon) return { hour: 12, minute: 0, matchedText: noon[0] };
  const midnight = input.match(/\b(midnight)\b/i);
  if (midnight) return { hour: 0, minute: 0, matchedText: midnight[0] };

  // 24h time: 14:30, 9:00
  const twentyFour = input.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (twentyFour) {
    return {
      hour: parseInt(twentyFour[1], 10),
      minute: parseInt(twentyFour[2], 10),
      matchedText: twentyFour[0],
    };
  }

  // 12h time: 8pm, 8:30am, 12pm
  const twelve = input.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i);
  if (twelve) {
    let hour = parseInt(twelve[1], 10);
    const minute = twelve[2] ? parseInt(twelve[2], 10) : 0;
    const meridiem = twelve[3].toLowerCase();
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    return { hour, minute, matchedText: twelve[0] };
  }

  return null;
}

// Month-name alternation reused by both month-day and day-month patterns.
const MONTH_PATTERN =
  'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december';

// Construct a Date and reject invalid day-of-month combinations (e.g. Feb 30)
// — JS's Date constructor silently rolls them over to the next month, which
// we never want for parsed user input.
function makeDate(
  year: number,
  monthZeroIndex: number,
  day: number,
): Date | null {
  if (monthZeroIndex < 0 || monthZeroIndex > 11 || day < 1 || day > 31) {
    return null;
  }
  const d = new Date(year, monthZeroIndex, day);
  if (d.getMonth() !== monthZeroIndex || d.getDate() !== day) return null;
  return d;
}

// Pick a year when the user didn't specify one. Uses the next occurrence
// of (month, day) from `now`.
function inferYear(now: Date, monthZeroIndex: number, day: number): number {
  return monthZeroIndex < now.getMonth() ||
    (monthZeroIndex === now.getMonth() && day < now.getDate())
    ? now.getFullYear() + 1
    : now.getFullYear();
}

// Expand a 2-digit year to a 4-digit year using a 1970 pivot (years <70 are
// 20xx, ≥70 are 19xx). For a task tracker, this means "5/10/26" → 2026 and
// "5/10/95" → 1995, which matches user intuition.
function expandTwoDigitYear(y: number): number {
  if (y >= 100) return y;
  return y < 70 ? 2000 + y : 1900 + y;
}

function detectDate(input: string, now: Date): DateSuggestion | null {
  const time = detectTime(input);

  const apply = (d: Date, matchedText: string): DateSuggestion => {
    if (time) {
      return {
        dueDate: applyTime(d, time.hour, time.minute),
        matchedText: `${matchedText} ${time.matchedText}`.trim(),
        hasTime: true,
      };
    }
    // No specific time given — default to 9am rather than midnight so the
    // task doesn't show "12:00 AM" in pickers and notifications.
    return { dueDate: applyTime(d, 9, 0), matchedText, hasTime: false };
  };

  // ----- 1. Relative phrases (today / tonight / tomorrow) -----

  const today = input.match(/\b(today)\b/i);
  if (today) return apply(now, today[0]);

  const tonight = input.match(/\b(tonight)\b/i);
  if (tonight) {
    return {
      dueDate: applyTime(now, time?.hour ?? 20, time?.minute ?? 0),
      matchedText: time ? `${tonight[0]} ${time.matchedText}` : tonight[0],
      hasTime: true,
    };
  }

  const tomorrow = input.match(/\b(tomorrow|tmrw|tmw)\b/i);
  if (tomorrow) return apply(addDays(now, 1), tomorrow[0]);

  // ----- 2. "in N days/weeks" -----

  const inN = input.match(/\bin\s+(\d+)\s+(day|days|week|weeks)\b/i);
  if (inN) {
    const n = parseInt(inN[1], 10);
    const unit = inN[2].toLowerCase().startsWith('week') ? 7 : 1;
    return apply(addDays(now, n * unit), inN[0]);
  }

  // ----- 3. ISO date YYYY-MM-DD (most specific, try first) -----

  const iso = input.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const d = makeDate(
      parseInt(iso[1], 10),
      parseInt(iso[2], 10) - 1,
      parseInt(iso[3], 10),
    );
    if (d) return apply(d, iso[0]);
  }

  // ----- 4. Slash date M/D[/YY[YY]] (US-style) -----

  const slash = input.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slash) {
    const m = parseInt(slash[1], 10) - 1;
    const day = parseInt(slash[2], 10);
    const year = slash[3]
      ? expandTwoDigitYear(parseInt(slash[3], 10))
      : inferYear(now, m, day);
    const d = makeDate(year, m, day);
    if (d) return apply(d, slash[0]);
  }

  // ----- 5. Month + day [+ year] — "May 10", "May 10th", "May 10 2028" -----
  // Run BEFORE weekday detection so "Friday May 10" picks the explicit date.

  const monthDay = input.match(
    new RegExp(
      `\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
      'i',
    ),
  );
  if (monthDay) {
    const m = monthIndex(monthDay[1]);
    const day = parseInt(monthDay[2], 10);
    const year = monthDay[3]
      ? parseInt(monthDay[3], 10)
      : inferYear(now, m, day);
    const d = makeDate(year, m, day);
    if (d) return apply(d, monthDay[0]);
  }

  // ----- 6. Day + month [+ year] — "10 May", "10th May", "10 of May" -----

  const dayMonth = input.match(
    new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${MONTH_PATTERN})(?:,?\\s+(\\d{4}))?\\b`,
      'i',
    ),
  );
  if (dayMonth) {
    const day = parseInt(dayMonth[1], 10);
    const m = monthIndex(dayMonth[2]);
    const year = dayMonth[3]
      ? parseInt(dayMonth[3], 10)
      : inferYear(now, m, day);
    const d = makeDate(year, m, day);
    if (d) return apply(d, dayMonth[0]);
  }

  // ----- 7. "next <weekday>" / "<weekday> next week" -----
  // Both phrasings mean "that weekday in next calendar week", treating Sunday
  // as the start of the week. Matches Apple Reminders / Todoist convention.

  const dateInNextWeek = (target: number): Date => {
    const dow = now.getDay(); // 0=Sun..6=Sat
    const daysToNextSunday = 7 - dow;
    return addDays(now, daysToNextSunday + target);
  };

  const nextWeekday = input.match(
    /\bnext\s+(sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
  );
  if (nextWeekday) {
    const target = weekdayIndex(nextWeekday[1]);
    if (target >= 0) return apply(dateInNextWeek(target), nextWeekday[0]);
  }

  // ----- 8. Bare weekday, optionally bumped by "next week" -----

  const hasNextWeek = /\bnext\s+week\b/i.test(input);
  const weekday = input.match(
    /\b(sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
  );
  if (weekday) {
    const target = weekdayIndex(weekday[1]);
    if (target >= 0) {
      if (hasNextWeek) {
        return apply(dateInNextWeek(target), `${weekday[0]} next week`);
      }
      const dow = now.getDay();
      let delta = target - dow;
      if (delta < 0) delta += 7;
      return apply(addDays(now, delta), weekday[0]);
    }
  }

  return null;
}

// "every" or "each" — both treated identically.
const EVERY = '(?:every|each)';

const WEEKDAY_PATTERN =
  'sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday';

const WORD_NUMERALS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

// Matches a count expressed as a digit or word numeral.
const COUNT_PATTERN = `(?:\\d+|${Object.keys(WORD_NUMERALS).join('|')})`;

function parseCount(token: string): number | null {
  const trimmed = token.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  return WORD_NUMERALS[trimmed] ?? null;
}

function weekdayLabel(idx: number): string {
  // Use the full name (last variant in each row) for display.
  const full = WEEKDAYS[idx][WEEKDAYS[idx].length - 1];
  return full[0].toUpperCase() + full.slice(1);
}

function detectRecurrence(input: string): RecurrenceSuggestion | null {
  // Order matters: more specific patterns must precede looser ones so the
  // first-match-wins logic captures the right structure.

  // "every weekend" → BYDAY=SA,SU.
  const everyWeekend = input.match(new RegExp(`\\b${EVERY}\\s+weekend\\b`, 'i'));
  if (everyWeekend) {
    return {
      mode: 'schedule',
      rule: 'FREQ=WEEKLY;BYDAY=SA,SU',
      matchedText: everyWeekend[0],
      label: 'Repeats every weekend',
    };
  }

  // "every weekday" → BYDAY=MO,TU,WE,TH,FR.
  const everyBusinessDay = input.match(
    new RegExp(`\\b${EVERY}\\s+weekday\\b`, 'i'),
  );
  if (everyBusinessDay) {
    return {
      mode: 'schedule',
      rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      matchedText: everyBusinessDay[0],
      label: 'Repeats every weekday',
    };
  }

  // Multi-weekday: "every Mon, Wed, Fri" / "every Monday and Wednesday".
  // The capture group accepts 2+ weekday tokens separated by commas or "and".
  const multiWeekdayRe = new RegExp(
    `\\b${EVERY}\\s+((?:${WEEKDAY_PATTERN})(?:\\s*(?:,|and)\\s*(?:${WEEKDAY_PATTERN}))+)\\b`,
    'i',
  );
  const multiWeekday = input.match(multiWeekdayRe);
  if (multiWeekday) {
    const tokens = multiWeekday[1]
      .split(/\s*(?:,|and)\s*/i)
      .map((t) => t.trim())
      .filter(Boolean);
    const indices = Array.from(
      new Set(
        tokens
          .map((t) => weekdayIndex(t))
          .filter((i) => i >= 0)
          // Sort so RRULE BYDAY is deterministic (SU=0 first).
          .sort((a, b) => a - b),
      ),
    );
    if (indices.length >= 2) {
      const byday = indices.map((i) => RRULE_BYDAY[i]).join(',');
      const display = indices.map((i) => weekdayLabel(i).slice(0, 3)).join(', ');
      return {
        mode: 'schedule',
        rule: `FREQ=WEEKLY;BYDAY=${byday}`,
        matchedText: multiWeekday[0],
        label: `Repeats ${display}`,
      };
    }
  }

  // "every other Monday" / "every 2 Mondays" / "every two Mondays".
  const intervalWeekdayRe = new RegExp(
    `\\b${EVERY}\\s+(other|${COUNT_PATTERN})\\s+(${WEEKDAY_PATTERN})s?\\b`,
    'i',
  );
  const intervalWeekday = input.match(intervalWeekdayRe);
  if (intervalWeekday) {
    const multToken = intervalWeekday[1].toLowerCase();
    const interval = multToken === 'other' ? 2 : parseCount(multToken);
    const idx = weekdayIndex(intervalWeekday[2]);
    if (interval !== null && interval >= 2 && idx >= 0) {
      return {
        mode: 'schedule',
        rule: `FREQ=WEEKLY;INTERVAL=${interval};BYDAY=${RRULE_BYDAY[idx]}`,
        matchedText: intervalWeekday[0],
        label:
          interval === 2
            ? `Repeats every other ${weekdayLabel(idx)}`
            : `Repeats every ${interval} weeks on ${weekdayLabel(idx)}`,
      };
    }
  }

  // "every Monday" / "every Mondays" (single weekday, optional plural).
  const everyWeekdayRe = new RegExp(
    `\\b${EVERY}\\s+(${WEEKDAY_PATTERN})s?\\b`,
    'i',
  );
  const everyWeekday = input.match(everyWeekdayRe);
  if (everyWeekday) {
    const idx = weekdayIndex(everyWeekday[1]);
    if (idx >= 0) {
      return {
        mode: 'schedule',
        rule: `FREQ=WEEKLY;BYDAY=${RRULE_BYDAY[idx]}`,
        matchedText: everyWeekday[0],
        label: `Repeats every ${weekdayLabel(idx)}`,
      };
    }
  }

  // "every other day/week/month/year" / "every 2 weeks" / "every three days".
  const intervalUnitRe = new RegExp(
    `\\b${EVERY}\\s+(other|${COUNT_PATTERN})\\s+(day|days|week|weeks|month|months|year|years)\\b`,
    'i',
  );
  const intervalUnit = input.match(intervalUnitRe);
  if (intervalUnit) {
    const multToken = intervalUnit[1].toLowerCase();
    const interval = multToken === 'other' ? 2 : parseCount(multToken);
    const unit = intervalUnit[2].toLowerCase();
    if (interval !== null && interval >= 2) {
      // Day/week intervals → reset_on_complete (rhythm semantics).
      // Month/year intervals → schedule (calendar-anchored; avoids 30-day drift).
      if (unit.startsWith('day')) {
        return {
          mode: 'reset_on_complete',
          cadenceDays: interval,
          matchedText: intervalUnit[0],
          label: `Repeats every ${interval} days after I complete it`,
        };
      }
      if (unit.startsWith('week')) {
        return {
          mode: 'reset_on_complete',
          cadenceDays: interval * 7,
          matchedText: intervalUnit[0],
          label:
            interval === 2
              ? 'Repeats every other week after I complete it'
              : `Repeats every ${interval} weeks after I complete it`,
        };
      }
      if (unit.startsWith('month')) {
        return {
          mode: 'schedule',
          rule: `FREQ=MONTHLY;INTERVAL=${interval}`,
          matchedText: intervalUnit[0],
          label:
            interval === 2
              ? 'Repeats every other month'
              : `Repeats every ${interval} months`,
        };
      }
      if (unit.startsWith('year')) {
        return {
          mode: 'schedule',
          rule: `FREQ=YEARLY;INTERVAL=${interval}`,
          matchedText: intervalUnit[0],
          label:
            interval === 2
              ? 'Repeats every other year'
              : `Repeats every ${interval} years`,
        };
      }
    }
  }

  // Bare "every day/week/month/year" → calendar-anchored schedule.
  // Putting this AFTER the interval forms means "every 2 weeks" is captured
  // first and won't fall through here.
  const bareUnitRe = new RegExp(
    `\\b${EVERY}\\s+(day|week|month|year)\\b`,
    'i',
  );
  const bareUnit = input.match(bareUnitRe);
  if (bareUnit) {
    const unit = bareUnit[1].toLowerCase();
    const freqMap: Record<string, { freq: string; label: string }> = {
      day: { freq: 'DAILY', label: 'Repeats daily' },
      week: { freq: 'WEEKLY', label: 'Repeats weekly' },
      month: { freq: 'MONTHLY', label: 'Repeats monthly' },
      year: { freq: 'YEARLY', label: 'Repeats yearly' },
    };
    const m = freqMap[unit];
    if (m) {
      return {
        mode: 'schedule',
        rule: `FREQ=${m.freq}`,
        matchedText: bareUnit[0],
        label: m.label,
      };
    }
  }

  // Bare adjective forms: "daily", "weekly", "biweekly", "monthly", "yearly", "annually".
  // The asymmetric boundary rejects a preceding hyphen ("half-yearly") and a
  // preceding word char ("biweekly" boundary already handled by alternation),
  // but allows a following hyphen ("weekly-review" still matches "weekly").
  const adjective = input.match(
    /(?<![\w-])(daily|weekly|biweekly|monthly|yearly|annually)(?!\w)/i,
  );
  if (adjective) {
    const w = adjective[1].toLowerCase();
    const map: Record<string, { rule: string; label: string }> = {
      daily: { rule: 'FREQ=DAILY', label: 'Repeats daily' },
      weekly: { rule: 'FREQ=WEEKLY', label: 'Repeats weekly' },
      biweekly: {
        rule: 'FREQ=WEEKLY;INTERVAL=2',
        label: 'Repeats every 2 weeks',
      },
      monthly: { rule: 'FREQ=MONTHLY', label: 'Repeats monthly' },
      yearly: { rule: 'FREQ=YEARLY', label: 'Repeats yearly' },
      annually: { rule: 'FREQ=YEARLY', label: 'Repeats yearly' },
    };
    const m = map[w];
    if (m) {
      return {
        mode: 'schedule',
        rule: m.rule,
        matchedText: adjective[0],
        label: m.label,
      };
    }
  }

  return null;
}

function detectAssignee(
  input: string,
  candidates: AssigneeCandidate[],
): AssigneeSuggestion | null {
  if (!candidates.length) return null;

  // `@name` (no space before required besides word-boundary) and `for <name>`
  // are the two patterns we accept. Names can be one or two words.
  const patterns: RegExp[] = [
    /@([\w][\w'-]*(?:\s+[\w][\w'-]*)?)/gi,
    /\bfor\s+([\w][\w'-]*(?:\s+[\w][\w'-]*)?)\b/gi,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(input)) !== null) {
      const query = m[1].trim().toLowerCase();
      if (!query) continue;
      // Exact case-insensitive match wins.
      const exact = candidates.find((c) => c.name.toLowerCase() === query);
      if (exact) return { ...exact, matchedText: m[0] };
      // Otherwise unique prefix match.
      const matches = candidates.filter((c) =>
        c.name.toLowerCase().startsWith(query),
      );
      if (matches.length === 1) {
        return { ...matches[0], matchedText: m[0] };
      }
    }
  }
  return null;
}

export function parseTaskInput(
  input: string,
  now: Date = new Date(),
  candidates: AssigneeCandidate[] = [],
): ParseResult {
  return {
    date: detectDate(input, now) ?? undefined,
    recurrence: detectRecurrence(input) ?? undefined,
    assignee: detectAssignee(input, candidates) ?? undefined,
  };
}

// Flip a schedule rule to its reset_on_complete equivalent, and vice versa.
// Used by the chip's mode-toggle. Returns null when the flip would be lossy —
// for instance, multi-weekday BYDAY rules and yearly/monthly schedules don't
// map cleanly onto a "days since completion" model.
export function flipRecurrenceMode(
  r: RecurrenceSuggestion,
): RecurrenceSuggestion | null {
  if (r.mode === 'schedule' && r.rule) {
    const m = r.rule.match(/FREQ=(\w+)(?:;INTERVAL=(\d+))?(?:;BYDAY=([\w,]+))?/);
    if (!m) return null;
    const freq = m[1];
    const interval = m[2] ? parseInt(m[2], 10) : 1;
    const byday = m[3];

    // Multi-day weekly rules (e.g. MO,WE,FR) and yearly/monthly rules don't
    // translate cleanly to an integer day cadence.
    if (byday && byday.includes(',')) return null;
    if (freq === 'YEARLY' || freq === 'MONTHLY') return null;

    const days =
      freq === 'DAILY' ? interval : freq === 'WEEKLY' ? interval * 7 : null;
    if (days === null) return null;
    return {
      mode: 'reset_on_complete',
      cadenceDays: days,
      matchedText: r.matchedText,
      label: `Repeats ${days} day${days === 1 ? '' : 's'} after I complete it`,
    };
  }
  if (r.mode === 'reset_on_complete' && r.cadenceDays) {
    const days = r.cadenceDays;
    let rule: string;
    let label: string;
    if (days === 1) {
      rule = 'FREQ=DAILY';
      label = 'Repeats every day';
    } else if (days % 7 === 0) {
      const weeks = days / 7;
      rule = weeks === 1 ? 'FREQ=WEEKLY' : `FREQ=WEEKLY;INTERVAL=${weeks}`;
      label = weeks === 1 ? 'Repeats weekly' : `Repeats every ${weeks} weeks`;
    } else {
      rule = `FREQ=DAILY;INTERVAL=${days}`;
      label = `Repeats every ${days} days`;
    }
    return { mode: 'schedule', rule, matchedText: r.matchedText, label };
  }
  return null;
}
