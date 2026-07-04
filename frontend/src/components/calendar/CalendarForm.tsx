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
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { calendarsApi } from '@/api/calendars';
import { IntraHouseholdAccess } from '@/components/calendar/IntraHouseholdAccess';
import type { Calendar } from '@/types/models';
import { toast } from '@/hooks/useToast';
import { useTheme } from '@/hooks/useTheme';
import { useCalendarColor } from '@/hooks/useCalendarColor';
import { COLOR_PALETTES, getColorForIndex } from '@/lib/theme-presets';
import { copyToClipboard as copyText } from '@/lib/clipboard';

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
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

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

  // Fetch public link status
  const { data: linkStatus, isLoading: linkLoading } = useQuery({
    queryKey: ['calendar-public-link', calendar?.id],
    queryFn: () => calendarsApi.getPublicLinkStatus(calendar!.id),
    enabled: open && isEditing && !!calendar?.id,
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
    if (!open) {
      // Parent closed the dialog (e.g. after a successful delete) — make sure
      // nested confirmation dialogs don't outlive it.
      setShowDeleteDialog(false);
      setShowRevokeDialog(false);
    }
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
    if (await copyText(text)) {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
      toast({ title: 'Copied!', description: 'Link copied to clipboard.' });
    } else {
      toast({ title: 'Copy Failed', description: 'Could not copy to clipboard.', variant: 'destructive' });
    }
  };

  const goToSettings = () => {
    handleClose();
    navigate('/settings/calendars');
  };

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
                        onClick={() => setShowDeleteDialog(true)}
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

                <DialogFooter className="pt-4">
                  <Button variant="outline" onClick={handleClose}>
                    Close
                  </Button>
                </DialogFooter>
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
      <ConfirmDialog
        open={showRevokeDialog}
        onOpenChange={setShowRevokeDialog}
        title="Revoke Public Access?"
        description="External calendar apps that have subscribed to this calendar will no longer be able to access it. You can create a new link at any time."
        confirmText="Revoke Access"
        variant="destructive"
        isPending={revokeLinkMutation.isPending}
        onConfirm={() => revokeLinkMutation.mutate()}
      />

      {/* Delete Calendar Confirmation Dialog */}
      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title={calendar?.name ? `Delete "${calendar.name}"?` : 'Delete calendar?'}
        description="This calendar and all of its events will be permanently deleted. This action cannot be undone."
        confirmText="Delete"
        variant="destructive"
        isPending={isDeleting ?? false}
        onConfirm={() => onDelete?.()}
      />
    </>
  );
}
