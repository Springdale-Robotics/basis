/**
 * Ring buffer that captures recent console output and unhandled errors so a
 * user-submitted bug report can include surrounding context. Install once
 * from main.tsx; safe to call multiple times (idempotent).
 */

export type ConsoleLogLevel = 'log' | 'info' | 'warn' | 'error' | 'unhandled' | 'rejection';

export interface ConsoleLogEntry {
  level: ConsoleLogLevel;
  ts: number;
  message: string;
}

const MAX_ENTRIES = 100;
const MAX_MESSAGE_LEN = 4_000;

const buffer: ConsoleLogEntry[] = [];
let installed = false;

function safeStringify(value: unknown): string {
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) {
    return String(value);
  }
  try {
    const seen = new WeakSet();
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[circular]';
        seen.add(v);
      }
      return v;
    });
  } catch {
    return '[unserializable]';
  }
}

function push(level: ConsoleLogLevel, args: unknown[]): void {
  const message = args.map(safeStringify).join(' ').slice(0, MAX_MESSAGE_LEN);
  buffer.push({ level, ts: Date.now(), message });
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
}

export function installConsoleBuffer(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const levels = ['log', 'info', 'warn', 'error'] as const;
  for (const level of levels) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      push(level, args);
      original(...args);
    };
  }

  window.addEventListener('error', (event) => {
    const detail = event.error?.stack || event.message || 'unknown error';
    push('unhandled', [`${detail} (${event.filename}:${event.lineno}:${event.colno})`]);
  });

  window.addEventListener('unhandledrejection', (event) => {
    push('rejection', [event.reason]);
  });
}

export function getConsoleBuffer(): ConsoleLogEntry[] {
  return buffer.slice();
}

export function clearConsoleBuffer(): void {
  buffer.length = 0;
}
