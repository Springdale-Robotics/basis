import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  Globe,
  Users,
  Settings,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
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
import { calendarsApi, type PermissionLevel } from '@/api/calendars';
import { IntraHouseholdAccess } from '@/components/calendar/CalendarSharingDialog';
import type { Calendar } from '@/types/models';
import { toast } from '@/hooks/useToast';
import { useTheme } from '@/hooks/useTheme';
import { useCalendarColor } from '@/hooks/useCalendarColor';
import { COLOR_PALETTES, getColorForIndex } from '@/lib/theme-presets';

export type CalendarAccessPreset =
  | 'everyone'      // No rules: every household member gets edit
  | 'admins_only'   // role=admin, edit
  | 'kids_only'     // role=kid, edit
  | 'just_me'       // user=<creator>, edit
  | 'custom';       // Open the share dialog after create

export interface CalendarFormData {
  name: string;
  colorIndex: number;
  type: 'individual' | 'group';
  accessPreset?: CalendarAccessPreset; // create-mode only
}

interface CalendarFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  calendar?: Calendar | null;
  onSubmit: (data: CalendarFormData) => void;
  onDelete?: () => void;
  isSubmitting?: boolean;
  isDeleting?: boolean;
  /** Which tab the dialog opens to in edit mode (default: 'general'). */
  initialTab?: 'general' | 'sharing' | 'public';
}

const permissionLabels: Record<PermissionLevel, string> = {
  view_busy: 'Busy/Free Only',
  view: 'View Events',
  edit: 'Edit Events',
};

export function CalendarForm({
  open,
  onOpenChange,
  calendar,
  onSubmit,
  onDelete,
  isSubmitting,
  isDeleting,
  initialTab = 'general',
}: CalendarFormProps) {
  const isEditing = !!calendar;
  const navigate = useNavigate();
  const { colorPalette } = useTheme();
  const colorOptions = COLOR_PALETTES[colorPalette].colors;
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('general');
  const [copiedField, setCopiedField] = useState<'feed' | 'webcal' | null>(null);
  const [showRevokeDialog, setShowRevokeDialog] = useState(false);
  const [shareHouseholdId, setShareHouseholdId] = useState<string>('');
  const [sharePermission, setSharePermission] = useState<PermissionLevel>('view');

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<CalendarFormData>({
    defaultValues: calendar
      ? {
          name: calendar.name,
          colorIndex: calendar.colorIndex ?? 0,
          type: calendar.type === 'synced' ? 'group' : calendar.type,
        }
      : {
          name: '',
          colorIndex: 0,
          type: 'group',
          accessPreset: 'everyone',
        },
  });

  const selectedColorIndex = watch('colorIndex');
  const selectedType = watch('type');
  const selectedColor = getColorForIndex(colorPalette, selectedColorIndex);

  // Fetch connected households for sharing
  const { data: householdsData } = useQuery({
    queryKey: ['connected-households'],
    queryFn: () => calendarsApi.getConnectedHouseholds(),
    enabled: open && isEditing,
  });

  // Fetch current shares for this calendar
  const { data: sharesData, isLoading: sharesLoading } = useQuery({
    queryKey: ['calendar-shares', calendar?.id],
    queryFn: () => calendarsApi.getCalendarShares(calendar!.id),
    enabled: open && isEditing && !!calendar?.id,
  });

  // Fetch public link status
  const { data: linkStatus, isLoading: linkLoading } = useQuery({
    queryKey: ['calendar-public-link', calendar?.id],
    queryFn: () => calendarsApi.getPublicLinkStatus(calendar!.id),
    enabled: open && isEditing && !!calendar?.id,
  });

  // Share calendar mutation
  const shareMutation = useMutation({
    mutationFn: ({ householdId, permissionLevel }: { householdId: string; permissionLevel: PermissionLevel }) =>
      calendarsApi.shareCalendar(calendar!.id, { householdId, permissionLevel }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-shares', calendar?.id] });
      setShareHouseholdId('');
      toast({ title: 'Calendar Shared', description: 'Calendar has been shared successfully.' });
    },
    onError: () => {
      toast({ title: 'Failed to Share', description: 'Could not share calendar.', variant: 'destructive' });
    },
  });

  // Remove share mutation
  const removeShareMutation = useMutation({
    mutationFn: (shareId: string) => calendarsApi.removeShare(calendar!.id, shareId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-shares', calendar?.id] });
      toast({ title: 'Share Removed', description: 'Calendar share has been removed.' });
    },
    onError: () => {
      toast({ title: 'Failed to Remove', description: 'Could not remove share.', variant: 'destructive' });
    },
  });

  // Generate public link mutation
  const generateLinkMutation = useMutation({
    mutationFn: () => calendarsApi.generatePublicLink(calendar!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-public-link', calendar?.id] });
      toast({ title: 'Link Created', description: 'Public subscription link has been created.' });
    },
    onError: () => {
      toast({ title: 'Failed', description: 'Could not generate public link.', variant: 'destructive' });
    },
  });

  // Revoke public link mutation
  const revokeLinkMutation = useMutation({
    mutationFn: () => calendarsApi.revokePublicLink(calendar!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-public-link', calendar?.id] });
      setShowRevokeDialog(false);
      toast({ title: 'Link Revoked', description: 'External apps can no longer access this calendar.' });
    },
    onError: () => {
      toast({ title: 'Failed', description: 'Could not revoke public link.', variant: 'destructive' });
    },
  });

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
      if (calendar) {
        reset({
          name: calendar.name,
          colorIndex: calendar.colorIndex ?? 0,
          type: calendar.type === 'synced' ? 'group' : calendar.type,
        });
      } else {
        reset({
          name: '',
          colorIndex: 0,
          type: 'group',
          accessPreset: 'everyone',
        });
      }
    }
  }, [open, calendar, reset, initialTab]);

  const handleFormSubmit = (data: CalendarFormData) => {
    onSubmit(data);
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  const copyToClipboard = async (text: string, field: 'feed' | 'webcal') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
      toast({ title: 'Copied!', description: 'Link copied to clipboard.' });
    } catch {
      toast({ title: 'Copy Failed', description: 'Could not copy to clipboard.', variant: 'destructive' });
    }
  };

  const handleShare = () => {
    if (!shareHouseholdId) return;
    shareMutation.mutate({ householdId: shareHouseholdId, permissionLevel: sharePermission });
  };

  const goToSettings = () => {
    handleClose();
    navigate('/settings/calendars');
  };

  // Get households that haven't been shared with yet
  const availableHouseholds = householdsData?.households?.filter(
    (h) => !sharesData?.shares?.some((s) => s.householdId === h.id)
  ) || [];

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Calendar Settings' : 'New Calendar'}</DialogTitle>
          </DialogHeader>

          {isEditing ? (
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="sharing">
                  <Users className="mr-1 h-3 w-3" />
                  Sharing
                </TabsTrigger>
                <TabsTrigger value="public">
                  <Globe className="mr-1 h-3 w-3" />
                  Public
                </TabsTrigger>
              </TabsList>

              {/* General Tab */}
              <TabsContent value="general" className="space-y-4 pt-4 min-h-[320px]">
                <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input
                      id="name"
                      placeholder="Calendar name"
                      {...register('name', { required: 'Name is required' })}
                    />
                    {errors.name && (
                      <p className="text-sm text-destructive">{errors.name.message}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="color">Color</Label>
                    <Select
                      value={selectedColorIndex.toString()}
                      onValueChange={(value) => setValue('colorIndex', parseInt(value, 10))}
                    >
                      <SelectTrigger>
                        <SelectValue>
                          <div className="flex items-center gap-2">
                            <div
                              className="w-4 h-4 rounded-full"
                              style={{ backgroundColor: selectedColor }}
                            />
                            {colorOptions[selectedColorIndex]?.label || 'Select color'}
                          </div>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {colorOptions.map((color, index) => (
                          <SelectItem key={index} value={index.toString()}>
                            <div className="flex items-center gap-2">
                              <div
                                className="w-4 h-4 rounded-full"
                                style={{ backgroundColor: color.value }}
                              />
                              {color.label}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <DialogFooter className="flex justify-between pt-4">
                    {onDelete && !calendar?.isSynced && (
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={onDelete}
                        disabled={isSubmitting || isDeleting}
                      >
                        {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Delete
                      </Button>
                    )}
                    <div className="flex gap-2 ml-auto">
                      <Button type="button" variant="outline" onClick={handleClose}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={isSubmitting || isDeleting}>
                        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save
                      </Button>
                    </div>
                  </DialogFooter>
                </form>
              </TabsContent>

              {/* Sharing Tab */}
              <TabsContent value="sharing" className="space-y-6 pt-4 min-h-[320px]">
                {/* Inside-household access (roles, groups, individual users) */}
                {calendar && (
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Inside this household
                    </Label>
                    <IntraHouseholdAccess calendar={calendar} open={open} />
                  </div>
                )}

                {/* Connected-household sharing (cross-household) */}
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Connected households
                  </Label>
                  {sharesLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : (
                    <>
                      {/* Current Shares */}
                    {sharesData?.shares && sharesData.shares.length > 0 && (
                      <div className="space-y-2">
                        <Label>Shared With</Label>
                        <div className="space-y-2">
                          {sharesData.shares.map((share) => (
                            <div
                              key={share.id}
                              className="flex items-center justify-between rounded-md border p-2"
                            >
                              <div>
                                <span className="font-medium">{share.householdName}</span>
                                <Badge variant="outline" className="ml-2 text-xs">
                                  {permissionLabels[share.permissionLevel as PermissionLevel]}
                                </Badge>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeShareMutation.mutate(share.id)}
                                disabled={removeShareMutation.isPending}
                              >
                                {removeShareMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                )}
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Add New Share */}
                    {availableHouseholds.length > 0 && (
                      <div className="space-y-2">
                        <Label>Share with Household</Label>
                        <div className="flex gap-2">
                          <Select value={shareHouseholdId} onValueChange={setShareHouseholdId}>
                            <SelectTrigger className="flex-1">
                              <SelectValue placeholder="Select household" />
                            </SelectTrigger>
                            <SelectContent>
                              {availableHouseholds.map((h) => (
                                <SelectItem key={h.id} value={h.id}>
                                  {h.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={sharePermission}
                            onValueChange={(v) => setSharePermission(v as PermissionLevel)}
                          >
                            <SelectTrigger className="w-[140px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="view_busy">Busy/Free Only</SelectItem>
                              <SelectItem value="view">View Events</SelectItem>
                              <SelectItem value="edit">Edit Events</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            onClick={handleShare}
                            disabled={!shareHouseholdId || shareMutation.isPending}
                          >
                            {shareMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              'Share'
                            )}
                          </Button>
                        </div>
                      </div>
                    )}

                    {availableHouseholds.length === 0 && (!sharesData?.shares || sharesData.shares.length === 0) && (
                      <p className="text-sm text-muted-foreground py-4 text-center">
                        No connected households to share with. Connect with other households first.
                      </p>
                    )}

                    <DialogFooter className="pt-4">
                      <Button variant="outline" onClick={handleClose}>
                        Close
                      </Button>
                    </DialogFooter>
                  </>
                  )}
                </div>
              </TabsContent>

              {/* Public Link Tab */}
              <TabsContent value="public" className="space-y-4 pt-4 min-h-[320px]">
                {linkLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : !linkStatus?.enabled ? (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Create a public link to allow external calendar apps (Apple Calendar, Google Calendar, Outlook) to subscribe to this calendar.
                    </p>
                    <Button
                      onClick={() => generateLinkMutation.mutate()}
                      disabled={generateLinkMutation.isPending}
                    >
                      {generateLinkMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Globe className="mr-2 h-4 w-4" />
                      )}
                      Create Public Link
                    </Button>
                    <DialogFooter className="pt-4">
                      <Button variant="outline" onClick={handleClose}>
                        Close
                      </Button>
                    </DialogFooter>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                        Public Access Enabled
                      </Badge>
                    </div>

                    {/* Webcal URL */}
                    <div className="space-y-1">
                      <Label className="text-xs">One-Click Subscribe</Label>
                      <div className="flex gap-1">
                        <Input
                          value={linkStatus.webcalUrl || ''}
                          readOnly
                          className="font-mono text-xs h-8"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2"
                          onClick={() => copyToClipboard(linkStatus.webcalUrl!, 'webcal')}
                        >
                          {copiedField === 'webcal' ? (
                            <Check className="h-3 w-3 text-green-500" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                        <Button variant="outline" size="sm" className="h-8 px-2" asChild>
                          <a href={linkStatus.webcalUrl} title="Open in calendar app">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </Button>
                      </div>
                    </div>

                    {/* HTTP URL */}
                    <div className="space-y-1">
                      <Label className="text-xs">ICS Feed URL</Label>
                      <div className="flex gap-1">
                        <Input
                          value={linkStatus.feedUrl || ''}
                          readOnly
                          className="font-mono text-xs h-8"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2"
                          onClick={() => copyToClipboard(linkStatus.feedUrl!, 'feed')}
                        >
                          {copiedField === 'feed' ? (
                            <Check className="h-3 w-3 text-green-500" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => generateLinkMutation.mutate()}
                        disabled={generateLinkMutation.isPending}
                      >
                        {generateLinkMutation.isPending ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-1 h-3 w-3" />
                        )}
                        Regenerate
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setShowRevokeDialog(true)}
                      >
                        <Trash2 className="mr-1 h-3 w-3" />
                        Revoke
                      </Button>
                    </div>

                    <DialogFooter className="pt-4">
                      <Button variant="outline" onClick={handleClose}>
                        Close
                      </Button>
                    </DialogFooter>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          ) : (
            // Create mode - just show the form
            <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="Calendar name"
                  {...register('name', { required: 'Name is required' })}
                />
                {errors.name && (
                  <p className="text-sm text-destructive">{errors.name.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="color">Color</Label>
                <Select
                  value={selectedColorIndex.toString()}
                  onValueChange={(value) => setValue('colorIndex', parseInt(value, 10))}
                >
                  <SelectTrigger>
                    <SelectValue>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-4 h-4 rounded-full"
                          style={{ backgroundColor: selectedColor }}
                        />
                        {colorOptions[selectedColorIndex]?.label || 'Select color'}
                      </div>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {colorOptions.map((color, index) => (
                      <SelectItem key={index} value={index.toString()}>
                        <div className="flex items-center gap-2">
                          <div
                            className="w-4 h-4 rounded-full"
                            style={{ backgroundColor: color.value }}
                          />
                          {color.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="type">Type</Label>
                <Select
                  value={selectedType}
                  onValueChange={(value) => setValue('type', value as 'individual' | 'group')}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="group">Shared (Group)</SelectItem>
                    <SelectItem value="individual">Personal</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="access">Who can see this calendar?</Label>
                <Select
                  value={watch('accessPreset') ?? 'everyone'}
                  onValueChange={(v) => setValue('accessPreset', v as CalendarAccessPreset)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="everyone">Everyone in this household</SelectItem>
                    <SelectItem value="admins_only">Admins / Parents only</SelectItem>
                    <SelectItem value="kids_only">Kids only</SelectItem>
                    <SelectItem value="just_me">Just me</SelectItem>
                    <SelectItem value="custom">Custom — I’ll pick after</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  You can change this any time from the calendar’s sharing settings.
                </p>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create
                </Button>
              </DialogFooter>
            </form>
          )}

          {/* Link to full settings */}
          {isEditing && (
            <div className="border-t pt-3 mt-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={goToSettings}
              >
                <Settings className="mr-2 h-4 w-4" />
                More Calendar Settings
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Revoke Confirmation Dialog */}
      <AlertDialog open={showRevokeDialog} onOpenChange={setShowRevokeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Public Access?</AlertDialogTitle>
            <AlertDialogDescription>
              External calendar apps that have subscribed to this calendar will
              no longer be able to access it. You can create a new link at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeLinkMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {revokeLinkMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Revoke Access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
