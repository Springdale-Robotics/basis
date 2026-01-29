import type { ParsedListContent, ParsedListItem } from '../../../db/schema/image-parse.js';

interface RawListData {
  title?: string;
  items?: Array<{
    content?: string;
    text?: string;
    isChecked?: boolean;
    checked?: boolean;
    dueDate?: string;
    due?: string;
    confidence?: number;
  }>;
  suggestedListType?: string;
  type?: string;
}

/**
 * Normalize and validate extracted list content
 */
export function normalizeListContent(raw: unknown): ParsedListContent {
  const data = raw as RawListData;

  const items: ParsedListItem[] = [];

  if (Array.isArray(data.items)) {
    for (const item of data.items) {
      const content = item.content || item.text || '';
      if (!content.trim()) continue;

      items.push({
        content: content.trim(),
        isChecked: item.isChecked ?? item.checked ?? false,
        dueDate: normalizeDate(item.dueDate || item.due),
        confidence: Math.min(1, Math.max(0, item.confidence ?? 0.8)),
      });
    }
  }

  // Determine list type from content
  let suggestedType: 'checklist' | 'reminder' | 'notes' = 'checklist';

  const rawType = data.suggestedListType || data.type || '';
  if (rawType.toLowerCase().includes('reminder')) {
    suggestedType = 'reminder';
  } else if (rawType.toLowerCase().includes('notes')) {
    suggestedType = 'notes';
  } else {
    // Heuristics: if items have due dates, suggest reminder
    const hasDateItems = items.some((i) => i.dueDate);
    if (hasDateItems) {
      suggestedType = 'reminder';
    }
  }

  return {
    title: data.title?.trim(),
    items,
    suggestedListType: suggestedType,
  };
}

/**
 * Parse list content from raw text (fallback when AI extraction fails)
 */
export function parseListFromText(rawText: string): ParsedListContent {
  const lines = rawText.split('\n').filter((l) => l.trim());
  const items: ParsedListItem[] = [];

  // Pattern for checkbox-style items
  const checkboxPattern = /^[\s]*(\[[ x]\]|☐|☑|✓|✗|•|[-*])\s*/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 2) continue;

    // Skip if it looks like a header (all caps, ends with colon)
    if (trimmed === trimmed.toUpperCase() && trimmed.length < 30) continue;
    if (trimmed.endsWith(':') && trimmed.length < 30) continue;

    let content = trimmed;
    let isChecked = false;

    // Check for checkbox patterns
    const checkboxMatch = trimmed.match(checkboxPattern);
    if (checkboxMatch) {
      content = trimmed.slice(checkboxMatch[0].length).trim();
      const marker = checkboxMatch[1].toLowerCase();
      isChecked = marker.includes('x') || marker.includes('☑') || marker.includes('✓');
    } else {
      // Remove numbered list markers
      content = content.replace(/^\d+[\.\)]\s*/, '');
    }

    if (content.length > 0) {
      items.push({
        content,
        isChecked,
        confidence: 0.7, // Lower confidence for text-only parsing
      });
    }
  }

  // Try to extract a title from the first line if it looks like one
  let title: string | undefined;
  if (items.length > 0 && lines[0]) {
    const firstLine = lines[0].trim();
    // If first line doesn't have bullet/checkbox and is short, it might be a title
    if (!checkboxPattern.test(firstLine) && firstLine.length < 50 && !firstLine.includes(',')) {
      title = firstLine;
      // Remove it from items if it was added
      if (items[0]?.content === title) {
        items.shift();
      }
    }
  }

  return {
    title,
    items,
    suggestedListType: 'checklist',
  };
}

/**
 * Normalize date string to ISO format
 */
function normalizeDate(dateStr?: string): string | undefined {
  if (!dateStr) return undefined;

  try {
    // Try parsing as ISO date
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }

    // Try common formats
    // MM/DD/YYYY or MM-DD-YYYY
    const usFormat = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (usFormat) {
      const month = parseInt(usFormat[1]);
      const day = parseInt(usFormat[2]);
      let year = parseInt(usFormat[3]);
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
