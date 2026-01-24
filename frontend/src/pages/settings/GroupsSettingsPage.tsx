import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Plus,
  Users,
  Trash2,
  Edit2,
  Loader2,
  UserPlus,
  UserMinus,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { groupsApi, type Group, type GroupMember } from '@/api/groups';
import { householdsApi } from '@/api/households';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/api-error';
import type { User } from '@/types/models';

const groupSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().optional(),
});

type GroupFormData = z.infer<typeof groupSchema>;

export function GroupsSettingsPage() {
  const queryClient = useQueryClient();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<Group | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Fetch groups
  const { data: groupsData, isLoading: loadingGroups } = useQuery({
    queryKey: ['groups'],
    queryFn: groupsApi.list,
  });

  // Fetch household members
  const { data: membersData } = useQuery({
    queryKey: ['household-members'],
    queryFn: householdsApi.getMembers,
  });

  // Create group mutation
  const createMutation = useMutation({
    mutationFn: groupsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      setCreateDialogOpen(false);
      toast({ title: 'Group created successfully' });
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  // Update group mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: GroupFormData }) =>
      groupsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      setEditingGroup(null);
      toast({ title: 'Group updated successfully' });
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  // Delete group mutation
  const deleteMutation = useMutation({
    mutationFn: groupsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      setDeletingGroup(null);
      toast({ title: 'Group deleted successfully' });
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  const groups = groupsData?.groups || [];
  const members = membersData?.members || [];

  const toggleExpand = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  if (loadingGroups) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Groups</CardTitle>
            <CardDescription>
              Create groups to easily share resources with multiple people at once
            </CardDescription>
          </div>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Group
          </Button>
        </CardHeader>
        <CardContent>
          {groups.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No groups created yet</p>
              <p className="text-sm mt-1">
                Groups let you share recipes, tasks, and files with multiple people at once.
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => setCreateDialogOpen(true)}
              >
                <Plus className="mr-2 h-4 w-4" />
                Create your first group
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map((group) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  members={members}
                  isExpanded={expandedGroups.has(group.id)}
                  onToggleExpand={() => toggleExpand(group.id)}
                  onEdit={() => setEditingGroup(group)}
                  onDelete={() => setDeletingGroup(group)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <GroupDialog
        open={createDialogOpen || !!editingGroup}
        onOpenChange={(open) => {
          if (!open) {
            setCreateDialogOpen(false);
            setEditingGroup(null);
          }
        }}
        group={editingGroup}
        onSubmit={(data) => {
          if (editingGroup) {
            updateMutation.mutate({ id: editingGroup.id, data });
          } else {
            createMutation.mutate(data);
          }
        }}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletingGroup}
        onOpenChange={(open) => !open && setDeletingGroup(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Group</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingGroup?.name}"? This will remove all
              permissions associated with this group. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingGroup && deleteMutation.mutate(deletingGroup.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function GroupCard({
  group,
  members,
  isExpanded,
  onToggleExpand,
  onEdit,
  onDelete,
}: {
  group: Group;
  members: User[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');

  // Fetch group details when expanded
  const { data: groupData, isLoading } = useQuery({
    queryKey: ['groups', group.id],
    queryFn: () => groupsApi.get(group.id),
    enabled: isExpanded,
  });

  // Add member mutation
  const addMemberMutation = useMutation({
    mutationFn: (userId: string) => groupsApi.addMember(group.id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups', group.id] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      setAddMemberOpen(false);
      setSelectedUserId('');
      toast({ title: 'Member added to group' });
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  // Remove member mutation
  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => groupsApi.removeMember(group.id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups', group.id] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      toast({ title: 'Member removed from group' });
    },
  });

  const groupMembers = groupData?.members || [];
  const memberIds = new Set(groupMembers.map((m) => m.userId));
  const availableMembers = members.filter((m) => !memberIds.has(m.id));

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggleExpand}>
      <div className="border rounded-lg">
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-medium">{group.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); onEdit(); }}>
                <Edit2 className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
              {isExpanded ? (
                <ChevronUp className="h-5 w-5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t p-4 space-y-4">
            {group.description && (
              <p className="text-sm text-muted-foreground">{group.description}</p>
            )}

            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Members</Label>
              <Button variant="outline" size="sm" onClick={() => setAddMemberOpen(true)}>
                <UserPlus className="mr-2 h-4 w-4" />
                Add Member
              </Button>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : groupMembers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No members in this group yet
              </p>
            ) : (
              <div className="space-y-2">
                {groupMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={member.user.avatarUrl} />
                        <AvatarFallback>
                          {member.user.displayName.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium">{member.user.displayName}</p>
                        <p className="text-xs text-muted-foreground">{member.user.email}</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => removeMemberMutation.mutate(member.userId)}
                      disabled={removeMemberMutation.isPending}
                    >
                      {removeMemberMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <UserMinus className="h-4 w-4 text-destructive" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Add Member Dialog */}
            <Dialog open={addMemberOpen} onOpenChange={setAddMemberOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Member to {group.name}</DialogTitle>
                  <DialogDescription>
                    Select a household member to add to this group
                  </DialogDescription>
                </DialogHeader>

                {availableMembers.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    All household members are already in this group
                  </p>
                ) : (
                  <div className="space-y-4">
                    <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a member" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableMembers.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            <div className="flex items-center gap-2">
                              <Avatar className="h-6 w-6">
                                <AvatarImage src={member.avatarUrl} />
                                <AvatarFallback>
                                  {member.displayName.slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <span>{member.displayName}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddMemberOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => addMemberMutation.mutate(selectedUserId)}
                    disabled={!selectedUserId || addMemberMutation.isPending}
                  >
                    {addMemberMutation.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Add Member
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function GroupDialog({
  open,
  onOpenChange,
  group,
  onSubmit,
  isSubmitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: Group | null;
  onSubmit: (data: GroupFormData) => void;
  isSubmitting: boolean;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<GroupFormData>({
    resolver: zodResolver(groupSchema),
    defaultValues: {
      name: group?.name || '',
      description: group?.description || '',
    },
  });

  // Reset form when dialog opens with different group
  useState(() => {
    if (open) {
      reset({
        name: group?.name || '',
        description: group?.description || '',
      });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{group ? 'Edit Group' : 'Create Group'}</DialogTitle>
          <DialogDescription>
            {group
              ? 'Update the group name and description'
              : 'Create a new group to organize members'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              {...register('name')}
              placeholder="e.g., Family, Roommates, Kids"
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              {...register('description')}
              placeholder="What is this group for?"
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {group ? 'Save Changes' : 'Create Group'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
