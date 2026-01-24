import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, HardDrive, AlertTriangle, Info, Image, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { settingsApi } from '@/api/settings';
import { filesApi, type StorageUsage } from '@/api/files';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/api-error';
import { cn } from '@/lib/utils';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getProgressColor(percent: number): string {
  if (percent >= 95) return 'bg-red-500';
  if (percent >= 80) return 'bg-yellow-500';
  return 'bg-primary';
}

function getLimitSourceLabel(source: string): string {
  switch (source) {
    case 'household':
      return 'Custom limit';
    case 'system':
      return 'System default';
    case 'disk':
      return 'Disk capacity';
    default:
      return source;
  }
}

export function StorageSettingsPage() {
  const queryClient = useQueryClient();
  const [useCustomLimit, setUseCustomLimit] = useState(false);
  const [limitGb, setLimitGb] = useState<string>('');

  const { data: storageSettings, isLoading: settingsLoading } = useQuery({
    queryKey: ['settings', 'storage'],
    queryFn: settingsApi.getStorageSettings,
  });

  const { data: storageUsage, isLoading: usageLoading } = useQuery({
    queryKey: ['files', 'storage', 'usage'],
    queryFn: filesApi.getStorageUsage,
  });

  // Sync local state with server data
  useEffect(() => {
    if (storageSettings) {
      const hasCustomLimit = storageSettings.storage.limitGb !== null;
      setUseCustomLimit(hasCustomLimit);
      setLimitGb(hasCustomLimit ? String(storageSettings.storage.limitGb) : '');
    }
  }, [storageSettings]);

  const updateMutation = useMutation({
    mutationFn: settingsApi.updateStorageSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'storage'] });
      queryClient.invalidateQueries({ queryKey: ['files', 'storage', 'usage'] });
      toast({ title: 'Storage settings updated' });
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  const regenerateThumbnailsMutation = useMutation({
    mutationFn: () => filesApi.regenerateThumbnails(),
    onSuccess: (data) => {
      toast({ title: 'Thumbnails queued', description: `${data.queuedCount} files queued for thumbnail generation` });
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  const handleSave = () => {
    if (useCustomLimit) {
      const gb = parseFloat(limitGb);
      if (isNaN(gb) || gb <= 0) {
        toast({ title: 'Invalid limit', description: 'Please enter a valid number greater than 0', variant: 'destructive' });
        return;
      }
      updateMutation.mutate({ limitGb: gb });
    } else {
      updateMutation.mutate({ limitGb: null });
    }
  };

  const handleToggleCustomLimit = (checked: boolean) => {
    setUseCustomLimit(checked);
    if (!checked) {
      // Immediately save when disabling custom limit
      updateMutation.mutate({ limitGb: null });
    } else if (storageSettings?.systemDefaultGb) {
      // Pre-fill with system default when enabling
      setLimitGb(String(storageSettings.systemDefaultGb));
    }
  };

  if (settingsLoading || usageLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const usage = storageUsage;
  const settings = storageSettings;

  // Calculate if limit is less than current usage
  const currentUsageGb = settings ? settings.currentUsageBytes / (1024 * 1024 * 1024) : 0;
  const proposedLimitGb = useCustomLimit ? parseFloat(limitGb) : null;
  const limitBelowUsage = proposedLimitGb !== null && !isNaN(proposedLimitGb) && proposedLimitGb < currentUsageGb;

  return (
    <div className="space-y-6">
      {/* Storage Usage Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Storage Usage
          </CardTitle>
          <CardDescription>Current storage usage for your household</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {usage && (
            <>
              {/* Progress bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>{formatBytes(usage.usedBytes)} used</span>
                  <span>
                    {usage.effectiveLimit > 0
                      ? `${formatBytes(usage.effectiveLimit)} limit`
                      : 'No limit set'}
                  </span>
                </div>
                <div className="relative h-4 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn(
                      'h-full transition-all',
                      getProgressColor(usage.percentUsed)
                    )}
                    style={{ width: `${Math.min(usage.percentUsed, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{Math.round(usage.percentUsed)}% used</span>
                  <span>Limit source: {getLimitSourceLabel(usage.limitSource)}</span>
                </div>
              </div>

              {/* Breakdown by type */}
              <div>
                <h4 className="text-sm font-medium mb-3">Breakdown by type</h4>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {Object.entries(usage.breakdown).map(([type, bytes]) => (
                    <div key={type} className="text-center p-3 rounded-lg bg-muted/50">
                      <div className="text-lg font-semibold">{formatBytes(bytes)}</div>
                      <div className="text-xs text-muted-foreground capitalize">{type}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Disk info */}
              {usage.filesystem && (
                <div className="pt-4 border-t">
                  <h4 className="text-sm font-medium mb-2">Disk Information</h4>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <div>Total disk space: {formatBytes(usage.filesystem.totalBytes)}</div>
                    <div>Available: {formatBytes(usage.filesystem.availableBytes)}</div>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Storage Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle>Storage Limit</CardTitle>
          <CardDescription>
            Configure a custom storage limit for your household
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Default info */}
          {settings && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
              <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="text-sm text-muted-foreground">
                <p>
                  {settings.systemDefaultGb !== null ? (
                    <>System default limit: <strong>{settings.systemDefaultGb} GB</strong></>
                  ) : settings.diskCapacityGb !== null ? (
                    <>No system limit set. Disk capacity: <strong>{settings.diskCapacityGb} GB</strong></>
                  ) : (
                    <>No system limit or disk information available</>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Toggle for custom limit */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="use-custom-limit">Use custom limit</Label>
              <p className="text-sm text-muted-foreground">
                Override the system default with a custom storage limit
              </p>
            </div>
            <Switch
              id="use-custom-limit"
              checked={useCustomLimit}
              onCheckedChange={handleToggleCustomLimit}
              disabled={updateMutation.isPending}
            />
          </div>

          {/* Limit input */}
          {useCustomLimit && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="limit-gb">Storage limit (GB)</Label>
                <div className="flex gap-2">
                  <Input
                    id="limit-gb"
                    type="number"
                    min="1"
                    step="1"
                    value={limitGb}
                    onChange={(e) => setLimitGb(e.target.value)}
                    placeholder="e.g., 100"
                    className="max-w-[200px]"
                  />
                  <Button
                    onClick={handleSave}
                    disabled={updateMutation.isPending || !limitGb}
                  >
                    {updateMutation.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Save
                  </Button>
                </div>
              </div>

              {/* Warning if limit below usage */}
              {limitBelowUsage && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    This limit ({proposedLimitGb?.toFixed(1)} GB) is below your current usage (
                    {currentUsageGb.toFixed(2)} GB). New uploads will be blocked until you free up space.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Maintenance Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Maintenance
          </CardTitle>
          <CardDescription>
            Tools to maintain and repair your file library
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Image className="h-4 w-4 text-muted-foreground" />
                <Label>Regenerate Thumbnails</Label>
              </div>
              <p className="text-sm text-muted-foreground">
                Generate missing thumbnails for images and videos. This is useful after installing ffmpeg or if thumbnails are missing.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => regenerateThumbnailsMutation.mutate()}
              disabled={regenerateThumbnailsMutation.isPending}
            >
              {regenerateThumbnailsMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Regenerate
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
