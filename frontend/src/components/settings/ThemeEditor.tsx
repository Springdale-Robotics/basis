import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ColorPickerRow } from './ColorPickerRow';
import { useTheme } from '@/hooks/useTheme';
import { type CustomTheme } from '@/stores/themeStore';
import {
  type ThemeColors,
  THEME_PRESETS,
  COLOR_LABELS,
  BASIC_COLORS,
  ADVANCED_COLORS,
  colorKeyToVar,
} from '@/lib/theme-presets';
import { cn } from '@/lib/utils';
import { Sun, Moon, ChevronDown, RotateCcw } from 'lucide-react';

interface ThemeEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  basePresetId: string;
  existingTheme?: CustomTheme;
  onSave: (name: string, light: ThemeColors, dark: ThemeColors) => void;
}

export function ThemeEditor({
  open,
  onOpenChange,
  basePresetId,
  existingTheme,
  onSave,
}: ThemeEditorProps) {
  const { presetId, customThemes, resolvedTheme } = useTheme();
  const [name, setName] = useState(existingTheme?.name || '');
  const [editingMode, setEditingMode] = useState<'light' | 'dark'>('light');
  const [lightColors, setLightColors] = useState<ThemeColors>(() => getInitialColors('light'));
  const [darkColors, setDarkColors] = useState<ThemeColors>(() => getInitialColors('dark'));
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Store original theme state to restore on cancel
  const originalThemeRef = useRef<{ mode: 'light' | 'dark'; colors: ThemeColors } | null>(null);

  function getInitialColors(mode: 'light' | 'dark'): ThemeColors {
    if (existingTheme) {
      return { ...existingTheme[mode] };
    }
    const preset = THEME_PRESETS[basePresetId];
    if (preset) {
      return { ...preset[mode] };
    }
    return { ...THEME_PRESETS.lavender[mode] };
  }

  // Get current active theme colors
  const getActiveColors = (mode: 'light' | 'dark'): ThemeColors => {
    if (customThemes[presetId]) {
      return customThemes[presetId][mode];
    }
    const preset = THEME_PRESETS[presetId];
    if (preset) {
      return preset[mode];
    }
    return THEME_PRESETS.lavender[mode];
  };

  // Reset state when dialog opens with new props
  useEffect(() => {
    if (open) {
      // Save original theme state
      originalThemeRef.current = {
        mode: resolvedTheme,
        colors: getActiveColors(resolvedTheme),
      };
      setName(existingTheme?.name || '');
      setLightColors(getInitialColors('light'));
      setDarkColors(getInitialColors('dark'));
      setEditingMode('light');
      setAdvancedOpen(false);
    }
  }, [open, existingTheme, basePresetId]);

  // Live preview - apply colors to CSS vars as user edits
  useEffect(() => {
    if (!open) return;

    const root = document.documentElement;
    const colors = editingMode === 'light' ? lightColors : darkColors;

    Object.entries(colors).forEach(([key, value]) => {
      const varName = colorKeyToVar(key);
      root.style.setProperty(varName, value as string);
    });

    // Also ensure the correct class is applied
    root.classList.remove('light', 'dark');
    root.classList.add(editingMode);
  }, [open, lightColors, darkColors, editingMode]);

  // Restore original theme when dialog closes without saving
  const restoreOriginalTheme = () => {
    if (originalThemeRef.current) {
      const root = document.documentElement;
      const { mode, colors } = originalThemeRef.current;

      // Restore classes
      root.classList.remove('light', 'dark');
      root.classList.add(mode);

      // Restore colors
      Object.entries(colors).forEach(([key, value]) => {
        const varName = colorKeyToVar(key);
        root.style.setProperty(varName, value as string);
      });
    }
  };

  const handleCancel = () => {
    restoreOriginalTheme();
    onOpenChange(false);
  };

  const handleColorChange = (key: keyof ThemeColors, value: string) => {
    if (editingMode === 'light') {
      setLightColors((prev) => ({ ...prev, [key]: value }));
    } else {
      setDarkColors((prev) => ({ ...prev, [key]: value }));
    }
  };

  const handleResetToBase = () => {
    const preset = THEME_PRESETS[basePresetId] || THEME_PRESETS.lavender;
    if (editingMode === 'light') {
      setLightColors({ ...preset.light });
    } else {
      setDarkColors({ ...preset.dark });
    }
  };

  const handleSave = () => {
    if (!name.trim()) return;
    // Restore original theme first, then the save will trigger proper theme application
    restoreOriginalTheme();
    onSave(name.trim(), lightColors, darkColors);
    onOpenChange(false);
  };

  // Handle dialog close (X button or backdrop click)
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      restoreOriginalTheme();
    }
    onOpenChange(newOpen);
  };

  const currentColors = editingMode === 'light' ? lightColors : darkColors;

  const renderColorSection = (title: string, colorKeys: (keyof ThemeColors)[]) => (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground">{title}</h4>
      <div className="space-y-2">
        {colorKeys.map((key) => (
          <ColorPickerRow
            key={key}
            label={COLOR_LABELS[key]}
            value={currentColors[key]}
            onChange={(value) => handleColorChange(key, value)}
          />
        ))}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {existingTheme ? 'Edit Custom Theme' : 'Create Custom Theme'}
          </DialogTitle>
          <DialogDescription>
            Customize colors for your theme. Changes are previewed in real-time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Theme Name */}
          <div className="space-y-2">
            <Label htmlFor="theme-name">Theme Name</Label>
            <Input
              id="theme-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Custom Theme"
              className="max-w-xs"
            />
          </div>

          {/* Light/Dark Mode Toggle */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Editing:</span>
            <div className="flex rounded-lg border p-1">
              <button
                onClick={() => setEditingMode('light')}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  editingMode === 'light'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                )}
              >
                <Sun className="h-4 w-4" />
                Light
              </button>
              <button
                onClick={() => setEditingMode('dark')}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  editingMode === 'dark'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                )}
              >
                <Moon className="h-4 w-4" />
                Dark
              </button>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetToBase}
              className="ml-auto"
            >
              <RotateCcw className="mr-2 h-3 w-3" />
              Reset {editingMode}
            </Button>
          </div>

          {/* Basic Colors */}
          {renderColorSection('Basic Colors', BASIC_COLORS)}

          {/* Advanced Colors (collapsible) */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left hover:bg-muted/50">
              <span className="font-medium">Advanced Colors</span>
              <ChevronDown
                className={cn(
                  'h-5 w-5 text-muted-foreground transition-transform',
                  advancedOpen && 'rotate-180'
                )}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-6 pt-4">
              {renderColorSection('Surfaces', ADVANCED_COLORS.surfaces)}
              {renderColorSection('Foreground Colors', ADVANCED_COLORS.foregrounds)}
              {renderColorSection('Success', ADVANCED_COLORS.success)}
              {renderColorSection('Warning', ADVANCED_COLORS.warning)}
              {renderColorSection('Error', ADVANCED_COLORS.error)}
              {renderColorSection('Info', ADVANCED_COLORS.info)}
              {renderColorSection('Destructive', ADVANCED_COLORS.destructive)}
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            {existingTheme ? 'Save Changes' : 'Create Theme'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
