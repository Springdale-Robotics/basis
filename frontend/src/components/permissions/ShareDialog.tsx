import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Share2,
  Trash2,
  Loader2,
  Users,
  User as UserIcon,
  Eye,
  Edit,
  Shield,
  Crown,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  permissionsApi,
  type Permission,
  type ResourceType,
  type PermissionLevel,
  type GranteeType,
} from '@/api/permissions';
import { groupsApi, type Group } from '@/api/groups';
import { householdsApi } from '@/api/households';
import { toast } from '@/hooks/useToast';
import type { User } from '@/types/models';

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceType: ResourceType;
  resourceId: string;
  resourceName: string;
}

export function ShareDialog({
  open,
  onOpenChange,
  resourceType,
  resourceId,
  resourceName,
}: ShareDialogProps) {
  const queryClient = useQueryClient();
  const [selectedGrantee, setSelectedGrantee] = useState('');
  const [selectedGranteeType, setSelectedGranteeType] = useState<GranteeType>('user');
  const [permissionLevel, setPermissionLevel] = useState<PermissionLevel>('view');

  // Get existing permissions
  const { data: permissionsData, isLoading: loadingPermissions } = useQuery({
    queryKey: ['permissions', resourceType, resourceId],
    queryFn: () => permissionsApi.getForResource(resourceType, resourceId),
    enabled: open,
  });

  // Get household members
  const { data: membersData } = useQuery({
    queryKey: ['household-members'],
    queryFn: () => householdsApi.getMembers(),
    enabled: open,
  });

  // Get groups
  const { data: groupsData } = useQuery({
    queryKey: ['groups'],
    queryFn: () => groupsApi.list(),
    enabled: open,
  });

  // Grant permission mutation
  const grantMutation = useMutation({
    mutationFn: () =>
      permissionsApi.grant(resourceType, resourceId, {
        granteeType: selectedGranteeType,
        granteeId: selectedGrantee,
        level: permissionLevel,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permissions', resourceType, resourceId] });
      setSelectedGrantee('');
      setPermissionLevel('view');
      toast({
        title: 'Permission granted',
        description: 'Access has been granted successfully.',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Could not grant permission.',
        variant: 'destructive',
      });
    },
  });

  // Update permission mutation
  const updateMutation = useMutation({
    mutationFn: ({ permissionId, level }: { permissionId: string; level: PermissionLevel }) =>
      permissionsApi.update(resourceType, resourceId, permissionId, level),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permissions', resourceType, resourceId] });
      toast({
        title: 'Permission updated',
        description: 'Access level has been updated.',
      });
    },
  });

  // Revoke permission mutation
  const revokeMutation = useMutation({
    mutationFn: (permissionId: string) =>
      permissionsApi.revoke(resourceType, resourceId, permissionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permissions', resourceType, resourceId] });
      toast({
        title: 'Permission revoked',
        description: 'Access has been revoked.',
      });
    },
  });

  const permissions = permissionsData?.permissions || [];
  const members = membersData?.members || [];
  const groups = groupsData?.groups || [];

  // Filter out entities that already have permissions
  const existingUserIds = new Set(
    permissions
      .filter((p) => p.granteeType === 'user')
      .map((p) => p.granteeId)
  );
  const existingGroupIds = new Set(
    permissions
      .filter((p) => p.granteeType === 'group')
      .map((p) => p.granteeId)
  );
  const hasHouseholdPermission = permissions.some((p) => p.granteeType === 'household');

  const availableMembers = members.filter((m) => !existingUserIds.has(m.id));
  const availableGroups = groups.filter((g) => !existingGroupIds.has(g.id));

  const getPermissionIcon = (level: PermissionLevel) => {
    switch (level) {
      case 'view_busy':
        return <Eye className="h-4 w-4 opacity-50" />;
      case 'view':
        return <Eye className="h-4 w-4" />;
      case 'edit':
        return <Edit className="h-4 w-4" />;
      case 'admin':
        return <Shield className="h-4 w-4" />;
    }
  };

  const getPermissionLabel = (level: PermissionLevel) => {
    switch (level) {
      case 'view_busy':
        return 'View busy';
      case 'view':
        return 'Can view';
      case 'edit':
        return 'Can edit';
      case 'admin':
        return 'Admin';
    }
  };

  const getGranteeIcon = (type: GranteeType) => {
    switch (type) {
      case 'user':
        return <UserIcon className="h-4 w-4" />;
      case 'group':
        return <Users className="h-4 w-4" />;
      case 'household':
        return <Users className="h-4 w-4" />;
      default:
        return <UserIcon className="h-4 w-4" />;
    }
  };

  const handleTabChange = (value: string) => {
    setSelectedGranteeType(value as GranteeType);
    setSelectedGrantee('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Share
          </DialogTitle>
          <DialogDescription>
            Manage who can access "{resourceName}"
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Add new share */}
          <Tabs
            defaultValue="user"
            value={selectedGranteeType}
            onValueChange={handleTabChange}
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="user">Users</TabsTrigger>
              <TabsTrigger value="group">Groups</TabsTrigger>
              <TabsTrigger value="household">Household</TabsTrigger>
            </TabsList>

            <TabsContent value="user" className="space-y-4 mt-4">
              {availableMembers.length > 0 ? (
                <>
                  <div className="space-y-2">
                    <Label>Select user</Label>
                    <Select value={selectedGrantee} onValueChange={setSelectedGrantee}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a user" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableMembers.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <PermissionLevelSelect
                    value={permissionLevel}
                    onChange={setPermissionLevel}
                  />

                  <Button
                    onClick={() => grantMutation.mutate()}
                    disabled={!selectedGrantee || grantMutation.isPending}
                    className="w-full"
                  >
                    {grantMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Share2 className="mr-2 h-4 w-4" />
                    )}
                    Share with user
                  </Button>
                </>
              ) : (
                <div className="text-center py-4 text-muted-foreground">
                  <UserIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">All users already have access</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="group" className="space-y-4 mt-4">
              {availableGroups.length > 0 ? (
                <>
                  <div className="space-y-2">
                    <Label>Select group</Label>
                    <Select value={selectedGrantee} onValueChange={setSelectedGrantee}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a group" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableGroups.map((group) => (
                          <SelectItem key={group.id} value={group.id}>
                            {group.name} ({group.memberCount} members)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <PermissionLevelSelect
                    value={permissionLevel}
                    onChange={setPermissionLevel}
                  />

                  <Button
                    onClick={() => grantMutation.mutate()}
                    disabled={!selectedGrantee || grantMutation.isPending}
                    className="w-full"
                  >
                    {grantMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Share2 className="mr-2 h-4 w-4" />
                    )}
                    Share with group
                  </Button>
                </>
              ) : groups.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No groups exist yet</p>
                  <p className="text-xs mt-1">Create groups in Settings &gt; Groups</p>
                </div>
              ) : (
                <div className="text-center py-4 text-muted-foreground">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">All groups already have access</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="household" className="space-y-4 mt-4">
              {!hasHouseholdPermission ? (
                <>
                  <div className="text-center py-4 text-muted-foreground">
                    <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Share with everyone in the household</p>
                  </div>

                  <PermissionLevelSelect
                    value={permissionLevel}
                    onChange={setPermissionLevel}
                  />

                  <Button
                    onClick={() => {
                      setSelectedGranteeType('household');
                      // Use current household ID (we'll set this in the mutation)
                      setSelectedGrantee('current');
                      grantMutation.mutate();
                    }}
                    disabled={grantMutation.isPending}
                    className="w-full"
                  >
                    {grantMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Share2 className="mr-2 h-4 w-4" />
                    )}
                    Share with household
                  </Button>
                </>
              ) : (
                <div className="text-center py-4 text-muted-foreground">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Household already has access</p>
                  <p className="text-xs mt-1">Manage the permission below</p>
                </div>
              )}
            </TabsContent>
          </Tabs>

          {/* Current permissions */}
          {permissions.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label className="text-muted-foreground">Current access</Label>
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {permissions.map((permission) => (
                    <PermissionItem
                      key={permission.id}
                      permission={permission}
                      onUpdate={(level) =>
                        updateMutation.mutate({ permissionId: permission.id, level })
                      }
                      onRemove={() => revokeMutation.mutate(permission.id)}
                      isUpdating={updateMutation.isPending}
                      isRemoving={revokeMutation.isPending}
                      getIcon={() => getGranteeIcon(permission.granteeType)}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {loadingPermissions && (
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

function PermissionLevelSelect({
  value,
  onChange,
}: {
  value: PermissionLevel;
  onChange: (value: PermissionLevel) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Permission level</Label>
      <Select value={value} onValueChange={(v) => onChange(v as PermissionLevel)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="view">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              <span>Can view</span>
            </div>
          </SelectItem>
          <SelectItem value="edit">
            <div className="flex items-center gap-2">
              <Edit className="h-4 w-4" />
              <span>Can edit</span>
            </div>
          </SelectItem>
          <SelectItem value="admin">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              <span>Admin</span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function PermissionItem({
  permission,
  onUpdate,
  onRemove,
  isUpdating,
  isRemoving,
  getIcon,
}: {
  permission: Permission;
  onUpdate: (level: PermissionLevel) => void;
  onRemove: () => void;
  isUpdating: boolean;
  isRemoving: boolean;
  getIcon: () => React.ReactNode;
}) {
  const isOwner = permission.permissionLevel === 'admin' && permission.granteeType === 'user';

  return (
    <div className="flex items-center justify-between p-3 border rounded-lg">
      <div className="flex items-center gap-2 min-w-0">
        <div className="text-muted-foreground">{getIcon()}</div>
        <div className="min-w-0">
          <span className="font-medium truncate block">
            {permission.grantee?.name || permission.granteeId}
          </span>
          {permission.grantee?.email && (
            <span className="text-xs text-muted-foreground truncate block">
              {permission.grantee.email}
            </span>
          )}
        </div>
        {isOwner && (
          <Badge variant="secondary" className="ml-2">
            <Crown className="h-3 w-3 mr-1" />
            Owner
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Select
          value={permission.permissionLevel}
          onValueChange={(v) => onUpdate(v as PermissionLevel)}
          disabled={isUpdating || isOwner}
        >
          <SelectTrigger className="w-[100px] h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="view">View</SelectItem>
            <SelectItem value="edit">Edit</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
        {!isOwner && (
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
        )}
      </div>
    </div>
  );
}
