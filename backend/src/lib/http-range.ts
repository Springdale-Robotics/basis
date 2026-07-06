/**
 * RFC 7233 Range header parsing, shared by the file and music stream
 * endpoints. The previous inline parsing broke on suffix ranges
 * (`bytes=-500`, sent by Safari → start=NaN → createReadStream throws → 500
 * mid-playback) and never returned 416 for unsatisfiable ranges.
 */

export interface ParsedRange {
  /** Inclusive byte offsets. */
  start: number;
  end: number;
}

export type RangeResult =
  | { kind: 'full' }
  | { kind: 'range'; range: ParsedRange }
  | { kind: 'unsatisfiable' };

export function parseRangeHeader(header: string | undefined, fileSize: number): RangeResult {
  if (!header) return { kind: 'full' };

  // Only single-range byte requests are supported; anything else is ignored
  // (RFC 7233: a server MAY ignore the Range header), serving the full file.
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { kind: 'full' };

  const [, startStr, endStr] = match;
  if (startStr === '' && endStr === '') return { kind: 'full' };

  if (fileSize <= 0) return { kind: 'unsatisfiable' };

  if (startStr === '') {
    // Suffix range: last N bytes
    const suffixLength = parseInt(endStr, 10);
    if (suffixLength === 0) return { kind: 'unsatisfiable' };
    const start = Math.max(0, fileSize - suffixLength);
    return { kind: 'range', range: { start, end: fileSize - 1 } };
  }

  const start = parseInt(startStr, 10);
  if (start >= fileSize) return { kind: 'unsatisfiable' };

  const end = endStr === '' ? fileSize - 1 : Math.min(parseInt(endStr, 10), fileSize - 1);
  if (end < start) return { kind: 'full' }; // malformed — ignore the header

  return { kind: 'range', range: { start, end } };
}
