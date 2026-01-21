import rruleLib from 'rrule';
const { RRule, RRuleSet, rrulestr, Frequency, Weekday } = rruleLib;
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

const REVERSE_FREQUENCY_MAP: Record<string, Frequency> = {
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

const WEEKDAY_OBJECTS: Weekday[] = [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA, RRule.SU];

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
        const dayNum = typeof wd === 'number' ? wd : (wd as Weekday).weekday;
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
    freq: Frequency;
    interval: number;
    dtstart: Date;
    until?: Date;
    count?: number;
    byweekday?: Weekday[];
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

/**
 * Check if a date is in the exclusion list (EXDATE)
 */
export function isExcluded(date: Date, exDates: Date[]): boolean {
  const dateStr = date.toISOString().split('T')[0];
  return exDates.some(exDate => {
    return exDate.toISOString().split('T')[0] === dateStr;
  });
}

/**
 * Find exception event for a given instance date
 */
export function findException(
  instanceDate: Date,
  exceptions: CalendarEvent[]
): CalendarEvent | undefined {
  const dateStr = instanceDate.toISOString().split('T')[0];
  return exceptions.find(ex => {
    if (!ex.originalStartTime) return false;
    const exDateStr = new Date(ex.originalStartTime).toISOString().split('T')[0];
    return exDateStr === dateStr;
  });
}

/**
 * Expand a recurring event to instances within a date range
 */
export function expandRecurrence(
  masterEvent: CalendarEvent,
  rangeStart: Date,
  rangeEnd: Date,
  exceptions: CalendarEvent[] = []
): ExpandedInstance[] {
  if (!masterEvent.recurrenceRule) return [];

  const instances: ExpandedInstance[] = [];
  const dtstart = new Date(masterEvent.startTime);
  const duration = new Date(masterEvent.endTime).getTime() - dtstart.getTime();

  try {
    // Create RRuleSet to handle EXDATE/RDATE
    const rruleSet = new RRuleSet();

    // Add main rule - rrulestr needs the full RRULE with dtstart to respect UNTIL/COUNT
    const mainRule = rrulestr(masterEvent.recurrenceRule, { dtstart });
    rruleSet.rrule(mainRule);

    // Add EXDATE (excluded dates)
    const exDates = parseExDates(masterEvent.recurrenceExDates ?? null);
    exDates.forEach(date => rruleSet.exdate(date));

    // Add RDATE (additional dates)
    const rDates = parseRDates(masterEvent.recurrenceRDates ?? null);
    rDates.forEach(date => rruleSet.rdate(date));

    // Get occurrences within range
    const occurrences = rruleSet.between(rangeStart, rangeEnd, true);

    for (const date of occurrences) {
      const exception = findException(date, exceptions);

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
    case 'yearly':
      const month = startDate.toLocaleString('default', { month: 'long' });
      const day = startDate.getDate();
      parts.push(interval === 1
        ? `Every year on ${month} ${day}`
        : `Every ${interval} years on ${month} ${day}`);
      break;
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
