import { useMemo, useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQuery } from '@tanstack/react-query';
import {
  Plus,
  GripVertical,
  Trash2,
  Clock,
  Layers,
  ChevronDown,
  CornerDownRight,
} from 'lucide-react';
import { format, isPast, isToday, isTomorrow } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { householdsApi } from '@/api/households';
import { ItemDetailSheet } from './ItemDetailSheet';
import { BulkAddDialog } from './BulkAddDialog';
import { useListMutations } from './useListMutations';
import { cn } from '@/lib/utils';
import type { List, ListItem, User } from '@/types/models';

interface ChecklistViewProps {
  list: List;
  items: ListItem[];
}

function dueChip(dueDate: string | null | undefined) {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  const overdue = isPast(d) && !isToday(d);
  const label = isToday(d)
    ? 'Today'
    : isTomorrow(d)
    ? 'Tomorrow'
    : format(d, 'MMM d');
  return { label, overdue };
}

function findUser(users: User[], userId: string | null | undefined) {
  return userId ? users.find((u) => u.id === userId) ?? null : null;
}

interface ItemRowProps {
  item: ListItem;
  list: List;
  members: User[];
  isSubtask?: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onOpen: () => void;
  onAddSubtask: () => void;
  hasSubtasks: boolean;
  showAddSubtask: boolean;
}

function ItemRow({
  item,
  list,
  members,
  isSubtask,
  onToggle,
  onDelete,
  onOpen,
  onAddSubtask,
  hasSubtasks,
  showAddSubtask,
}: ItemRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const assignee = findUser(members, item.assigneeUserId);
  const chip = dueChip(item.dueDate);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group flex items-center gap-2 rounded-md border bg-card px-2 py-1.5',
        isSubtask && 'ml-8',
        item.isChecked && 'opacity-60',
      )}
    >
      {!isSubtask && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      {isSubtask && (
        <CornerDownRight className="h-3 w-3 text-muted-foreground" />
      )}
      <Checkbox checked={item.isChecked} onCheckedChange={onToggle} />
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex-1 truncate text-left text-sm',
          item.isChecked && 'line-through',
        )}
      >
        {item.content}
        {item.notes && (
          <span className="ml-2 text-xs text-muted-foreground">·</span>
        )}
      </button>
      {chip && (
        <Badge
          variant={chip.overdue ? 'destructive' : 'secondary'}
          className="hidden h-5 px-1.5 text-[10px] sm:inline-flex"
        >
          <Clock className="mr-1 h-3 w-3" />
          {chip.label}
        </Badge>
      )}
      {assignee && (
        <Avatar className="h-5 w-5">
          <AvatarImage src={assignee.avatarUrl} />
          <AvatarFallback className="text-[9px]">
            {assignee.displayName?.[0]?.toUpperCase()}
          </AvatarFallback>
        </Avatar>
      )}
      {!isSubtask && showAddSubtask && !hasSubtasks && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 group-hover:opacity-100"
          onClick={onAddSubtask}
          aria-label="Add subtask"
          title="Add subtask"
        >
          <Layers className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 opacity-0 group-hover:opacity-100"
        onClick={onDelete}
        aria-label="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function ChecklistView({ list, items }: ChecklistViewProps) {
  const m = useListMutations(list.id);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [quickAdd, setQuickAdd] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<ListItem | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [showSubtaskInputFor, setShowSubtaskInputFor] = useState<string | null>(null);
  const [subtaskText, setSubtaskText] = useState('');

  const { data: membersData } = useQuery({
    queryKey: ['household-members'],
    queryFn: () => householdsApi.getMembers(),
  });
  const members = membersData?.members ?? [];

  // Group items: section -> top-level items; each top-level item -> children
  const grouped = useMemo(() => {
    const topLevel = items.filter((i) => !i.parentItemId);
    const childrenByParent = new Map<string, ListItem[]>();
    for (const it of items) {
      if (it.parentItemId) {
        const arr = childrenByParent.get(it.parentItemId) ?? [];
        arr.push(it);
        childrenByParent.set(it.parentItemId, arr);
      }
    }
    for (const arr of childrenByParent.values()) {
      arr.sort((a, b) => a.sortOrder - b.sortOrder);
    }

    const bySection = new Map<string, ListItem[]>();
    for (const it of topLevel) {
      const key = it.sectionLabel ?? '';
      const arr = bySection.get(key) ?? [];
      arr.push(it);
      bySection.set(key, arr);
    }
    for (const arr of bySection.values()) {
      arr.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    // Order sections: '' first, then alphabetical
    const sectionKeys = Array.from(bySection.keys()).sort((a, b) => {
      if (a === '' && b !== '') return -1;
      if (b === '' && a !== '') return 1;
      return a.localeCompare(b);
    });
    return { bySection, sectionKeys, childrenByParent };
  }, [items]);

  const toggleSectionCollapse = (key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAdd.trim()) return;
    m.addItem.mutate({ content: quickAdd.trim() });
    setQuickAdd('');
  };

  const handleBulk = async (lines: string[]) => {
    await m.bulkAdd.mutateAsync(lines.map((l) => ({ content: l })));
  };

  const handleDragEnd = (event: DragEndEvent, sectionKey: string) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const sectionItems = grouped.bySection.get(sectionKey) ?? [];
    const oldIndex = sectionItems.findIndex((i) => i.id === active.id);
    const newIndex = sectionItems.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(sectionItems, oldIndex, newIndex);
    m.reorder.mutate(
      next.map((it, idx) => ({ id: it.id, sortOrder: idx + 1 })),
    );
  };

  const checkedCount = items.filter((i) => i.isChecked).length;

  return (
    <>
      <div className="space-y-4">
        {/* Quick add */}
        <Card>
          <CardContent className="p-3">
            <form onSubmit={handleQuickAdd} className="flex gap-2">
              <Input
                placeholder="Add an item…"
                value={quickAdd}
                onChange={(e) => setQuickAdd(e.target.value)}
                className="flex-1"
              />
              <Button type="submit" disabled={!quickAdd.trim() || m.addItem.isPending}>
                <Plus className="mr-1 h-4 w-4" />
                Add
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setBulkOpen(true)}
              >
                Bulk
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Sections */}
        {grouped.sectionKeys.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No items yet. Add one above.
          </p>
        ) : (
          grouped.sectionKeys.map((sectionKey) => {
            const sectionItems = grouped.bySection.get(sectionKey) ?? [];
            const collapsed = collapsedSections.has(sectionKey);
            return (
              <div key={sectionKey || '__no_section__'}>
                {sectionKey && (
                  <button
                    type="button"
                    className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    onClick={() => toggleSectionCollapse(sectionKey)}
                  >
                    <ChevronDown
                      className={cn(
                        'h-3 w-3 transition-transform',
                        collapsed && '-rotate-90',
                      )}
                    />
                    {sectionKey}
                    <span className="ml-1 font-normal opacity-60">
                      {sectionItems.length}
                    </span>
                  </button>
                )}
                {!collapsed && (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(e) => handleDragEnd(e, sectionKey)}
                  >
                    <SortableContext
                      items={sectionItems.map((i) => i.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-1.5">
                        {sectionItems.map((it) => {
                          const children =
                            grouped.childrenByParent.get(it.id) ?? [];
                          return (
                            <div key={it.id} className="space-y-1.5">
                              <ItemRow
                                item={it}
                                list={list}
                                members={members}
                                onToggle={() => m.toggleItem.mutate(it.id)}
                                onDelete={() => m.deleteItem.mutate(it.id)}
                                onOpen={() => setDetailItem(it)}
                                onAddSubtask={() => {
                                  setShowSubtaskInputFor(it.id);
                                  setSubtaskText('');
                                }}
                                hasSubtasks={children.length > 0}
                                showAddSubtask
                              />
                              {children.map((child) => (
                                <ItemRow
                                  key={child.id}
                                  item={child}
                                  list={list}
                                  members={members}
                                  isSubtask
                                  onToggle={() => m.toggleItem.mutate(child.id)}
                                  onDelete={() => m.deleteItem.mutate(child.id)}
                                  onOpen={() => setDetailItem(child)}
                                  onAddSubtask={() => {}}
                                  hasSubtasks={false}
                                  showAddSubtask={false}
                                />
                              ))}
                              {showSubtaskInputFor === it.id && (
                                <form
                                  className="ml-8 flex gap-2"
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    if (!subtaskText.trim()) return;
                                    m.addItem.mutate({
                                      content: subtaskText.trim(),
                                      parentItemId: it.id,
                                      sectionLabel: it.sectionLabel ?? null,
                                    });
                                    setSubtaskText('');
                                    setShowSubtaskInputFor(null);
                                  }}
                                >
                                  <Input
                                    autoFocus
                                    value={subtaskText}
                                    onChange={(e) =>
                                      setSubtaskText(e.target.value)
                                    }
                                    onBlur={() => {
                                      if (!subtaskText.trim())
                                        setShowSubtaskInputFor(null);
                                    }}
                                    placeholder="Subtask…"
                                    className="h-8 text-sm"
                                  />
                                  <Button type="submit" size="sm">
                                    Add
                                  </Button>
                                </form>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </div>
            );
          })
        )}

        {checkedCount > 0 && (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => m.clearChecked.mutate()}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              Clear {checkedCount} completed
            </Button>
          </div>
        )}
      </div>

      <BulkAddDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onSubmit={handleBulk}
      />

      <ItemDetailSheet
        open={!!detailItem}
        onOpenChange={(o) => !o && setDetailItem(null)}
        list={list}
        item={detailItem}
        onSave={async (data) => {
          if (!detailItem) return;
          await m.updateItem.mutateAsync({ itemId: detailItem.id, data });
        }}
        onDelete={async () => {
          if (!detailItem) return;
          await m.deleteItem.mutateAsync(detailItem.id);
        }}
      />
    </>
  );
}
