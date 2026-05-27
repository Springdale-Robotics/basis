import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { usersApi } from '@/api/users';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/api-error';
import { AppPasswordsCard } from '@/components/profile/AppPasswordsCard';

const profileSchema = z.object({
  displayName: z.string().min(1, 'Display name is required'),
  email: z.string().email('Invalid email'),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export function ProfileSettingsPage() {
  const { user, refetch } = useAuth();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: user?.displayName || '',
      email: user?.email || '',
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: ProfileFormData) => usersApi.update(user!.id, data),
    onSuccess: () => {
      refetch();
      toast({ title: 'Profile updated' });
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  const onSubmit = (data: ProfileFormData) => {
    updateMutation.mutate(data);
  };

  const userInitials = user?.displayName
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile Picture</CardTitle>
          <CardDescription>Your profile avatar</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Avatar className="h-20 w-20">
              <AvatarImage src={user?.avatarUrl} alt={user?.displayName} />
              <AvatarFallback className="text-lg">{userInitials}</AvatarFallback>
            </Avatar>
            <p className="text-sm text-muted-foreground">
              Avatar upload coming soon
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Profile Information</CardTitle>
          <CardDescription>Update your account details</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input id="displayName" {...register('displayName')} />
              {errors.displayName && (
                <p className="text-sm text-destructive">{errors.displayName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...register('email')} />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email.message}</p>
              )}
            </div>

            <Button type="submit" disabled={!isDirty || isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </form>
        </CardContent>
      </Card>

      <ChangePasswordCard />

      <AppPasswordsCard />
    </div>
  );
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'Must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type PasswordFormData = z.infer<typeof passwordSchema>;

function ChangePasswordCard() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PasswordFormData>({ resolver: zodResolver(passwordSchema) });

  const mutation = useMutation({
    mutationFn: (data: PasswordFormData) =>
      usersApi.changePassword(user!.id, {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      }),
    onSuccess: () => {
      toast({ title: 'Password updated' });
      reset();
      setOpen(false);
    },
    onError: (err) => {
      toast({
        title: 'Could not update password',
        description: getErrorMessage(err),
        variant: 'destructive',
      });
    },
  });

  const onSubmit = (data: PasswordFormData) => mutation.mutate(data);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Update the password used to sign in.</CardDescription>
      </CardHeader>
      <CardContent>
        <Dialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) reset();
          }}
        >
          <Button variant="outline" onClick={() => setOpen(true)}>
            Change Password
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change password</DialogTitle>
              <DialogDescription>
                Enter your current password, then choose a new one.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currentPassword">Current password</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  {...register('currentPassword')}
                />
                {errors.currentPassword && (
                  <p className="text-sm text-destructive">
                    {errors.currentPassword.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  autoComplete="new-password"
                  {...register('newPassword')}
                />
                {errors.newPassword && (
                  <p className="text-sm text-destructive">
                    {errors.newPassword.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm new password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  {...register('confirmPassword')}
                />
                {errors.confirmPassword && (
                  <p className="text-sm text-destructive">
                    {errors.confirmPassword.message}
                  </p>
                )}
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={isSubmitting || mutation.isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting || mutation.isPending}>
                  {(isSubmitting || mutation.isPending) && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Update password
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
