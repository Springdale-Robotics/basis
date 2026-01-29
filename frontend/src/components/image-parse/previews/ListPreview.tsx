import { useState } from 'react';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ParsedListContent, ParsedListItem } from '@/api/image-parse';

interface ListPreviewProps {
  content: ParsedListContent;
  onContentChange?: (content: ParsedListContent) => void;
}

export function ListPreview({ content, onContentChange }: ListPreviewProps) {
  const [localContent, setLocalContent] = useState<ParsedListContent>(content);

  const updateContent = (updates: Partial<ParsedListContent>) => {
    const updated = { ...localContent, ...updates };
    setLocalContent(updated);
    onContentChange?.(updated);
  };

  const updateItem = (index: number, updates: Partial<ParsedListItem>) => {
    const items = [...localContent.items];
    items[index] = { ...items[index], ...updates };
    updateContent({ items });
  };

  const removeItem = (index: number) => {
    const items = localContent.items.filter((_, i) => i !== index);
    updateContent({ items });
  };

  const addItem = () => {
    const items = [
      ...localContent.items,
      { content: '', isChecked: false, confidence: 1 },
    ];
    updateContent({ items });
  };

  return (
    <div className="space-y-4">
      {/* Title */}
      <div className="space-y-2">
        <Label>List Title (optional)</Label>
        <Input
          value={localContent.title || ''}
          onChange={(e) => updateContent({ title: e.target.value })}
          placeholder="Enter list title..."
        />
      </div>

      {/* List Type */}
      <div className="space-y-2">
        <Label>List Type</Label>
        <Select
          value={localContent.suggestedListType}
          onValueChange={(value: 'checklist' | 'reminder' | 'notes') =>
            updateContent({ suggestedListType: value })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="checklist">Checklist</SelectItem>
            <SelectItem value="reminder">Reminder</SelectItem>
            <SelectItem value="notes">Notes</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Items */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Items ({localContent.items.length})</Label>
          <Button variant="ghost" size="sm" onClick={addItem}>
            <Plus className="mr-1 h-4 w-4" />
            Add Item
          </Button>
        </div>

        <div className="max-h-[300px] space-y-2 overflow-y-auto rounded-md border p-2">
          {localContent.items.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No items extracted. Add items manually.
            </p>
          ) : (
            localContent.items.map((item, index) => (
              <div
                key={index}
                className="flex items-center gap-2 rounded-md bg-muted/50 p-2"
              >
                <GripVertical className="h-4 w-4 cursor-grab text-muted-foreground" />

                {localContent.suggestedListType === 'checklist' && (
                  <Checkbox
                    checked={item.isChecked}
                    onCheckedChange={(checked) =>
                      updateItem(index, { isChecked: !!checked })
                    }
                  />
                )}

                <Input
                  value={item.content}
                  onChange={(e) => updateItem(index, { content: e.target.value })}
                  className="flex-1"
                  placeholder="Item content..."
                />

                {item.confidence < 0.7 && (
                  <Badge variant="outline" className="shrink-0 text-xs">
                    Low confidence
                  </Badge>
                )}

                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => removeItem(index)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
