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
  User as UserIcon,
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  calendarsApi,
  type PermissionLevel,
  type CalendarShare,
  type CalendarAccessRule,
} from '@/api/calendars';
import { householdsApi } from '@/api/households';
import { groupsApi } from '@/api/groups';
import type { Calendar } from '@/types/models';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/api-error';

interface CalendarSharingDialogProps {
  calendar: Calendar;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function permissionLabel(level: PermissionLevel): string {
  switch (level) {
    case 'view_busy':
      return 'See free/busy only';
    case 'view':
      return 'View events';
    case 'edit':
      return 'Edit events';
  }
}

export function CalendarSharingDialog({
  calendar,
  open,
  onOpenChange,
}: CalendarSharingDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Share Calendar
          </DialogTitle>
          <DialogDescription>
            Control who can see and edit "{calendar.name}".
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="household">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="household">Inside household</TabsTrigger>
            <TabsTrigger value="connected">Connected households</TabsTrigger>
          </TabsList>
          <TabsContent value="household" className="space-y-4">
            <IntraHouseholdAccess calendar={calendar} open={open} />
          </TabsContent>
          <TabsContent value="connected" className="space-y-4">
            <ConnectedHouseholdSharing calendar={calendar} open={open} />
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Inside-household access ───────────────────────────────────────────────

const ROLE_OPTIONS: { id: 'admin' | 'member' | 'kid' | 'visitor'; label: string }[] = [
  { id: 'admin', label: 'Admins (Parents)' },
  { id: 'member', label: 'Members' },
  { id: 'kid', label: 'Kids' },
  { id: 'visitor', label: 'Visitors' },
];

export function IntraHouseholdAccess({ calendar, open }: { calendar: Calendar; open: boolean }) {
  const queryClient = useQueryClient();
  const [principalType, setPrincipalType] = useState<'user' | 'group' | 'role'>('role');
  const [principalId, setPrincipalId] = useState('');
  const [level, setLevel] = useState<PermissionLevel>('edit');

  const { data: rulesData, isLoading: loadingRules } = useQuery({
    queryKey: ['calendar-access', calendar.id],
    queryFn: () => calendarsApi.listAccessRules(calendar.id),
    enabled: open,
  });
  const { data: membersData } = useQuery({
    queryKey: ['households', 'current', 'members'],
    queryFn: householdsApi.getMembers,
    enabled: open,
  });
  const { data: groupsData } = useQuery({
    queryKey: ['groups'],
    queryFn: groupsApi.list,
    enabled: open,
  });

  const rules = rulesData?.rules ?? [];
  const members = membersData?.members ?? [];
  const groups = groupsData?.groups ?? [];

  const usedKeys = new Set(
    rules.map((r) => `${r.principalType}:${r.principalId}`)
  );
  const availablePrincipals =
    principalType === 'user'
      ? members.filter((m) => !usedKeys.has(`user:${m.id}`)).map((m) => ({ id: m.id, label: m.displayName || m.email }))
      : principalType === 'group'
      ? groups.filter((g) => !usedKeys.has(`group:${g.id}`)).map((g) => ({ id: g.id, label: g.name }))
      : ROLE_OPTIONS.filter((r) => !usedKeys.has(`role:${r.id}`));

  const upsertMutation = useMutation({
    mutationFn: () =>
      calendarsApi.upsertAccessRule(calendar.id, {
        principalType,
        principalId,
        permissionLevel: level,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-access', calendar.id] });
      setPrincipalId('');
      toast({ title: 'Access granted' });
    },
    onError: (err) =>
      toast({ title: 'Could not grant', description: getErrorMessage(err), variant: 'destructive' }),
  });

  const removeMutation = useMutation({
    mutationFn: (ruleId: string) => calendarsApi.deleteAccessRule(calendar.id, ruleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-access', calendar.id] });
      toast({ title: 'Access removed' });
    },
  });

  return (
    <div className="space-y-4">
      {rules.length === 0 && (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          No restrictions — every member of this household can read and write this
          calendar. Add a rule below to scope it down (e.g. only the "Parents" group).
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Select value={principalType} onValueChange={(v) => { setPrincipalType(v as 'user' | 'group' | 'role'); setPrincipalId(''); }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="role">Role</SelectItem>
            <SelectItem value="group">Group</SelectItem>
            <SelectItem value="user">User</SelectItem>
          </SelectContent>
        </Select>
        <Select value={principalId} onValueChange={setPrincipalId}>
          <SelectTrigger>
            <SelectValue
              placeholder={
                principalType === 'user'
                  ? 'Pick a member'
                  : principalType === 'group'
                  ? 'Pick a group'
                  : 'Pick a role'
              }
            />
          </SelectTrigger>
          <SelectContent>
            {availablePrincipals.length === 0 ? (
              <SelectItem value="__none" disabled>
                {principalType === 'user'
                  ? 'No more members'
                  : principalType === 'group'
                  ? 'No more groups'
                  : 'No more roles'}
              </SelectItem>
            ) : (
              availablePrincipals.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Permission</Label>
        <Select value={level} onValueChange={(v) => setLevel(v as PermissionLevel)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="view_busy"><PermissionRow level="view_busy" /></SelectItem>
            <SelectItem value="view"><PermissionRow level="view" /></SelectItem>
            <SelectItem value="edit"><PermissionRow level="edit" /></SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Button
        onClick={() => upsertMutation.mutate()}
        disabled={!principalId || upsertMutation.isPending}
        className="w-full"
      >
        {upsertMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Add access rule
      </Button>

      {rules.length > 0 && (
        <>
          <Separator />
          <div className="space-y-2">
            {rules.map((r) => (
              <AccessRuleRow
                key={r.id}
                rule={r}
                onRemove={() => removeMutation.mutate(r.id)}
                isRemoving={removeMutation.isPending}
              />
            ))}
          </div>
        </>
      )}

      {loadingRules && (
        <div className="flex items-center justify-center py-2">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
    </div>
  );
}

function PermissionRow({ level }: { level: PermissionLevel }) {
  const Icon = level === 'view_busy' ? EyeOff : level === 'view' ? Eye : Edit;
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4" />
      <span>{permissionLabel(level)}</span>
    </div>
  );
}

function AccessRuleRow({
  rule,
  onRemove,
  isRemoving,
}: {
  rule: CalendarAccessRule;
  onRemove: () => void;
  isRemoving: boolean;
}) {
  const Icon =
    rule.principalType === 'group' || rule.principalType === 'role'
      ? Users
      : UserIcon;
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="truncate font-medium">{rule.principalLabel}</span>
        <span className="text-xs text-muted-foreground">· {permissionLabel(rule.permissionLevel)}</span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={onRemove}
        disabled={isRemoving}
        aria-label={`Remove ${rule.principalLabel}`}
      >
        {isRemoving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
      </Button>
    </div>
  );
}

// ─── Connected-household sharing (preserved from prior implementation) ──────

function ConnectedHouseholdSharing({ calendar, open }: { calendar: Calendar; open: boolean }) {
  const queryClient = useQueryClient();
  const [selectedHousehold, setSelectedHousehold] = useState('');
  const [permissionLevel, setPermissionLevel] = useState<PermissionLevel>('view');

  const { data: sharesData, isLoading: loadingShares } = useQuery({
    queryKey: ['calendar-shares', calendar.id],
    queryFn: () => calendarsApi.getCalendarShares(calendar.id),
    enabled: open,
  });
  const { data: householdsData } = useQuery({
    queryKey: ['connected-households'],
    queryFn: calendarsApi.getConnectedHouseholds,
    enabled: open,
  });

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
      toast({ title: 'Shared' });
    },
    onError: (err) =>
      toast({ title: 'Could not share', description: getErrorMessage(err), variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ shareId, permission }: { shareId: string; permission: PermissionLevel }) =>
      calendarsApi.updateShare(calendar.id, shareId, permission),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendar-shares', calendar.id] }),
  });

  const removeMutation = useMutation({
    mutationFn: (shareId: string) => calendarsApi.removeShare(calendar.id, shareId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendar-shares', calendar.id] }),
  });

  const shares = sharesData?.shares || [];
  const households = householdsData?.households || [];
  const sharedHouseholdIds = new Set(shares.map((s) => s.householdId));
  const availableHouseholds = households.filter((h) => !sharedHouseholdIds.has(h.id));

  return (
    <div className="space-y-4">
      {availableHouseholds.length > 0 && (
        <>
          <div className="space-y-2">
            <Label>Share with household</Label>
            <Select value={selectedHousehold} onValueChange={setSelectedHousehold}>
              <SelectTrigger><SelectValue placeholder="Select a household" /></SelectTrigger>
              <SelectContent>
                {availableHouseholds.map((h) => (
                  <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Permission</Label>
            <Select value={permissionLevel} onValueChange={(v) => setPermissionLevel(v as PermissionLevel)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="view_busy"><PermissionRow level="view_busy" /></SelectItem>
                <SelectItem value="view"><PermissionRow level="view" /></SelectItem>
                <SelectItem value="edit"><PermissionRow level="edit" /></SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => shareMutation.mutate()}
            disabled={!selectedHousehold || shareMutation.isPending}
            className="w-full"
          >
            {shareMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Share2 className="mr-2 h-4 w-4" />}
            Share calendar
          </Button>
        </>
      )}

      {availableHouseholds.length === 0 && households.length === 0 && (
        <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
          No connected households. Connect with other households in Settings &gt; Connections.
        </div>
      )}

      {shares.length > 0 && (
        <>
          <Separator />
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
        </>
      )}

      {loadingShares && (
        <div className="flex items-center justify-center py-2">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
    </div>
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
    <div className="flex items-center justify-between rounded-lg border p-3">
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
          <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
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
          {isRemoving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
        </Button>
      </div>
    </div>
  );
}
