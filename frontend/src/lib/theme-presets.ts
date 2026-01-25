// Theme colors interface - all values are in HSL format (e.g., "142 76% 36%")
export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
  success: string;
  successForeground: string;
  successMuted: string;
  successMutedForeground: string;
  warning: string;
  warningForeground: string;
  warningMuted: string;
  warningMutedForeground: string;
  error: string;
  errorForeground: string;
  errorMuted: string;
  errorMutedForeground: string;
  info: string;
  infoForeground: string;
  infoMuted: string;
  infoMutedForeground: string;
}

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  preview: { primary: string; background: string; accent: string };
  light: ThemeColors;
  dark: ThemeColors;
}

// Complete theme presets
export const THEME_PRESETS: Record<string, ThemePreset> = {
  lavender: {
    id: 'lavender',
    name: 'Lavender',
    description: 'Soft purple with indigo accents',
    preview: { primary: '#6366f1', background: '#faf8ff', accent: '#8b5cf6' },
    light: {
      background: '260 40% 98%',
      foreground: '255 20% 15%',
      card: '0 0% 100%',
      cardForeground: '255 20% 15%',
      popover: '0 0% 100%',
      popoverForeground: '255 20% 15%',
      primary: '239 84% 67%',
      primaryForeground: '0 0% 100%',
      secondary: '260 30% 96%',
      secondaryForeground: '255 20% 15%',
      muted: '260 20% 94%',
      mutedForeground: '255 10% 45%',
      accent: '262 83% 58%',
      accentForeground: '0 0% 100%',
      destructive: '0 84% 60%',
      destructiveForeground: '0 0% 100%',
      border: '260 20% 90%',
      input: '260 20% 90%',
      ring: '239 84% 67%',
      success: '142 76% 36%',
      successForeground: '0 0% 100%',
      successMuted: '142 76% 95%',
      successMutedForeground: '142 76% 25%',
      warning: '38 92% 50%',
      warningForeground: '0 0% 0%',
      warningMuted: '38 92% 95%',
      warningMutedForeground: '38 92% 30%',
      error: '0 84% 60%',
      errorForeground: '0 0% 100%',
      errorMuted: '0 84% 95%',
      errorMutedForeground: '0 84% 30%',
      info: '217 91% 60%',
      infoForeground: '0 0% 100%',
      infoMuted: '217 91% 95%',
      infoMutedForeground: '217 91% 30%',
    },
    dark: {
      background: '255 8% 9%',
      foreground: '255 5% 95%',
      card: '255 8% 12%',
      cardForeground: '255 5% 95%',
      popover: '255 8% 12%',
      popoverForeground: '255 5% 95%',
      primary: '239 84% 67%',
      primaryForeground: '0 0% 100%',
      secondary: '255 6% 18%',
      secondaryForeground: '255 5% 95%',
      muted: '255 6% 18%',
      mutedForeground: '255 5% 60%',
      accent: '262 83% 58%',
      accentForeground: '0 0% 100%',
      destructive: '0 62% 50%',
      destructiveForeground: '0 0% 100%',
      border: '255 6% 20%',
      input: '255 6% 20%',
      ring: '239 84% 67%',
      success: '142 76% 45%',
      successForeground: '0 0% 100%',
      successMuted: '142 40% 15%',
      successMutedForeground: '142 76% 65%',
      warning: '38 92% 55%',
      warningForeground: '0 0% 0%',
      warningMuted: '38 40% 15%',
      warningMutedForeground: '38 92% 70%',
      error: '0 72% 55%',
      errorForeground: '0 0% 100%',
      errorMuted: '0 40% 15%',
      errorMutedForeground: '0 72% 70%',
      info: '217 91% 65%',
      infoForeground: '0 0% 100%',
      infoMuted: '217 40% 15%',
      infoMutedForeground: '217 91% 75%',
    },
  },
  ocean: {
    id: 'ocean',
    name: 'Ocean',
    description: 'Cool blue with teal accents',
    preview: { primary: '#0ea5e9', background: '#f0f9ff', accent: '#06b6d4' },
    light: {
      background: '200 60% 98%',
      foreground: '210 30% 15%',
      card: '0 0% 100%',
      cardForeground: '210 30% 15%',
      popover: '0 0% 100%',
      popoverForeground: '210 30% 15%',
      primary: '199 89% 48%',
      primaryForeground: '0 0% 100%',
      secondary: '200 40% 96%',
      secondaryForeground: '210 30% 15%',
      muted: '200 25% 94%',
      mutedForeground: '210 15% 45%',
      accent: '186 94% 42%',
      accentForeground: '0 0% 100%',
      destructive: '0 84% 60%',
      destructiveForeground: '0 0% 100%',
      border: '200 25% 88%',
      input: '200 25% 88%',
      ring: '199 89% 48%',
      success: '142 76% 36%',
      successForeground: '0 0% 100%',
      successMuted: '142 76% 95%',
      successMutedForeground: '142 76% 25%',
      warning: '38 92% 50%',
      warningForeground: '0 0% 0%',
      warningMuted: '38 92% 95%',
      warningMutedForeground: '38 92% 30%',
      error: '0 84% 60%',
      errorForeground: '0 0% 100%',
      errorMuted: '0 84% 95%',
      errorMutedForeground: '0 84% 30%',
      info: '217 91% 60%',
      infoForeground: '0 0% 100%',
      infoMuted: '217 91% 95%',
      infoMutedForeground: '217 91% 30%',
    },
    dark: {
      background: '210 8% 9%',
      foreground: '210 5% 95%',
      card: '210 8% 12%',
      cardForeground: '210 5% 95%',
      popover: '210 8% 12%',
      popoverForeground: '210 5% 95%',
      primary: '199 89% 48%',
      primaryForeground: '0 0% 100%',
      secondary: '210 6% 18%',
      secondaryForeground: '210 5% 95%',
      muted: '210 6% 18%',
      mutedForeground: '210 5% 60%',
      accent: '186 94% 42%',
      accentForeground: '0 0% 100%',
      destructive: '0 62% 50%',
      destructiveForeground: '0 0% 100%',
      border: '210 6% 20%',
      input: '210 6% 20%',
      ring: '199 89% 48%',
      success: '142 76% 45%',
      successForeground: '0 0% 100%',
      successMuted: '142 40% 15%',
      successMutedForeground: '142 76% 65%',
      warning: '38 92% 55%',
      warningForeground: '0 0% 0%',
      warningMuted: '38 40% 15%',
      warningMutedForeground: '38 92% 70%',
      error: '0 72% 55%',
      errorForeground: '0 0% 100%',
      errorMuted: '0 40% 15%',
      errorMutedForeground: '0 72% 70%',
      info: '217 91% 65%',
      infoForeground: '0 0% 100%',
      infoMuted: '217 40% 15%',
      infoMutedForeground: '217 91% 75%',
    },
  },
  sunrise: {
    id: 'sunrise',
    name: 'Sunrise',
    description: 'Warm cream with coral accents',
    preview: { primary: '#f66951', background: '#FFFEF9', accent: '#f66951' },
    light: {
      background: '50 100% 98%',
      foreground: '0 0% 27%',
      card: '0 0% 100%',
      cardForeground: '0 0% 27%',
      popover: '0 0% 100%',
      popoverForeground: '0 0% 27%',
      primary: '9 91% 64%',
      primaryForeground: '0 0% 100%',
      secondary: '35 100% 96%',
      secondaryForeground: '0 0% 27%',
      muted: '35 30% 94%',
      mutedForeground: '0 0% 45%',
      accent: '9 91% 64%',
      accentForeground: '0 0% 100%',
      destructive: '0 84% 60%',
      destructiveForeground: '0 0% 100%',
      border: '35 20% 88%',
      input: '35 20% 88%',
      ring: '9 91% 64%',
      success: '142 76% 36%',
      successForeground: '0 0% 100%',
      successMuted: '142 76% 95%',
      successMutedForeground: '142 76% 25%',
      warning: '38 92% 50%',
      warningForeground: '0 0% 0%',
      warningMuted: '38 92% 95%',
      warningMutedForeground: '38 92% 30%',
      error: '0 84% 60%',
      errorForeground: '0 0% 100%',
      errorMuted: '0 84% 95%',
      errorMutedForeground: '0 84% 30%',
      info: '217 91% 60%',
      infoForeground: '0 0% 100%',
      infoMuted: '217 91% 95%',
      infoMutedForeground: '217 91% 30%',
    },
    dark: {
      background: '0 0% 9%',
      foreground: '0 0% 95%',
      card: '0 0% 12%',
      cardForeground: '0 0% 95%',
      popover: '0 0% 12%',
      popoverForeground: '0 0% 95%',
      primary: '9 91% 64%',
      primaryForeground: '0 0% 100%',
      secondary: '0 0% 18%',
      secondaryForeground: '0 0% 95%',
      muted: '0 0% 18%',
      mutedForeground: '0 0% 60%',
      accent: '9 91% 64%',
      accentForeground: '0 0% 100%',
      destructive: '0 62% 50%',
      destructiveForeground: '0 0% 100%',
      border: '0 0% 20%',
      input: '0 0% 20%',
      ring: '9 91% 64%',
      success: '142 76% 45%',
      successForeground: '0 0% 100%',
      successMuted: '142 40% 15%',
      successMutedForeground: '142 76% 65%',
      warning: '38 92% 55%',
      warningForeground: '0 0% 0%',
      warningMuted: '38 40% 15%',
      warningMutedForeground: '38 92% 70%',
      error: '0 72% 55%',
      errorForeground: '0 0% 100%',
      errorMuted: '0 40% 15%',
      errorMutedForeground: '0 72% 70%',
      info: '217 91% 65%',
      infoForeground: '0 0% 100%',
      infoMuted: '217 40% 15%',
      infoMutedForeground: '217 91% 75%',
    },
  },
  forest: {
    id: 'forest',
    name: 'Forest',
    description: 'Natural greens with earthy warmth',
    preview: { primary: '#22c55e', background: '#f0fdf4', accent: '#16a34a' },
    light: {
      background: '138 76% 97%',
      foreground: '140 40% 10%',
      card: '0 0% 100%',
      cardForeground: '140 40% 10%',
      popover: '0 0% 100%',
      popoverForeground: '140 40% 10%',
      primary: '142 71% 45%',
      primaryForeground: '0 0% 100%',
      secondary: '138 30% 94%',
      secondaryForeground: '140 40% 10%',
      muted: '138 20% 92%',
      mutedForeground: '140 10% 45%',
      accent: '142 76% 36%',
      accentForeground: '0 0% 100%',
      destructive: '0 84% 60%',
      destructiveForeground: '0 0% 100%',
      border: '138 20% 88%',
      input: '138 20% 88%',
      ring: '142 71% 45%',
      success: '142 76% 36%',
      successForeground: '0 0% 100%',
      successMuted: '142 76% 95%',
      successMutedForeground: '142 76% 25%',
      warning: '38 92% 50%',
      warningForeground: '0 0% 0%',
      warningMuted: '38 92% 95%',
      warningMutedForeground: '38 92% 30%',
      error: '0 84% 60%',
      errorForeground: '0 0% 100%',
      errorMuted: '0 84% 95%',
      errorMutedForeground: '0 84% 30%',
      info: '217 91% 60%',
      infoForeground: '0 0% 100%',
      infoMuted: '217 91% 95%',
      infoMutedForeground: '217 91% 30%',
    },
    dark: {
      background: '140 30% 6%',
      foreground: '138 30% 95%',
      card: '140 30% 9%',
      cardForeground: '138 30% 95%',
      popover: '140 30% 9%',
      popoverForeground: '138 30% 95%',
      primary: '142 71% 45%',
      primaryForeground: '0 0% 100%',
      secondary: '140 20% 15%',
      secondaryForeground: '138 30% 95%',
      muted: '140 20% 15%',
      mutedForeground: '138 15% 60%',
      accent: '142 71% 45%',
      accentForeground: '0 0% 100%',
      destructive: '0 62% 50%',
      destructiveForeground: '0 0% 100%',
      border: '140 20% 18%',
      input: '140 20% 18%',
      ring: '142 71% 45%',
      success: '142 76% 45%',
      successForeground: '0 0% 100%',
      successMuted: '142 40% 15%',
      successMutedForeground: '142 76% 65%',
      warning: '38 92% 55%',
      warningForeground: '0 0% 0%',
      warningMuted: '38 40% 15%',
      warningMutedForeground: '38 92% 70%',
      error: '0 72% 55%',
      errorForeground: '0 0% 100%',
      errorMuted: '0 40% 15%',
      errorMutedForeground: '0 72% 70%',
      info: '217 91% 65%',
      infoForeground: '0 0% 100%',
      infoMuted: '217 40% 15%',
      infoMutedForeground: '217 91% 75%',
    },
  },
  roseGold: {
    id: 'roseGold',
    name: 'Rose Gold',
    description: 'Elegant rose with golden warmth',
    preview: { primary: '#f43f5e', background: '#fff1f2', accent: '#e11d48' },
    light: {
      background: '355 100% 97%',
      foreground: '340 30% 15%',
      card: '0 0% 100%',
      cardForeground: '340 30% 15%',
      popover: '0 0% 100%',
      popoverForeground: '340 30% 15%',
      primary: '347 77% 50%',
      primaryForeground: '0 0% 100%',
      secondary: '350 80% 96%',
      secondaryForeground: '340 30% 15%',
      muted: '350 30% 94%',
      mutedForeground: '340 15% 45%',
      accent: '347 77% 50%',
      accentForeground: '0 0% 100%',
      destructive: '0 84% 60%',
      destructiveForeground: '0 0% 100%',
      border: '350 25% 90%',
      input: '350 25% 90%',
      ring: '347 77% 50%',
      success: '142 76% 36%',
      successForeground: '0 0% 100%',
      successMuted: '142 76% 95%',
      successMutedForeground: '142 76% 25%',
      warning: '38 92% 50%',
      warningForeground: '0 0% 0%',
      warningMuted: '38 92% 95%',
      warningMutedForeground: '38 92% 30%',
      error: '0 84% 60%',
      errorForeground: '0 0% 100%',
      errorMuted: '0 84% 95%',
      errorMutedForeground: '0 84% 30%',
      info: '217 91% 60%',
      infoForeground: '0 0% 100%',
      infoMuted: '217 91% 95%',
      infoMutedForeground: '217 91% 30%',
    },
    dark: {
      background: '340 30% 6%',
      foreground: '350 50% 95%',
      card: '340 30% 9%',
      cardForeground: '350 50% 95%',
      popover: '340 30% 9%',
      popoverForeground: '350 50% 95%',
      primary: '347 77% 50%',
      primaryForeground: '0 0% 100%',
      secondary: '340 20% 15%',
      secondaryForeground: '350 50% 95%',
      muted: '340 20% 15%',
      mutedForeground: '340 15% 60%',
      accent: '347 77% 50%',
      accentForeground: '0 0% 100%',
      destructive: '0 62% 50%',
      destructiveForeground: '0 0% 100%',
      border: '340 20% 18%',
      input: '340 20% 18%',
      ring: '347 77% 50%',
      success: '142 76% 45%',
      successForeground: '0 0% 100%',
      successMuted: '142 40% 15%',
      successMutedForeground: '142 76% 65%',
      warning: '38 92% 55%',
      warningForeground: '0 0% 0%',
      warningMuted: '38 40% 15%',
      warningMutedForeground: '38 92% 70%',
      error: '0 72% 55%',
      errorForeground: '0 0% 100%',
      errorMuted: '0 40% 15%',
      errorMutedForeground: '0 72% 70%',
      info: '217 91% 65%',
      infoForeground: '0 0% 100%',
      infoMuted: '217 40% 15%',
      infoMutedForeground: '217 91% 75%',
    },
  },
  highContrast: {
    id: 'highContrast',
    name: 'High Contrast',
    description: 'Maximum accessibility',
    preview: { primary: '#000000', background: '#ffffff', accent: '#000000' },
    light: {
      background: '0 0% 100%',
      foreground: '0 0% 0%',
      card: '0 0% 100%',
      cardForeground: '0 0% 0%',
      popover: '0 0% 100%',
      popoverForeground: '0 0% 0%',
      primary: '0 0% 0%',
      primaryForeground: '0 0% 100%',
      secondary: '0 0% 96%',
      secondaryForeground: '0 0% 0%',
      muted: '0 0% 94%',
      mutedForeground: '0 0% 25%',
      accent: '0 0% 0%',
      accentForeground: '0 0% 100%',
      destructive: '0 100% 40%',
      destructiveForeground: '0 0% 100%',
      border: '0 0% 0%',
      input: '0 0% 0%',
      ring: '0 0% 0%',
      success: '142 100% 25%',
      successForeground: '0 0% 100%',
      successMuted: '142 50% 90%',
      successMutedForeground: '142 100% 15%',
      warning: '38 100% 40%',
      warningForeground: '0 0% 0%',
      warningMuted: '38 50% 90%',
      warningMutedForeground: '38 100% 25%',
      error: '0 100% 40%',
      errorForeground: '0 0% 100%',
      errorMuted: '0 50% 90%',
      errorMutedForeground: '0 100% 25%',
      info: '217 100% 40%',
      infoForeground: '0 0% 100%',
      infoMuted: '217 50% 90%',
      infoMutedForeground: '217 100% 25%',
    },
    dark: {
      background: '0 0% 0%',
      foreground: '0 0% 100%',
      card: '0 0% 5%',
      cardForeground: '0 0% 100%',
      popover: '0 0% 5%',
      popoverForeground: '0 0% 100%',
      primary: '0 0% 100%',
      primaryForeground: '0 0% 0%',
      secondary: '0 0% 15%',
      secondaryForeground: '0 0% 100%',
      muted: '0 0% 15%',
      mutedForeground: '0 0% 75%',
      accent: '0 0% 100%',
      accentForeground: '0 0% 0%',
      destructive: '0 100% 60%',
      destructiveForeground: '0 0% 0%',
      border: '0 0% 100%',
      input: '0 0% 100%',
      ring: '0 0% 100%',
      success: '142 100% 55%',
      successForeground: '0 0% 0%',
      successMuted: '142 50% 15%',
      successMutedForeground: '142 100% 75%',
      warning: '38 100% 60%',
      warningForeground: '0 0% 0%',
      warningMuted: '38 50% 15%',
      warningMutedForeground: '38 100% 75%',
      error: '0 100% 60%',
      errorForeground: '0 0% 0%',
      errorMuted: '0 50% 15%',
      errorMutedForeground: '0 100% 75%',
      info: '217 100% 65%',
      infoForeground: '0 0% 0%',
      infoMuted: '217 50% 15%',
      infoMutedForeground: '217 100% 75%',
    },
  },
};

export type ThemePresetId = keyof typeof THEME_PRESETS;

// Color palette configuration interface
export interface ColorPaletteConfig {
  name: string;
  type: 'standard' | 'monochromatic';
  colors: Array<{ value: string; label: string }>;
}

// Color palettes for calendars and other multi-color features (hex format)
// Standard palettes have positionally consistent color types:
// 0=Blue, 1=Green, 2=Red/Coral, 3=Yellow, 4=Purple, 5=Pink, 6=Teal, 7=Orange, 8=Brown, 9=Lime, 10=Indigo, 11=Slate
export const COLOR_PALETTES: Record<string, ColorPaletteConfig> = {
  default: {
    name: 'Default',
    type: 'standard',
    colors: [
      { value: '#4A90D9', label: 'Blue' },
      { value: '#50C878', label: 'Green' },
      { value: '#f66951', label: 'Coral' },
      { value: '#FFD700', label: 'Yellow' },
      { value: '#9B59B6', label: 'Purple' },
      { value: '#E91E63', label: 'Pink' },
      { value: '#00BCD4', label: 'Teal' },
      { value: '#FF9800', label: 'Orange' },
      { value: '#8B5A2B', label: 'Brown' },
      { value: '#8BC34A', label: 'Lime' },
      { value: '#3F51B5', label: 'Indigo' },
      { value: '#607D8B', label: 'Slate' },
    ],
  },
  pastel: {
    name: 'Pastel',
    type: 'standard',
    colors: [
      { value: '#A2D2FF', label: 'Sky' },
      { value: '#B5E48C', label: 'Mint' },
      { value: '#FFB5A7', label: 'Blush' },
      { value: '#FDFFB6', label: 'Cream' },
      { value: '#CDB4DB', label: 'Lavender' },
      { value: '#FFC8DD', label: 'Rose' },
      { value: '#99D98C', label: 'Sage' },
      { value: '#FFCFD2', label: 'Peach' },
      { value: '#D4A373', label: 'Tan' },
      { value: '#C1E1A3', label: 'Spring' },
      { value: '#B8C0FF', label: 'Periwinkle' },
      { value: '#E0E1DD', label: 'Mist' },
    ],
  },
  vibrant: {
    name: 'Vibrant',
    type: 'standard',
    colors: [
      { value: '#3A86FF', label: 'Azure' },
      { value: '#06D6A0', label: 'Emerald' },
      { value: '#FF006E', label: 'Magenta' },
      { value: '#FFBE0B', label: 'Amber' },
      { value: '#8338EC', label: 'Violet' },
      { value: '#F72585', label: 'Fuchsia' },
      { value: '#00F5D4', label: 'Cyan' },
      { value: '#FB5607', label: 'Tangerine' },
      { value: '#C77B58', label: 'Terracotta' },
      { value: '#97FF00', label: 'Neon' },
      { value: '#5E60CE', label: 'Iris' },
      { value: '#6C757D', label: 'Steel' },
    ],
  },
  earth: {
    name: 'Earth',
    type: 'standard',
    colors: [
      { value: '#5C7C9A', label: 'Slate Blue' },
      { value: '#606C38', label: 'Olive' },
      { value: '#BC6C25', label: 'Sienna' },
      { value: '#DDA15E', label: 'Sand' },
      { value: '#7C5C6B', label: 'Mauve' },
      { value: '#CB997E', label: 'Clay' },
      { value: '#283618', label: 'Forest' },
      { value: '#9C6644', label: 'Umber' },
      { value: '#6B705C', label: 'Moss' },
      { value: '#A68A64', label: 'Khaki' },
      { value: '#354F52', label: 'Pine' },
      { value: '#3D405B', label: 'Charcoal' },
    ],
  },
  monochrome: {
    name: 'Monochrome',
    type: 'monochromatic',
    colors: [
      { value: '#F8F9FA', label: 'White' },
      { value: '#E9ECEF', label: 'Lightest' },
      { value: '#DEE2E6', label: 'Lighter' },
      { value: '#CED4DA', label: 'Light' },
      { value: '#ADB5BD', label: 'Medium Light' },
      { value: '#868E96', label: 'Medium' },
      { value: '#6C757D', label: 'Medium Dark' },
      { value: '#495057', label: 'Dark' },
      { value: '#343A40', label: 'Darker' },
      { value: '#212529', label: 'Darkest' },
      { value: '#1A1D20', label: 'Near Black' },
      { value: '#0D0F10', label: 'Black' },
    ],
  },
  oceanBlue: {
    name: 'Ocean Blues',
    type: 'monochromatic',
    colors: [
      { value: '#CAF0F8', label: 'Foam' },
      { value: '#ADE8F4', label: 'Pale' },
      { value: '#90E0EF', label: 'Light' },
      { value: '#48CAE4', label: 'Aqua' },
      { value: '#00B4D8', label: 'Surf' },
      { value: '#0096C7', label: 'Cerulean' },
      { value: '#0077B6', label: 'Marine' },
      { value: '#023E8A', label: 'Navy' },
      { value: '#03045E', label: 'Abyss' },
      { value: '#012A4A', label: 'Midnight' },
      { value: '#001D3D', label: 'Deep' },
      { value: '#001233', label: 'Depths' },
    ],
  },
};

export type ColorPalette = keyof typeof COLOR_PALETTES;

// Helper function to get color hex value by index from a palette
export function getColorForIndex(palette: ColorPalette, index: number): string {
  const paletteConfig = COLOR_PALETTES[palette];
  if (!paletteConfig) {
    return COLOR_PALETTES.default.colors[0].value;
  }
  const normalizedIndex = Math.max(0, Math.min(index, paletteConfig.colors.length - 1));
  return paletteConfig.colors[normalizedIndex]?.value ?? paletteConfig.colors[0].value;
}

// Helper function to get color label by index from a palette
export function getColorLabelForIndex(palette: ColorPalette, index: number): string {
  const paletteConfig = COLOR_PALETTES[palette];
  if (!paletteConfig) {
    return COLOR_PALETTES.default.colors[0].label;
  }
  const normalizedIndex = Math.max(0, Math.min(index, paletteConfig.colors.length - 1));
  return paletteConfig.colors[normalizedIndex]?.label ?? paletteConfig.colors[0].label;
}

export const THEME_DEFAULTS = {
  theme: 'system' as const,
  presetId: 'lavender' as ThemePresetId,
  colorPalette: 'default' as ColorPalette,
  fontSize: 14,
  borderRadius: 0.75,
  customColors: {} as {
    light?: Partial<ThemeColors>;
    dark?: Partial<ThemeColors>;
  },
};

// Helper to convert camelCase color key to CSS variable name
export function colorKeyToVar(key: string): string {
  return '--' + key.replace(/([A-Z])/g, '-$1').toLowerCase();
}

// Get all color keys for customization UI
export const THEME_COLOR_CATEGORIES = {
  surfaces: ['background', 'card', 'popover', 'border', 'input'] as const,
  text: ['foreground', 'cardForeground', 'popoverForeground', 'mutedForeground'] as const,
  brand: ['primary', 'primaryForeground', 'secondary', 'secondaryForeground', 'muted', 'accent', 'accentForeground', 'ring'] as const,
  semantic: [
    'success', 'successForeground', 'successMuted', 'successMutedForeground',
    'warning', 'warningForeground', 'warningMuted', 'warningMutedForeground',
    'error', 'errorForeground', 'errorMuted', 'errorMutedForeground',
    'info', 'infoForeground', 'infoMuted', 'infoMutedForeground',
    'destructive', 'destructiveForeground',
  ] as const,
};

// Human-readable labels for color keys
export const COLOR_LABELS: Record<keyof ThemeColors, string> = {
  background: 'Background',
  foreground: 'Text',
  card: 'Card',
  cardForeground: 'Card Text',
  popover: 'Popover',
  popoverForeground: 'Popover Text',
  primary: 'Primary',
  primaryForeground: 'Primary Text',
  secondary: 'Secondary',
  secondaryForeground: 'Secondary Text',
  muted: 'Muted',
  mutedForeground: 'Muted Text',
  accent: 'Accent',
  accentForeground: 'Accent Text',
  destructive: 'Destructive',
  destructiveForeground: 'Destructive Text',
  border: 'Border',
  input: 'Input',
  ring: 'Focus Ring',
  success: 'Success',
  successForeground: 'Success Text',
  successMuted: 'Success Muted',
  successMutedForeground: 'Success Muted Text',
  warning: 'Warning',
  warningForeground: 'Warning Text',
  warningMuted: 'Warning Muted',
  warningMutedForeground: 'Warning Muted Text',
  error: 'Error',
  errorForeground: 'Error Text',
  errorMuted: 'Error Muted',
  errorMutedForeground: 'Error Muted Text',
  info: 'Info',
  infoForeground: 'Info Text',
  infoMuted: 'Info Muted',
  infoMutedForeground: 'Info Muted Text',
};

// Basic colors (always visible in editor)
export const BASIC_COLORS: (keyof ThemeColors)[] = [
  'background',
  'foreground',
  'primary',
  'secondary',
  'accent',
  'muted',
  'border',
];

// Advanced colors (collapsible in editor)
export const ADVANCED_COLORS = {
  surfaces: ['card', 'cardForeground', 'popover', 'popoverForeground', 'input', 'ring'] as (keyof ThemeColors)[],
  success: ['success', 'successForeground', 'successMuted', 'successMutedForeground'] as (keyof ThemeColors)[],
  warning: ['warning', 'warningForeground', 'warningMuted', 'warningMutedForeground'] as (keyof ThemeColors)[],
  error: ['error', 'errorForeground', 'errorMuted', 'errorMutedForeground'] as (keyof ThemeColors)[],
  info: ['info', 'infoForeground', 'infoMuted', 'infoMutedForeground'] as (keyof ThemeColors)[],
  destructive: ['destructive', 'destructiveForeground'] as (keyof ThemeColors)[],
  foregrounds: ['primaryForeground', 'secondaryForeground', 'mutedForeground', 'accentForeground'] as (keyof ThemeColors)[],
};

// HSL string "260 40% 98%" to hex "#faf8ff"
export function hslStringToHex(hsl: string): string {
  const parts = hsl.split(' ');
  if (parts.length !== 3) return '#000000';

  const h = parseFloat(parts[0]);
  const s = parseFloat(parts[1].replace('%', '')) / 100;
  const l = parseFloat(parts[2].replace('%', '')) / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;

  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0;
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x;
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c;
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c;
  } else if (h >= 300 && h < 360) {
    r = c; g = 0; b = x;
  }

  const toHex = (n: number) => {
    const hex = Math.round((n + m) * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Hex "#faf8ff" to HSL string "260 40% 98%"
export function hexToHslString(hex: string): string {
  // Remove # if present
  hex = hex.replace(/^#/, '');

  // Parse RGB values
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        break;
      case g:
        h = ((b - r) / d + 2) * 60;
        break;
      case b:
        h = ((r - g) / d + 4) * 60;
        break;
    }
  }

  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
