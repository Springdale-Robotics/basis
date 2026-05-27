import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Shield, ChevronDown, ChevronUp, X, Plus, Info } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  permissionsApi,
  type Feature,
  type PermissionLevel,
  type FeaturePermission,
  type FeatureDefaults,
  type GranteeType,
  type UserRole,
} from '@/api/permissions';
import { householdsApi } from '@/api/households';
import { groupsApi } from '@/api/groups';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/api-error';
import { FEATURES } from '@/lib/constants';
import { useAuth } from '@/hooks/useAuth';

const ROLES: UserRole[] = ['admin', 'member', 'kid', 'visitor'];

function PermissionLevelOptions({ feature }: { feature: Feature }) {
  return (
    <>
      <SelectItem value="admin">Full Control</SelectItem>
      <SelectItem value="edit">Can Edit</SelectItem>
      <SelectItem value="view">View Only</SelectItem>
      {feature === 'calendars' && (
        <SelectItem value="view_busy">View Busy Only</SelectItem>
      )}
      <SelectItem value="none">No Access</SelectItem>
    </>
  );
}

export function FeaturePermissionsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [expandedFeatures, setExpandedFeatures] = useState<Set<string>>(new Set());
  const [addOverrideDialog, setAddOverrideDialog] = useState<{
    feature: Feature;
    type: 'user' | 'group';
  } | null>(null);

  // Fetch feature permissions and defaults
  const { data, isLoading, error } = useQuery({
    queryKey: ['feature-permissions'],
    queryFn: permissionsApi.getFeaturePermissions,
  });

  // Fetch household members for user overrides
  const { data: membersData } = useQuery({
    queryKey: ['household-members'],
    queryFn: householdsApi.getMembers,
  });

  // Fetch groups for group overrides
  const { data: groupsData } = useQuery({
    queryKey: ['groups'],
    queryFn: groupsApi.list,
  });

  // Set feature permission mutation
  const setPermissionMutation = useMutation({
    mutationFn: ({
      feature,
      granteeType,
      granteeId,
      level,
    }: {
      feature: Feature;
      granteeType: GranteeType;
      granteeId: string;
      level: PermissionLevel;
    }) => permissionsApi.setFeaturePermission(feature, granteeType, granteeId, level),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feature-permissions'] });
      toast({ title: 'Permission updated' });
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  // Delete feature permission mutation
  const deletePermissionMutation = useMutation({
    mutationFn: ({
      feature,
      granteeType,
      granteeId,
    }: {
      feature: Feature;
      granteeType: GranteeType;
      granteeId: string;
    }) => permissionsApi.deleteFeaturePermission(feature, granteeType, granteeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feature-permissions'] });
      toast({ title: 'Override removed' });
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  const toggleFeature = (featureId: string) => {
    setExpandedFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(featureId)) {
        next.delete(featureId);
      } else {
        next.add(featureId);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-destructive">Failed to load feature permissions</p>
        </CardContent>
      </Card>
    );
  }

  const { permissions = [], defaults = {} as FeatureDefaults } = data || {};
  const members = membersData?.members || [];
  const groups = groupsData?.groups || [];

  // Only show this page to admins
  if (user?.role !== 'admin') {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">
            Only household admins can manage feature permissions.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Feature Permissions</CardTitle>
          <CardDescription>
            Configure who can access each feature in your household. You can set defaults by role
            and add specific overrides for users or groups.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {FEATURES.map((feature) => {
            const isExpanded = expandedFeatures.has(feature.id);
            const featurePermissions = permissions.filter((p) => p.feature === feature.id);
            const rolePermissions = featurePermissions.filter((p) => p.granteeType === 'role');
            const userOverrides = featurePermissions.filter((p) => p.granteeType === 'user');
            const groupOverrides = featurePermissions.filter((p) => p.granteeType === 'group');
            const featureDefaults = defaults[feature.id as Feature] || {};

            return (
              <Collapsible
                key={feature.id}
                open={isExpanded}
                onOpenChange={() => toggleFeature(feature.id)}
              >
                <div className="border rounded-lg">
                  <CollapsibleTrigger asChild>
                    <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <Shield className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-medium">{feature.label}</h3>
                          <p className="text-sm text-muted-foreground">{feature.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {userOverrides.length + groupOverrides.length > 0 && (
                          <Badge variant="secondary">
                            {userOverrides.length + groupOverrides.length} override
                            {userOverrides.length + groupOverrides.length !== 1 && 's'}
                          </Badge>
                        )}
                        {isExpanded ? (
                          <ChevronUp className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className="border-t p-4 space-y-6">
                      {/* Role Defaults */}
                      <div>
                        <h4 className="text-sm font-medium mb-3">Role Defaults</h4>
                        <div className="grid gap-3">
                          {ROLES.map((role) => {
                            const rolePermission = rolePermissions.find(
                              (p) => p.granteeId === role
                            );
                            const currentLevel =
                              rolePermission?.permissionLevel ||
                              featureDefaults[role] ||
                              null;

                            return (
                              <div
                                key={role}
                                className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="capitalize font-medium">{role}</span>
                                  {role === 'admin' && (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger>
                                          <Info className="h-4 w-4 text-muted-foreground" />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>Admins always have full access</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}
                                </div>
                                {role === 'admin' ? (
                                  <Badge>Full Control (always)</Badge>
                                ) : (
                                  <Select
                                    value={currentLevel || 'none'}
                                    onValueChange={(value) => {
                                      setPermissionMutation.mutate({
                                        feature: feature.id as Feature,
                                        granteeType: 'role',
                                        granteeId: role,
                                        level: value as PermissionLevel,
                                      });
                                    }}
                                    disabled={setPermissionMutation.isPending || deletePermissionMutation.isPending}
                                  >
                                    <SelectTrigger className="w-40">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <PermissionLevelOptions feature={feature.id as Feature} />
                                    </SelectContent>
                                  </Select>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* User/Group Overrides */}
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-medium">Overrides</h4>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setAddOverrideDialog({
                                  feature: feature.id as Feature,
                                  type: 'user',
                                })
                              }
                            >
                              <Plus className="mr-1 h-4 w-4" />
                              User
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setAddOverrideDialog({
                                  feature: feature.id as Feature,
                                  type: 'group',
                                })
                              }
                            >
                              <Plus className="mr-1 h-4 w-4" />
                              Group
                            </Button>
                          </div>
                        </div>

                        {userOverrides.length === 0 && groupOverrides.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-4">
                            No overrides. All users follow role defaults.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {userOverrides.map((override) => (
                              <OverrideRow
                                key={override.id}
                                override={override}
                                type="user"
                                feature={feature.id as Feature}
                                onLevelChange={(level) =>
                                  setPermissionMutation.mutate({
                                    feature: feature.id as Feature,
                                    granteeType: 'user',
                                    granteeId: override.granteeId,
                                    level,
                                  })
                                }
                                onRemove={() =>
                                  deletePermissionMutation.mutate({
                                    feature: feature.id as Feature,
                                    granteeType: 'user',
                                    granteeId: override.granteeId,
                                  })
                                }
                                isLoading={
                                  setPermissionMutation.isPending ||
                                  deletePermissionMutation.isPending
                                }
                              />
                            ))}
                            {groupOverrides.map((override) => (
                              <OverrideRow
                                key={override.id}
                                override={override}
                                type="group"
                                feature={feature.id as Feature}
                                onLevelChange={(level) =>
                                  setPermissionMutation.mutate({
                                    feature: feature.id as Feature,
                                    granteeType: 'group',
                                    granteeId: override.granteeId,
                                    level,
                                  })
                                }
                                onRemove={() =>
                                  deletePermissionMutation.mutate({
                                    feature: feature.id as Feature,
                                    granteeType: 'group',
                                    granteeId: override.granteeId,
                                  })
                                }
                                isLoading={
                                  setPermissionMutation.isPending ||
                                  deletePermissionMutation.isPending
                                }
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
        </CardContent>
      </Card>

      {/* Add Override Dialog */}
      <AddOverrideDialog
        open={!!addOverrideDialog}
        onOpenChange={(open) => !open && setAddOverrideDialog(null)}
        type={addOverrideDialog?.type || 'user'}
        feature={addOverrideDialog?.feature || 'recipes'}
        members={members}
        groups={groups}
        existingPermissions={permissions}
        onSubmit={(granteeId, level) => {
          if (addOverrideDialog) {
            setPermissionMutation.mutate(
              {
                feature: addOverrideDialog.feature,
                granteeType: addOverrideDialog.type,
                granteeId,
                level,
              },
              {
                onSuccess: () => setAddOverrideDialog(null),
              }
            );
          }
        }}
        isSubmitting={setPermissionMutation.isPending}
      />
    </div>
  );
}

function OverrideRow({
  override,
  type,
  feature,
  onLevelChange,
  onRemove,
  isLoading,
}: {
  override: FeaturePermission;
  type: 'user' | 'group';
  feature: Feature;
  onLevelChange: (level: PermissionLevel) => void;
  onRemove: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs">
          {type}
        </Badge>
        <span className="font-medium">{override.grantee?.name || override.granteeId}</span>
        {override.grantee?.email && (
          <span className="text-sm text-muted-foreground">({override.grantee.email})</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Select
          value={override.permissionLevel}
          onValueChange={(value) => onLevelChange(value as PermissionLevel)}
          disabled={isLoading}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <PermissionLevelOptions feature={feature} />
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" onClick={onRemove} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <X className="h-4 w-4 text-destructive" />
          )}
        </Button>
      </div>
    </div>
  );
}

function AddOverrideDialog({
  open,
  onOpenChange,
  type,
  feature,
  members,
  groups,
  existingPermissions,
  onSubmit,
  isSubmitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: 'user' | 'group';
  feature: Feature;
  members: Array<{ id: string; displayName: string; email: string }>;
  groups: Array<{ id: string; name: string }>;
  existingPermissions: FeaturePermission[];
  onSubmit: (granteeId: string, level: PermissionLevel) => void;
  isSubmitting: boolean;
}) {
  const [selectedId, setSelectedId] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<PermissionLevel>('view');

  // Filter out entities that already have overrides for this feature
  const existingIds = new Set(
    existingPermissions
      .filter((p) => p.feature === feature && p.granteeType === type)
      .map((p) => p.granteeId)
  );

  const availableOptions =
    type === 'user'
      ? members.filter((m) => !existingIds.has(m.id))
      : groups.filter((g) => !existingIds.has(g.id));

  const handleSubmit = () => {
    if (selectedId) {
      onSubmit(selectedId, selectedLevel);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add {type === 'user' ? 'User' : 'Group'} Override</DialogTitle>
          <DialogDescription>
            Set a specific permission level for a {type} that overrides the role default.
          </DialogDescription>
        </DialogHeader>

        {availableOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            All {type === 'user' ? 'users' : 'groups'} already have overrides for this feature.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {type === 'user' ? 'Select User' : 'Select Group'}
              </label>
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={`Select a ${type === 'user' ? 'user' : 'group'}`}
                  />
                </SelectTrigger>
                <SelectContent>
                  {type === 'user'
                    ? (availableOptions as typeof members).map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.displayName} ({member.email})
                        </SelectItem>
                      ))
                    : (availableOptions as typeof groups).map((group) => (
                        <SelectItem key={group.id} value={group.id}>
                          {group.name}
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Permission Level</label>
              <Select
                value={selectedLevel}
                onValueChange={(v) => setSelectedLevel(v as PermissionLevel)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <PermissionLevelOptions feature={feature} />
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!selectedId || isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add Override
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
