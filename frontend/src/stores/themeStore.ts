import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  type ThemeColors,
  type ThemePresetId,
  type ColorPalette,
  THEME_DEFAULTS,
} from '@/lib/theme-presets';

type Theme = 'light' | 'dark' | 'system';

export interface CustomTheme {
  id: string;
  name: string;
  basePresetId: string;
  light: ThemeColors;
  dark: ThemeColors;
  createdAt: number;
}

interface ThemeState {
  theme: Theme;
  presetId: ThemePresetId | string; // Can be preset or custom theme ID
  colorPalette: ColorPalette;
  fontSize: number;
  borderRadius: number;
  customColors: {
    light?: Partial<ThemeColors>;
    dark?: Partial<ThemeColors>;
  };
  customThemes: Record<string, CustomTheme>; // Saved custom themes
  setTheme: (theme: Theme) => void;
  setPresetId: (presetId: ThemePresetId | string) => void;
  setColorPalette: (colorPalette: ColorPalette) => void;
  setFontSize: (fontSize: number) => void;
  setBorderRadius: (borderRadius: number) => void;
  setCustomColor: (mode: 'light' | 'dark', key: keyof ThemeColors, value: string) => void;
  clearCustomColors: () => void;
  resetToDefaults: () => void;
  saveCustomTheme: (name: string, basePresetId: string, light: ThemeColors, dark: ThemeColors) => string;
  updateCustomTheme: (id: string, updates: Partial<Omit<CustomTheme, 'id' | 'createdAt'>>) => void;
  deleteCustomTheme: (id: string) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: THEME_DEFAULTS.theme,
      presetId: THEME_DEFAULTS.presetId,
      colorPalette: THEME_DEFAULTS.colorPalette,
      fontSize: THEME_DEFAULTS.fontSize,
      borderRadius: THEME_DEFAULTS.borderRadius,
      customColors: THEME_DEFAULTS.customColors,
      customThemes: {},
      setTheme: (theme) => set({ theme }),
      setPresetId: (presetId) => set({ presetId, customColors: {} }),
      setColorPalette: (colorPalette) => set({ colorPalette }),
      setFontSize: (fontSize) => set({ fontSize }),
      setBorderRadius: (borderRadius) => set({ borderRadius }),
      setCustomColor: (mode, key, value) =>
        set((state) => ({
          customColors: {
            ...state.customColors,
            [mode]: {
              ...state.customColors[mode],
              [key]: value,
            },
          },
        })),
      clearCustomColors: () => set({ customColors: {} }),
      resetToDefaults: () =>
        set({
          theme: THEME_DEFAULTS.theme,
          presetId: THEME_DEFAULTS.presetId,
          colorPalette: THEME_DEFAULTS.colorPalette,
          fontSize: THEME_DEFAULTS.fontSize,
          borderRadius: THEME_DEFAULTS.borderRadius,
          customColors: {},
        }),
      saveCustomTheme: (name, basePresetId, light, dark) => {
        const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const newTheme: CustomTheme = {
          id,
          name,
          basePresetId,
          light,
          dark,
          createdAt: Date.now(),
        };
        set((state) => ({
          customThemes: {
            ...state.customThemes,
            [id]: newTheme,
          },
          presetId: id,
          customColors: {},
        }));
        return id;
      },
      updateCustomTheme: (id, updates) =>
        set((state) => {
          const existing = state.customThemes[id];
          if (!existing) return state;
          return {
            customThemes: {
              ...state.customThemes,
              [id]: {
                ...existing,
                ...updates,
              },
            },
          };
        }),
      deleteCustomTheme: (id) =>
        set((state) => {
          const { [id]: _, ...remaining } = state.customThemes;
          // If the deleted theme was active, switch to default
          const newPresetId = state.presetId === id ? THEME_DEFAULTS.presetId : state.presetId;
          return {
            customThemes: remaining,
            presetId: newPresetId,
          };
        }),
    }),
    {
      name: 'homemanager-theme',
    }
  )
);
