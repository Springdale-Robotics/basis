import { useAuthStore } from '@/stores/authStore';

export type InventoryTier = 'basic' | 'advanced';

export interface InventoryTierConfig {
  tier: InventoryTier;
  isAdvanced: boolean;
  confidenceThresholds: { high: number; medium: number };
}

/**
 * Read the household's inventory tier setting.
 * Defaults to 'basic' if not configured.
 */
export function useInventoryTier(): InventoryTierConfig {
  const household = useAuthStore(s => s.household);
  const inventorySettings = household?.settings?.inventory;

  const tier: InventoryTier = inventorySettings?.tier ?? 'basic';
  const thresholds = inventorySettings?.confidenceThresholds ?? { high: 80, medium: 40 };

  return {
    tier,
    isAdvanced: tier === 'advanced',
    confidenceThresholds: thresholds,
  };
}
