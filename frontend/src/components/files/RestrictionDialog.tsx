import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Lock,
  Unlock,
  Trash2,
  Loader2,
  Users,
  User as UserIcon,
  Eye,
  Edit,
  Shield,
  Crown,
  AlertTriangle,
  FolderLock,
  Link,
  UserCog,
  Ban,
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
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { filesApi } from '@/api/files';
import {
  permissionsApi,
  type Permission,
  type PermissionLevel,
  type GranteeType,
  type UserRole,
} from '@/api/permissions';
import { groupsApi } from '@/api/groups';
import { householdsApi } from '@/api/households';
import { toast } from '@/hooks/useToast';

interface RestrictionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceType: 'file' | 'folder';
  resourceId: string;
  resourceName: string;
}

export function RestrictionDialog({
  open,
  onOpenChange,
  resourceType,
  resourceId,
  resourceName,
}: RestrictionDialogProps) {
  const queryClient = useQueryClient();
  const [selectedGrantee, setSelectedGrantee] = useState('');
  const [selectedGranteeType, setSelectedGranteeType] = useState<GranteeType>('user');
  const [permissionLevel, setPermissionLevel] = useState<PermissionLevel>('view');

  // Get restriction status
  const { data: restrictionData, isLoading: loadingRestriction } = useQuery({
    queryKey: ['restriction', resourceType, resourceId],
    queryFn: () =>
      resourceType === 'folder'
        ? filesApi.getFolderRestriction(resourceId)
        : filesApi.getFileRestriction(resourceId),
    enabled: open,
  });

  // Get existing permissions
  const { data: permissionsData, isLoading: loadingPermissions } = useQuery({
    queryKey: ['permissions', 'file', resourceId],
    queryFn: () => permissionsApi.getForResource('file', resourceId),
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

  // Toggle restriction mutation
  const toggleRestrictionMutation = useMutation({
    mutationFn: (restricted: boolean) =>
      resourceType === 'folder'
        ? filesApi.setFolderRestriction(resourceId, restricted)
        : filesApi.setFileRestriction(resourceId, restricted),
    onSuccess: (data, restricted) => {
      queryClient.invalidateQueries({ queryKey: ['restriction', resourceType, resourceId] });
      queryClient.invalidateQueries({ queryKey: ['files'] });
      toast({
        title: restricted ? 'Access restricted' : 'Restriction removed',
        description: restricted
          ? 'Only users with explicit permissions can access this item.'
          : 'All household members can now access this item based on their role.',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Could not update restriction.',
        variant: 'destructive',
      });
    },
  });

  // Grant permission mutation
  const grantMutation = useMutation({
    mutationFn: () =>
      permissionsApi.grant('file', resourceId, {
        granteeType: selectedGranteeType,
        granteeId: selectedGrantee,
        level: permissionLevel,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permissions', 'file', resourceId] });
      setSelectedGrantee('');
      setPermissionLevel('view');
      toast({
        title: 'Access granted',
        description: 'User can now access this item.',
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
      permissionsApi.update('file', resourceId, permissionId, level),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permissions', 'file', resourceId] });
      toast({
        title: 'Permission updated',
      });
    },
  });

  // Revoke permission mutation
  const revokeMutation = useMutation({
    mutationFn: (permissionId: string) =>
      permissionsApi.revoke('file', resourceId, permissionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permissions', 'file', resourceId] });
      toast({
        title: 'Access revoked',
      });
    },
  });

  const restriction = restrictionData;
  const isRestricted = restriction?.isRestricted ?? false;
  const restrictedDirectly = restriction?.restrictedDirectly ?? false;
  const restrictedBy = restriction?.restrictedBy;
  const inheritedRestriction = isRestricted && !restrictedDirectly;

  const permissions = permissionsData?.permissions || [];
  const members = membersData?.members || [];
  const groups = groupsData?.groups || [];

  // Filter out entities that already have permissions
  const existingUserIds = new Set(
    permissions.filter((p) => p.granteeType === 'user').map((p) => p.granteeId)
  );
  const existingGroupIds = new Set(
    permissions.filter((p) => p.granteeType === 'group').map((p) => p.granteeId)
  );

  const availableMembers = members.filter((m) => !existingUserIds.has(m.id));
  const availableGroups = groups.filter((g) => !existingGroupIds.has(g.id));

  const handleTabChange = (value: string) => {
    setSelectedGranteeType(value as GranteeType);
    setSelectedGrantee('');
  };

  const isLoading = loadingRestriction || loadingPermissions;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isRestricted ? (
              <Lock className="h-5 w-5 text-amber-500" />
            ) : (
              <Unlock className="h-5 w-5" />
            )}
            Restrict Access
          </DialogTitle>
          <DialogDescription>
            Control who can access "{resourceName}"
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Restriction toggle */}
            {inheritedRestriction && restrictedBy ? (
              <Alert>
                <FolderLock className="h-4 w-4" />
                <AlertDescription className="flex items-center justify-between">
                  <span>
                    Restricted by parent folder:{' '}
                    <span className="font-medium">{restrictedBy.name}</span>
                  </span>
                </AlertDescription>
              </Alert>
            ) : (
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-0.5">
                  <Label htmlFor="restrict-toggle" className="text-base font-medium">
                    Restrict this {resourceType}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    When restricted, only users you specify can access
                    {resourceType === 'folder' ? ' this folder and its contents' : ' this file'}.
                  </p>
                </div>
                <Switch
                  id="restrict-toggle"
                  checked={isRestricted}
                  onCheckedChange={(checked) => toggleRestrictionMutation.mutate(checked)}
                  disabled={toggleRestrictionMutation.isPending || inheritedRestriction}
                />
              </div>
            )}

            {/* Access list section */}
            {isRestricted && (
              <>
                <Separator />

                <div className="space-y-4">
                  <Label className="text-base font-medium">Who can access</Label>

                  {/* Current permissions */}
                  {permissions.length > 0 && (
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
                        />
                      ))}
                    </div>
                  )}

                  {permissions.length === 0 && (
                    <div className="text-center py-4 text-muted-foreground">
                      <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No one has explicit access yet.</p>
                      <p className="text-xs mt-1">Add users or groups below.</p>
                    </div>
                  )}

                  {/* Add permission section */}
                  <Separator />

                  <Tabs
                    defaultValue="user"
                    value={selectedGranteeType}
                    onValueChange={handleTabChange}
                  >
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="user">User</TabsTrigger>
                      <TabsTrigger value="group">Group</TabsTrigger>
                      <TabsTrigger value="role">Role</TabsTrigger>
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
                              <UserIcon className="mr-2 h-4 w-4" />
                            )}
                            Add user
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
                              <Users className="mr-2 h-4 w-4" />
                            )}
                            Add group
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

                    <TabsContent value="role" className="space-y-4 mt-4">
                      <RolePermissions
                        permissions={permissions}
                        resourceId={resourceId}
                        onSetPermission={(role, level) => {
                          // Find existing role permission
                          const existingPerm = permissions.find(
                            (p) => p.granteeType === 'role' && p.granteeId === role
                          );
                          if (existingPerm) {
                            // Update existing permission
                            updateMutation.mutate({ permissionId: existingPerm.id, level });
                          } else {
                            // Create new permission
                            permissionsApi.grant('file', resourceId, {
                              granteeType: 'role',
                              granteeId: role,
                              level,
                            }).then(() => {
                              queryClient.invalidateQueries({ queryKey: ['permissions', 'file', resourceId] });
                              toast({ title: 'Role permission set' });
                            }).catch(() => {
                              toast({ title: 'Error', description: 'Could not set role permission.', variant: 'destructive' });
                            });
                          }
                        }}
                        isLoading={grantMutation.isPending || updateMutation.isPending || revokeMutation.isPending}
                      />
                    </TabsContent>
                  </Tabs>
                </div>
              </>
            )}

            {/* Unrestricted info */}
            {!isRestricted && (
              <Alert>
                <Users className="h-4 w-4" />
                <AlertDescription>
                  Everyone in your household can access this {resourceType} based on their role.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

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
}: {
  permission: Permission;
  onUpdate: (level: PermissionLevel) => void;
  onRemove: () => void;
  isUpdating: boolean;
  isRemoving: boolean;
}) {
  const isOwner = permission.permissionLevel === 'admin' && permission.granteeType === 'user';
  const isUser = permission.granteeType === 'user';
  const isGroup = permission.granteeType === 'group';

  return (
    <div className="flex items-center justify-between p-3 border rounded-lg">
      <div className="flex items-center gap-2 min-w-0">
        <div className="text-muted-foreground">
          {isUser ? (
            <UserIcon className="h-4 w-4" />
          ) : isGroup ? (
            <Users className="h-4 w-4" />
          ) : (
            <Users className="h-4 w-4" />
          )}
        </div>
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

const ROLES: UserRole[] = ['admin', 'member', 'kid', 'visitor'];

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  member: 'Member',
  kid: 'Kid',
  visitor: 'Visitor',
};

function RolePermissions({
  permissions,
  resourceId,
  onSetPermission,
  isLoading,
}: {
  permissions: Permission[];
  resourceId: string;
  onSetPermission: (role: UserRole, level: PermissionLevel) => void;
  isLoading: boolean;
}) {
  // Get existing role permissions
  const rolePermissions = permissions.filter((p) => p.granteeType === 'role');
  const rolePermMap = new Map(rolePermissions.map((p) => [p.granteeId, p.permissionLevel]));

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Set default access levels for each role when this item is restricted.
      </p>
      {ROLES.map((role) => {
        const currentLevel = rolePermMap.get(role) || 'none';

        return (
          <div
            key={role}
            className="flex items-center justify-between p-3 border rounded-lg"
          >
            <div className="flex items-center gap-2">
              <UserCog className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{ROLE_LABELS[role]}</span>
              {role === 'admin' && (
                <Badge variant="secondary" className="text-xs">
                  Always has access
                </Badge>
              )}
            </div>
            {role === 'admin' ? (
              <Badge>Full Control</Badge>
            ) : (
              <Select
                value={currentLevel}
                onValueChange={(value) => onSetPermission(role, value as PermissionLevel)}
                disabled={isLoading}
              >
                <SelectTrigger className="w-[120px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <div className="flex items-center gap-2">
                      <Ban className="h-3 w-3" />
                      <span>No Access</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="view">
                    <div className="flex items-center gap-2">
                      <Eye className="h-3 w-3" />
                      <span>Can View</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="edit">
                    <div className="flex items-center gap-2">
                      <Edit className="h-3 w-3" />
                      <span>Can Edit</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="admin">
                    <div className="flex items-center gap-2">
                      <Shield className="h-3 w-3" />
                      <span>Admin</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        );
      })}
    </div>
  );
}
