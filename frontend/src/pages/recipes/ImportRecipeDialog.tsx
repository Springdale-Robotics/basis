import { useState, useCallback, useEffect } from 'react';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { Upload, Link, FileText, Check, X, ChevronRight, Loader2, AlertCircle, AlertTriangle, Info, FileUp, Camera } from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { recipesApi, type IngredientMatch, type ImportSession, type ParsedRecipe, type ParseMethod } from '@/api/recipes';
import { imageParseApi, type ImageParseSession, type ParsedRecipeContent } from '@/api/image-parse';
import { inventoryApi } from '@/api/inventory';
import { cn } from '@/lib/utils';
import { IngredientMatchRow } from './IngredientMatchRow';
import { BulkIngredientActions } from './BulkIngredientActions';
import { useInventoryTier } from '@/hooks/useInventoryTier';
import { useCategories } from '@/hooks/useCategories';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { getItemIcon } from '@/lib/inventory-constants';

type ImportStep = 'source' | 'review' | 'ingredients' | 'quick-catalog' | 'confirm';

interface ImportRecipeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (recipeId: string) => void;
  defaultTab?: 'text' | 'url' | 'file' | 'pdf' | 'image';
}

// Map parse method to user-friendly name
function getParseMethodLabel(method: ParseMethod | undefined): string {
  switch (method) {
    case 'json-ld': return 'Structured Data';
    case 'recipe-clipper': return 'Smart Extraction';
    case 'microdata': return 'Microdata';
    case 'heuristic': return 'Pattern Matching';
    case 'text': return 'Text Parsing';
    default: return 'Unknown';
  }
}

// Get confidence badge color
function getConfidenceBadgeVariant(confidence: number): 'default' | 'secondary' | 'destructive' {
  if (confidence >= 0.8) return 'default';
  if (confidence >= 0.5) return 'secondary';
  return 'destructive';
}

function formatRecipeAsText(recipe: ParsedRecipe): string {
  const lines = [recipe.title || 'Untitled Recipe', '', 'Ingredients:'];
  for (const ing of recipe.ingredients) {
    const parts: string[] = [];
    if (ing.quantity) parts.push(String(ing.quantity));
    if (ing.unit) parts.push(ing.unit);
    parts.push(ing.name);
    if (ing.notes) parts.push(`(${ing.notes})`);
    lines.push(parts.join(' '));
  }
  lines.push('', 'Instructions:');
  recipe.instructions.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
  return lines.join('\n');
}

export function ImportRecipeDialog({ open, onOpenChange, onSuccess, defaultTab }: ImportRecipeDialogProps) {
  const { isAdvanced } = useInventoryTier();
  const { categories } = useCategories();
  const [step, setStep] = useState<ImportStep>('source');

  // Fetch existing inventory items for "link to existing" option
  const { data: existingItemsData } = useQuery({
    queryKey: ['inventory', 'items'],
    queryFn: () => inventoryApi.getItems({}),
    enabled: open,
  });
  const existingItems = existingItemsData?.items || [];
  const existingItemOptions: ComboboxOption[] = existingItems.map(item => ({
    value: item.id,
    label: item.name,
    icon: <span>{getItemIcon(item)}</span>,
  }));
  const [sourceType, setSourceType] = useState<'url' | 'pdf' | 'text' | 'file' | 'image'>(defaultTab || 'text');

  // Sync tab when dialog opens
  useEffect(() => {
    if (open) {
      setSourceType(defaultTab || 'text');
    }
  }, [open, defaultTab]);
  const [sourceUrl, setSourceUrl] = useState('');
  const [rawText, setRawText] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Image scan state
  const [imageParseSessionId, setImageParseSessionId] = useState<string | null>(null);
  const [imageProcessing, setImageProcessing] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [ingredientMatches, setIngredientMatches] = useState<IngredientMatch[]>([]);
  // Store catalog item data from imported .recipe files
  const [importedCatalogItems, setImportedCatalogItems] = useState<Record<string, { name: string; category?: string; defaultUnit?: string; density?: number }>>({});
  const [overrides, setOverrides] = useState<{
    title?: string;
    description?: string;
    prepTimeMinutes?: number;
    cookTimeMinutes?: number;
    servings?: number;
  }>({});

  // Quick catalog state (Basic mode)
  interface CatalogSuggestion {
    originalName: string;
    suggestedName: string;
    editedName: string;
    category?: string;
    similarExisting?: string;
    /** 'create' = make new item, 'link' = link to existing item */
    action: 'create' | 'link';
    /** If action='link', the existing item ID to link to */
    linkedItemId?: string;
    linkedItemName?: string;
  }
  const [catalogSuggestions, setCatalogSuggestions] = useState<CatalogSuggestion[]>([]);
  const [isCreatingItems, setIsCreatingItems] = useState(false);

  // Preview state for URL/text parsing
  const [previewRecipe, setPreviewRecipe] = useState<ParsedRecipe | null>(null);
  const [parseMethod, setParseMethod] = useState<ParseMethod | undefined>();
  const [parseConfidence, setParseConfidence] = useState<number | undefined>();
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);

  const queryClient = useQueryClient();

  // Fetch session data when we have a sessionId
  const { data: sessionData, isLoading: isLoadingSession } = useQuery({
    queryKey: ['import-session', sessionId],
    queryFn: () => recipesApi.getImportSession(sessionId!),
    enabled: !!sessionId,
  });

  const session = sessionData?.session;

  // URL preview mutation
  const previewUrlMutation = useMutation({
    mutationFn: () => recipesApi.parseUrl(sourceUrl),
    onSuccess: (data) => {
      setPreviewRecipe(data.parsedRecipe);
      setParseMethod(data.parseMethod);
      setParseConfidence(data.confidence);
      setParseWarnings(data.warnings);
    },
  });

  // Text preview mutation
  const previewTextMutation = useMutation({
    mutationFn: () => recipesApi.parseText(rawText),
    onSuccess: (data) => {
      setPreviewRecipe(data.parsedRecipe);
      setParseMethod(data.parseMethod);
      setParseConfidence(data.confidence);
      setParseWarnings(data.warnings);
    },
  });

  // Start import mutation
  const startImportMutation = useMutation({
    mutationFn: async () => {
      if (sourceType === 'image' && previewRecipe) {
        // Send OCR-extracted recipe as text for the import pipeline to process
        const recipeText = formatRecipeAsText(previewRecipe);
        return recipesApi.startImport({
          sourceType: 'text',
          sourceData: recipeText,
          rawText: recipeText,
        });
      }
      if (sourceType === 'file' && previewRecipe) {
        // For .recipe files, send the parsed recipe as JSON with catalogItem data
        const fileData = {
          version: '1.0',
          type: 'recipe',
          recipe: {
            ...previewRecipe,
            ingredients: previewRecipe.ingredients.map(ing => ({
              ...ing,
              catalogItem: importedCatalogItems[ing.name],
            })),
          },
        };
        return recipesApi.startImport({
          sourceType: 'text',
          sourceData: JSON.stringify(fileData),
          rawText: JSON.stringify(fileData),
        });
      }
      const sourceData = sourceType === 'url' ? sourceUrl : rawText;
      return recipesApi.startImport({
        sourceType: sourceType === 'file' ? 'text' : sourceType,
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

  // Rematch mutation
  const rematchMutation = useMutation({
    mutationFn: () => recipesApi.rematchIngredients(sessionId!),
    onSuccess: (data) => {
      setIngredientMatches(data.matches);
      queryClient.invalidateQueries({ queryKey: ['import-session', sessionId] });
    },
  });

  // Confirm import mutation
  const confirmMutation = useMutation({
    mutationFn: async () => {
      // Step 1: Create new items from catalog suggestions
      const toCreate = catalogSuggestions.filter(s => s.action === 'create' && s.editedName.trim());
      if (toCreate.length > 0) {
        const items = toCreate.map(s => ({
          name: s.editedName.trim(),
          category: s.category,
          defaultUnit: 'pieces',
        }));
        const result = await inventoryApi.batchCreateItems({ items });

        if (result?.items) {
          const nameToId: Record<string, string> = {};
          for (const item of result.items) {
            nameToId[item.name.toLowerCase()] = item.id;
          }

          // Update ingredient matches with created item IDs
          for (const suggestion of toCreate) {
            const itemId = nameToId[suggestion.editedName.trim().toLowerCase()];
            if (itemId) {
              const matchIdx = ingredientMatches.findIndex(m => m.parsedName === suggestion.originalName);
              if (matchIdx >= 0) {
                ingredientMatches[matchIdx] = {
                  ...ingredientMatches[matchIdx],
                  matchedItemId: itemId,
                  matchedItemName: suggestion.editedName.trim(),
                  matchStatus: 'manual',
                };
              }
            }
          }
        }
      }

      // Step 2: Apply "link to existing" matches
      const toLink = catalogSuggestions.filter(s => s.action === 'link' && s.linkedItemId);
      for (const suggestion of toLink) {
        const matchIdx = ingredientMatches.findIndex(m => m.parsedName === suggestion.originalName);
        if (matchIdx >= 0) {
          ingredientMatches[matchIdx] = {
            ...ingredientMatches[matchIdx],
            matchedItemId: suggestion.linkedItemId!,
            matchedItemName: suggestion.linkedItemName || '',
            matchStatus: 'manual',
          };
        }
      }

      // Step 3: Save all matches to session
      if (sessionId && (toCreate.length > 0 || toLink.length > 0)) {
        await recipesApi.updateImportMatches(sessionId, ingredientMatches.map(m => ({
          parsedName: m.parsedName,
          matchedItemId: m.matchedItemId,
          matchedItemName: m.matchedItemName,
          modifiedUnit: m.modifiedUnit,
        })));
      }

      // Step 4: Confirm the import (creates recipe in DB)
      return recipesApi.confirmImport(sessionId!, overrides);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      queryClient.invalidateQueries({ queryKey: ['tag-suggestions'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
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
    setSourceType(defaultTab || 'text');
    setSourceUrl('');
    setRawText('');
    setSessionId(null);
    setIngredientMatches([]);
    setImportedCatalogItems({});
    setCatalogSuggestions([]);
    setOverrides({});
    setPreviewRecipe(null);
    setParseMethod(undefined);
    setParseConfidence(undefined);
    setParseWarnings([]);
    setImageParseSessionId(null);
    setImageProcessing(false);
    setImageError(null);
    onOpenChange(false);
  }, [onOpenChange, defaultTab]);

  const handlePreview = useCallback(() => {
    if (sourceType === 'url') {
      previewUrlMutation.mutate();
    } else if (sourceType === 'text') {
      previewTextMutation.mutate();
    }
  }, [sourceType, previewUrlMutation, previewTextMutation]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Check if this is a .recipe file format
      if (data.version && data.type === 'recipe' && data.recipe) {
        // Extract recipe data
        const recipe = data.recipe;
        setPreviewRecipe({
          title: recipe.title,
          description: recipe.description,
          instructions: recipe.instructions?.map((inst: { text: string }) => inst.text) || [],
          prepTimeMinutes: recipe.prepTimeMinutes,
          cookTimeMinutes: recipe.cookTimeMinutes,
          servings: recipe.servings,
          imageUrl: recipe.imageUrl,
          sourceUrl: recipe.sourceUrl,
          ingredients: recipe.ingredients?.map((ing: { name: string; quantity?: number; unit?: string; notes?: string }) => ({
            name: ing.name,
            quantity: ing.quantity,
            unit: ing.unit,
            notes: ing.notes,
          })) || [],
        });
        setParseMethod('json-ld'); // Treat as structured data
        setParseConfidence(1.0); // High confidence for .recipe files
        setParseWarnings([]);

        // Store catalog item data for ingredient matching (including unit conversions)
        const catalogItems: Record<string, { name: string; category?: string; defaultUnit?: string; density?: number }> = {};
        recipe.ingredients?.forEach((ing: { name: string; catalogItem?: { name: string; category?: string; defaultUnit?: string; density?: number } }) => {
          if (ing.catalogItem) {
            catalogItems[ing.name] = ing.catalogItem;
          }
        });
        setImportedCatalogItems(catalogItems);
      } else {
        setParseWarnings(['Invalid .recipe file format']);
      }
    } catch {
      setParseWarnings(['Failed to parse file. Make sure it is a valid .recipe file.']);
    }
    // Reset file input
    e.target.value = '';
  }, []);

  const handleImageUpload = useCallback(async (file: File) => {
    setImageProcessing(true);
    setImageError(null);
    setPreviewRecipe(null);

    try {
      // Upload image to the image-parse service
      const { sessionId: imgSessionId } = await imageParseApi.uploadImage(file, 'recipe', undefined, 'accurate');
      setImageParseSessionId(imgSessionId);

      // Poll until processing is complete
      const maxWaitMs = 180000; // 3 minutes
      const startTime = Date.now();
      let delay = 1000;

      while (Date.now() - startTime < maxWaitMs) {
        await new Promise(resolve => setTimeout(resolve, delay));
        const { session: imgSession } = await imageParseApi.getSession(imgSessionId);

        if (imgSession.status === 'review' && imgSession.parsedContent) {
          // Map image-parse result to preview recipe format
          const data = imgSession.parsedContent.data as ParsedRecipeContent;
          setPreviewRecipe({
            title: data.title || '',
            description: data.description,
            instructions: data.instructions || [],
            prepTimeMinutes: data.prepTimeMinutes,
            cookTimeMinutes: data.cookTimeMinutes,
            servings: data.servings,
            imageUrl: data.imageUrl,
            ingredients: (data.ingredients || []).map(ing => ({
              name: ing.name,
              quantity: ing.quantity,
              unit: ing.unit,
              notes: ing.notes,
            })),
          });
          setParseMethod('crf' as ParseMethod);
          setParseConfidence(parseFloat(imgSession.confidence || '0.8'));
          setParseWarnings(imgSession.parseWarnings || []);
          setImageProcessing(false);
          return;
        }

        if (imgSession.status === 'failed') {
          throw new Error('Image processing failed. Try a clearer photo.');
        }

        delay = Math.min(delay * 1.5, 5000);
      }

      throw new Error('Image processing timed out. Please try again.');
    } catch (e) {
      setImageError(e instanceof Error ? e.message : 'Failed to process image');
      setImageProcessing(false);
    }
  }, []);

  const handleMatchUpdate = useCallback((parsedName: string, matchedItemId?: string, matchedItemName?: string, unit?: string) => {
    setIngredientMatches(prev =>
      prev.map(m =>
        m.parsedName === parsedName
          ? {
              ...m,
              matchedItemId,
              matchedItemName,
              matchStatus: matchedItemId ? 'manual' : 'unmatched',
              // Store user-modified unit
              modifiedUnit: unit,
            }
          : m
      )
    );
  }, []);

  const handleCreateNewItem = useCallback(async (name: string, unit?: string, category?: string, areaId?: string) => {
    // Check if there's catalogItem data for this ingredient from .recipe import
    const catalogItem = importedCatalogItems[name];
    const result = await createItemMutation.mutateAsync({
      name: catalogItem?.name || name,
      defaultUnit: unit || catalogItem?.defaultUnit,
      category: category || catalogItem?.category,
      defaultAreaId: areaId,
    });
    return { itemId: result.item.id, itemName: result.item.name };
  }, [createItemMutation, importedCatalogItems]);

  const handleProceedToIngredients = useCallback(() => {
    if (session?.ingredientMatches) {
      // Attach catalogItem data from imported .recipe file if available
      const matchesWithCatalog = session.ingredientMatches.map(match => ({
        ...match,
        catalogItem: importedCatalogItems[match.parsedName] || match.catalogItem,
      }));
      setIngredientMatches(matchesWithCatalog);
    }
    setStep('ingredients');
  }, [session, importedCatalogItems]);

  const handleSaveMatches = useCallback(() => {
    const updates = ingredientMatches.map(m => ({
      parsedName: m.parsedName,
      matchedItemId: m.matchedItemId,
      matchedItemName: m.matchedItemName,
      modifiedUnit: m.modifiedUnit,
    }));
    updateMatchesMutation.mutate(updates);
    setStep('confirm');
  }, [ingredientMatches, updateMatchesMutation]);

  // Bulk action handlers
  const handleAutoAcceptHighConfidence = useCallback(() => {
    setIngredientMatches(prev =>
      prev.map(m => {
        if (m.suggestions && m.suggestions.length > 0 && m.suggestions[0].confidence >= 0.9) {
          return {
            ...m,
            matchedItemId: m.suggestions[0].itemId,
            matchedItemName: m.suggestions[0].name,
            matchStatus: 'manual',
            confidence: m.suggestions[0].confidence,
          };
        }
        return m;
      })
    );
  }, []);

  const handleCreateAllUnmatched = useCallback(async () => {
    const unmatched = ingredientMatches.filter(m => !m.matchedItemId);
    for (const match of unmatched) {
      try {
        const result = await handleCreateNewItem(match.parsedName, match.parsedUnit);
        handleMatchUpdate(match.parsedName, result.itemId, result.itemName);
      } catch {
        // Continue with next item on error
      }
    }
    // Rematch to pick up new items
    if (sessionId) {
      rematchMutation.mutate();
    }
  }, [ingredientMatches, handleCreateNewItem, handleMatchUpdate, sessionId, rematchMutation]);

  const handleSkipAllUnmatched = useCallback(() => {
    // Nothing to do - unmatched items will be imported without inventory links
  }, []);

  // Calculate step progress
  // Step definitions per mode
  const steps: { key: ImportStep; label: string }[] = isAdvanced
    ? [
        { key: 'source', label: 'Source' },
        { key: 'review', label: 'Review' },
        { key: 'ingredients', label: 'Link' },
        { key: 'confirm', label: 'Save' },
      ]
    : [
        { key: 'source', label: 'Source' },
        { key: 'review', label: 'Review' },
        { key: 'quick-catalog', label: 'Catalog' },
        { key: 'confirm', label: 'Save' },
      ];

  const currentStepIndex = steps.findIndex(s => s.key === step);
  const nextStepLabel = currentStepIndex < steps.length - 1 ? steps[currentStepIndex + 1]?.label : null;

  const isPreviewing = previewUrlMutation.isPending || previewTextMutation.isPending;
  const hasPreview = !!previewRecipe;
  const currentConfidence = parseConfidence ?? (session?.parseConfidence ? parseFloat(session.parseConfidence) : undefined);
  const currentWarnings = parseWarnings.length > 0 ? parseWarnings : (session?.parseWarnings ?? []);
  const currentParseMethod = parseMethod ?? session?.parseMethod;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Import Recipe</DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 flex-shrink-0 px-1">
          {steps.map((s, i) => (
            <div key={s.key} className="flex items-center flex-1">
              <div className="flex flex-col items-center flex-1">
                <div className={cn(
                  'h-1.5 w-full rounded-full transition-colors',
                  i <= currentStepIndex ? 'bg-primary' : 'bg-muted'
                )} />
                <span className={cn(
                  'text-[10px] mt-1 transition-colors',
                  i === currentStepIndex ? 'text-foreground font-medium' : 'text-muted-foreground'
                )}>
                  {s.label}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto pr-4 min-h-0">
          {step === 'source' && (
            <div className="space-y-4 py-4">
              <Tabs value={sourceType} onValueChange={(v) => {
                setSourceType(v as 'url' | 'pdf' | 'text' | 'file' | 'image');
                setPreviewRecipe(null);
                setParseWarnings([]);
                setImportedCatalogItems({});
                setImageError(null);
              }}>
                <TabsList className="grid w-full grid-cols-5">
                  <TabsTrigger value="text">
                    <FileText className="mr-2 h-4 w-4" />
                    Paste Text
                  </TabsTrigger>
                  <TabsTrigger value="url">
                    <Link className="mr-2 h-4 w-4" />
                    From URL
                  </TabsTrigger>
                  <TabsTrigger value="image">
                    <Camera className="mr-2 h-4 w-4" />
                    Scan Image
                  </TabsTrigger>
                  <TabsTrigger value="file">
                    <FileUp className="mr-2 h-4 w-4" />
                    Upload File
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
                      onChange={(e) => {
                        setRawText(e.target.value);
                        setPreviewRecipe(null);
                      }}
                      rows={12}
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      The parser will automatically detect ingredients and instructions sections
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="url" className="mt-4">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Recipe URL</Label>
                      <div className="flex gap-2">
                        <Input
                          type="url"
                          placeholder="https://example.com/recipe"
                          value={sourceUrl}
                          onChange={(e) => {
                            setSourceUrl(e.target.value);
                            setPreviewRecipe(null);
                          }}
                          className="flex-1"
                        />
                        <Button
                          variant="outline"
                          onClick={handlePreview}
                          disabled={!sourceUrl || isPreviewing}
                        >
                          {isPreviewing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Preview
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Enter the URL of a recipe page. We support most recipe websites including AllRecipes, Food Network, and more.
                      </p>
                    </div>

                    {previewUrlMutation.isError && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          {previewUrlMutation.error instanceof Error
                            ? previewUrlMutation.error.message
                            : 'Failed to fetch recipe from URL'}
                        </AlertDescription>
                      </Alert>
                    )}

                    {hasPreview && sourceType === 'url' && (
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="font-medium">{previewRecipe?.title}</h4>
                            <div className="flex gap-2">
                              {currentParseMethod && (
                                <Badge variant="outline" className="text-xs">
                                  {getParseMethodLabel(currentParseMethod)}
                                </Badge>
                              )}
                              {currentConfidence !== undefined && (
                                <Badge variant={getConfidenceBadgeVariant(currentConfidence)} className="text-xs">
                                  {Math.round(currentConfidence * 100)}% confidence
                                </Badge>
                              )}
                            </div>
                          </div>
                          {previewRecipe?.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {previewRecipe.description}
                            </p>
                          )}
                          <div className="flex gap-4 text-sm text-muted-foreground">
                            <span>{previewRecipe?.ingredients.length ?? 0} ingredients</span>
                            <span>{previewRecipe?.instructions.length ?? 0} steps</span>
                            {previewRecipe?.servings && <span>{previewRecipe.servings} servings</span>}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="image" className="mt-4">
                  <div className="space-y-4">
                    {imageProcessing ? (
                      <div className="border-2 border-dashed rounded-lg p-8 text-center space-y-4">
                        <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin" />
                        <p className="text-sm font-medium">Processing image...</p>
                        <p className="text-xs text-muted-foreground">
                          Extracting text and parsing recipe. This may take up to a minute.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label>Upload a photo of a recipe</Label>
                        <Input
                          type="file"
                          accept="image/jpeg,image/png,image/gif,image/webp,image/heic"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleImageUpload(file);
                            e.target.value = '';
                          }}
                        />
                        <p className="text-xs text-muted-foreground">
                          Take a photo of a handwritten recipe card, printed recipe, or screenshot. Supports JPG, PNG, GIF, WebP, HEIC (max 10MB).
                        </p>
                      </div>
                    )}

                    {imageError && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{imageError}</AlertDescription>
                      </Alert>
                    )}

                    {hasPreview && sourceType === 'image' && (
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="font-medium">{previewRecipe?.title}</h4>
                            <div className="flex gap-2">
                              {currentConfidence !== undefined && (
                                <Badge variant={getConfidenceBadgeVariant(currentConfidence)} className="text-xs">
                                  {Math.round(currentConfidence * 100)}% confidence
                                </Badge>
                              )}
                            </div>
                          </div>
                          {previewRecipe?.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {previewRecipe.description}
                            </p>
                          )}
                          <div className="flex gap-4 text-sm text-muted-foreground">
                            <span>{previewRecipe?.ingredients.length ?? 0} ingredients</span>
                            <span>{previewRecipe?.instructions.length ?? 0} steps</span>
                            {previewRecipe?.servings && <span>{previewRecipe.servings} servings</span>}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="file" className="mt-4">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Upload .recipe file</Label>
                      <Input
                        type="file"
                        accept=".recipe"
                        onChange={handleFileUpload}
                      />
                      <p className="text-xs text-muted-foreground">
                        Upload a .recipe file exported from this app or another compatible source.
                      </p>
                    </div>

                    {hasPreview && sourceType === 'file' && (
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="font-medium">{previewRecipe?.title}</h4>
                            <Badge variant="default" className="text-xs">
                              100% confidence
                            </Badge>
                          </div>
                          {previewRecipe?.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {previewRecipe.description}
                            </p>
                          )}
                          <div className="flex gap-4 text-sm text-muted-foreground">
                            <span>{previewRecipe?.ingredients.length ?? 0} ingredients</span>
                            <span>{previewRecipe?.instructions.length ?? 0} steps</span>
                            {previewRecipe?.servings && <span>{previewRecipe.servings} servings</span>}
                          </div>
                          {Object.keys(importedCatalogItems).length > 0 && (
                            <div className="text-sm text-green-600">
                              {Object.keys(importedCatalogItems).length} ingredients have catalog data for easy linking
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}
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

              {currentWarnings.length > 0 && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <ul className="list-disc list-inside space-y-1">
                      {currentWarnings.map((warning, i) => (
                        <li key={i} className="text-sm">{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex justify-end">
                <Button
                  onClick={() => startImportMutation.mutate()}
                  disabled={startImportMutation.isPending || imageProcessing || (
                    sourceType === 'text' ? !rawText :
                    sourceType === 'file' ? !previewRecipe :
                    sourceType === 'image' ? !previewRecipe :
                    sourceType === 'url' ? !sourceUrl :
                    true
                  )}
                >
                  {startImportMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Parse & Review
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
                  {/* Confidence and warnings banner */}
                  {(currentConfidence !== undefined || currentWarnings.length > 0) && (
                    <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex items-center gap-2">
                        {currentParseMethod && (
                          <Badge variant="outline">
                            {getParseMethodLabel(currentParseMethod)}
                          </Badge>
                        )}
                        {currentConfidence !== undefined && (
                          <Badge variant={getConfidenceBadgeVariant(currentConfidence)}>
                            {Math.round(currentConfidence * 100)}% confidence
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {currentWarnings.length > 0 && (
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <AlertTriangle className="h-4 w-4" />
                            {currentWarnings.length} warning{currentWarnings.length !== 1 ? 's' : ''}
                          </div>
                        )}
                        {currentParseMethod !== 'llm' && sessionId && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              try {
                                const result = await recipesApi.reparseLLM(sessionId);
                                setParseConfidence(result.confidence);
                                setParseMethod(result.parseMethod as ParseMethod);
                                setParseWarnings([]);
                                // Refresh session data
                                queryClient.invalidateQueries({ queryKey: ['import-session', sessionId] });
                              } catch (err) {
                                console.error('LLM re-parse failed:', err);
                              }
                            }}
                          >
                            Re-parse with AI
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {currentWarnings.length > 0 && (
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertDescription>
                        <ul className="list-disc list-inside space-y-1">
                          {currentWarnings.map((warning, i) => (
                            <li key={i} className="text-sm">{warning}</li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}

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

                    {session.parsedRecipe.author && (
                      <div className="text-sm text-muted-foreground">
                        By {session.parsedRecipe.author}
                      </div>
                    )}

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
                    {isAdvanced ? (
                      <Button onClick={handleProceedToIngredients}>
                        Link Ingredients
                        <ChevronRight className="ml-2 h-4 w-4" />
                      </Button>
                    ) : (
                      <Button onClick={async () => {
                        // Basic mode: auto-accept high confidence matches
                        let autoAccepted: IngredientMatch[] = [];
                        if (session?.ingredientMatches) {
                          autoAccepted = session.ingredientMatches.map(m => {
                            if (m.suggestions && m.suggestions.length > 0 && m.suggestions[0].confidence >= 0.8) {
                              return {
                                ...m,
                                matchedItemId: m.suggestions[0].itemId,
                                matchedItemName: m.suggestions[0].name,
                                matchStatus: 'manual' as const,
                                confidence: m.suggestions[0].confidence,
                              };
                            }
                            return m;
                          });
                          setIngredientMatches(autoAccepted);
                          const updates = autoAccepted.map(m => ({
                            parsedName: m.parsedName,
                            matchedItemId: m.matchedItemId,
                            matchedItemName: m.matchedItemName,
                            modifiedUnit: m.modifiedUnit,
                          }));
                          updateMatchesMutation.mutate(updates);
                        }

                        // Always go to catalog step — get suggestions for unmatched
                        const unmatched = autoAccepted.filter(m => !m.matchedItemId);
                        try {
                          if (unmatched.length > 0) {
                            const result = await recipesApi.suggestItems(
                              unmatched.map(m => m.parsedName)
                            );
                            setCatalogSuggestions(result.suggestions.map(s => ({
                              ...s,
                              editedName: s.suggestedName,
                              action: 'create' as const,
                            })));
                          } else {
                            setCatalogSuggestions([]);
                          }
                        } catch {
                          setCatalogSuggestions([]);
                        }
                        setStep('quick-catalog');
                      }}>
                        {nextStepLabel ? `Continue to ${nextStepLabel}` : 'Continue'}
                        <ChevronRight className="ml-2 h-4 w-4" />
                      </Button>
                    )}
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

              {/* Bulk actions */}
              <BulkIngredientActions
                matches={ingredientMatches}
                onAutoAccept={handleAutoAcceptHighConfidence}
                onCreateAll={handleCreateAllUnmatched}
                onSkipAll={handleSkipAllUnmatched}
                isCreating={createItemMutation.isPending}
              />

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
                  {nextStepLabel ? `Continue to ${nextStepLabel}` : 'Continue'}
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {step === 'quick-catalog' && (() => {
            const matched = ingredientMatches.filter(m => m.matchedItemId);
            const unmatched = catalogSuggestions;
            const allResolved = unmatched.every(s =>
              (s.action === 'create' && s.editedName.trim()) ||
              (s.action === 'link' && s.linkedItemId)
            );
            const newItemCount = unmatched.filter(s => s.action === 'create').length;

            return (
            <div className="space-y-4 py-4">
              <div>
                <h3 className="font-medium">Link Ingredients to Catalog</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Each ingredient needs a catalog item.
                  {matched.length > 0 && ` ${matched.length} auto-matched.`}
                  {unmatched.length > 0 && ` ${unmatched.length} need linking.`}
                </p>
              </div>

              {/* Already matched */}
              {matched.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Auto-matched</p>
                  {matched.map(m => (
                    <div key={m.parsedName} className="flex items-center gap-2 px-3 py-1.5 rounded bg-muted/30 text-sm">
                      <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      <span className="text-muted-foreground truncate">{m.parsedName}</span>
                      <span className="text-muted-foreground shrink-0">→</span>
                      <span className="font-medium truncate">{m.matchedItemName}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Unmatched — create new or link to existing */}
              {unmatched.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Needs linking</p>
                  <div className="space-y-2">
                    {unmatched.map((suggestion, idx) => (
                      <div key={suggestion.originalName} className="p-3 rounded-lg border space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">{suggestion.originalName}</p>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              className={cn(
                                'text-xs px-2 py-0.5 rounded transition-colors',
                                suggestion.action === 'create'
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-muted text-muted-foreground hover:text-foreground'
                              )}
                              onClick={() => setCatalogSuggestions(prev => prev.map((s, i) =>
                                i === idx ? { ...s, action: 'create', linkedItemId: undefined, linkedItemName: undefined } : s
                              ))}
                            >
                              Create new
                            </button>
                            <button
                              type="button"
                              className={cn(
                                'text-xs px-2 py-0.5 rounded transition-colors',
                                suggestion.action === 'link'
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-muted text-muted-foreground hover:text-foreground'
                              )}
                              onClick={() => setCatalogSuggestions(prev => prev.map((s, i) =>
                                i === idx ? { ...s, action: 'link' } : s
                              ))}
                            >
                              Link existing
                            </button>
                          </div>
                        </div>

                        {suggestion.action === 'create' ? (
                          <div className="space-y-1.5">
                            <input
                              className="text-sm bg-transparent border-b border-border focus:border-primary focus:outline-none px-0 py-0.5 w-full"
                              placeholder="Item name"
                              value={suggestion.editedName}
                              onChange={(e) => setCatalogSuggestions(prev => prev.map((s, i) =>
                                i === idx ? { ...s, editedName: e.target.value } : s
                              ))}
                            />
                            <div className="flex items-center gap-2">
                              <select
                                className="text-xs rounded border bg-muted/50 px-1.5 py-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
                                value={suggestion.category || ''}
                                onChange={(e) => setCatalogSuggestions(prev => prev.map((s, i) =>
                                  i === idx ? { ...s, category: e.target.value || undefined } : s
                                ))}
                              >
                                <option value="">No category</option>
                                {categories.map(cat => (
                                  <option key={cat} value={cat}>{cat}</option>
                                ))}
                              </select>
                              {suggestion.similarExisting && (
                                <Badge variant="outline" className="text-xs text-warning-foreground border-warning/50">
                                  Similar to: {suggestion.similarExisting}
                                </Badge>
                              )}
                            </div>
                          </div>
                        ) : (
                          <Combobox
                            options={existingItemOptions}
                            value={suggestion.linkedItemId || ''}
                            onValueChange={(value) => {
                              const item = existingItems.find(i => i.id === value);
                              setCatalogSuggestions(prev => prev.map((s, i) =>
                                i === idx ? {
                                  ...s,
                                  linkedItemId: value || undefined,
                                  linkedItemName: item?.name,
                                } : s
                              ));
                            }}
                            placeholder="Search items..."
                            searchPlaceholder="Type to search..."
                            emptyText="No matching items"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep('review')}>
                  Back
                </Button>
                <Button
                  onClick={() => setStep('confirm')}
                  disabled={!allResolved}
                >
                  {newItemCount > 0
                    ? `Continue — ${newItemCount} new item${newItemCount !== 1 ? 's' : ''} to create`
                    : 'Continue to Save'}
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
            );
          })()}

          {step === 'confirm' && (
            <div className="space-y-4 py-4">
              <div className="text-center py-6">
                <Check className="h-16 w-16 mx-auto text-green-500" />
                <h3 className="mt-4 text-lg font-medium">Ready to Import</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {session?.parsedRecipe?.title ?? overrides.title}
                </p>
                <div className="text-xs text-muted-foreground mt-3 space-y-1">
                  <p>{ingredientMatches.length} ingredients total</p>
                  {catalogSuggestions.filter(s => s.action === 'create').length > 0 && (
                    <p>{catalogSuggestions.filter(s => s.action === 'create').length} new catalog items will be created</p>
                  )}
                  {catalogSuggestions.filter(s => s.action === 'link').length > 0 && (
                    <p>{catalogSuggestions.filter(s => s.action === 'link').length} linked to existing items</p>
                  )}
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(isAdvanced ? 'ingredients' : catalogSuggestions.length > 0 ? 'quick-catalog' : 'review')}>
                  Back
                </Button>
                <Button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
                  {confirmMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Recipe
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
