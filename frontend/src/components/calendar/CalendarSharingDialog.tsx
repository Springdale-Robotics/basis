import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Share2,
  Trash2,
  Loader2,
  Users,
  Eye,
  Edit,
  EyeOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { calendarsApi, type PermissionLevel, type CalendarShare } from '@/api/calendars';
import type { Calendar } from '@/types/models';
import { toast } from '@/hooks/useToast';

interface CalendarSharingDialogProps {
  calendar: Calendar;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CalendarSharingDialog({
  calendar,
  open,
  onOpenChange,
}: CalendarSharingDialogProps) {
  const queryClient = useQueryClient();
  const [selectedHousehold, setSelectedHousehold] = useState('');
  const [permissionLevel, setPermissionLevel] = useState<PermissionLevel>('view');

  // Get existing shares
  const { data: sharesData, isLoading: loadingShares } = useQuery({
    queryKey: ['calendar-shares', calendar.id],
    queryFn: () => calendarsApi.getCalendarShares(calendar.id),
    enabled: open,
  });

  // Get connected households for sharing
  const { data: householdsData, isLoading: loadingHouseholds } = useQuery({
    queryKey: ['connected-households'],
    queryFn: calendarsApi.getConnectedHouseholds,
    enabled: open,
  });

  // Share mutation
  const shareMutation = useMutation({
    mutationFn: () =>
      calendarsApi.shareCalendar(calendar.id, {
        householdId: selectedHousehold,
        permissionLevel,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-shares', calendar.id] });
      setSelectedHousehold('');
      setPermissionLevel('view');
      toast({
        title: 'Calendar Shared',
        description: 'Calendar has been shared successfully.',
      });
    },
    onError: () => {
      toast({
        title: 'Share Failed',
        description: 'Could not share calendar.',
        variant: 'destructive',
      });
    },
  });

  // Update share mutation
  const updateMutation = useMutation({
    mutationFn: ({ shareId, permission }: { shareId: string; permission: PermissionLevel }) =>
      calendarsApi.updateShare(calendar.id, shareId, permission),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-shares', calendar.id] });
      toast({
        title: 'Permission Updated',
        description: 'Share permission has been updated.',
      });
    },
  });

  // Remove share mutation
  const removeMutation = useMutation({
    mutationFn: (shareId: string) =>
      calendarsApi.removeShare(calendar.id, shareId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-shares', calendar.id] });
      toast({
        title: 'Share Removed',
        description: 'Calendar is no longer shared with this household.',
      });
    },
  });

  const shares = sharesData?.shares || [];
  const households = householdsData?.households || [];

  // Filter out households that already have access
  const sharedHouseholdIds = new Set(shares.map((s) => s.householdId));
  const availableHouseholds = households.filter((h) => !sharedHouseholdIds.has(h.id));

  const getPermissionIcon = (level: PermissionLevel) => {
    switch (level) {
      case 'view_busy':
        return <EyeOff className="h-4 w-4" />;
      case 'view':
        return <Eye className="h-4 w-4" />;
      case 'edit':
        return <Edit className="h-4 w-4" />;
    }
  };

  const getPermissionLabel = (level: PermissionLevel) => {
    switch (level) {
      case 'view_busy':
        return 'See free/busy only';
      case 'view':
        return 'View events';
      case 'edit':
        return 'Edit events';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Share Calendar
          </DialogTitle>
          <DialogDescription>
            Share "{calendar.name}" with connected households.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Add new share */}
          {availableHouseholds.length > 0 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Share with household</Label>
                <Select value={selectedHousehold} onValueChange={setSelectedHousehold}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a household" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableHouseholds.map((h) => (
                      <SelectItem key={h.id} value={h.id}>
                        {h.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Permission level</Label>
                <Select
                  value={permissionLevel}
                  onValueChange={(v) => setPermissionLevel(v as PermissionLevel)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="view_busy">
                      <div className="flex items-center gap-2">
                        <EyeOff className="h-4 w-4" />
                        <span>See free/busy only</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="view">
                      <div className="flex items-center gap-2">
                        <Eye className="h-4 w-4" />
                        <span>View event details</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="edit">
                      <div className="flex items-center gap-2">
                        <Edit className="h-4 w-4" />
                        <span>Edit events</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={() => shareMutation.mutate()}
                disabled={!selectedHousehold || shareMutation.isPending}
                className="w-full"
              >
                {shareMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Share2 className="mr-2 h-4 w-4" />
                )}
                Share Calendar
              </Button>
            </div>
          )}

          {availableHouseholds.length === 0 && households.length === 0 && (
            <div className="text-center py-4 text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">
                No connected households to share with. Connect with other households
                in Settings &gt; Connections.
              </p>
            </div>
          )}

          {/* Current shares */}
          {shares.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label className="text-muted-foreground">Currently shared with</Label>
                <div className="space-y-2">
                  {shares.map((share) => (
                    <ShareItem
                      key={share.id}
                      share={share}
                      onUpdatePermission={(permission) =>
                        updateMutation.mutate({ shareId: share.id, permission })
                      }
                      onRemove={() => removeMutation.mutate(share.id)}
                      isUpdating={updateMutation.isPending}
                      isRemoving={removeMutation.isPending}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {loadingShares && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShareItem({
  share,
  onUpdatePermission,
  onRemove,
  isUpdating,
  isRemoving,
}: {
  share: CalendarShare;
  onUpdatePermission: (permission: PermissionLevel) => void;
  onRemove: () => void;
  isUpdating: boolean;
  isRemoving: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-3 border rounded-lg">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{share.householdName}</span>
      </div>
      <div className="flex items-center gap-2">
        <Select
          value={share.permissionLevel}
          onValueChange={(v) => onUpdatePermission(v as PermissionLevel)}
          disabled={isUpdating}
        >
          <SelectTrigger className="w-[140px] h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="view_busy">Free/Busy</SelectItem>
            <SelectItem value="view">View</SelectItem>
            <SelectItem value="edit">Edit</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onRemove}
          disabled={isRemoving}
        >
          {isRemoving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4 text-destructive" />
          )}
        </Button>
      </div>
    </div>
  );
}
