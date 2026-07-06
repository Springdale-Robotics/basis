import rruleLib from 'rrule';
import type { Frequency as RRuleFrequency, Weekday as RRuleWeekday } from 'rrule';
const { RRule, RRuleSet, rrulestr, Frequency } = rruleLib;
import type { calendarEvents } from '../../db/schema/index.js';

// Infer CalendarEvent type from the schema
type CalendarEvent = typeof calendarEvents.$inferSelect;

/**
 * RFC 5545 Recurrence Options for building RRULE strings
 */
export interface RecurrenceOptions {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;           // Every N days/weeks/months/years

  // Termination
  endType?: 'never' | 'until' | 'count';
  until?: Date;                // End date
  count?: number;              // Number of occurrences

  // Weekly options
  byDay?: string[];            // ['MO', 'TU', 'WE', ...] for weekly

  // Monthly options
  monthlyType?: 'dayOfMonth' | 'dayOfWeek';  // "15th" vs "3rd Tuesday"
  byMonthDay?: number;         // Day of month (1-31)
  bySetPos?: number;           // Position (-1 = last, 1 = first, etc.)
}

/**
 * Expanded instance representing a single occurrence of a recurring event
 */
export interface ExpandedInstance {
  date: Date;
  endDate: Date;
  isException: boolean;
  isCancelled: boolean;
  exceptionEvent?: CalendarEvent;
}

/**
 * Virtual calendar event instance
 */
export interface VirtualInstance extends Omit<CalendarEvent, 'id'> {
  id: string;                  // Composite ID: masterId_timestamp
  isVirtualInstance: true;
  masterId: string;
  instanceDate: Date;
}

// Map RRULE frequency constants to our frequency strings
const FREQUENCY_MAP: Record<number, 'daily' | 'weekly' | 'monthly' | 'yearly'> = {
  [Frequency.DAILY]: 'daily',
  [Frequency.WEEKLY]: 'weekly',
  [Frequency.MONTHLY]: 'monthly',
  [Frequency.YEARLY]: 'yearly',
};

const REVERSE_FREQUENCY_MAP: Record<string, RRuleFrequency> = {
  'daily': Frequency.DAILY,
  'weekly': Frequency.WEEKLY,
  'monthly': Frequency.MONTHLY,
  'yearly': Frequency.YEARLY,
};

// Day name mapping
const DAY_MAP: Record<string, number> = {
  'MO': RRule.MO.weekday,
  'TU': RRule.TU.weekday,
  'WE': RRule.WE.weekday,
  'TH': RRule.TH.weekday,
  'FR': RRule.FR.weekday,
  'SA': RRule.SA.weekday,
  'SU': RRule.SU.weekday,
};

const WEEKDAY_OBJECTS: RRuleWeekday[] = [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA, RRule.SU];

/**
 * Parse an RRULE string into structured options
 */
export function parseRRule(rruleString: string): RecurrenceOptions | null {
  if (!rruleString) return null;

  try {
    const rule = rrulestr(rruleString);
    const options = rule.options;

    const result: RecurrenceOptions = {
      frequency: FREQUENCY_MAP[options.freq] || 'daily',
      interval: options.interval || 1,
    };

    // Termination
    if (options.until) {
      result.endType = 'until';
      result.until = options.until;
    } else if (options.count) {
      result.endType = 'count';
      result.count = options.count;
    } else {
      result.endType = 'never';
    }

    // Weekly by day
    if (options.byweekday && options.byweekday.length > 0) {
      result.byDay = options.byweekday.map((wd) => {
        // wd can be a number (0-6) or a Weekday object
        const dayNum = typeof wd === 'number' ? wd : (wd as RRuleWeekday).weekday;
        const days = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
        return days[dayNum];
      });
    }

    // Monthly options
    if (options.bymonthday && options.bymonthday.length > 0) {
      result.monthlyType = 'dayOfMonth';
      result.byMonthDay = options.bymonthday[0];
    } else if (options.bysetpos && options.bysetpos.length > 0) {
      result.monthlyType = 'dayOfWeek';
      result.bySetPos = options.bysetpos[0];
    }

    return result;
  } catch (e) {
    console.error('Failed to parse RRULE:', rruleString, e);
    return null;
  }
}

/**
 * Build an RRULE string from UI options
 */
export function buildRRule(options: RecurrenceOptions, dtstart: Date): string {
  const ruleOptions: {
    freq: RRuleFrequency;
    interval: number;
    dtstart: Date;
    until?: Date;
    count?: number;
    byweekday?: RRuleWeekday[];
    bymonthday?: number[];
    bysetpos?: number[];
  } = {
    freq: REVERSE_FREQUENCY_MAP[options.frequency],
    interval: options.interval || 1,
    dtstart,
  };

  // Termination
  if (options.endType === 'until' && options.until) {
    ruleOptions.until = options.until;
  } else if (options.endType === 'count' && options.count) {
    ruleOptions.count = options.count;
  }

  // Weekly by day
  if (options.byDay && options.byDay.length > 0 && options.frequency === 'weekly') {
    ruleOptions.byweekday = options.byDay.map(day => {
      const dayIndex = DAY_MAP[day];
      return WEEKDAY_OBJECTS[dayIndex];
    });
  }

  // Monthly options
  if (options.frequency === 'monthly') {
    if (options.monthlyType === 'dayOfMonth' && options.byMonthDay) {
      ruleOptions.bymonthday = [options.byMonthDay];
    } else if (options.monthlyType === 'dayOfWeek' && options.byDay && options.bySetPos) {
      // e.g., "3rd Tuesday" => byweekday=[TU], bysetpos=[3]
      ruleOptions.byweekday = options.byDay.map(day => WEEKDAY_OBJECTS[DAY_MAP[day]]);
      ruleOptions.bysetpos = [options.bySetPos];
    }
  }

  const rule = new RRule(ruleOptions);
  return rule.toString().replace('RRULE:', '');
}

/**
 * Parse JSON string of dates into Date array
 */
export function parseExDates(exDatesJson: string | null): Date[] {
  if (!exDatesJson) return [];
  try {
    const dates = JSON.parse(exDatesJson);
    return dates.map((d: string) => new Date(d));
  } catch {
    return [];
  }
}

/**
 * Parse JSON string of dates into Date array (for RDATE)
 */
export function parseRDates(rDatesJson: string | null): Date[] {
  if (!rDatesJson) return [];
  try {
    const dates = JSON.parse(rDatesJson);
    return dates.map((d: string) => new Date(d));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Timezone helpers
//
// `rrule` computes in UTC only, but recurrence is a wall-clock concept: a
// "weekly on Monday, 8 PM" event in Los Angeles is Tuesday 04:00 UTC, so a
// UTC expansion recurs on the wrong local day and every occurrence shifts an
// hour across DST. We expand in "fake UTC" — the event's wall-clock time in
// the calendar timezone re-labeled as UTC — then convert each occurrence back
// to a real instant.
// ---------------------------------------------------------------------------

/** Offset (ms) of `tz` from UTC at the given instant. Invalid tz → 0 (UTC). */
function tzOffsetMs(tz: string, atUtc: Date): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const parts: Record<string, string> = {};
    for (const p of dtf.formatToParts(atUtc)) parts[p.type] = p.value;
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      parts.hour === '24' ? 0 : Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    return asUtc - atUtc.getTime();
  } catch {
    return 0;
  }
}

/** Re-label a real instant as its wall-clock time in `tz`, expressed as UTC. */
function toFakeUtc(real: Date, tz: string): Date {
  return new Date(real.getTime() + tzOffsetMs(tz, real));
}

/** Inverse of toFakeUtc: wall-clock-as-UTC back to the real instant in `tz`. */
function fromFakeUtc(fake: Date, tz: string): Date {
  // First guess uses the offset at the fake instant; re-derive once so DST
  // transitions land on the correct side.
  let real = new Date(fake.getTime() - tzOffsetMs(tz, fake));
  real = new Date(fake.getTime() - tzOffsetMs(tz, real));
  return real;
}

/** Calendar-date key of an instant in `tz` (for legacy day-granular matching). */
function localDayKey(date: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().split('T')[0];
  }
}

/**
 * Check if an occurrence is in the exclusion list (EXDATE). Exact-instant
 * match first; falls back to same-local-day so exclusions recorded before
 * expansion was timezone-aware keep working.
 */
export function isExcluded(date: Date, exDates: Date[], timezone = 'UTC'): boolean {
  return exDates.some(exDate =>
    exDate.getTime() === date.getTime() ||
    localDayKey(exDate, timezone) === localDayKey(date, timezone)
  );
}

/**
 * Find exception event for a given instance date. Exact-instant match first,
 * with the same legacy local-day fallback as isExcluded.
 */
export function findException(
  instanceDate: Date,
  exceptions: CalendarEvent[],
  timezone = 'UTC'
): CalendarEvent | undefined {
  const exact = exceptions.find(
    ex => ex.originalStartTime &&
      new Date(ex.originalStartTime).getTime() === instanceDate.getTime()
  );
  if (exact) return exact;

  const dayKey = localDayKey(instanceDate, timezone);
  return exceptions.find(ex => {
    if (!ex.originalStartTime) return false;
    return localDayKey(new Date(ex.originalStartTime), timezone) === dayKey;
  });
}

/**
 * Expand a recurring event to instances within a date range.
 *
 * `timezone` is the calendar's IANA timezone — the frame the recurrence rule
 * is anchored to. Defaults to UTC, which preserves old behavior for callers
 * that don't pass it.
 */
export function expandRecurrence(
  masterEvent: CalendarEvent,
  rangeStart: Date,
  rangeEnd: Date,
  exceptions: CalendarEvent[] = [],
  timezone = 'UTC'
): ExpandedInstance[] {
  if (!masterEvent.recurrenceRule) return [];

  const instances: ExpandedInstance[] = [];
  const realStart = new Date(masterEvent.startTime);
  const duration = new Date(masterEvent.endTime).getTime() - realStart.getTime();

  try {
    const rruleSet = new RRuleSet();

    // Expand in the calendar timezone's wall-clock frame (see helpers above).
    const dtstart = toFakeUtc(realStart, timezone);
    const mainRule = rrulestr(masterEvent.recurrenceRule, { dtstart });
    rruleSet.rrule(mainRule);

    // Pad the range by a day on each side: the fake-UTC frame can differ from
    // real UTC by up to ±14h, and we filter precisely after converting back.
    const DAY = 24 * 60 * 60 * 1000;
    const fakeOccurrences = rruleSet.between(
      new Date(toFakeUtc(rangeStart, timezone).getTime() - DAY),
      new Date(toFakeUtc(rangeEnd, timezone).getTime() + DAY),
      true
    );

    // Convert to real instants and filter to the requested range.
    let occurrences = fakeOccurrences
      .map(fake => fromFakeUtc(fake, timezone))
      .filter(d => d >= rangeStart && d <= rangeEnd);

    // EXDATE: stored as real instants; applied here (not via rruleSet) so
    // matching is instant/local-day-based rather than fake-UTC-based.
    const exDates = parseExDates(masterEvent.recurrenceExDates ?? null);
    if (exDates.length > 0) {
      occurrences = occurrences.filter(d => !isExcluded(d, exDates, timezone));
    }

    // RDATE: extra real instants, added directly.
    const rDates = parseRDates(masterEvent.recurrenceRDates ?? null);
    for (const rd of rDates) {
      if (rd >= rangeStart && rd <= rangeEnd && !occurrences.some(o => o.getTime() === rd.getTime())) {
        occurrences.push(rd);
      }
    }
    occurrences.sort((a, b) => a.getTime() - b.getTime());

    for (const date of occurrences) {
      const exception = findException(date, exceptions, timezone);

      if (exception && exception.recurrenceStatus === 'cancelled') {
        // Instance was cancelled, skip it
        instances.push({
          date,
          endDate: new Date(date.getTime() + duration),
          isException: true,
          isCancelled: true,
          exceptionEvent: exception,
        });
      } else if (exception) {
        // Instance was modified
        instances.push({
          date,
          endDate: new Date(date.getTime() + duration),
          isException: true,
          isCancelled: false,
          exceptionEvent: exception,
        });
      } else {
        // Regular instance
        instances.push({
          date,
          endDate: new Date(date.getTime() + duration),
          isException: false,
          isCancelled: false,
        });
      }
    }
  } catch (e) {
    console.error('Failed to expand recurrence:', e);
  }

  return instances;
}

/**
 * Create a virtual instance from a master event and instance date
 */
export function createVirtualInstance(
  masterEvent: CalendarEvent,
  instanceDate: Date
): VirtualInstance {
  const duration = new Date(masterEvent.endTime).getTime() - new Date(masterEvent.startTime).getTime();
  const endDate = new Date(instanceDate.getTime() + duration);

  // Generate composite ID: masterId_timestamp
  const instanceId = `${masterEvent.id}_${instanceDate.getTime()}`;

  return {
    ...masterEvent,
    id: instanceId,
    startTime: instanceDate,
    endTime: endDate,
    isVirtualInstance: true,
    masterId: masterEvent.id,
    instanceDate,
  } as VirtualInstance;
}

/**
 * Generate human-readable summary of recurrence rule
 */
export function getRecurrenceSummary(rruleString: string, startDate: Date): string {
  if (!rruleString) return '';

  const options = parseRRule(rruleString);
  if (!options) return 'Custom recurrence';

  const parts: string[] = [];
  const interval = options.interval || 1;

  // Frequency
  switch (options.frequency) {
    case 'daily':
      parts.push(interval === 1 ? 'Every day' : `Every ${interval} days`);
      break;
    case 'weekly':
      if (options.byDay && options.byDay.length > 0) {
        const dayNames = options.byDay.map(d => {
          const dayMap: Record<string, string> = {
            'MO': 'Monday', 'TU': 'Tuesday', 'WE': 'Wednesday',
            'TH': 'Thursday', 'FR': 'Friday', 'SA': 'Saturday', 'SU': 'Sunday'
          };
          return dayMap[d] || d;
        });

        if (interval === 1) {
          if (dayNames.length === 5 &&
              options.byDay?.includes('MO') && options.byDay?.includes('TU') &&
              options.byDay?.includes('WE') && options.byDay?.includes('TH') &&
              options.byDay?.includes('FR')) {
            parts.push('Every weekday');
          } else {
            parts.push(`Weekly on ${dayNames.join(', ')}`);
          }
        } else {
          parts.push(`Every ${interval} weeks on ${dayNames.join(', ')}`);
        }
      } else {
        parts.push(interval === 1 ? 'Every week' : `Every ${interval} weeks`);
      }
      break;
    case 'monthly':
      if (options.monthlyType === 'dayOfWeek' && options.bySetPos && options.byDay) {
        const posNames: Record<number, string> = {
          1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', [-1]: 'last'
        };
        const dayMap: Record<string, string> = {
          'MO': 'Monday', 'TU': 'Tuesday', 'WE': 'Wednesday',
          'TH': 'Thursday', 'FR': 'Friday', 'SA': 'Saturday', 'SU': 'Sunday'
        };
        const posName = posNames[options.bySetPos] || `${options.bySetPos}th`;
        const dayName = dayMap[options.byDay[0]] || options.byDay[0];
        parts.push(interval === 1
          ? `Monthly on the ${posName} ${dayName}`
          : `Every ${interval} months on the ${posName} ${dayName}`);
      } else {
        const day = options.byMonthDay || startDate.getDate();
        parts.push(interval === 1
          ? `Monthly on the ${day}${getOrdinalSuffix(day)}`
          : `Every ${interval} months on the ${day}${getOrdinalSuffix(day)}`);
      }
      break;
    case 'yearly': {
      const month = startDate.toLocaleString('default', { month: 'long' });
      const day = startDate.getDate();
      parts.push(interval === 1
        ? `Every year on ${month} ${day}`
        : `Every ${interval} years on ${month} ${day}`);
      break;
    }
  }

  // Termination
  if (options.endType === 'until' && options.until) {
    parts.push(`until ${options.until.toLocaleDateString()}`);
  } else if (options.endType === 'count' && options.count) {
    parts.push(`for ${options.count} occurrence${options.count !== 1 ? 's' : ''}`);
  }

  return parts.join(' ');
}

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

/**
 * Add an EXDATE to exclude a single occurrence
 */
export function addExDate(
  currentExDates: string | null,
  dateToExclude: Date
): string {
  const existing = parseExDates(currentExDates);
  existing.push(dateToExclude);
  return JSON.stringify(existing.map(d => d.toISOString()));
}

/**
 * Truncate RRULE with UNTIL for "this and following" deletion
 */
export function truncateRRule(rruleString: string, untilDate: Date): string {
  if (!rruleString) return rruleString;

  try {
    const rule = rrulestr(rruleString);
    const options = { ...rule.options };

    // Remove COUNT if present, add UNTIL
    const newOptions = {
      ...options,
      count: undefined,
      until: untilDate,
    };

    const newRule = new RRule(newOptions);
    return newRule.toString().replace('RRULE:', '');
  } catch (e) {
    console.error('Failed to truncate RRULE:', e);
    return rruleString;
  }
}

/**
 * Convert simple preset values to RRULE strings
 */
export function presetToRRule(preset: string, dtstart: Date): string | null {
  switch (preset) {
    case 'none':
      return null;
    case 'daily':
      return buildRRule({ frequency: 'daily', interval: 1 }, dtstart);
    case 'weekly':
      return buildRRule({ frequency: 'weekly', interval: 1 }, dtstart);
    case 'biweekly':
      return buildRRule({ frequency: 'weekly', interval: 2 }, dtstart);
    case 'monthly':
      return buildRRule({ frequency: 'monthly', interval: 1 }, dtstart);
    case 'yearly':
      return buildRRule({ frequency: 'yearly', interval: 1 }, dtstart);
    case 'weekdays':
      return buildRRule({
        frequency: 'weekly',
        interval: 1,
        byDay: ['MO', 'TU', 'WE', 'TH', 'FR'],
      }, dtstart);
    default:
      // Assume it's already an RRULE string
      if (preset.includes('FREQ=')) {
        return preset;
      }
      return null;
  }
}

/**
 * Parse instance ID to get master event ID and instance timestamp
 */
export function parseInstanceId(instanceId: string): { masterId: string; timestamp: number } | null {
  const parts = instanceId.split('_');
  if (parts.length < 2) return null;

  const timestamp = parseInt(parts[parts.length - 1], 10);
  if (isNaN(timestamp)) return null;

  const masterId = parts.slice(0, -1).join('_');
  return { masterId, timestamp };
}

/**
 * Check if an event is a recurring master event
 */
export function isRecurringMaster(event: CalendarEvent): boolean {
  return !!event.recurrenceRule && event.recurrenceStatus !== 'exception' && event.recurrenceStatus !== 'cancelled';
}

/**
 * Check if an event is an exception instance
 */
export function isException(event: CalendarEvent): boolean {
  return event.recurrenceStatus === 'exception' || event.recurrenceStatus === 'cancelled';
}
