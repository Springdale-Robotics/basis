import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useTheme } from '@/hooks/useTheme';
import {
  THEME_PRESETS,
  COLOR_PALETTES,
  type ThemePresetId,
  type ColorPalette,
} from '@/lib/theme-presets';
import { cn } from '@/lib/utils';
import { Sun, Moon, Monitor, ChevronDown, RotateCcw, Check } from 'lucide-react';

const themes = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
] as const;

const presetEntries = Object.entries(THEME_PRESETS) as [ThemePresetId, (typeof THEME_PRESETS)[ThemePresetId]][];
const colorPaletteEntries = Object.entries(COLOR_PALETTES) as [ColorPalette, (typeof COLOR_PALETTES)[ColorPalette]][];

export function ThemeSettingsPage() {
  const {
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
    clearCustomColors,
    resetToDefaults,
  } = useTheme();

  const [advancedOpen, setAdvancedOpen] = useState(false);

  const hasCustomColors = Object.keys(customColors.light || {}).length > 0 || Object.keys(customColors.dark || {}).length > 0;

  return (
    <div className="space-y-6">
      {/* Appearance */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Appearance</CardTitle>
          <CardDescription>Choose how Home Manager looks to you</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            {themes.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTheme(id)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors',
                  theme === id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted'
                )}
              >
                <Icon className="h-6 w-6" />
                <span className="text-sm font-medium">{label}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Theme Presets */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Theme</CardTitle>
          <CardDescription>Choose a complete color scheme</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {presetEntries.map(([id, preset]) => (
              <button
                key={id}
                onClick={() => setPresetId(id)}
                className={cn(
                  'flex flex-col gap-3 rounded-lg border p-4 text-left transition-all',
                  presetId === id
                    ? 'border-primary ring-2 ring-primary ring-offset-2 ring-offset-background'
                    : 'border-border hover:bg-muted/50'
                )}
              >
                {/* Preview swatches */}
                <div className="flex gap-1">
                  <div
                    className="h-8 w-8 rounded-md border shadow-sm"
                    style={{ backgroundColor: preset.preview.background }}
                    title="Background"
                  />
                  <div
                    className="h-8 w-8 rounded-md border shadow-sm"
                    style={{ backgroundColor: preset.preview.primary }}
                    title="Primary"
                  />
                  <div
                    className="h-8 w-8 rounded-md border shadow-sm"
                    style={{ backgroundColor: preset.preview.accent }}
                    title="Accent"
                  />
                  {presetId === id && (
                    <div className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-4 w-4" />
                    </div>
                  )}
                </div>
                <div>
                  <p className="font-medium">{preset.name}</p>
                  <p className="text-xs text-muted-foreground">{preset.description}</p>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Color Palette */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Color Palette</CardTitle>
          <CardDescription>Choose colors for calendars and categories</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {colorPaletteEntries.map(([id, palette]) => (
              <button
                key={id}
                onClick={() => setColorPalette(id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border p-3 transition-colors text-left',
                  colorPalette === id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted'
                )}
              >
                <div className="flex gap-1">
                  {palette.colors.slice(0, 8).map((color, i) => (
                    <div
                      key={i}
                      className="h-6 w-6 rounded-full"
                      style={{ backgroundColor: color.value }}
                    />
                  ))}
                </div>
                <span className="text-sm font-medium">{palette.name}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Font Size */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Font Size</CardTitle>
          <CardDescription>Adjust the base font size</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm">Small</span>
            <span className="text-sm">Large</span>
          </div>
          <Slider
            value={[fontSize]}
            onValueChange={(v) => setFontSize(v[0])}
            min={12}
            max={18}
            step={1}
          />
          <p className="text-sm text-muted-foreground">
            Current: {fontSize}px
          </p>
        </CardContent>
      </Card>

      {/* Border Radius */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Border Radius</CardTitle>
          <CardDescription>Adjust the roundness of elements</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm">Square</span>
            <span className="text-sm">Round</span>
          </div>
          <Slider
            value={[borderRadius]}
            onValueChange={(v) => setBorderRadius(v[0])}
            min={0}
            max={1}
            step={0.125}
          />
          <div className="flex gap-4 pt-2">
            <div className="h-12 w-12 bg-primary" style={{ borderRadius: '0rem' }} />
            <div className="h-12 w-12 bg-primary" style={{ borderRadius: '0.25rem' }} />
            <div className="h-12 w-12 bg-primary" style={{ borderRadius: '0.5rem' }} />
            <div className="h-12 w-12 bg-primary" style={{ borderRadius: '0.75rem' }} />
            <div className="h-12 w-12 bg-primary" style={{ borderRadius: '1rem' }} />
          </div>
        </CardContent>
      </Card>

      {/* Advanced Color Customization */}
      <Card>
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CardHeader className="pb-3">
            <CollapsibleTrigger className="flex w-full items-center justify-between">
              <div className="text-left">
                <CardTitle className="text-base font-medium">Advanced Customization</CardTitle>
                <CardDescription>Fine-tune individual colors</CardDescription>
              </div>
              <ChevronDown
                className={cn(
                  'h-5 w-5 text-muted-foreground transition-transform',
                  advancedOpen && 'rotate-180'
                )}
              />
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent>
              <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                <p className="text-sm">
                  Advanced color customization allows you to override individual colors
                  from the selected theme preset.
                </p>
                <p className="mt-2 text-xs">
                  Currently viewing: {resolvedTheme === 'dark' ? 'Dark' : 'Light'} mode
                  {hasCustomColors && ' (with custom overrides)'}
                </p>
                {hasCustomColors && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={clearCustomColors}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Clear Custom Colors
                  </Button>
                )}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        {hasCustomColors && (
          <Button variant="outline" onClick={clearCustomColors}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Clear Customizations
          </Button>
        )}
        <Button variant="outline" onClick={resetToDefaults}>
          Reset All to Defaults
        </Button>
      </div>
    </div>
  );
}
