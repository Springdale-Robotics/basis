import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  type ThemeColors,
  type ThemePresetId,
  type ColorPalette,
  THEME_DEFAULTS,
} from '@/lib/theme-presets';

type Theme = 'light' | 'dark' | 'system';

interface ThemeState {
  theme: Theme;
  presetId: ThemePresetId;
  colorPalette: ColorPalette;
  fontSize: number;
  borderRadius: number;
  customColors: {
    light?: Partial<ThemeColors>;
    dark?: Partial<ThemeColors>;
  };
  setTheme: (theme: Theme) => void;
  setPresetId: (presetId: ThemePresetId) => void;
  setColorPalette: (colorPalette: ColorPalette) => void;
  setFontSize: (fontSize: number) => void;
  setBorderRadius: (borderRadius: number) => void;
  setCustomColor: (mode: 'light' | 'dark', key: keyof ThemeColors, value: string) => void;
  clearCustomColors: () => void;
  resetToDefaults: () => void;
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
    }),
    {
      name: 'homemanager-theme',
    }
  )
);
