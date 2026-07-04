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
import type { List, ListType } from '@/types/models';

type CreateType = Exclude<ListType, 'reminder'>;

interface ListFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, the dialog edits this list; otherwise it creates a new one. */
  list?: List;
  /** Create mode only: pre-selected list type. */
  defaultType?: CreateType;
  /** Create mode only: called with the new list's id. */
  onCreated?: (listId: string) => void;
}

/**
 * Create/edit dialog for lists. Create mode shows the type picker and a
 * type-aware name placeholder; edit mode pre-fills from the list. Both share
 * the name field, wishlist recipient select, icon/color picker, and
 * Enter-to-submit form behavior.
 */
export function ListFormDialog({
  open,
  onOpenChange,
  list,
  defaultType = 'checklist',
  onCreated,
}: ListFormDialogProps) {
  const isEditing = !!list;
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [name, setName] = useState(list?.name ?? '');
  const [type, setType] = useState<CreateType>(defaultType);
  const [icon, setIcon] = useState<string | null>(list?.icon ?? null);
  const [color, setColor] = useState<string | null>(list?.color ?? null);
  const [recipientUserId, setRecipientUserId] = useState<string | null>(
    list ? list.recipientUserId ?? null : currentUser?.id ?? null,
  );

  // The effective type: fixed when editing, user-picked when creating.
  const listType = list?.type ?? type;
  const isWishlist = listType === 'wishlist';

  const { data: membersData } = useQuery({
    queryKey: ['household-members'],
    queryFn: () => householdsApi.getMembers(),
    enabled: open && (isEditing ? isWishlist : true),
  });
  const members = membersData?.members ?? [];

  // Reset to a fresh (create) or pre-filled (edit) state each time it opens.
  useEffect(() => {
    if (open) {
      setName(list?.name ?? '');
      setType(defaultType);
      setIcon(list?.icon ?? null);
      setColor(list?.color ?? null);
      setRecipientUserId(list ? list.recipientUserId ?? null : currentUser?.id ?? null);
    }
  }, [open, list, defaultType, currentUser?.id]);

  const save = useMutation({
    mutationFn: () =>
      list
        ? listsApi.update(list.id, {
            name: name.trim(),
            icon,
            color,
            recipientUserId: isWishlist ? recipientUserId : undefined,
          })
        : listsApi.create({
            name: name.trim(),
            type,
            icon: icon ?? undefined,
            color: color ?? undefined,
            recipientUserId: isWishlist ? recipientUserId : undefined,
          }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      if (list) {
        queryClient.invalidateQueries({ queryKey: ['lists', list.id] });
      } else if ('list' in res) {
        onCreated?.(res.list.id);
      }
      onOpenChange(false);
    },
  });

  const canSubmit = name.trim().length > 0 && !save.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit list' : 'New list'}</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Rename and restyle this list.' : 'Pick a type and give it a name.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="contents">
        <div className="space-y-4">
          {!isEditing && (
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
          )}

          <div>
            <Label htmlFor="list-name">Name</Label>
            <Input
              id="list-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                isEditing
                  ? undefined
                  : type === 'wishlist'
                  ? "e.g. Maya's Birthday Wishes"
                  : type === 'notes'
                  ? 'e.g. Babysitter notes'
                  : 'e.g. Beach trip packing'
              }
              autoFocus
            />
          </div>

          {isWishlist && (
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
              {!isEditing && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Other household members can claim items secretly — the recipient
                  won't see who claimed what.
                </p>
              )}
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
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {isEditing
              ? save.isPending ? 'Saving…' : 'Save'
              : save.isPending ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
