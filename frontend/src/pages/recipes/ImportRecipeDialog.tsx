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
import { imageParseApi } from '@/api/image-parse';
import { formatOcrForEditing } from '@/lib/recipe-utils';
import { inventoryApi } from '@/api/inventory';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/lib/api-error';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { IngredientMatchRow } from './IngredientMatchRow';
import { BulkIngredientActions } from './BulkIngredientActions';
import { BulkImportRecipeDialog } from './BulkImportRecipeDialog';
import { useInventoryTier } from '@/hooks/useInventoryTier';
import { Checkbox } from '@/components/ui/checkbox';
import { FileSourcePicker } from '@/components/shared/FileSourcePicker';
import { useDirtyCloseGuard } from '@/hooks/useDirtyCloseGuard';

type ImportStep = 'source' | 'review' | 'ingredients' | 'confirm';

interface ImportRecipeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (recipeId: string) => void;
  defaultTab?: 'text' | 'url' | 'file' | 'pdf' | 'image';
  /**
   * Called when the user selects multiple files in the image or file tab.
   * Lets the host route through the bulk-import flow without making the user
   * find a separate "Bulk Import" entry point.
   */
  onBatchTransition?: (files: File[]) => void;
}

// Translate parser internals (method + confidence) into a single plain-English
// status the user can act on. The technical detail is preserved as a tooltip
// so power users / debugging can still see it.
interface ParseStatus {
  label: string;
  variant: 'default' | 'secondary' | 'destructive';
  detail: string;
}

function getParseStatus(method: ParseMethod | undefined, confidence: number | undefined): ParseStatus | null {
  if (confidence === undefined && !method) return null;
  const conf = confidence ?? 0;
  const methodDetail = (() => {
    switch (method) {
      case 'json-ld': return 'structured data';
      case 'recipe-clipper': return 'smart extraction';
      case 'microdata': return 'microdata';
      case 'heuristic': return 'pattern matching';
      case 'text': return 'text parsing';
      case 'crf': return 'ingredient parser';
      case 'llm': return 'AI parsing';
      default: return 'auto-detected';
    }
  })();
  const detail = confidence !== undefined
    ? `Parsed via ${methodDetail} (${Math.round(conf * 100)}% confidence)`
    : `Parsed via ${methodDetail}`;
  if (conf >= 0.8) return { label: 'Looks complete', variant: 'default', detail };
  if (conf >= 0.5) return { label: 'Review carefully', variant: 'secondary', detail };
  return { label: 'Some fields may be wrong', variant: 'destructive', detail };
}

export function ImportRecipeDialog({ open, onOpenChange, onSuccess, defaultTab, onBatchTransition }: ImportRecipeDialogProps) {
  const { isAdvanced } = useInventoryTier();
  const [step, setStep] = useState<ImportStep>('source');
  // When the user picks multiple files we render the batch flow inline
  // inside this same dialog instead of opening a separate one. The optional
  // `onBatchTransition` prop is the legacy escape hatch — if the host
  // provides one, we honor it; otherwise we handle batch internally.
  const [batchMode, setBatchMode] = useState(false);
  const [batchInitialFiles, setBatchInitialFiles] = useState<File[] | undefined>();
  const enterBatchMode = (files: File[]) => {
    if (onBatchTransition) {
      onBatchTransition(files);
      return;
    }
    setBatchInitialFiles(files);
    setBatchMode(true);
  };

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
  const [imageRawText, setImageRawText] = useState<string | null>(null);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [ingredientMatches, setIngredientMatches] = useState<IngredientMatch[]>([]);
  // Store catalog item data from imported .recipe files
  const [importedCatalogItems, setImportedCatalogItems] = useState<Record<string, { name: string; category?: string; defaultUnit?: string; density?: number }>>({});
  const [overrides, setOverrides] = useState<{
    title?: string;
    description?: string;
    prepTimeMinutes?: number;
    cookTimeMinutes?: number;
    servings?: number;
    ingredients?: Array<{ name: string; quantity?: number; unit?: string; notes?: string }>;
    instructions?: string[];
  }>({});

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
    // Errors render inline below the URL field; skip the global toast.
    meta: { silenceError: true },
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
      if (sourceType === 'image' && imageRawText) {
        // Send the user-reviewed OCR text for CRF parsing
        return recipesApi.startImport({
          sourceType: 'text',
          sourceData: imageRawText,
          rawText: imageRawText,
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
      if (sourceType === 'pdf' && pdfBase64) {
        return recipesApi.startImport({
          sourceType: 'pdf',
          sourceData: pdfBase64,
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
    mutationFn: (updates: Array<{
      parsedName: string;
      matchedItemId?: string;
      matchedItemName?: string;
      modifiedUnit?: string;
      confirmed?: boolean;
    }>) => recipesApi.updateImportMatches(sessionId!, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-session', sessionId] });
    },
  });

  // Confirm import mutation
  const confirmMutation = useMutation({
    mutationFn: async () => {
      // Persist whatever linking the user did, then create the recipe.
      if (sessionId && ingredientMatches.length > 0) {
        await recipesApi.updateImportMatches(sessionId, ingredientMatches.map(m => ({
          parsedName: m.parsedName,
          matchedItemId: m.matchedItemId,
          matchedItemName: m.matchedItemName,
          modifiedUnit: m.modifiedUnit,
          confirmed: m.matchStatus === 'manual',
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

  // Quick create item mutation (per-row "Create & Link" form)
  const createItemMutation = useMutation({
    mutationFn: inventoryApi.quickCreateItem,
    onSuccess: () => {
      // Sibling rows cache their suggestions by ingredient name, so without
      // this an item created for one row stays invisible to the others and
      // the user creates it again a few rows later.
      queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['ingredient-suggestions'] });
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
    setOverrides({});
    setPreviewRecipe(null);
    setParseMethod(undefined);
    setParseConfidence(undefined);
    setParseWarnings([]);
    setImageParseSessionId(null);
    setImageProcessing(false);
    setImageError(null);
    setImageRawText(null);
    setImagePickerOpen(false);
    setPdfFileName(null);
    setPdfBase64(null);
    setPdfError(null);
    setBatchMode(false);
    setBatchInitialFiles(undefined);
    onOpenChange(false);
  }, [onOpenChange, defaultTab]);

  // Closing mid-import wipes a whole reviewed multi-step session. Guard the
  // Escape / outside-click / X paths once the user is past the source step or
  // has produced preview/OCR/PDF state worth keeping. A pristine source step
  // still closes freely. Successful imports close via handleClose directly.
  const hasImportProgress =
    step !== 'source' ||
    batchMode ||
    !!sessionId ||
    !!previewRecipe ||
    imageRawText !== null ||
    imageProcessing ||
    !!pdfBase64;

  const { requestClose, confirmDialog } = useDirtyCloseGuard({
    isDirty: hasImportProgress,
    onDiscard: handleClose,
    title: 'Discard this import?',
    description: 'Your progress on this recipe import will be lost.',
  });

  const handlePreview = useCallback(() => {
    if (sourceType === 'url') {
      previewUrlMutation.mutate();
    } else if (sourceType === 'text') {
      previewTextMutation.mutate();
    }
  }, [sourceType, previewUrlMutation, previewTextMutation]);

  const handlePdfUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setPdfError(null);
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setPdfError('Please choose a PDF file.');
      return;
    }
    // Cap at 10MB to match the image upload cap.
    if (file.size > 10 * 1024 * 1024) {
      setPdfError('PDF is over 10 MB. Try splitting it or copy/pasting the text instead.');
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      // Convert to base64 in chunks to avoid call-stack limits on large files.
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
      }
      setPdfBase64(btoa(binary));
      setPdfFileName(file.name);
    } catch (err) {
      setPdfError(getErrorMessage(err, 'Failed to read PDF'));
    }
  }, []);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    if (files.length > 1) {
      enterBatchMode(files);
      return;
    }
    const file = files[0];

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
    setImageRawText(null);

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

        if (imgSession.status === 'review') {
          // Build editable text with clear section headers from structured data
          // so the user can see and fix any misplaced content before CRF parsing
          const editableText = formatOcrForEditing(imgSession.rawText, imgSession.parsedContent);
          setImageRawText(editableText);
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
      setImageError(getErrorMessage(e, 'Failed to process image'));
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

  // Single-recipe ingredient review uses the per-session matches the backend
  // already produced (one session per recipe, matches scoped to that session).
  // No cross-recipe dedup is needed because there's only one recipe.
  // Compare with BulkImportRecipeDialog.handleProceedToIngredients (~line 319)
  // which dedupes across all recipes in the batch via normalizeIngredientName().
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
      // Every row gets posted, but only the ones the user acted on are marked
      // as their choice. handleMatchUpdate sets 'manual' when they pick, link
      // or create; rows left as the matcher found them stay 'matched'.
      confirmed: m.matchStatus === 'manual',
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
    if (unmatched.length === 0) return;

    // One request for the whole set. Creating them one at a time meant each
    // row was resolved against a catalog snapshot taken before the previous
    // row created anything, so "olive oil" and "extra virgin olive oil" in the
    // same recipe became two items.
    const { results, warnings } = await recipesApi.createItemsForIngredients(
      unmatched.map(m => ({ name: m.parsedName, unit: m.parsedUnit }))
    );

    for (const result of results) {
      handleMatchUpdate(result.originalName, result.itemId, result.itemName);
    }
    if (warnings.length > 0) setParseWarnings(prev => [...prev, ...warnings]);

    queryClient.invalidateQueries({ queryKey: ['inventory'] });
    queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
    queryClient.invalidateQueries({ queryKey: ['ingredient-suggestions'] });
  }, [ingredientMatches, handleMatchUpdate, queryClient]);

  const handleSkipAllUnmatched = useCallback(() => {
    // Nothing to do - unmatched items will be imported without inventory links
  }, []);

  // Calculate step progress
  // Step definitions per mode. Tier 1 (basic) users don't track an
  // inventory catalog, so they skip the linking step entirely — recipes
  // save with ingredients as free text.
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
        { key: 'confirm', label: 'Save' },
      ];

  const currentStepIndex = steps.findIndex(s => s.key === step);
  const nextStepLabel = currentStepIndex < steps.length - 1 ? steps[currentStepIndex + 1]?.label : null;

  const isPreviewing = previewUrlMutation.isPending || previewTextMutation.isPending;
  const hasPreview = !!previewRecipe;
  const currentConfidence = parseConfidence ?? (session?.parseConfidence ? parseFloat(session.parseConfidence) : undefined);
  const currentWarnings = parseWarnings.length > 0 ? parseWarnings : (session?.parseWarnings ?? []);
  const currentParseMethod = parseMethod ?? session?.parseMethod;

  if (batchMode) {
    return (
      <>
      {confirmDialog}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) requestClose();
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Import Recipes</DialogTitle>
          </DialogHeader>
          <BulkImportRecipeDialog
            embedded
            open={open}
            onOpenChange={(o) => { if (!o) handleClose(); }}
            initialFiles={batchInitialFiles}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['recipes'] });
            }}
          />
        </DialogContent>
      </Dialog>
      </>
    );
  }

  return (
    <>
    {confirmDialog}
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) requestClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
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
                setImageRawText(null);
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
                          {getErrorMessage(previewUrlMutation.error)}
                        </AlertDescription>
                      </Alert>
                    )}

                    {hasPreview && sourceType === 'url' && (
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="font-medium">{previewRecipe?.title}</h4>
                            {(() => {
                              const status = getParseStatus(currentParseMethod, currentConfidence);
                              if (!status) return null;
                              return (
                                <Badge variant={status.variant} className="text-xs" title={status.detail}>
                                  {status.label}
                                </Badge>
                              );
                            })()}
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
                        <LoadingSpinner className="h-12 w-12 mx-auto text-primary" />
                        <p className="text-sm font-medium">Processing image...</p>
                        <p className="text-xs text-muted-foreground">
                          Extracting text from image. This may take up to a minute.
                        </p>
                      </div>
                    ) : imageRawText !== null ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>Extracted text — review and fix any errors</Label>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setImageRawText(null);
                              setParseWarnings([]);
                            }}
                          >
                            <X className="mr-1 h-3 w-3" />
                            Clear
                          </Button>
                        </div>
                        <Textarea
                          value={imageRawText}
                          onChange={(e) => setImageRawText(e.target.value)}
                          rows={14}
                          className="font-mono text-sm"
                          placeholder="No text was extracted from the image."
                        />
                        <p className="text-xs text-muted-foreground">
                          Fix any OCR errors above, then click Parse & Review. The text will be parsed into a structured recipe.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label>Upload one or more recipe photos</Label>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          onClick={() => setImagePickerOpen(true)}
                        >
                          <Camera className="mr-2 h-4 w-4" />
                          Choose photos
                        </Button>
                        <FileSourcePicker
                          open={imagePickerOpen}
                          onOpenChange={setImagePickerOpen}
                          onSelect={(files) => {
                            if (files.length === 0) return;
                            if (files.length > 1) {
                              enterBatchMode(files);
                              return;
                            }
                            handleImageUpload(files[0]);
                          }}
                          accept="image/jpeg,image/png,image/gif,image/webp,image/heic"
                          multiple
                          title="Add recipe photos"
                          description="Pick one photo for a single recipe, or several to import them all."
                        />
                        <p className="text-xs text-muted-foreground">
                          Pick one photo for a single recipe, or several to process them all at once. Supports JPG, PNG, GIF, WebP, HEIC (max 10MB each).
                        </p>
                      </div>
                    )}

                    {imageError && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{imageError}</AlertDescription>
                      </Alert>
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
                        multiple
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
                            <div className="text-sm text-success">
                              {Object.keys(importedCatalogItems).length} ingredients have catalog data for easy linking
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="pdf" className="mt-4">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Upload a recipe PDF</Label>
                      <Input
                        type="file"
                        accept=".pdf,application/pdf"
                        onChange={handlePdfUpload}
                      />
                      <p className="text-xs text-muted-foreground">
                        We extract the text on the server and parse it the same way as a pasted recipe. Max 10 MB.
                      </p>
                    </div>

                    {pdfFileName && !pdfError && (
                      <Alert>
                        <Check className="h-4 w-4" />
                        <AlertDescription>
                          Ready to parse: <span className="font-medium">{pdfFileName}</span>
                        </AlertDescription>
                      </Alert>
                    )}

                    {pdfError && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{pdfError}</AlertDescription>
                      </Alert>
                    )}
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
                    sourceType === 'image' ? !imageRawText :
                    sourceType === 'url' ? !sourceUrl :
                    sourceType === 'pdf' ? !pdfBase64 :
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
                  <LoadingSpinner size="lg" />
                </div>
              ) : session?.parsedRecipe ? (() => {
                const recipe = session.parsedRecipe!;
                return (
                <>
                  {/* Status + warnings banner */}
                  {(currentConfidence !== undefined || currentWarnings.length > 0) && (
                    <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex items-center gap-2">
                        {(() => {
                          const status = getParseStatus(currentParseMethod, currentConfidence);
                          if (!status) return null;
                          return (
                            <Badge variant={status.variant} title={status.detail}>
                              {status.label}
                            </Badge>
                          );
                        })()}
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
                        value={overrides.title ?? recipe.title}
                        onChange={(e) => setOverrides(prev => ({ ...prev, title: e.target.value }))}
                      />
                    </div>

                    <div>
                      <Label>Description</Label>
                      <Textarea
                        value={overrides.description ?? recipe.description ?? ''}
                        onChange={(e) => setOverrides(prev => ({ ...prev, description: e.target.value }))}
                        rows={2}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <Label>Prep Time (min)</Label>
                        <Input
                          type="number"
                          value={overrides.prepTimeMinutes ?? recipe.prepTimeMinutes ?? ''}
                          onChange={(e) => setOverrides(prev => ({ ...prev, prepTimeMinutes: parseInt(e.target.value) || undefined }))}
                        />
                      </div>
                      <div>
                        <Label>Cook Time (min)</Label>
                        <Input
                          type="number"
                          value={overrides.cookTimeMinutes ?? recipe.cookTimeMinutes ?? ''}
                          onChange={(e) => setOverrides(prev => ({ ...prev, cookTimeMinutes: parseInt(e.target.value) || undefined }))}
                        />
                      </div>
                      <div>
                        <Label>Servings</Label>
                        <Input
                          type="number"
                          value={overrides.servings ?? recipe.servings ?? ''}
                          onChange={(e) => setOverrides(prev => ({ ...prev, servings: parseInt(e.target.value) || undefined }))}
                        />
                      </div>
                    </div>

                    {recipe.author && (
                      <div className="text-sm text-muted-foreground">
                        By {recipe.author}
                      </div>
                    )}

                    <div>
                      <div className="flex items-center justify-between">
                        <Label>Ingredients ({overrides.ingredients ? overrides.ingredients.length : recipe.ingredients.length})</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const current = overrides.ingredients;
                            const ingredients = current || recipe.ingredients;
                            setOverrides(prev => ({
                              ...prev,
                              ingredients: [...ingredients, { name: '', quantity: undefined, unit: undefined, notes: undefined }],
                            }))
;
                          }}
                        >
                          + Add
                        </Button>
                      </div>
                      <Card className="mt-2">
                        <CardContent className="p-3 max-h-48 overflow-y-auto space-y-2">
                          {(overrides.ingredients || recipe.ingredients).map((ing, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              <Input
                                className="w-16 h-8 text-xs px-2"
                                placeholder="Qty"
                                value={ing.quantity ?? ''}
                                onChange={(e) => {
                                  const current = (overrides.ingredients) || [...recipe.ingredients];
                                  const updated = [...current];
                                  updated[i] = { ...updated[i], quantity: e.target.value ? parseFloat(e.target.value) : undefined };
                                  setOverrides(prev => ({ ...prev, ingredients: updated }))
;
                                }}
                              />
                              <Input
                                className="w-16 h-8 text-xs px-2"
                                placeholder="Unit"
                                value={ing.unit ?? ''}
                                onChange={(e) => {
                                  const current = (overrides.ingredients) || [...recipe.ingredients];
                                  const updated = [...current];
                                  updated[i] = { ...updated[i], unit: e.target.value || undefined };
                                  setOverrides(prev => ({ ...prev, ingredients: updated }))
;
                                }}
                              />
                              <Input
                                className="flex-1 h-8 text-xs px-2"
                                placeholder="Ingredient name"
                                value={ing.name}
                                onChange={(e) => {
                                  const current = (overrides.ingredients) || [...recipe.ingredients];
                                  const updated = [...current];
                                  updated[i] = { ...updated[i], name: e.target.value };
                                  setOverrides(prev => ({ ...prev, ingredients: updated }))
;
                                }}
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 shrink-0 text-destructive hover:text-destructive"
                                onClick={() => {
                                  const current = (overrides.ingredients) || [...recipe.ingredients];
                                  const updated = current.filter((_, idx) => idx !== i);
                                  setOverrides(prev => ({ ...prev, ingredients: updated }))
;
                                }}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <Label>Instructions ({overrides.instructions ? overrides.instructions.length : recipe.instructions.length} steps)</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const current = overrides.instructions;
                            const instructions = current || recipe.instructions;
                            setOverrides(prev => ({
                              ...prev,
                              instructions: [...instructions, ''],
                            }))
;
                          }}
                        >
                          + Add Step
                        </Button>
                      </div>
                      <Card className="mt-2">
                        <CardContent className="p-3 max-h-48 overflow-y-auto space-y-2">
                          {(overrides.instructions || recipe.instructions).map((inst, i) => (
                            <div key={i} className="flex items-start gap-1.5">
                              <span className="shrink-0 text-xs text-muted-foreground mt-2.5 w-5 text-right">{i + 1}.</span>
                              <Textarea
                                className="flex-1 text-xs min-h-[2rem]"
                                rows={1}
                                value={inst}
                                onChange={(e) => {
                                  const current = (overrides.instructions) || [...recipe.instructions];
                                  const updated = [...current];
                                  updated[i] = e.target.value;
                                  setOverrides(prev => ({ ...prev, instructions: updated }))
;
                                }}
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 shrink-0 text-destructive hover:text-destructive"
                                onClick={() => {
                                  const current = (overrides.instructions) || [...recipe.instructions];
                                  const updated = current.filter((_, idx) => idx !== i);
                                  setOverrides(prev => ({ ...prev, instructions: updated }))
;
                                }}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
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
                      <Button onClick={() => {
                        // Tier 1 (basic): no catalog linking — ingredients
                        // save as text. Skip straight to the confirm step.
                                            setStep('confirm');
                      }}>
                        {nextStepLabel ? `Continue to ${nextStepLabel}` : 'Continue'}
                        <ChevronRight className="ml-2 h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </>
                );
              })() : (
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

          {step === 'confirm' && (
            <div className="space-y-4 py-4">
              <div className="text-center py-6">
                <Check className="h-16 w-16 mx-auto text-success" />
                <h3 className="mt-4 text-lg font-medium">Ready to Import</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {session?.parsedRecipe?.title ?? overrides.title}
                </p>
                <div className="text-xs text-muted-foreground mt-3 space-y-1">
                  <p>{ingredientMatches.length} ingredients total</p>
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(isAdvanced ? 'ingredients' : 'review')}>
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
    </>
  );
}
