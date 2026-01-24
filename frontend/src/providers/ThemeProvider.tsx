import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useThemeStore } from '@/stores/themeStore';
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
  presetId: ThemePresetId;
  colorPalette: ColorPalette;
  fontSize: number;
  borderRadius: number;
  customColors: {
    light?: Partial<ThemeColors>;
    dark?: Partial<ThemeColors>;
  };
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  setPresetId: (presetId: ThemePresetId) => void;
  setColorPalette: (colorPalette: ColorPalette) => void;
  setFontSize: (fontSize: number) => void;
  setBorderRadius: (borderRadius: number) => void;
  setCustomColor: (mode: 'light' | 'dark', key: keyof ThemeColors, value: string) => void;
  clearCustomColors: () => void;
  resetToDefaults: () => void;
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
    setTheme,
    setPresetId,
    setColorPalette,
    setFontSize,
    setBorderRadius,
    setCustomColor,
    clearCustomColors,
    resetToDefaults,
  } = useThemeStore();

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
    const preset = THEME_PRESETS[presetId];

    if (!preset) return;

    // Determine which color mode to use
    const colorMode = theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      : theme;

    // Get base colors from preset
    const baseColors = preset[colorMode];

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
  }, [presetId, theme, customColors, fontSize, borderRadius]);

  // Update colors when system theme changes
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      const root = document.documentElement;
      const preset = THEME_PRESETS[presetId];
      if (!preset) return;

      const colorMode = mediaQuery.matches ? 'dark' : 'light';
      const baseColors = preset[colorMode];
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
  }, [theme, presetId, customColors]);

  const value = {
    theme,
    presetId,
    colorPalette,
    fontSize,
    borderRadius,
    customColors,
    resolvedTheme,
    setTheme,
    setPresetId,
    setColorPalette,
    setFontSize,
    setBorderRadius,
    setCustomColor,
    clearCustomColors,
    resetToDefaults,
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
