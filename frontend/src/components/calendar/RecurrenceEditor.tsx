import { useEffect, useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { format } from 'date-fns';

export interface RecurrenceOptions {
  frequency: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  endType: 'never' | 'until' | 'count';
  until?: string;
  count?: number;
  byDay?: string[];
  monthlyType?: 'dayOfMonth' | 'dayOfWeek';
  byMonthDay?: number;
  bySetPos?: number;
}

interface RecurrenceEditorProps {
  value: RecurrenceOptions;
  onChange: (options: RecurrenceOptions) => void;
  startDate: Date;
}

const DAYS_OF_WEEK = [
  { value: 'MO', label: 'Mon' },
  { value: 'TU', label: 'Tue' },
  { value: 'WE', label: 'Wed' },
  { value: 'TH', label: 'Thu' },
  { value: 'FR', label: 'Fri' },
  { value: 'SA', label: 'Sat' },
  { value: 'SU', label: 'Sun' },
];

const ORDINAL_POSITIONS = [
  { value: 1, label: 'First' },
  { value: 2, label: 'Second' },
  { value: 3, label: 'Third' },
  { value: 4, label: 'Fourth' },
  { value: -1, label: 'Last' },
];

export function RecurrenceEditor({ value, onChange, startDate }: RecurrenceEditorProps) {
  // Calculate default day of week from startDate
  const defaultDayOfWeek = useMemo(() => {
    const dayIndex = startDate.getDay();
    const dayMap = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    return dayMap[dayIndex];
  }, [startDate]);

  // Calculate default position in month (1st, 2nd, 3rd, 4th, or last)
  const defaultPosition = useMemo(() => {
    const dayOfMonth = startDate.getDate();
    const weekOfMonth = Math.ceil(dayOfMonth / 7);
    return weekOfMonth <= 4 ? weekOfMonth : -1;
  }, [startDate]);

  const updateOption = <K extends keyof RecurrenceOptions>(
    key: K,
    val: RecurrenceOptions[K]
  ) => {
    onChange({ ...value, [key]: val });
  };

  const toggleDay = (day: string) => {
    const currentDays = value.byDay || [];
    if (currentDays.includes(day)) {
      updateOption('byDay', currentDays.filter(d => d !== day));
    } else {
      updateOption('byDay', [...currentDays, day]);
    }
  };

  // Initialize byDay for weekly frequency if not set
  useEffect(() => {
    if (value.frequency === 'weekly' && (!value.byDay || value.byDay.length === 0)) {
      updateOption('byDay', [defaultDayOfWeek]);
    }
  }, [value.frequency, defaultDayOfWeek]);

  if (value.frequency === 'none') {
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          <Label>Repeat</Label>
          <Select
            value={value.frequency}
            onValueChange={(v) => updateOption('frequency', v as RecurrenceOptions['frequency'])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Does not repeat</SelectItem>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="yearly">Yearly</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Frequency and Interval */}
      <div className="flex gap-3 items-end">
        <div className="flex-1 space-y-2">
          <Label>Repeat every</Label>
          <div className="flex gap-2">
            <Input
              type="number"
              min={1}
              max={99}
              value={value.interval}
              onChange={(e) => updateOption('interval', parseInt(e.target.value) || 1)}
              className="w-20"
            />
            <Select
              value={value.frequency}
              onValueChange={(v) => updateOption('frequency', v as RecurrenceOptions['frequency'])}
            >
              <SelectTrigger className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Does not repeat</SelectItem>
                <SelectItem value="daily">{value.interval === 1 ? 'day' : 'days'}</SelectItem>
                <SelectItem value="weekly">{value.interval === 1 ? 'week' : 'weeks'}</SelectItem>
                <SelectItem value="monthly">{value.interval === 1 ? 'month' : 'months'}</SelectItem>
                <SelectItem value="yearly">{value.interval === 1 ? 'year' : 'years'}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Weekly: Day selection */}
      {value.frequency === 'weekly' && (
        <div className="space-y-2">
          <Label>Repeat on</Label>
          <div className="flex gap-1 flex-wrap">
            {DAYS_OF_WEEK.map((day) => (
              <Button
                key={day.value}
                type="button"
                variant={value.byDay?.includes(day.value) ? 'default' : 'outline'}
                size="sm"
                className="w-11"
                onClick={() => toggleDay(day.value)}
              >
                {day.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Monthly: Day of month vs Day of week */}
      {value.frequency === 'monthly' && (
        <div className="space-y-3">
          <Label>Repeat on</Label>
          <RadioGroup
            value={value.monthlyType || 'dayOfMonth'}
            onValueChange={(v: string) => updateOption('monthlyType', v as 'dayOfMonth' | 'dayOfWeek')}
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="dayOfMonth" id="dayOfMonth" />
              <Label htmlFor="dayOfMonth" className="flex items-center gap-2">
                Day
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={value.byMonthDay || startDate.getDate()}
                  onChange={(e) => updateOption('byMonthDay', parseInt(e.target.value) || 1)}
                  className="w-16"
                  disabled={value.monthlyType === 'dayOfWeek'}
                />
                of the month
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="dayOfWeek" id="dayOfWeek" />
              <Label htmlFor="dayOfWeek" className="flex items-center gap-2">
                The
                <Select
                  value={String(value.bySetPos || defaultPosition)}
                  onValueChange={(v) => updateOption('bySetPos', parseInt(v))}
                  disabled={value.monthlyType !== 'dayOfWeek'}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORDINAL_POSITIONS.map((pos) => (
                      <SelectItem key={pos.value} value={String(pos.value)}>
                        {pos.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={value.byDay?.[0] || defaultDayOfWeek}
                  onValueChange={(v) => updateOption('byDay', [v])}
                  disabled={value.monthlyType !== 'dayOfWeek'}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS_OF_WEEK.map((day) => (
                      <SelectItem key={day.value} value={day.value}>
                        {day.label === 'Mon' ? 'Monday' :
                         day.label === 'Tue' ? 'Tuesday' :
                         day.label === 'Wed' ? 'Wednesday' :
                         day.label === 'Thu' ? 'Thursday' :
                         day.label === 'Fri' ? 'Friday' :
                         day.label === 'Sat' ? 'Saturday' : 'Sunday'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
            </div>
          </RadioGroup>
        </div>
      )}

      {/* End condition */}
      <div className="space-y-3">
        <Label>Ends</Label>
        <RadioGroup
          value={value.endType}
          onValueChange={(v: string) => updateOption('endType', v as 'never' | 'until' | 'count')}
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="never" id="endNever" />
            <Label htmlFor="endNever">Never</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="until" id="endUntil" />
            <Label htmlFor="endUntil" className="flex items-center gap-2">
              On
              <Input
                type="date"
                value={value.until || format(new Date(), 'yyyy-MM-dd')}
                onChange={(e) => updateOption('until', e.target.value)}
                className="w-40"
                disabled={value.endType !== 'until'}
              />
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="count" id="endCount" />
            <Label htmlFor="endCount" className="flex items-center gap-2">
              After
              <Input
                type="number"
                min={1}
                max={999}
                value={value.count || 10}
                onChange={(e) => updateOption('count', parseInt(e.target.value) || 1)}
                className="w-20"
                disabled={value.endType !== 'count'}
              />
              occurrences
            </Label>
          </div>
        </RadioGroup>
      </div>
    </div>
  );
}

/**
 * Generate a human-readable summary of recurrence options
 */
export function getRecurrenceSummary(options: RecurrenceOptions, startDate: Date): string {
  if (options.frequency === 'none') return 'Does not repeat';

  const parts: string[] = [];
  const interval = options.interval || 1;

  switch (options.frequency) {
    case 'daily':
      parts.push(interval === 1 ? 'Every day' : `Every ${interval} days`);
      break;
    case 'weekly':
      if (options.byDay && options.byDay.length > 0) {
        const dayNames = options.byDay.map(d => {
          const map: Record<string, string> = {
            'MO': 'Monday', 'TU': 'Tuesday', 'WE': 'Wednesday',
            'TH': 'Thursday', 'FR': 'Friday', 'SA': 'Saturday', 'SU': 'Sunday'
          };
          return map[d] || d;
        });
        if (interval === 1) {
          if (options.byDay.length === 5 &&
              options.byDay.includes('MO') && options.byDay.includes('TU') &&
              options.byDay.includes('WE') && options.byDay.includes('TH') &&
              options.byDay.includes('FR')) {
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
          1: 'first', 2: 'second', 3: 'third', 4: 'fourth', [-1]: 'last'
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
        const suffix = getOrdinalSuffix(day);
        parts.push(interval === 1
          ? `Monthly on the ${day}${suffix}`
          : `Every ${interval} months on the ${day}${suffix}`);
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

  if (options.endType === 'until' && options.until) {
    parts.push(`until ${new Date(options.until).toLocaleDateString()}`);
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
 * Convert RecurrenceOptions to RRULE string
 */
export function optionsToRRule(options: RecurrenceOptions, startDate: Date): string | null {
  if (options.frequency === 'none') return null;

  const parts: string[] = [];

  // Frequency
  parts.push(`FREQ=${options.frequency.toUpperCase()}`);

  // Interval
  if (options.interval && options.interval > 1) {
    parts.push(`INTERVAL=${options.interval}`);
  }

  // Weekly by day
  if (options.frequency === 'weekly' && options.byDay && options.byDay.length > 0) {
    parts.push(`BYDAY=${options.byDay.join(',')}`);
  }

  // Monthly options
  if (options.frequency === 'monthly') {
    if (options.monthlyType === 'dayOfWeek' && options.bySetPos && options.byDay) {
      parts.push(`BYDAY=${options.bySetPos}${options.byDay[0]}`);
    } else if (options.byMonthDay) {
      parts.push(`BYMONTHDAY=${options.byMonthDay}`);
    }
  }

  // End condition
  if (options.endType === 'until' && options.until) {
    // Parse the date string and set to end of day in UTC
    // options.until is 'YYYY-MM-DD' format from date input
    const [year, month, day] = options.until.split('-').map(Number);
    const untilDate = new Date(Date.UTC(year, month - 1, day, 23, 59, 59));
    const untilStr = untilDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    parts.push(`UNTIL=${untilStr}`);
  } else if (options.endType === 'count' && options.count) {
    parts.push(`COUNT=${options.count}`);
  }

  return parts.join(';');
}

/**
 * Parse RRULE string to RecurrenceOptions
 */
export function parseRRule(rruleString: string | null | undefined): RecurrenceOptions {
  const defaultOptions: RecurrenceOptions = {
    frequency: 'none',
    interval: 1,
    endType: 'never',
  };

  if (!rruleString) return defaultOptions;

  // Handle preset strings
  const presets: Record<string, RecurrenceOptions> = {
    'daily': { ...defaultOptions, frequency: 'daily' },
    'weekly': { ...defaultOptions, frequency: 'weekly' },
    'biweekly': { ...defaultOptions, frequency: 'weekly', interval: 2 },
    'monthly': { ...defaultOptions, frequency: 'monthly' },
    'yearly': { ...defaultOptions, frequency: 'yearly' },
  };

  if (presets[rruleString]) {
    return presets[rruleString];
  }

  // Parse RRULE format
  if (!rruleString.includes('FREQ=')) {
    return defaultOptions;
  }

  const result: RecurrenceOptions = { ...defaultOptions };

  // Parse each component
  const parts = rruleString.split(';');
  for (const part of parts) {
    const [key, value] = part.split('=');
    switch (key) {
      case 'FREQ':
        const freqMap: Record<string, RecurrenceOptions['frequency']> = {
          'DAILY': 'daily',
          'WEEKLY': 'weekly',
          'MONTHLY': 'monthly',
          'YEARLY': 'yearly',
        };
        result.frequency = freqMap[value] || 'none';
        break;
      case 'INTERVAL':
        result.interval = parseInt(value) || 1;
        break;
      case 'BYDAY':
        // Handle both weekly (MO,TU) and monthly (2MO) formats
        if (/^-?\d/.test(value)) {
          // Monthly format: 2MO, -1FR
          const match = value.match(/^(-?\d)(\w{2})$/);
          if (match) {
            result.monthlyType = 'dayOfWeek';
            result.bySetPos = parseInt(match[1]);
            result.byDay = [match[2]];
          }
        } else {
          // Weekly format: MO,TU,WE
          result.byDay = value.split(',');
        }
        break;
      case 'BYMONTHDAY':
        result.monthlyType = 'dayOfMonth';
        result.byMonthDay = parseInt(value);
        break;
      case 'UNTIL':
        result.endType = 'until';
        // Parse RRULE date format: 20251231T235959Z
        const year = value.substring(0, 4);
        const month = value.substring(4, 6);
        const day = value.substring(6, 8);
        result.until = `${year}-${month}-${day}`;
        break;
      case 'COUNT':
        result.endType = 'count';
        result.count = parseInt(value);
        break;
    }
  }

  return result;
}

export default RecurrenceEditor;
