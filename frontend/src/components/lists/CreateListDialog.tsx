import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { IconColorPicker } from './IconColorPicker';
import { CREATABLE_LIST_TYPES } from '@/lib/listTypes';
import { listsApi } from '@/api/lists';
import { householdsApi } from '@/api/households';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import type { ListType } from '@/types/models';

type CreateType = Exclude<ListType, 'reminder'>;

interface CreateListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultType?: CreateType;
  onCreated?: (listId: string) => void;
}

export function CreateListDialog({
  open,
  onOpenChange,
  defaultType = 'checklist',
  onCreated,
}: CreateListDialogProps) {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [name, setName] = useState('');
  const [type, setType] = useState<CreateType>(defaultType);
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [recipientUserId, setRecipientUserId] = useState<string | null>(
    currentUser?.id ?? null,
  );

  const { data: membersData } = useQuery({
    queryKey: ['household-members'],
    queryFn: () => householdsApi.getMembers(),
    enabled: open,
  });
  const members = membersData?.members ?? [];

  useEffect(() => {
    if (open) {
      setName('');
      setType(defaultType);
      setIcon(null);
      setColor(null);
      setRecipientUserId(currentUser?.id ?? null);
    }
  }, [open, defaultType, currentUser?.id]);

  const create = useMutation({
    mutationFn: () =>
      listsApi.create({
        name: name.trim(),
        type,
        icon: icon ?? undefined,
        color: color ?? undefined,
        recipientUserId: type === 'wishlist' ? recipientUserId : undefined,
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      onCreated?.(res.list.id);
      onOpenChange(false);
    },
  });

  const canSubmit = name.trim().length > 0 && !create.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New list</DialogTitle>
          <DialogDescription>Pick a type and give it a name.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {CREATABLE_LIST_TYPES.map((meta) => {
              const Icon = meta.icon;
              const selected = type === meta.value;
              return (
                <button
                  key={meta.value}
                  type="button"
                  onClick={() => setType(meta.value as CreateType)}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors',
                    selected
                      ? 'border-primary bg-primary/5'
                      : 'border-input hover:bg-muted/50',
                  )}
                >
                  <div className="flex w-full items-center justify-between">
                    <Icon className="h-5 w-5" />
                    {selected && <Check className="h-4 w-4 text-primary" />}
                  </div>
                  <div className="text-sm font-medium">{meta.label}</div>
                  <div className="text-[11px] leading-snug text-muted-foreground">
                    {meta.description}
                  </div>
                </button>
              );
            })}
          </div>

          <div>
            <Label htmlFor="list-name">Name</Label>
            <Input
              id="list-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                type === 'wishlist'
                  ? "e.g. Maya's Birthday Wishes"
                  : type === 'notes'
                  ? 'e.g. Babysitter notes'
                  : 'e.g. Beach trip packing'
              }
              autoFocus
            />
          </div>

          {type === 'wishlist' && (
            <div>
              <Label>For (recipient)</Label>
              <Select
                value={recipientUserId ?? '__none__'}
                onValueChange={(v) =>
                  setRecipientUserId(v === '__none__' ? null : v)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No recipient</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.displayName ?? m.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Other household members can claim items secretly — the recipient
                won't see who claimed what.
              </p>
            </div>
          )}

          <IconColorPicker
            icon={icon}
            color={color}
            onIconChange={setIcon}
            onColorChange={setColor}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={!canSubmit}>
            {create.isPending ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
