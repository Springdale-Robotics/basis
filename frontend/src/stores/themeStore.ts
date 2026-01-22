import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type ColorPreset, type ColorPalette, THEME_DEFAULTS } from '@/lib/theme-presets';

type Theme = 'light' | 'dark' | 'system';

interface ThemeState {
  theme: Theme;
  colorPreset: ColorPreset;
  colorPalette: ColorPalette;
  fontSize: number;
  borderRadius: number;
  setTheme: (theme: Theme) => void;
  setColorPreset: (colorPreset: ColorPreset) => void;
  setColorPalette: (colorPalette: ColorPalette) => void;
  setFontSize: (fontSize: number) => void;
  setBorderRadius: (borderRadius: number) => void;
  resetToDefaults: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: THEME_DEFAULTS.theme,
      colorPreset: THEME_DEFAULTS.colorPreset,
      colorPalette: THEME_DEFAULTS.colorPalette,
      fontSize: THEME_DEFAULTS.fontSize,
      borderRadius: THEME_DEFAULTS.borderRadius,
      setTheme: (theme) => set({ theme }),
      setColorPreset: (colorPreset) => set({ colorPreset }),
      setColorPalette: (colorPalette) => set({ colorPalette }),
      setFontSize: (fontSize) => set({ fontSize }),
      setBorderRadius: (borderRadius) => set({ borderRadius }),
      resetToDefaults: () =>
        set({
          theme: THEME_DEFAULTS.theme,
          colorPreset: THEME_DEFAULTS.colorPreset,
          colorPalette: THEME_DEFAULTS.colorPalette,
          fontSize: THEME_DEFAULTS.fontSize,
          borderRadius: THEME_DEFAULTS.borderRadius,
        }),
    }),
    {
      name: 'homemanager-theme',
    }
  )
);
