import { useState } from 'react';
import { format, isToday, isTomorrow, isPast } from 'date-fns';
import { GripVertical, Clock, Trash2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ListItem as ListItemType } from '@/types/models';

interface ListItemProps {
  item: ListItemType;
  onToggle: () => void;
  onUpdate: (text: string) => void;
  onDelete: () => void;
  isDragging?: boolean;
}

export function ListItem({
  item,
  onToggle,
  onUpdate,
  onDelete,
  isDragging,
}: ListItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(item.text);

  const handleSave = () => {
    if (editText.trim()) {
      onUpdate(editText.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setEditText(item.text);
      setIsEditing(false);
    }
  };

  const getDueDateLabel = () => {
    if (!item.dueDate) return null;
    const date = new Date(item.dueDate);
    if (isToday(date)) return 'Today';
    if (isTomorrow(date)) return 'Tomorrow';
    return format(date, 'MMM d');
  };

  const isOverdue = item.dueDate && isPast(new Date(item.dueDate)) && !item.checked;

  return (
    <div
      className={cn(
        'flex items-center gap-2 p-2 rounded-md group transition-colors',
        isDragging && 'bg-muted shadow-md',
        !isDragging && 'hover:bg-muted/50'
      )}
    >
      <GripVertical className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 cursor-grab shrink-0" />
      <Checkbox
        checked={item.checked}
        onCheckedChange={onToggle}
        className="shrink-0"
      />
      {isEditing ? (
        <Input
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          autoFocus
          className="h-8"
        />
      ) : (
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span
            className={cn(
              'truncate cursor-pointer',
              item.checked && 'line-through text-muted-foreground'
            )}
            onClick={() => setIsEditing(true)}
          >
            {item.text}
          </span>
          {item.dueDate && (
            <div
              className={cn(
                'flex items-center gap-1 text-xs shrink-0',
                isOverdue ? 'text-destructive' : 'text-muted-foreground'
              )}
            >
              <Clock className="h-3 w-3" />
              {getDueDateLabel()}
            </div>
          )}
        </div>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0"
        onClick={onDelete}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

interface AddListItemProps {
  onAdd: (text: string) => void;
  placeholder?: string;
}

export function AddListItem({ onAdd, placeholder = 'Add item...' }: AddListItemProps) {
  const [text, setText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim()) {
      onAdd(text.trim());
      setText('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 p-2">
      <Checkbox disabled className="opacity-50 shrink-0" />
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="h-8 border-dashed"
      />
    </form>
  );
}
