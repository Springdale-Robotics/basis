import { useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { defaultCategories, categoryIcons } from '@/lib/inventory-constants';

/**
 * Returns the full list of inventory categories (defaults - hidden + custom).
 * Also provides the icon for any category.
 */
export function useCategories() {
  const household = useAuthStore(s => s.household);
  const customCategories = household?.settings?.inventory?.customCategories || [];
  const hiddenCategories = household?.settings?.inventory?.hiddenCategories || [];

  const categories = useMemo(() => {
    const hidden = new Set(hiddenCategories);
    const all: string[] = [...defaultCategories].filter(c => !hidden.has(c));
    for (const custom of customCategories) {
      if (!all.includes(custom)) {
        const otherIndex = all.indexOf('Other');
        if (otherIndex >= 0) {
          all.splice(otherIndex, 0, custom);
        } else {
          all.push(custom);
        }
      }
    }
    return all;
  }, [customCategories, hiddenCategories]);

  const getIcon = (category: string): string => {
    return categoryIcons[category] || '📦';
  };

  return { categories, getIcon, hiddenCategories };
}
