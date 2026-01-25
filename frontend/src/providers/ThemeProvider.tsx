import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useThemeStore, type CustomTheme } from '@/stores/themeStore';
import {
  THEME_PRESETS,
  colorKeyToVar,
  type ThemeColors,
  type ThemePresetId,
  type ColorPalette,
} from '@/lib/theme-presets';

type Theme = 'dark' | 'light' | 'system';

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

interface ThemeProviderState {
  theme: Theme;
  presetId: ThemePresetId | string;
  colorPalette: ColorPalette;
  fontSize: number;
  borderRadius: number;
  customColors: {
    light?: Partial<ThemeColors>;
    dark?: Partial<ThemeColors>;
  };
  customThemes: Record<string, CustomTheme>;
  resolvedTheme: 'light' | 'dark';
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
  getActiveThemeColors: () => { light: ThemeColors; dark: ThemeColors } | null;
}

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  ...props
}: ThemeProviderProps) {
  const {
    theme,
    presetId,
    colorPalette,
    fontSize,
    borderRadius,
    customColors,
    customThemes,
    setTheme,
    setPresetId,
    setColorPalette,
    setFontSize,
    setBorderRadius,
    setCustomColor,
    clearCustomColors,
    resetToDefaults,
    saveCustomTheme,
    updateCustomTheme,
    deleteCustomTheme,
  } = useThemeStore();

  // Helper to get theme colors (either from preset or custom theme)
  const getThemeColorsById = (id: string): { light: ThemeColors; dark: ThemeColors } | null => {
    if (THEME_PRESETS[id]) {
      return {
        light: THEME_PRESETS[id].light,
        dark: THEME_PRESETS[id].dark,
      };
    }
    if (customThemes[id]) {
      return {
        light: customThemes[id].light,
        dark: customThemes[id].dark,
      };
    }
    return null;
  };

  const getActiveThemeColors = (): { light: ThemeColors; dark: ThemeColors } | null => {
    return getThemeColorsById(presetId);
  };

  // Compute resolved theme
  const resolvedTheme = useMemo(() => {
    if (theme === 'system') {
      return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    }
    return theme;
  }, [theme]);

  // Apply dark/light theme class
  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  // Listen for system theme changes
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      const root = window.document.documentElement;
      root.classList.remove('light', 'dark');
      root.classList.add(mediaQuery.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  // Apply all theme colors as CSS variables
  useEffect(() => {
    const root = document.documentElement;
    const themeColors = getThemeColorsById(presetId);

    if (!themeColors) return;

    // Determine which color mode to use
    const colorMode = theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      : theme;

    // Get base colors from preset or custom theme
    const baseColors = themeColors[colorMode];

    // Merge with custom colors
    const mergedColors = {
      ...baseColors,
      ...(customColors[colorMode] || {}),
    };

    // Apply all colors as CSS variables
    Object.entries(mergedColors).forEach(([key, value]) => {
      const varName = colorKeyToVar(key);
      root.style.setProperty(varName, value as string);
    });

    // Apply font size and border radius
    root.style.fontSize = `${fontSize}px`;
    root.style.setProperty('--radius', `${borderRadius}rem`);
  }, [presetId, theme, customColors, customThemes, fontSize, borderRadius]);

  // Update colors when system theme changes
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      const root = document.documentElement;
      const themeColors = getThemeColorsById(presetId);
      if (!themeColors) return;

      const colorMode = mediaQuery.matches ? 'dark' : 'light';
      const baseColors = themeColors[colorMode];
      const mergedColors = {
        ...baseColors,
        ...(customColors[colorMode] || {}),
      };

      Object.entries(mergedColors).forEach(([key, value]) => {
        const varName = colorKeyToVar(key);
        root.style.setProperty(varName, value as string);
      });
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme, presetId, customColors, customThemes]);

  const value = {
    theme,
    presetId,
    colorPalette,
    fontSize,
    borderRadius,
    customColors,
    customThemes,
    resolvedTheme,
    setTheme,
    setPresetId,
    setColorPalette,
    setFontSize,
    setBorderRadius,
    setCustomColor,
    clearCustomColors,
    resetToDefaults,
    saveCustomTheme,
    updateCustomTheme,
    deleteCustomTheme,
    getActiveThemeColors,
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeProviderContext);

  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }

  return context;
}
