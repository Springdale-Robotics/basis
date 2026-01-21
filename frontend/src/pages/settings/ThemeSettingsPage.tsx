import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';
import { Sun, Moon, Monitor } from 'lucide-react';

const themes = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
] as const;

const colorPresets = [
  { name: 'Default', value: '222.2 47.4% 11.2%' },
  { name: 'Blue', value: '221.2 83.2% 53.3%' },
  { name: 'Green', value: '142.1 76.2% 36.3%' },
  { name: 'Purple', value: '262.1 83.3% 57.8%' },
  { name: 'Rose', value: '346.8 77.2% 49.8%' },
  { name: 'Orange', value: '24.6 95% 53.1%' },
];

export function ThemeSettingsPage() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
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
        <CardHeader>
          <CardTitle>Primary Color</CardTitle>
          <CardDescription>Choose your accent color</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {colorPresets.map((preset) => (
              <button
                key={preset.name}
                className="group relative"
                title={preset.name}
              >
                <div
                  className="h-10 w-10 rounded-full border-2 border-border transition-transform hover:scale-110"
                  style={{
                    backgroundColor: `hsl(${preset.value})`,
                  }}
                />
                <span className="sr-only">{preset.name}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Font Size</CardTitle>
          <CardDescription>Adjust the base font size</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm">Small</span>
            <span className="text-sm">Large</span>
          </div>
          <Slider defaultValue={[16]} min={14} max={20} step={1} />
          <p className="text-sm text-muted-foreground">
            Current: 16px
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Border Radius</CardTitle>
          <CardDescription>Adjust the roundness of elements</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm">Square</span>
            <span className="text-sm">Round</span>
          </div>
          <Slider defaultValue={[0.5]} min={0} max={1} step={0.125} />
          <div className="flex gap-4 pt-2">
            <div className="h-12 w-12 rounded bg-primary" style={{ borderRadius: '0rem' }} />
            <div className="h-12 w-12 rounded bg-primary" style={{ borderRadius: '0.25rem' }} />
            <div className="h-12 w-12 rounded bg-primary" style={{ borderRadius: '0.5rem' }} />
            <div className="h-12 w-12 rounded bg-primary" style={{ borderRadius: '0.75rem' }} />
            <div className="h-12 w-12 rounded bg-primary" style={{ borderRadius: '1rem' }} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="outline">Reset to Defaults</Button>
      </div>
    </div>
  );
}
