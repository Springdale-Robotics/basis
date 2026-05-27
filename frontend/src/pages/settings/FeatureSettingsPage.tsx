import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import {
  Calendar,
  ChefHat,
  Package,
  CheckSquare,
  Trophy,
  Home,
  FolderOpen,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { settingsApi, type FeatureSettings } from '@/api/settings';
import { toast } from '@/hooks/useToast';

const FEATURE_META: Array<{
  key: keyof FeatureSettings;
  label: string;
  description: string;
  icon: typeof Calendar;
}> = [
  {
    key: 'calendar',
    label: 'Calendar',
    description: 'Shared household events, appointments, and scheduling.',
    icon: Calendar,
  },
  {
    key: 'recipes',
    label: 'Recipes & meal plan',
    description: 'Recipe library, meal planning, and cook mode.',
    icon: ChefHat,
  },
  {
    key: 'inventory',
    label: 'Inventory & shopping',
    description: 'Pantry tracking and the smart shopping list.',
    icon: Package,
  },
  {
    key: 'tasks',
    label: 'Tasks & chores',
    description: 'Assignable tasks, recurring chores, due dates.',
    icon: CheckSquare,
  },
  {
    key: 'rewards',
    label: 'Rewards & points',
    description:
      'Award points for completed chores and list items. Turn off if your household is past the chore-chart age — the points UI will be hidden everywhere.',
    icon: Trophy,
  },
  {
    key: 'smartHome',
    label: 'Smart home',
    description: 'Device integrations (lights, plugs, sensors).',
    icon: Home,
  },
  {
    key: 'files',
    label: 'Files & media',
    description: 'File browser, photos, videos, music, movies.',
    icon: FolderOpen,
  },
];

/**
 * Defaults to merge with whatever the backend has persisted. Older households
 * may not have every key in `enabledFeatures` — merging here makes the toggles
 * reflect actual app behavior (which falls back to these defaults) instead of
 * showing OFF for keys that simply haven't been saved yet.
 */
const FEATURE_DEFAULTS: FeatureSettings = {
  calendar: true,
  recipes: true,
  inventory: true,
  tasks: true,
  rewards: false,
  smartHome: true,
  files: true,
};

function withDefaults(partial: Partial<FeatureSettings> | undefined): FeatureSettings {
  return { ...FEATURE_DEFAULTS, ...(partial ?? {}) };
}

export function FeatureSettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'features'],
    queryFn: () => settingsApi.getFeatures(),
  });

  const [features, setFeatures] = useState<FeatureSettings | null>(null);

  useEffect(() => {
    if (data?.features) setFeatures(withDefaults(data.features));
  }, [data]);

  const update = useMutation({
    mutationFn: (vars: { patch: Partial<FeatureSettings>; previous: FeatureSettings }) =>
      settingsApi.updateFeatures(vars.patch),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'features'] });
      queryClient.invalidateQueries({ queryKey: ['feature-permissions'] });
      if (res?.features) setFeatures(withDefaults(res.features));
    },
    onError: (_err, vars) => {
      setFeatures(vars.previous);
      toast({
        title: 'Could not update features',
        description: 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  if (isLoading || !features) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
          <Skeleton className="mt-2 h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Features</CardTitle>
        <CardDescription>
          Turn major modules on or off for the whole household. Hidden features
          don't appear in the sidebar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {FEATURE_META.map((meta) => {
          const Icon = meta.icon;
          return (
            <div
              key={meta.key}
              className="flex items-start justify-between gap-4 rounded-md border p-4"
            >
              <div className="flex gap-3">
                <Icon className="mt-0.5 h-5 w-5 text-muted-foreground" />
                <div>
                  <Label htmlFor={`feat-${meta.key}`} className="text-base">
                    {meta.label}
                  </Label>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {meta.description}
                  </p>
                </div>
              </div>
              <Switch
                id={`feat-${meta.key}`}
                checked={!!features[meta.key]}
                disabled={update.isPending}
                onCheckedChange={(v) => {
                  const previous = features;
                  setFeatures({ ...features, [meta.key]: v });
                  update.mutate({ patch: { [meta.key]: v }, previous });
                }}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
