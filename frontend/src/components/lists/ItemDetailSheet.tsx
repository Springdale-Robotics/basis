import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trash2, ExternalLink } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AssigneePicker } from '@/components/tasks/AssigneePicker';
import { householdsApi } from '@/api/households';
import { groupsApi } from '@/api/groups';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import type { UpdateListItemRequest } from '@/api/lists';
import type { List, ListItem } from '@/types/models';

interface ItemDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: List;
  item: ListItem | null;
  onSave: (data: UpdateListItemRequest) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
}

export function ItemDetailSheet({
  open,
  onOpenChange,
  list,
  item,
  onSave,
  onDelete,
}: ItemDetailSheetProps) {
  const features = useFeatureFlags();
  const [content, setContent] = useState('');
  const [notes, setNotes] = useState('');
  const [url, setUrl] = useState('');
  const [price, setPrice] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [sectionLabel, setSectionLabel] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState<string | null>(null);
  const [rewardPoints, setRewardPoints] = useState<number>(0);

  const { data: membersData } = useQuery({
    queryKey: ['household-members'],
    queryFn: () => householdsApi.getMembers(),
    enabled: open,
  });
  const { data: groupsData } = useQuery({
    queryKey: ['groups'],
    queryFn: () => groupsApi.list(),
    enabled: open,
  });

  useEffect(() => {
    if (item) {
      setContent(item.content);
      setNotes(item.notes ?? '');
      setUrl(item.url ?? '');
      setPrice(item.price ?? '');
      setDueDate(item.dueDate ? item.dueDate.slice(0, 16) : '');
      setSectionLabel(item.sectionLabel ?? '');
      setAssigneeUserId(item.assigneeUserId ?? null);
      setRewardPoints(item.rewardPoints ?? 0);
    }
  }, [item]);

  if (!item) return null;

  const save = async () => {
    const parsedPrice = price.trim() ? parseFloat(price) : null;
    await onSave({
      content: content.trim() || item.content,
      notes: notes.trim() || null,
      url: url.trim() || null,
      price: Number.isFinite(parsedPrice as number) ? parsedPrice : null,
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      sectionLabel: sectionLabel.trim() || null,
      assigneeUserId,
      rewardPoints,
    });
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-md overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Item details</SheetTitle>
          <SheetDescription>
            Edit details for this {list.type === 'wishlist' ? 'wish' : 'item'}.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div>
            <Label htmlFor="item-content">Content</Label>
            <Input
              id="item-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              autoFocus
            />
          </div>

          {list.type === 'wishlist' && (
            <>
              <div>
                <Label htmlFor="item-url">Link</Label>
                <div className="flex gap-1">
                  <Input
                    id="item-url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://…"
                  />
                  {url && (
                    <Button
                      variant="outline"
                      size="icon"
                      asChild
                    >
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  )}
                </div>
              </div>
              <div>
                <Label htmlFor="item-price">Price</Label>
                <Input
                  id="item-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </>
          )}

          {list.type !== 'notes' && (
            <>
              <div>
                <Label htmlFor="item-due">Due date</Label>
                <Input
                  id="item-due"
                  type="datetime-local"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div>
                <Label>Assignee</Label>
                <AssigneePicker
                  users={membersData?.members ?? []}
                  groups={groupsData?.groups ?? []}
                  value={{ userId: assigneeUserId, groupId: null }}
                  onChange={(v) => setAssigneeUserId(v.userId ?? null)}
                />
              </div>
              <div>
                <Label htmlFor="item-section">Section</Label>
                <Input
                  id="item-section"
                  value={sectionLabel}
                  onChange={(e) => setSectionLabel(e.target.value)}
                  placeholder="e.g. Clothes, Toiletries"
                />
              </div>
              {features.rewards && (
                <div>
                  <Label htmlFor="item-points">Reward points</Label>
                  <Input
                    id="item-points"
                    type="number"
                    min="0"
                    value={rewardPoints}
                    onChange={(e) => setRewardPoints(parseInt(e.target.value || '0', 10))}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Awarded to the checker when this item is completed.
                  </p>
                </div>
              )}
            </>
          )}

          <div>
            <Label htmlFor="item-notes">Notes</Label>
            <Textarea
              id="item-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Optional notes…"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-between gap-2">
          <Button
            variant="destructive"
            onClick={async () => {
              await onDelete();
              onOpenChange(false);
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
