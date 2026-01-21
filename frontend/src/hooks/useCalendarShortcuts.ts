import { useEffect, useCallback, useRef } from 'react';

export interface CalendarShortcutHandlers {
  onCreateEvent?: () => void;
  onSearch?: () => void;
  onToday?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onMonthView?: () => void;
  onWeekView?: () => void;
  onDayView?: () => void;
  onEscape?: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
}

export function useCalendarShortcuts(handlers: CalendarShortcutHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Don't trigger shortcuts when typing in inputs
    const target = event.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      // Allow Escape to work even in inputs
      if (event.key !== 'Escape') {
        return;
      }
    }

    // Don't trigger shortcuts when modifiers are held (except for navigation)
    const hasModifier = event.ctrlKey || event.metaKey || event.altKey;

    switch (event.key) {
      case 'n':
      case 'c':
        if (!hasModifier) {
          event.preventDefault();
          handlersRef.current.onCreateEvent?.();
        }
        break;

      case '/':
      case 's':
        if (!hasModifier) {
          event.preventDefault();
          handlersRef.current.onSearch?.();
        }
        break;

      case 't':
        if (!hasModifier) {
          event.preventDefault();
          handlersRef.current.onToday?.();
        }
        break;

      case 'ArrowLeft':
        if (!hasModifier) {
          event.preventDefault();
          handlersRef.current.onPrevious?.();
        }
        break;

      case 'ArrowRight':
        if (!hasModifier) {
          event.preventDefault();
          handlersRef.current.onNext?.();
        }
        break;

      case 'm':
        if (!hasModifier) {
          event.preventDefault();
          handlersRef.current.onMonthView?.();
        }
        break;

      case 'w':
        if (!hasModifier) {
          event.preventDefault();
          handlersRef.current.onWeekView?.();
        }
        break;

      case 'd':
        if (!hasModifier) {
          event.preventDefault();
          handlersRef.current.onDayView?.();
        }
        break;

      case 'Escape':
        handlersRef.current.onEscape?.();
        break;

      case 'Delete':
      case 'Backspace':
        if (!hasModifier) {
          handlersRef.current.onDelete?.();
        }
        break;

      case 'e':
        if (!hasModifier) {
          event.preventDefault();
          handlersRef.current.onEdit?.();
        }
        break;
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

export const KEYBOARD_SHORTCUTS = [
  { key: 'n / c', description: 'Create new event' },
  { key: '/ / s', description: 'Open search' },
  { key: 't', description: 'Go to today' },
  { key: '←', description: 'Previous period' },
  { key: '→', description: 'Next period' },
  { key: 'm', description: 'Month view' },
  { key: 'w', description: 'Week view' },
  { key: 'd', description: 'Day view' },
  { key: 'e', description: 'Edit selected event' },
  { key: 'Esc', description: 'Close dialog' },
];
