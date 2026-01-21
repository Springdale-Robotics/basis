import { useState, useCallback } from 'react';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { Upload, Link, FileText, Check, X, ChevronRight, Loader2, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { recipesApi, type IngredientMatch, type ImportSession } from '@/api/recipes';
import { inventoryApi } from '@/api/inventory';
import { cn } from '@/lib/utils';
import { IngredientMatchRow } from './IngredientMatchRow';

type ImportStep = 'source' | 'review' | 'ingredients' | 'confirm';

interface ImportRecipeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (recipeId: string) => void;
}

export function ImportRecipeDialog({ open, onOpenChange, onSuccess }: ImportRecipeDialogProps) {
  const [step, setStep] = useState<ImportStep>('source');
  const [sourceType, setSourceType] = useState<'url' | 'pdf' | 'text'>('text');
  const [sourceUrl, setSourceUrl] = useState('');
  const [rawText, setRawText] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [ingredientMatches, setIngredientMatches] = useState<IngredientMatch[]>([]);
  const [overrides, setOverrides] = useState<{
    title?: string;
    description?: string;
    prepTimeMinutes?: number;
    cookTimeMinutes?: number;
    servings?: number;
  }>({});

  const queryClient = useQueryClient();

  // Fetch session data when we have a sessionId
  const { data: sessionData, isLoading: isLoadingSession } = useQuery({
    queryKey: ['import-session', sessionId],
    queryFn: () => recipesApi.getImportSession(sessionId!),
    enabled: !!sessionId,
  });

  const session = sessionData?.session;

  // Start import mutation
  const startImportMutation = useMutation({
    mutationFn: async () => {
      const sourceData = sourceType === 'url' ? sourceUrl : rawText;
      return recipesApi.startImport({
        sourceType: sourceType === 'text' ? 'pdf' : sourceType,
        sourceData,
        rawText: sourceType === 'text' ? rawText : undefined,
      });
    },
    onSuccess: (data) => {
      setSessionId(data.sessionId);
      setStep('review');
    },
  });

  // Update matches mutation
  const updateMatchesMutation = useMutation({
    mutationFn: (updates: Array<{ parsedName: string; matchedItemId?: string; matchedItemName?: string }>) =>
      recipesApi.updateImportMatches(sessionId!, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-session', sessionId] });
    },
  });

  // Confirm import mutation
  const confirmMutation = useMutation({
    mutationFn: () => recipesApi.confirmImport(sessionId!, overrides),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      onSuccess?.(data.recipeId);
      handleClose();
    },
  });

  // Quick create item mutation
  const createItemMutation = useMutation({
    mutationFn: inventoryApi.quickCreateItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
    },
  });

  const handleClose = useCallback(() => {
    setStep('source');
    setSourceType('text');
    setSourceUrl('');
    setRawText('');
    setSessionId(null);
    setIngredientMatches([]);
    setOverrides({});
    onOpenChange(false);
  }, [onOpenChange]);

  const handleMatchUpdate = useCallback((parsedName: string, matchedItemId?: string, matchedItemName?: string) => {
    setIngredientMatches(prev =>
      prev.map(m =>
        m.parsedName === parsedName
          ? { ...m, matchedItemId, matchedItemName, matchStatus: matchedItemId ? 'manual' : 'unmatched' }
          : m
      )
    );
  }, []);

  const handleCreateNewItem = useCallback(async (name: string, unit?: string) => {
    const result = await createItemMutation.mutateAsync({ name, defaultUnit: unit });
    return { itemId: result.item.id, itemName: result.item.name };
  }, [createItemMutation]);

  const handleProceedToIngredients = useCallback(() => {
    if (session?.ingredientMatches) {
      setIngredientMatches(session.ingredientMatches);
    }
    setStep('ingredients');
  }, [session]);

  const handleSaveMatches = useCallback(() => {
    const updates = ingredientMatches.map(m => ({
      parsedName: m.parsedName,
      matchedItemId: m.matchedItemId,
      matchedItemName: m.matchedItemName,
    }));
    updateMatchesMutation.mutate(updates);
    setStep('confirm');
  }, [ingredientMatches, updateMatchesMutation]);

  // Calculate step progress
  const stepProgress = {
    source: 0,
    review: 33,
    ingredients: 66,
    confirm: 100,
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Recipe</DialogTitle>
          <DialogDescription>
            Import a recipe from text, URL, or PDF
          </DialogDescription>
        </DialogHeader>

        <Progress value={stepProgress[step]} className="h-1" />

        <ScrollArea className="flex-1 pr-4">
          {step === 'source' && (
            <div className="space-y-4 py-4">
              <Tabs value={sourceType} onValueChange={(v) => setSourceType(v as 'url' | 'pdf' | 'text')}>
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="text">
                    <FileText className="mr-2 h-4 w-4" />
                    Paste Text
                  </TabsTrigger>
                  <TabsTrigger value="url">
                    <Link className="mr-2 h-4 w-4" />
                    From URL
                  </TabsTrigger>
                  <TabsTrigger value="pdf">
                    <Upload className="mr-2 h-4 w-4" />
                    Upload PDF
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="text" className="mt-4">
                  <div className="space-y-2">
                    <Label>Paste recipe text</Label>
                    <Textarea
                      placeholder="Paste the recipe here including ingredients and instructions..."
                      value={rawText}
                      onChange={(e) => setRawText(e.target.value)}
                      rows={12}
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      The parser will automatically detect ingredients and instructions sections
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="url" className="mt-4">
                  <div className="space-y-2">
                    <Label>Recipe URL</Label>
                    <Input
                      type="url"
                      placeholder="https://example.com/recipe"
                      value={sourceUrl}
                      onChange={(e) => setSourceUrl(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter the URL of a recipe page to import
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="pdf" className="mt-4">
                  <div className="border-2 border-dashed rounded-lg p-8 text-center">
                    <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      PDF import coming soon
                    </p>
                  </div>
                </TabsContent>
              </Tabs>

              <div className="flex justify-end">
                <Button
                  onClick={() => startImportMutation.mutate()}
                  disabled={startImportMutation.isPending || (sourceType === 'text' ? !rawText : !sourceUrl)}
                >
                  {startImportMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Parse Recipe
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-4 py-4">
              {isLoadingSession ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : session?.parsedRecipe ? (
                <>
                  <div className="space-y-4">
                    <div>
                      <Label>Title</Label>
                      <Input
                        value={overrides.title ?? session.parsedRecipe.title}
                        onChange={(e) => setOverrides(prev => ({ ...prev, title: e.target.value }))}
                      />
                    </div>

                    <div>
                      <Label>Description</Label>
                      <Textarea
                        value={overrides.description ?? session.parsedRecipe.description ?? ''}
                        onChange={(e) => setOverrides(prev => ({ ...prev, description: e.target.value }))}
                        rows={2}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <Label>Prep Time (min)</Label>
                        <Input
                          type="number"
                          value={overrides.prepTimeMinutes ?? session.parsedRecipe.prepTimeMinutes ?? ''}
                          onChange={(e) => setOverrides(prev => ({ ...prev, prepTimeMinutes: parseInt(e.target.value) || undefined }))}
                        />
                      </div>
                      <div>
                        <Label>Cook Time (min)</Label>
                        <Input
                          type="number"
                          value={overrides.cookTimeMinutes ?? session.parsedRecipe.cookTimeMinutes ?? ''}
                          onChange={(e) => setOverrides(prev => ({ ...prev, cookTimeMinutes: parseInt(e.target.value) || undefined }))}
                        />
                      </div>
                      <div>
                        <Label>Servings</Label>
                        <Input
                          type="number"
                          value={overrides.servings ?? session.parsedRecipe.servings ?? ''}
                          onChange={(e) => setOverrides(prev => ({ ...prev, servings: parseInt(e.target.value) || undefined }))}
                        />
                      </div>
                    </div>

                    <div>
                      <Label>Ingredients ({session.parsedRecipe.ingredients.length})</Label>
                      <Card className="mt-2">
                        <CardContent className="p-3 max-h-32 overflow-y-auto">
                          <ul className="text-sm space-y-1">
                            {session.parsedRecipe.ingredients.map((ing, i) => (
                              <li key={i}>
                                {ing.quantity && <span className="font-medium">{ing.quantity} </span>}
                                {ing.unit && <span>{ing.unit} </span>}
                                <span>{ing.name}</span>
                                {ing.notes && <span className="text-muted-foreground"> ({ing.notes})</span>}
                              </li>
                            ))}
                          </ul>
                        </CardContent>
                      </Card>
                    </div>

                    <div>
                      <Label>Instructions ({session.parsedRecipe.instructions.length} steps)</Label>
                      <Card className="mt-2">
                        <CardContent className="p-3 max-h-32 overflow-y-auto">
                          <ol className="text-sm space-y-2 list-decimal list-inside">
                            {session.parsedRecipe.instructions.map((inst, i) => (
                              <li key={i}>{inst}</li>
                            ))}
                          </ol>
                        </CardContent>
                      </Card>
                    </div>
                  </div>

                  <div className="flex justify-between">
                    <Button variant="outline" onClick={() => setStep('source')}>
                      Back
                    </Button>
                    <Button onClick={handleProceedToIngredients}>
                      Link Ingredients
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <AlertCircle className="h-12 w-12 text-destructive" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    Failed to parse recipe. Please try again with different text.
                  </p>
                  <Button variant="outline" className="mt-4" onClick={() => setStep('source')}>
                    Go Back
                  </Button>
                </div>
              )}
            </div>
          )}

          {step === 'ingredients' && (
            <div className="space-y-4 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">Link Ingredients to Inventory</h3>
                  <p className="text-sm text-muted-foreground">
                    Match recipe ingredients to your inventory items
                  </p>
                </div>
                <div className="flex gap-2">
                  <Badge variant="secondary">
                    {ingredientMatches.filter(m => m.matchedItemId).length} / {ingredientMatches.length} linked
                  </Badge>
                </div>
              </div>

              <div className="space-y-2">
                {ingredientMatches.map((match, index) => (
                  <IngredientMatchRow
                    key={index}
                    match={match}
                    onUpdate={handleMatchUpdate}
                    onCreateNew={handleCreateNewItem}
                  />
                ))}
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep('review')}>
                  Back
                </Button>
                <Button onClick={handleSaveMatches}>
                  Continue
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {step === 'confirm' && (
            <div className="space-y-4 py-4">
              <div className="text-center py-8">
                <Check className="h-16 w-16 mx-auto text-green-500" />
                <h3 className="mt-4 text-lg font-medium">Ready to Import</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {session?.parsedRecipe?.title ?? overrides.title}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  {ingredientMatches.filter(m => m.matchedItemId).length} ingredients linked to inventory
                </p>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep('ingredients')}>
                  Back
                </Button>
                <Button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
                  {confirmMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Recipe
                </Button>
              </div>
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
