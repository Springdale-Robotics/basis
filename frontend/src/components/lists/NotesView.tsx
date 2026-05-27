import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useListMutations } from './useListMutations';
import { cn } from '@/lib/utils';
import type { List, ListItem } from '@/types/models';

interface NotesViewProps {
  list: List;
  items: ListItem[];
}

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

function autolink(text: string): React.ReactNode[] {
  const parts = text.split(URL_REGEX);
  return parts.map((part, i) => {
    if (URL_REGEX.test(part)) {
      // re-test resets lastIndex on global regex, reset for next call
      URL_REGEX.lastIndex = 0;
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function NoteRow({
  item,
  onChange,
  onDelete,
}: {
  item: ListItem;
  onChange: (content: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content);
  const [headingDraft, setHeadingDraft] = useState(item.sectionLabel ?? '');

  const commit = () => {
    if (draft !== item.content) onChange(draft);
    setEditing(false);
  };

  return (
    <Card className="group">
      <CardContent className="space-y-2 p-4">
        {item.sectionLabel && (
          <Input
            value={headingDraft}
            onChange={(e) => setHeadingDraft(e.target.value)}
            onBlur={() => {
              // Saved via separate update; for v1 we just keep section label
              // editable from the detail sheet to avoid an extra request per
              // blur here.
            }}
            className="border-0 bg-transparent p-0 text-base font-semibold focus-visible:ring-0"
            placeholder="Heading"
            readOnly
          />
        )}
        {editing ? (
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            rows={Math.max(2, draft.split('\n').length)}
            className="resize-none border-0 p-0 focus-visible:ring-0"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={cn(
              'block w-full whitespace-pre-wrap break-words text-left text-sm leading-relaxed',
            )}
          >
            {item.content ? autolink(item.content) : (
              <span className="text-muted-foreground">Click to write…</span>
            )}
          </button>
        )}
        <div className="flex justify-end opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onDelete}
            aria-label="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function NotesView({ list, items }: NotesViewProps) {
  const m = useListMutations(list.id);
  const [newNote, setNewNote] = useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    m.addItem.mutate({ content: newNote.trim() });
    setNewNote('');
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3">
          <form onSubmit={handleAdd} className="flex gap-2">
            <Input
              placeholder="Add a note…"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={!newNote.trim() || m.addItem.isPending}>
              <Plus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No notes yet. Add one above.
        </p>
      ) : (
        items
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((it) => (
            <NoteRow
              key={it.id}
              item={it}
              onChange={(content) =>
                m.updateItem.mutate({ itemId: it.id, data: { content } })
              }
              onDelete={() => m.deleteItem.mutate(it.id)}
            />
          ))
      )}
    </div>
  );
}
