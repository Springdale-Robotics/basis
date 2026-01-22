import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useThemeStore } from '@/stores/themeStore';
import { COLOR_PRESETS, type ColorPreset, type ColorPalette } from '@/lib/theme-presets';

type Theme = 'dark' | 'light' | 'system';

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

interface ThemeProviderState {
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

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  ...props
}: ThemeProviderProps) {
  const {
    theme,
    colorPreset,
    colorPalette,
    fontSize,
    borderRadius,
    setTheme,
    setColorPreset,
    setColorPalette,
    setFontSize,
    setBorderRadius,
    resetToDefaults,
  } = useThemeStore();

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

  // Apply CSS custom properties for color preset, font size, and border radius
  useEffect(() => {
    const root = document.documentElement;
    const preset = COLOR_PRESETS[colorPreset];
    root.style.setProperty('--primary', preset.primary);
    root.style.setProperty('--ring', preset.primary);
    root.style.fontSize = `${fontSize}px`;
    root.style.setProperty('--radius', `${borderRadius}rem`);
  }, [colorPreset, fontSize, borderRadius]);

  const value = {
    theme,
    colorPreset,
    colorPalette,
    fontSize,
    borderRadius,
    setTheme,
    setColorPreset,
    setColorPalette,
    setFontSize,
    setBorderRadius,
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
