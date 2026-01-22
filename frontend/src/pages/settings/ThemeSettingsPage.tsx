import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useTheme } from '@/hooks/useTheme';
import { COLOR_PRESETS, COLOR_PALETTES, type ColorPreset, type ColorPalette } from '@/lib/theme-presets';
import { cn } from '@/lib/utils';
import { Sun, Moon, Monitor } from 'lucide-react';

const themes = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
] as const;

const colorPresetEntries = Object.entries(COLOR_PRESETS) as [ColorPreset, typeof COLOR_PRESETS[ColorPreset]][];
const colorPaletteEntries = Object.entries(COLOR_PALETTES) as [ColorPalette, typeof COLOR_PALETTES[ColorPalette]][];

export function ThemeSettingsPage() {
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
  } = useTheme();

  return (
    <div className="space-y-6">
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Primary Color</CardTitle>
          <CardDescription>Choose your accent color for buttons and highlights</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {colorPresetEntries.map(([id, preset]) => (
              <button
                key={id}
                className="group relative"
                title={preset.name}
                onClick={() => setColorPreset(id)}
              >
                <div
                  className={cn(
                    'h-10 w-10 rounded-full border-2 transition-transform hover:scale-110',
                    colorPreset === id
                      ? 'border-foreground ring-2 ring-foreground ring-offset-2 ring-offset-background'
                      : 'border-border'
                  )}
                  style={{
                    backgroundColor: `hsl(${preset.primary})`,
                  }}
                />
                <span className="sr-only">{preset.name}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

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

      <div className="flex justify-end">
        <Button variant="outline" onClick={resetToDefaults}>
          Reset to Defaults
        </Button>
      </div>
    </div>
  );
}
