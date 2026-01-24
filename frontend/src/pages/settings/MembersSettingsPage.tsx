import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  UserPlus,
  MoreHorizontal,
  Copy,
  Trash2,
  Shield,
  Loader2,
  Link as LinkIcon,
  Clock,
  Check,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { householdsApi, type MemberInvite } from '@/api/households';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/api-error';
import { useAuth } from '@/hooks/useAuth';
import type { User, UserRole } from '@/types/models';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  member: 'Member',
  kid: 'Kid',
  visitor: 'Visitor',
};

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: 'Full access to all features and settings',
  member: 'Can use all features but cannot change settings',
  kid: 'Limited access, suitable for children',
  visitor: 'View-only access to most features',
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function getExpiryText(expiresAt: string): string {
  const expiry = new Date(expiresAt);
  const now = new Date();
  const diff = expiry.getTime() - now.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (days > 0) {
    return `Expires in ${days} day${days > 1 ? 's' : ''}`;
  }
  if (hours > 0) {
    return `Expires in ${hours} hour${hours > 1 ? 's' : ''}`;
  }
  return 'Expires soon';
}

export function MembersSettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [changeRoleDialogOpen, setChangeRoleDialogOpen] = useState(false);
  const [removeMemberDialogOpen, setRemoveMemberDialogOpen] = useState(false);
  const [revokeInviteDialogOpen, setRevokeInviteDialogOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<User | null>(null);
  const [selectedInvite, setSelectedInvite] = useState<MemberInvite | null>(null);
  const [newRole, setNewRole] = useState<UserRole>('member');
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);

  const isAdmin = user?.role === 'admin';

  // Fetch members
  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ['household', 'members'],
    queryFn: householdsApi.getMembers,
  });

  // Fetch invites (admin only)
  const { data: invitesData, isLoading: invitesLoading } = useQuery({
    queryKey: ['household', 'invites'],
    queryFn: householdsApi.getInvites,
    enabled: isAdmin,
  });

  // Create invite mutation
  const createInviteMutation = useMutation({
    mutationFn: householdsApi.inviteMember,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['household', 'invites'] });
      toast({ title: 'Invite created' });
      setInviteDialogOpen(false);
      // Auto-copy the invite link
      const fullLink = `${window.location.origin}${data.invite.inviteLink}`;
      navigator.clipboard.writeText(fullLink);
      toast({ title: 'Invite link copied to clipboard' });
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  // Update member role mutation
  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: UserRole }) =>
      householdsApi.updateMemberRole(userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['household', 'members'] });
      toast({ title: 'Member role updated' });
      setChangeRoleDialogOpen(false);
      setSelectedMember(null);
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  // Remove member mutation
  const removeMemberMutation = useMutation({
    mutationFn: householdsApi.removeMember,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['household', 'members'] });
      toast({ title: 'Member removed' });
      setRemoveMemberDialogOpen(false);
      setSelectedMember(null);
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  // Revoke invite mutation
  const revokeInviteMutation = useMutation({
    mutationFn: householdsApi.revokeInvite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['household', 'invites'] });
      toast({ title: 'Invite revoked' });
      setRevokeInviteDialogOpen(false);
      setSelectedInvite(null);
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  const handleCopyInviteLink = async (invite: MemberInvite) => {
    const fullLink = `${window.location.origin}${invite.inviteLink}`;
    await navigator.clipboard.writeText(fullLink);
    setCopiedInviteId(invite.id);
    toast({ title: 'Invite link copied to clipboard' });
    setTimeout(() => setCopiedInviteId(null), 2000);
  };

  const handleOpenChangeRole = (member: User) => {
    setSelectedMember(member);
    setNewRole(member.role);
    setChangeRoleDialogOpen(true);
  };

  const handleOpenRemoveMember = (member: User) => {
    setSelectedMember(member);
    setRemoveMemberDialogOpen(true);
  };

  const handleOpenRevokeInvite = (invite: MemberInvite) => {
    setSelectedInvite(invite);
    setRevokeInviteDialogOpen(true);
  };

  const members = membersData?.members || [];
  const invites = invitesData?.invites || [];

  if (membersLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-64" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Members Card */}
      <Card>
        <CardHeader>
          <CardTitle>Household Members</CardTitle>
          <CardDescription>People who have access to your household</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between rounded-lg border p-4"
              >
                <div className="flex items-center gap-4">
                  <Avatar>
                    <AvatarImage src={member.avatarUrl} />
                    <AvatarFallback>{getInitials(member.displayName)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{member.displayName}</span>
                      {member.id === user?.id && (
                        <Badge variant="outline" className="text-xs">
                          You
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{member.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">{ROLE_LABELS[member.role]}</Badge>
                  {isAdmin && member.id !== user?.id && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleOpenChangeRole(member)}>
                          <Shield className="mr-2 h-4 w-4" />
                          Change Role
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleOpenRemoveMember(member)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Pending Invites Card (Admin only) */}
      {isAdmin && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Pending Invites</CardTitle>
              <CardDescription>Invitations waiting to be accepted</CardDescription>
            </div>
            <Button onClick={() => setInviteDialogOpen(true)}>
              <UserPlus className="mr-2 h-4 w-4" />
              Invite Member
            </Button>
          </CardHeader>
          <CardContent>
            {invitesLoading ? (
              <Skeleton className="h-20" />
            ) : invites.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No pending invites. Click "Invite Member" to create one.
              </p>
            ) : (
              <div className="space-y-4">
                {invites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex items-center justify-between rounded-lg border p-4"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                        <LinkIcon className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {ROLE_LABELS[invite.role]} invite
                          </span>
                          <Badge variant="outline" className="text-xs">
                            <Clock className="mr-1 h-3 w-3" />
                            {getExpiryText(invite.expiresAt)}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground font-mono">
                          {invite.inviteLink}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopyInviteLink(invite)}
                      >
                        {copiedInviteId === invite.id ? (
                          <>
                            <Check className="mr-2 h-4 w-4" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="mr-2 h-4 w-4" />
                            Copy
                          </>
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenRevokeInvite(invite)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create Invite Dialog */}
      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Member</DialogTitle>
            <DialogDescription>
              Create an invite link to share with someone you want to add to your household.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={newRole} onValueChange={(v) => setNewRole(v as UserRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['member', 'kid', 'visitor'] as const).map((role) => (
                    <SelectItem key={role} value={role}>
                      <div className="flex flex-col">
                        <span>{ROLE_LABELS[role]}</span>
                        <span className="text-xs text-muted-foreground">
                          {ROLE_DESCRIPTIONS[role]}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createInviteMutation.mutate({ role: newRole })}
              disabled={createInviteMutation.isPending}
            >
              {createInviteMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Create Invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Role Dialog */}
      <Dialog open={changeRoleDialogOpen} onOpenChange={setChangeRoleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Member Role</DialogTitle>
            <DialogDescription>
              Change the role for {selectedMember?.displayName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>New Role</Label>
              <Select value={newRole} onValueChange={(v) => setNewRole(v as UserRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['admin', 'member', 'kid', 'visitor'] as const).map((role) => (
                    <SelectItem key={role} value={role}>
                      <div className="flex flex-col">
                        <span>{ROLE_LABELS[role]}</span>
                        <span className="text-xs text-muted-foreground">
                          {ROLE_DESCRIPTIONS[role]}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeRoleDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedMember) {
                  updateRoleMutation.mutate({ userId: selectedMember.id, role: newRole });
                }
              }}
              disabled={updateRoleMutation.isPending || newRole === selectedMember?.role}
            >
              {updateRoleMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Update Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Member Confirmation */}
      <AlertDialog open={removeMemberDialogOpen} onOpenChange={setRemoveMemberDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {selectedMember?.displayName} from your
              household? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (selectedMember) {
                  removeMemberMutation.mutate(selectedMember.id);
                }
              }}
              disabled={removeMemberMutation.isPending}
            >
              {removeMemberMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke Invite Confirmation */}
      <AlertDialog open={revokeInviteDialogOpen} onOpenChange={setRevokeInviteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Invite</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to revoke this invite? Anyone with this link will no
              longer be able to join your household.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (selectedInvite) {
                  revokeInviteMutation.mutate(selectedInvite.id);
                }
              }}
              disabled={revokeInviteMutation.isPending}
            >
              {revokeInviteMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
