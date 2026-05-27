import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTheme } from '@/hooks/useTheme';
import {
  THEME_PRESETS,
  hslStringToHex,
  type ThemePresetId,
  type ThemeColors,
} from '@/lib/theme-presets';
import { ThemeEditor } from '@/components/settings/ThemeEditor';
import { type CustomTheme } from '@/stores/themeStore';
import { cn } from '@/lib/utils';
import { Sun, Moon, Monitor, RotateCcw, Check, Plus, Pencil, Trash2 } from 'lucide-react';

const themes = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
] as const;

const presetEntries = Object.entries(THEME_PRESETS) as [ThemePresetId, (typeof THEME_PRESETS)[ThemePresetId]][];

export function ThemeSettingsPage() {
  const {
    theme,
    presetId,
    fontSize,
    borderRadius,
    customColors,
    customThemes,
    setTheme,
    setPresetId,
    setFontSize,
    setBorderRadius,
    clearCustomColors,
    resetToDefaults,
    saveCustomTheme,
    updateCustomTheme,
    deleteCustomTheme,
  } = useTheme();

  // Custom theme editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [basePresetDialogOpen, setBasePresetDialogOpen] = useState(false);
  const [selectedBasePreset, setSelectedBasePreset] = useState<string>('lavender');
  const [editingTheme, setEditingTheme] = useState<CustomTheme | undefined>();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [themeToDelete, setThemeToDelete] = useState<string | null>(null);

  const hasCustomColors = Object.keys(customColors.light || {}).length > 0 || Object.keys(customColors.dark || {}).length > 0;

  // Get custom themes as array sorted by creation date
  const customThemesList = Object.values(customThemes).sort((a, b) => a.createdAt - b.createdAt);

  const handleCreateNewTheme = () => {
    setEditingTheme(undefined);
    setSelectedBasePreset('lavender');
    setBasePresetDialogOpen(true);
  };

  const handleSelectBaseAndEdit = () => {
    setBasePresetDialogOpen(false);
    setEditorOpen(true);
  };

  const handleEditTheme = (themeId: string) => {
    const themeToEdit = customThemes[themeId];
    if (themeToEdit) {
      setEditingTheme(themeToEdit);
      setSelectedBasePreset(themeToEdit.basePresetId);
      setEditorOpen(true);
    }
  };

  const handleDeleteTheme = (themeId: string) => {
    setThemeToDelete(themeId);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = () => {
    if (themeToDelete) {
      deleteCustomTheme(themeToDelete);
      setThemeToDelete(null);
    }
    setDeleteConfirmOpen(false);
  };

  const handleSaveTheme = (name: string, light: ThemeColors, dark: ThemeColors) => {
    if (editingTheme) {
      updateCustomTheme(editingTheme.id, { name, light, dark });
    } else {
      saveCustomTheme(name, selectedBasePreset, light, dark);
    }
  };

  // Generate preview colors for a custom theme
  const getCustomThemePreview = (customTheme: CustomTheme) => {
    return {
      primary: hslStringToHex(customTheme.light.primary),
      background: hslStringToHex(customTheme.light.background),
      accent: hslStringToHex(customTheme.light.accent),
    };
  };

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
          <CardDescription>Choose a complete color scheme or create your own</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Built-in presets */}
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

            {/* Custom themes */}
            {customThemesList.map((customTheme) => {
              const preview = getCustomThemePreview(customTheme);
              const isActive = presetId === customTheme.id;
              return (
                <div
                  key={customTheme.id}
                  className={cn(
                    'relative flex flex-col gap-3 rounded-lg border p-4 text-left transition-all',
                    isActive
                      ? 'border-primary ring-2 ring-primary ring-offset-2 ring-offset-background'
                      : 'border-border hover:bg-muted/50'
                  )}
                >
                  <button
                    onClick={() => setPresetId(customTheme.id)}
                    className="flex flex-col gap-3 text-left"
                  >
                    {/* Preview swatches */}
                    <div className="flex gap-1">
                      <div
                        className="h-8 w-8 rounded-md border shadow-sm"
                        style={{ backgroundColor: preview.background }}
                        title="Background"
                      />
                      <div
                        className="h-8 w-8 rounded-md border shadow-sm"
                        style={{ backgroundColor: preview.primary }}
                        title="Primary"
                      />
                      <div
                        className="h-8 w-8 rounded-md border shadow-sm"
                        style={{ backgroundColor: preview.accent }}
                        title="Accent"
                      />
                      {isActive && (
                        <div className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="font-medium">{customTheme.name}</p>
                      <p className="text-xs text-muted-foreground">Custom theme</p>
                    </div>
                  </button>
                  {/* Edit/Delete buttons */}
                  <div className="flex gap-1 mt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditTheme(customTheme.id);
                      }}
                    >
                      <Pencil className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteTheme(customTheme.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Delete
                    </Button>
                  </div>
                </div>
              );
            })}

            {/* Create Custom Theme button */}
            <button
              onClick={handleCreateNewTheme}
              className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-4 text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <Plus className="h-8 w-8" />
              <span className="text-sm font-medium">Create Custom Theme</span>
            </button>
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

      {/* Base Preset Selection Dialog */}
      <Dialog open={basePresetDialogOpen} onOpenChange={setBasePresetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select a Base Theme</DialogTitle>
            <DialogDescription>
              Choose a preset to start customizing from
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-4">
            {presetEntries.map(([id, preset]) => (
              <button
                key={id}
                onClick={() => setSelectedBasePreset(id)}
                className={cn(
                  'flex flex-col gap-2 rounded-lg border p-3 text-left transition-all',
                  selectedBasePreset === id
                    ? 'border-primary ring-2 ring-primary ring-offset-2 ring-offset-background'
                    : 'border-border hover:bg-muted/50'
                )}
              >
                <div className="flex gap-1">
                  <div
                    className="h-6 w-6 rounded border shadow-sm"
                    style={{ backgroundColor: preset.preview.background }}
                  />
                  <div
                    className="h-6 w-6 rounded border shadow-sm"
                    style={{ backgroundColor: preset.preview.primary }}
                  />
                  <div
                    className="h-6 w-6 rounded border shadow-sm"
                    style={{ backgroundColor: preset.preview.accent }}
                  />
                </div>
                <span className="text-sm font-medium">{preset.name}</span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBasePresetDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSelectBaseAndEdit}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Theme Editor */}
      <ThemeEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        basePresetId={selectedBasePreset}
        existingTheme={editingTheme}
        onSave={handleSaveTheme}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Custom Theme</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this custom theme? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
