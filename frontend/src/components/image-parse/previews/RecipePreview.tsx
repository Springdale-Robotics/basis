import { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { ParsedRecipeContent, ParsedRecipeIngredient } from '@/api/image-parse';

interface RecipePreviewProps {
  content: ParsedRecipeContent;
  onContentChange?: (content: ParsedRecipeContent) => void;
}

export function RecipePreview({ content, onContentChange }: RecipePreviewProps) {
  const [localContent, setLocalContent] = useState<ParsedRecipeContent>(content);
  const [ingredientsOpen, setIngredientsOpen] = useState(true);
  const [instructionsOpen, setInstructionsOpen] = useState(true);

  const updateContent = (updates: Partial<ParsedRecipeContent>) => {
    const updated = { ...localContent, ...updates };
    setLocalContent(updated);
    onContentChange?.(updated);
  };

  const updateIngredient = (index: number, updates: Partial<ParsedRecipeIngredient>) => {
    const ingredients = [...localContent.ingredients];
    ingredients[index] = { ...ingredients[index], ...updates };
    updateContent({ ingredients });
  };

  const removeIngredient = (index: number) => {
    const ingredients = localContent.ingredients.filter((_, i) => i !== index);
    updateContent({ ingredients });
  };

  const addIngredient = () => {
    const ingredients = [
      ...localContent.ingredients,
      { name: '', confidence: 1 },
    ];
    updateContent({ ingredients });
  };

  const updateInstruction = (index: number, text: string) => {
    const instructions = [...localContent.instructions];
    instructions[index] = text;
    updateContent({ instructions });
  };

  const removeInstruction = (index: number) => {
    const instructions = localContent.instructions.filter((_, i) => i !== index);
    updateContent({ instructions });
  };

  const addInstruction = () => {
    updateContent({ instructions: [...localContent.instructions, ''] });
  };

  return (
    <div className="space-y-4">
      {/* Title */}
      <div className="space-y-2">
        <Label>Recipe Title</Label>
        <Input
          value={localContent.title}
          onChange={(e) => updateContent({ title: e.target.value })}
          placeholder="Enter recipe title..."
        />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label>Description (optional)</Label>
        <Textarea
          value={localContent.description || ''}
          onChange={(e) => updateContent({ description: e.target.value })}
          placeholder="Brief description..."
          rows={2}
        />
      </div>

      {/* Times and Servings */}
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Prep Time (min)</Label>
          <Input
            type="number"
            value={localContent.prepTimeMinutes || ''}
            onChange={(e) =>
              updateContent({
                prepTimeMinutes: e.target.value ? parseInt(e.target.value) : undefined,
              })
            }
            placeholder="0"
          />
        </div>
        <div className="space-y-2">
          <Label>Cook Time (min)</Label>
          <Input
            type="number"
            value={localContent.cookTimeMinutes || ''}
            onChange={(e) =>
              updateContent({
                cookTimeMinutes: e.target.value ? parseInt(e.target.value) : undefined,
              })
            }
            placeholder="0"
          />
        </div>
        <div className="space-y-2">
          <Label>Servings</Label>
          <Input
            type="number"
            value={localContent.servings || ''}
            onChange={(e) =>
              updateContent({
                servings: e.target.value ? parseInt(e.target.value) : undefined,
              })
            }
            placeholder="0"
          />
        </div>
      </div>

      {/* Ingredients */}
      <Collapsible open={ingredientsOpen} onOpenChange={setIngredientsOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between">
            <span>Ingredients ({localContent.ingredients.length})</span>
            {ingredientsOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-2">
          <div className="max-h-[200px] space-y-2 overflow-y-auto rounded-md border p-2">
            {localContent.ingredients.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No ingredients extracted.
              </p>
            ) : (
              localContent.ingredients.map((ing, index) => (
                <div key={index} className="flex items-center gap-2 rounded-md bg-muted/50 p-2">
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      step="0.01"
                      value={ing.quantity || ''}
                      onChange={(e) =>
                        updateIngredient(index, {
                          quantity: e.target.value ? parseFloat(e.target.value) : undefined,
                        })
                      }
                      className="w-20"
                      placeholder="Qty"
                    />
                    <Input
                      value={ing.unit || ''}
                      onChange={(e) => updateIngredient(index, { unit: e.target.value })}
                      className="w-20"
                      placeholder="Unit"
                    />
                  </div>
                  <Input
                    value={ing.name}
                    onChange={(e) => updateIngredient(index, { name: e.target.value })}
                    className="flex-1"
                    placeholder="Ingredient name..."
                  />
                  {ing.confidence < 0.7 && (
                    <Badge variant="outline" className="shrink-0 text-xs">
                      Low
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => removeIngredient(index)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))
            )}
          </div>
          <Button variant="outline" size="sm" className="w-full" onClick={addIngredient}>
            <Plus className="mr-1 h-4 w-4" />
            Add Ingredient
          </Button>
        </CollapsibleContent>
      </Collapsible>

      {/* Instructions */}
      <Collapsible open={instructionsOpen} onOpenChange={setInstructionsOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between">
            <span>Instructions ({localContent.instructions.length} steps)</span>
            {instructionsOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-2">
          <div className="max-h-[200px] space-y-2 overflow-y-auto rounded-md border p-2">
            {localContent.instructions.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No instructions extracted.
              </p>
            ) : (
              localContent.instructions.map((instruction, index) => (
                <div key={index} className="flex items-start gap-2 rounded-md bg-muted/50 p-2">
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-xs font-medium">
                    {index + 1}
                  </span>
                  <Textarea
                    value={instruction}
                    onChange={(e) => updateInstruction(index, e.target.value)}
                    className="flex-1"
                    rows={2}
                    placeholder="Instruction step..."
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => removeInstruction(index)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))
            )}
          </div>
          <Button variant="outline" size="sm" className="w-full" onClick={addInstruction}>
            <Plus className="mr-1 h-4 w-4" />
            Add Step
          </Button>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
