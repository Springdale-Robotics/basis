import type { ParsedCalendarContent, ParsedCalendarEvent } from '../../../db/schema/image-parse.js';

interface RawCalendarData {
  events?: Array<{
    title?: string;
    name?: string;
    event?: string;
    description?: string;
    notes?: string;
    location?: string;
    place?: string;
    startTime?: string;
    start?: string;
    date?: string;
    time?: string;
    endTime?: string;
    end?: string;
    allDay?: boolean;
    isAllDay?: boolean;
    recurrenceHint?: string;
    recurrence?: string;
    recurring?: string;
    confidence?: number;
  }>;
}

/**
 * Normalize and validate extracted calendar content
 */
export function normalizeCalendarContent(raw: unknown): ParsedCalendarContent {
  const data = raw as RawCalendarData;
  const events: ParsedCalendarEvent[] = [];

  if (Array.isArray(data.events)) {
    for (const evt of data.events) {
      const title = (evt.title || evt.name || evt.event || 'Untitled Event').trim();
      if (!title || title === 'Untitled Event' && !evt.startTime && !evt.start && !evt.date) {
        continue;
      }

      // Parse start time
      let startTime = parseDateTime(evt.startTime || evt.start || evt.date, evt.time);
      let endTime = parseDateTime(evt.endTime || evt.end);

      // Determine if all-day
      let allDay = evt.allDay ?? evt.isAllDay ?? false;

      // If we only have a date (no time), it's likely all-day
      if (startTime && !startTime.includes('T')) {
        allDay = true;
        // For all-day events, just store the date
      } else if (startTime && allDay) {
        // Strip time from all-day events
        startTime = startTime.split('T')[0];
        endTime = endTime?.split('T')[0];
      }

      events.push({
        title,
        description: (evt.description || evt.notes || '').trim() || undefined,
        location: (evt.location || evt.place || '').trim() || undefined,
        startTime,
        endTime,
        allDay,
        recurrenceHint: (evt.recurrenceHint || evt.recurrence || evt.recurring || '').trim() || undefined,
        confidence: Math.min(1, Math.max(0, evt.confidence ?? 0.8)),
      });
    }
  }

  return { events };
}

/**
 * Parse calendar events from raw text (fallback when AI extraction fails)
 */
export function parseCalendarFromText(rawText: string): ParsedCalendarContent {
  const lines = rawText.split('\n').filter((l) => l.trim());
  const events: ParsedCalendarEvent[] = [];

  // Patterns to match dates and times
  const datePatterns = [
    /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/, // MM/DD/YYYY or similar
    /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?/i,
  ];

  const timePattern = /(\d{1,2}):(\d{2})\s*(am|pm)?/i;

  let currentDate: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Try to extract date from line
    let foundDate: string | undefined;
    for (const pattern of datePatterns) {
      const match = trimmed.match(pattern);
      if (match) {
        foundDate = parseDateFromMatch(match);
        if (foundDate) {
          currentDate = foundDate;
          break;
        }
      }
    }

    // Try to extract time
    const timeMatch = trimmed.match(timePattern);
    let foundTime: string | undefined;
    if (timeMatch) {
      foundTime = parseTimeFromMatch(timeMatch);
    }

    // If we found a date/time, this might be an event
    if (foundDate || foundTime || currentDate) {
      // Try to extract event title (everything before the date/time or after)
      let title = extractEventTitle(trimmed);

      if (title && title.length > 2) {
        const startTime = formatDateTime(foundDate || currentDate, foundTime);

        events.push({
          title,
          startTime,
          allDay: !foundTime,
          confidence: 0.6,
        });
      }
    }
  }

  return { events };
}

/**
 * Parse a date/time string into ISO format
 */
function parseDateTime(dateStr?: string, timeStr?: string): string | undefined {
  if (!dateStr) return undefined;

  try {
    // If it's already ISO format, return as-is
    if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/.test(dateStr)) {
      return dateStr;
    }

    // Try to parse with built-in Date
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      if (timeStr) {
        // Parse and add time
        const timeParsed = parseTimeString(timeStr);
        if (timeParsed) {
          date.setHours(timeParsed.hours, timeParsed.minutes);
          return date.toISOString().slice(0, 19);
        }
      }
      // Check if original string had time component
      if (dateStr.includes(':') || dateStr.toLowerCase().includes('am') || dateStr.toLowerCase().includes('pm')) {
        return date.toISOString().slice(0, 19);
      }
      return date.toISOString().split('T')[0];
    }

    // Try common formats
    // MM/DD/YYYY
    const usMatch = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (usMatch) {
      const month = parseInt(usMatch[1]);
      const day = parseInt(usMatch[2]);
      let year = parseInt(usMatch[3]);
      if (year < 100) year += 2000;

      const parsed = new Date(year, month - 1, day);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().split('T')[0];
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parse a time string into hours and minutes
 */
function parseTimeString(timeStr: string): { hours: number; minutes: number } | undefined {
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!match) return undefined;

  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const meridiem = match[3]?.toLowerCase();

  if (meridiem === 'pm' && hours !== 12) {
    hours += 12;
  } else if (meridiem === 'am' && hours === 12) {
    hours = 0;
  }

  return { hours, minutes };
}

/**
 * Parse date from regex match groups
 */
function parseDateFromMatch(match: RegExpMatchArray): string | undefined {
  const input = match[0];

  // YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return input;
  }

  // MM/DD/YYYY or similar
  const numericMatch = input.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (numericMatch) {
    const month = parseInt(numericMatch[1]);
    const day = parseInt(numericMatch[2]);
    let year = parseInt(numericMatch[3]);
    if (year < 100) year += 2000;

    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // Day of week - resolve to next occurrence
  const dayOfWeek = input.toLowerCase();
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayIndex = days.indexOf(dayOfWeek);
  if (dayIndex >= 0) {
    const today = new Date();
    const currentDay = today.getDay();
    let daysToAdd = dayIndex - currentDay;
    if (daysToAdd <= 0) daysToAdd += 7;

    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysToAdd);
    return targetDate.toISOString().split('T')[0];
  }

  // Month name format (e.g., "January 15, 2024")
  const months = ['january', 'february', 'march', 'april', 'may', 'june',
                  'july', 'august', 'september', 'october', 'november', 'december'];
  for (let i = 0; i < months.length; i++) {
    if (input.toLowerCase().includes(months[i])) {
      const dayMatch = input.match(/(\d{1,2})/);
      const yearMatch = input.match(/(\d{4})/);

      const day = dayMatch ? parseInt(dayMatch[1]) : 1;
      const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();

      return `${year}-${String(i + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return undefined;
}

/**
 * Parse time from regex match groups
 */
function parseTimeFromMatch(match: RegExpMatchArray): string | undefined {
  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const meridiem = match[3]?.toLowerCase();

  if (meridiem === 'pm' && hours !== 12) {
    hours += 12;
  } else if (meridiem === 'am' && hours === 12) {
    hours = 0;
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Format date and time into ISO datetime string
 */
function formatDateTime(date?: string, time?: string): string | undefined {
  if (!date) return undefined;

  if (time) {
    return `${date}T${time}:00`;
  }

  return date;
}

/**
 * Extract event title from a line containing date/time
 */
function extractEventTitle(line: string): string {
  // Remove date patterns
  let title = line
    .replace(/\d{4}-\d{2}-\d{2}/g, '')
    .replace(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/g, '')
    .replace(/\d{1,2}:\d{2}\s*(am|pm)?/gi, '')
    .replace(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/gi, '')
    .replace(/(january|february|march|april|may|june|july|august|september|october|november|december)\s*\d{1,2}(st|nd|rd|th)?/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\-\*•:,]\s*/, '')
    .replace(/[\-\*•:,]\s*$/, '')
    .trim();

  return title;
}
