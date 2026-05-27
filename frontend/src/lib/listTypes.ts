import { ListTodo, Gift, FileText, Bell, type LucideIcon } from 'lucide-react';
import type { ListType } from '@/types/models';

export interface ListTypeMeta {
  value: ListType;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Tailwind text/bg color tokens for the type badge. */
  badgeClass: string;
}

export const LIST_TYPES: Record<Exclude<ListType, 'reminder'>, ListTypeMeta> = {
  checklist: {
    value: 'checklist',
    label: 'Checklist',
    description: 'Tick items off. Group into sections, assign, set due dates.',
    icon: ListTodo,
    badgeClass: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  },
  wishlist: {
    value: 'wishlist',
    label: 'Wish list',
    description: 'A list of ideas with links and prices. Others can claim items secretly.',
    icon: Gift,
    badgeClass: 'bg-pink-500/10 text-pink-700 dark:text-pink-300',
  },
  notes: {
    value: 'notes',
    label: 'Notes',
    description: 'Free-form notes. Good for babysitter handoffs, brain dumps.',
    icon: FileText,
    badgeClass: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
};

export const CREATABLE_LIST_TYPES = [
  LIST_TYPES.checklist,
  LIST_TYPES.wishlist,
  LIST_TYPES.notes,
];

export function getListTypeMeta(type: ListType): ListTypeMeta {
  if (type === 'reminder') {
    // Legacy data — treat as checklist for display purposes.
    return {
      ...LIST_TYPES.checklist,
      label: 'Reminder (legacy)',
      icon: Bell,
    };
  }
  return LIST_TYPES[type];
}

export const LIST_COLOR_OPTIONS = [
  '#64748b', // slate
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#10b981', // emerald
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
];

export const LIST_ICON_OPTIONS = [
  '📝', '✅', '🛒', '✈️', '🏖️', '🎁', '🎄', '🎉', '🎂', '🏡',
  '🧳', '👶', '🐾', '🎬', '📚', '🍽️', '🛠️', '💊', '💡', '⭐',
];
