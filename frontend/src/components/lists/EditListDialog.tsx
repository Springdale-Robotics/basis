import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { listsApi } from '@/api/lists';
import { householdsApi } from '@/api/households';
import type { List } from '@/types/models';

interface EditListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: List;
}

export function EditListDialog({ open, onOpenChange, list }: EditListDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(list.name);
  const [icon, setIcon] = useState<string | null>(list.icon ?? null);
  const [color, setColor] = useState<string | null>(list.color ?? null);
  const [recipientUserId, setRecipientUserId] = useState<string | null>(
    list.recipientUserId ?? null,
  );

  useEffect(() => {
    if (open) {
      setName(list.name);
      setIcon(list.icon ?? null);
      setColor(list.color ?? null);
      setRecipientUserId(list.recipientUserId ?? null);
    }
  }, [open, list]);

  const { data: membersData } = useQuery({
    queryKey: ['household-members'],
    queryFn: () => householdsApi.getMembers(),
    enabled: open && list.type === 'wishlist',
  });
  const members = membersData?.members ?? [];

  const update = useMutation({
    mutationFn: () =>
      listsApi.update(list.id, {
        name: name.trim(),
        icon,
        color,
        recipientUserId: list.type === 'wishlist' ? recipientUserId : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      queryClient.invalidateQueries({ queryKey: ['lists', list.id] });
      onOpenChange(false);
    },
  });

  const canSubmit = name.trim().length > 0 && !update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit list</DialogTitle>
          <DialogDescription>Rename and restyle this list.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="edit-list-name">Name</Label>
            <Input
              id="edit-list-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          {list.type === 'wishlist' && (
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
          <Button onClick={() => update.mutate()} disabled={!canSubmit}>
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
