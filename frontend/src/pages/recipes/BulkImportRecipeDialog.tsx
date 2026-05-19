import { useState, useCallback, useEffect, useRef } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import {
  Camera, Link, FileText, FileUp, Upload, Loader2, AlertCircle, Check, X,
  ChevronRight, ChevronLeft, ChevronDown, RotateCw,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { recipesApi, type ImportSession, type IngredientMatch, type ParsedRecipe } from '@/api/recipes';
import { inventoryApi } from '@/api/inventory';
import { deduplicateIngredientMatches, normalizeIngredientName } from '@/lib/recipe-utils';
import { useBatchImageProcessing, type BatchItem } from '@/hooks/useBatchImageProcessing';
import { BulkIngredientActions } from './BulkIngredientActions';
import { IngredientMatchRow } from './IngredientMatchRow';

type BulkMode = 'image' | 'url' | 'text' | 'file';
type BulkStep = 'mode' | 'input' | 'processing' | 'ocr-review' | 'recipe-review' | 'catalog' | 'confirm';

// Per-recipe batch item. The image/upload/polling lifecycle is owned by
// useBatchImageProcessing; this dialog adds `importSessionId` once each item
// reaches the import-session stage.
type BulkItem = BatchItem;

interface BulkImportRecipeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  /**
   * Files pre-selected by the parent (typically because the user picked
   * multiple files in the single-recipe Import dialog and we routed them
   * here). When provided, the dialog skips the mode-picker / input step
   * and goes straight to image (or .recipe file) processing.
   */
  initialFiles?: File[];
  /**
   * Render without the outer <Dialog> wrapper — useful when this flow is
   * embedded inside another dialog (e.g., the unified ImportRecipeDialog
   * mounts this body when the user uploads multiple files).
   */
  embedded?: boolean;
}

export function BulkImportRecipeDialog({ open, onOpenChange, onSuccess, initialFiles, embedded = false }: BulkImportRecipeDialogProps) {
  const [mode, setMode] = useState<BulkMode | null>(null);
  const [step, setStep] = useState<BulkStep>('mode');
  const {
    items,
    setItems,
    addImageFiles: addImageBatchFiles,
    addRecipeFiles: addRecipeBatchFiles,
    startImageProcessing: runImageProcessing,
    reset: resetBatchItems,
  } = useBatchImageProcessing();
  const [importSessions, setImportSessions] = useState<Map<string, ImportSession>>(new Map());
  const [overridesMap, setOverridesMap] = useState<Map<string, Record<string, unknown>>>(new Map());
  const [ingredientMatches, setIngredientMatches] = useState<Map<string, IngredientMatch[]>>(new Map());
  const [activeRecipeIndex, setActiveRecipeIndex] = useState(0);
  const [urlText, setUrlText] = useState('');
  const [textEntries, setTextEntries] = useState<string[]>(['']);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const activeItems = items.filter(i => !i.excluded);
  const readyItems = activeItems.filter(i => i.status === 'ready');

  // Step definitions
  const steps: { key: BulkStep; label: string }[] = mode === 'image' || mode === 'text'
    ? [
        { key: 'input', label: 'Add' },
        { key: 'processing', label: 'Process' },
        { key: 'ocr-review', label: 'Text' },
        { key: 'recipe-review', label: 'Review' },
        { key: 'catalog', label: 'Catalog' },
        { key: 'confirm', label: 'Save' },
      ]
    : [
        { key: 'input', label: 'Add' },
        { key: 'processing', label: 'Process' },
        { key: 'recipe-review', label: 'Review' },
        { key: 'catalog', label: 'Catalog' },
        { key: 'confirm', label: 'Save' },
      ];

  const currentStepIndex = steps.findIndex(s => s.key === step);

  // ========== HANDLERS ==========

  const handleClose = useCallback(() => {
    resetBatchItems();
    setMode(null);
    setStep('mode');
    setImportSessions(new Map());
    setOverridesMap(new Map());
    setIngredientMatches(new Map());
    setActiveRecipeIndex(0);
    setUrlText('');
    setTextEntries(['']);
    onOpenChange(false);
  }, [onOpenChange, resetBatchItems]);

  const handleImageFiles = useCallback((files: FileList | null) => {
    addImageBatchFiles(files);
  }, [addImageBatchFiles]);

  const handleRecipeFiles = useCallback((files: FileList | null) => {
    addRecipeBatchFiles(files);
  }, [addRecipeBatchFiles]);

  // Switch to the processing step and let the hook own the upload+polling lifecycle.
  const startImageProcessing = useCallback(async () => {
    setStep('processing');
    await runImageProcessing();
  }, [runImageProcessing]);

  // Process URLs
  const startUrlProcessing = useCallback(async () => {
    setStep('processing');
    const urls = urlText.split('\n').map(u => u.trim()).filter(u => u.length > 0);

    for (let i = 0; i < urls.length; i++) {
      const item = items[i];
      if (!item) continue;
      setItems(prev => prev.map(it => it.id === item.id ? { ...it, status: 'processing' } : it));
      try {
        const result = await recipesApi.parseUrl(urls[i]);
        // URL results go directly to structured — store as .recipe format
        const fileData = { version: '1.0', type: 'recipe', recipe: result.parsedRecipe };
        setItems(prev => prev.map(it => it.id === item.id ? { ...it, status: 'ready', ocrText: JSON.stringify(fileData) } : it));
      } catch (e) {
        setItems(prev => prev.map(it => it.id === item.id ? { ...it, status: 'failed', error: (e as Error).message } : it));
      }
    }
  }, [urlText, items]);

  // CRF parse all texts
  const parseAllMutation = useMutation({
    mutationFn: async () => {
      const entries = readyItems.map(item => ({
        sourceType: 'text' as const,
        sourceData: item.ocrText || '',
        rawText: item.ocrText || '',
      }));
      return recipesApi.startBatchImport(entries);
    },
    onSuccess: async (data) => {
      // Map session IDs back to items
      const readyIds = readyItems.map(i => i.id);
      setItems(prev => prev.map(item => {
        const idx = readyIds.indexOf(item.id);
        if (idx >= 0 && data.sessionIds[idx]) {
          return { ...item, importSessionId: data.sessionIds[idx] };
        }
        return item;
      }));

      // Fetch all sessions
      const sessions = new Map<string, ImportSession>();
      const matches = new Map<string, IngredientMatch[]>();
      for (const sessionId of data.sessionIds) {
        const result = await recipesApi.getImportSession(sessionId);
        sessions.set(sessionId, result.session);
        if (result.session.ingredientMatches) {
          matches.set(sessionId, result.session.ingredientMatches);
        }
      }
      setImportSessions(sessions);
      setIngredientMatches(matches);
      setStep('recipe-review');
    },
  });

  // Confirm all
  const confirmMutation = useMutation({
    mutationFn: async () => {
      const sessions = readyItems
        .filter(i => i.importSessionId && !i.excluded)
        .map(item => ({
          sessionId: item.importSessionId!,
          overrides: overridesMap.get(item.importSessionId!) as Record<string, unknown> | undefined,
        }));
      return recipesApi.confirmBatchImport(sessions);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      onSuccess?.();
      handleClose();
    },
  });

  // Create new inventory item
  const handleCreateNewItem = useCallback(async (name: string, unit?: string, category?: string, areaId?: string) => {
    const result = await inventoryApi.quickCreateItem({ name, defaultUnit: unit, category, defaultAreaId: areaId });
    return { itemId: result.item.id, itemName: result.item.name };
  }, []);

  // Rematch all after creating items
  const rematchMutation = useMutation({
    mutationFn: async () => {
      const sessionIds = readyItems.map(i => i.importSessionId!).filter(Boolean);
      return recipesApi.rematchBatchIngredients(sessionIds);
    },
    onSuccess: (data) => {
      const newMatches = new Map(ingredientMatches);
      for (const [sessionId, matches] of Object.entries(data.results)) {
        newMatches.set(sessionId, matches as IngredientMatch[]);
      }
      setIngredientMatches(newMatches);
    },
  });

  // ========== DERIVED STATE ==========

  // Dedupe ingredient matches *across* the entire batch by normalized name,
  // so the reviewer only links "olive oil" once even if it appears in 8 recipes.
  // Compare with ImportRecipeDialog.handleProceedToIngredients (~line 455)
  // which has no dedup — single-recipe flow only ever has one session.
  const deduplicatedIngredients = deduplicateIngredientMatches(ingredientMatches);

  const allIngredientMatches: IngredientMatch[] = Array.from(deduplicatedIngredients.values()).map(g => g.matches[0]);

  // Handle ingredient match update — apply to all sessions that use this ingredient
  const handleMatchUpdate = useCallback((parsedName: string, matchedItemId?: string, matchedItemName?: string, unit?: string) => {
    const key = normalizeIngredientName(parsedName);
    const group = deduplicatedIngredients.get(key);
    if (!group) return;

    setIngredientMatches(prev => {
      const next = new Map(prev);
      for (const sessionId of group.sessionIds) {
        const sessionMatches = next.get(sessionId);
        if (sessionMatches) {
          next.set(sessionId, sessionMatches.map(m =>
            normalizeIngredientName(m.parsedName) === key
              ? { ...m, matchedItemId, matchedItemName, matchStatus: matchedItemId ? 'manual' as const : 'unmatched' as const, modifiedUnit: unit }
              : m
          ));
        }
      }
      return next;
    });
  }, [deduplicatedIngredients]);

  // Auto-accept high confidence
  const handleAutoAccept = useCallback(() => {
    setIngredientMatches(prev => {
      const next = new Map(prev);
      for (const [sessionId, matches] of next) {
        next.set(sessionId, matches.map(m => {
          if (m.matchedItemId) return m;
          if (m.suggestions && m.suggestions.length > 0 && m.suggestions[0].confidence >= 0.9) {
            return { ...m, matchedItemId: m.suggestions[0].itemId, matchedItemName: m.suggestions[0].name, matchStatus: 'manual' as const };
          }
          return m;
        }));
      }
      return next;
    });
  }, []);

  // Create all unmatched
  const handleCreateAllUnmatched = useCallback(async () => {
    const unmatched = allIngredientMatches.filter(m => !m.matchedItemId);
    for (const match of unmatched) {
      try {
        const result = await handleCreateNewItem(match.parsedName, match.parsedUnit);
        handleMatchUpdate(match.parsedName, result.itemId, result.itemName);
      } catch {
        // Continue
      }
    }
    rematchMutation.mutate();
  }, [allIngredientMatches, handleCreateNewItem, handleMatchUpdate, rematchMutation]);

  // ========== START PROCESSING ==========

  const handleStartProcessing = useCallback(() => {
    if (mode === 'image') {
      startImageProcessing();
    } else if (mode === 'url') {
      startUrlProcessing();
    } else if (mode === 'text') {
      // Text items are already "ready" — go to OCR review
      setItems(prev => prev.map(i => ({ ...i, status: 'ready' as const })));
      setStep('ocr-review');
    } else if (mode === 'file') {
      // Files are already parsed client-side — go directly to CRF parse
      setStep('processing');
      parseAllMutation.mutate();
    }
  }, [mode, startImageProcessing, startUrlProcessing, parseAllMutation]);

  // When the parent opens us with pre-selected files (multi-file upload was
  // detected inside the single-recipe dialog), skip the mode picker and
  // start processing immediately. Image files → image mode; .recipe JSON
  // files → file mode.
  useEffect(() => {
    if (!open || !initialFiles?.length) return;
    if (items.length > 0) return; // Don't double-load if user reopens
    const firstFile = initialFiles[0];
    const isImage = firstFile.type.startsWith('image/');
    if (isImage) {
      const dt = new DataTransfer();
      initialFiles.forEach((f) => dt.items.add(f));
      setMode('image');
      setStep('input');
      handleImageFiles(dt.files);
    } else {
      const dt = new DataTransfer();
      initialFiles.forEach((f) => dt.items.add(f));
      setMode('file');
      setStep('input');
      handleRecipeFiles(dt.files);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFiles]);

  // Prepare items from URL input
  const prepareUrlItems = useCallback(() => {
    const urls = urlText.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    setItems(urls.map((url, i) => ({
      id: `url-${Date.now()}-${i}`,
      label: url.length > 50 ? url.slice(0, 47) + '...' : url,
      status: 'pending' as const,
    })));
  }, [urlText]);

  // Prepare items from text entries
  const prepareTextItems = useCallback(() => {
    const entries = textEntries.filter(t => t.trim().length > 0);
    setItems(entries.map((text, i) => ({
      id: `text-${Date.now()}-${i}`,
      label: text.split('\n')[0]?.slice(0, 40) || `Recipe ${i + 1}`,
      status: 'pending' as const,
      ocrText: text,
    })));
  }, [textEntries]);

  // Get the currently viewed recipe in review step
  const activeImportSession = (() => {
    const item = readyItems[activeRecipeIndex];
    if (!item?.importSessionId) return null;
    return importSessions.get(item.importSessionId) || null;
  })();

  const activeOverrides = (() => {
    const item = readyItems[activeRecipeIndex];
    if (!item?.importSessionId) return {};
    return (overridesMap.get(item.importSessionId) || {}) as Record<string, unknown>;
  })();

  const setActiveOverrides = useCallback((updates: Record<string, unknown>) => {
    const item = readyItems[activeRecipeIndex];
    if (!item?.importSessionId) return;
    setOverridesMap(prev => {
      const next = new Map(prev);
      next.set(item.importSessionId!, { ...next.get(item.importSessionId!) || {}, ...updates });
      return next;
    });
  }, [readyItems, activeRecipeIndex]);

  // ========== RENDER ==========

  const processingComplete = items.length > 0 && items.every(i => i.status === 'ready' || i.status === 'failed' || i.excluded);
  const readyCount = items.filter(i => i.status === 'ready' && !i.excluded).length;
  const failedCount = items.filter(i => i.status === 'failed').length;
  const processingCount = items.filter(i => i.status === 'processing' || i.status === 'uploading').length;

  const body = (
    <>
        {!embedded && (
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Bulk Import Recipes</DialogTitle>
          </DialogHeader>
        )}

        {/* Step indicator */}
        {step !== 'mode' && (
          <div className="flex items-center gap-1 flex-shrink-0 px-1">
            {steps.map((s, i) => (
              <div key={s.key} className="flex flex-col items-center flex-1">
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
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto pr-1 min-h-0">
          {/* MODE PICKER */}
          {step === 'mode' && (
            <div className="grid grid-cols-2 gap-3 py-4">
              {([
                { mode: 'image' as BulkMode, icon: Camera, label: 'Scan Images', desc: 'Upload photos of recipes' },
                { mode: 'url' as BulkMode, icon: Link, label: 'From URLs', desc: 'Paste recipe URLs, one per line' },
                { mode: 'text' as BulkMode, icon: FileText, label: 'Paste Recipes', desc: 'Paste recipe text directly' },
                { mode: 'file' as BulkMode, icon: FileUp, label: 'Upload Files', desc: 'Upload .recipe files' },
              ]).map(opt => (
                <Card
                  key={opt.mode}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => { setMode(opt.mode); setStep('input'); }}
                >
                  <CardContent className="p-6 text-center space-y-2">
                    <opt.icon className="h-8 w-8 mx-auto text-muted-foreground" />
                    <p className="font-medium">{opt.label}</p>
                    <p className="text-xs text-muted-foreground">{opt.desc}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* INPUT STEP */}
          {step === 'input' && (
            <div className="space-y-4 py-4">
              {mode === 'image' && (
                <>
                  <div className="space-y-2">
                    <Label>Select recipe images</Label>
                    <Input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/gif,image/webp,image/heic"
                      onChange={(e) => handleImageFiles(e.target.files)}
                    />
                  </div>
                  {items.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">{items.length} file{items.length !== 1 ? 's' : ''} selected</p>
                      {items.map(item => (
                        <div key={item.id} className="flex items-center justify-between text-sm px-2 py-1 rounded bg-muted/30">
                          <span className="truncate">{item.label}</span>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setItems(prev => prev.filter(i => i.id !== item.id))}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {mode === 'url' && (
                <div className="space-y-2">
                  <Label>Paste recipe URLs (one per line)</Label>
                  <Textarea
                    value={urlText}
                    onChange={(e) => setUrlText(e.target.value)}
                    rows={8}
                    placeholder={"https://example.com/recipe-1\nhttps://example.com/recipe-2\nhttps://example.com/recipe-3"}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    {urlText.split('\n').filter(u => u.trim().length > 0).length} URLs entered
                  </p>
                </div>
              )}

              {mode === 'text' && (
                <div className="space-y-3">
                  <Label>Paste recipe text</Label>
                  {textEntries.map((text, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Recipe {i + 1}</span>
                        {textEntries.length > 1 && (
                          <Button variant="ghost" size="sm" className="h-6" onClick={() => setTextEntries(prev => prev.filter((_, j) => j !== i))}>
                            <X className="h-3 w-3 mr-1" /> Remove
                          </Button>
                        )}
                      </div>
                      <Textarea
                        value={text}
                        onChange={(e) => setTextEntries(prev => prev.map((t, j) => j === i ? e.target.value : t))}
                        rows={6}
                        placeholder="Paste recipe including ingredients and instructions..."
                        className="font-mono text-sm"
                      />
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => setTextEntries(prev => [...prev, ''])}>
                    + Add Another Recipe
                  </Button>
                </div>
              )}

              {mode === 'file' && (
                <div className="space-y-2">
                  <Label>Select .recipe files</Label>
                  <Input
                    type="file"
                    multiple
                    accept=".recipe"
                    onChange={(e) => handleRecipeFiles(e.target.files)}
                  />
                  {items.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">{items.length} file{items.length !== 1 ? 's' : ''} loaded</p>
                      {items.map(item => (
                        <div key={item.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded bg-muted/30">
                          <Check className="h-3 w-3 text-green-500" />
                          <span className="truncate">{item.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => { setStep('mode'); setMode(null); setItems([]); }}>
                  <ChevronLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button
                  onClick={() => {
                    if (mode === 'url') prepareUrlItems();
                    if (mode === 'text') prepareTextItems();
                    handleStartProcessing();
                  }}
                  disabled={
                    (mode === 'image' && items.length === 0) ||
                    (mode === 'url' && urlText.split('\n').filter(u => u.trim()).length === 0) ||
                    (mode === 'text' && textEntries.every(t => !t.trim())) ||
                    (mode === 'file' && items.length === 0)
                  }
                >
                  Start Processing
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* PROCESSING STEP */}
          {step === 'processing' && (
            <div className="space-y-4 py-4">
              <div className="text-center space-y-2">
                {!processingComplete && <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" />}
                {processingComplete && <Check className="h-8 w-8 mx-auto text-green-500" />}
                <p className="font-medium">
                  {processingComplete
                    ? `Done — ${readyCount} recipe${readyCount !== 1 ? 's' : ''} ready`
                    : `Processing ${readyCount + failedCount} of ${items.filter(i => !i.excluded).length}...`}
                </p>
                {!processingComplete && (
                  <Progress value={((readyCount + failedCount) / Math.max(activeItems.length, 1)) * 100} className="max-w-xs mx-auto" />
                )}
              </div>

              <div className="space-y-1">
                {items.filter(i => !i.excluded).map(item => (
                  <div key={item.id} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded bg-muted/30">
                    {item.status === 'pending' && <div className="h-3 w-3 rounded-full bg-muted-foreground/30" />}
                    {(item.status === 'uploading' || item.status === 'processing') && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                    {item.status === 'ready' && <Check className="h-3 w-3 text-green-500" />}
                    {item.status === 'failed' && <X className="h-3 w-3 text-destructive" />}
                    <span className="truncate flex-1">{item.label}</span>
                    {item.error && <span className="text-xs text-destructive truncate">{item.error}</span>}
                  </div>
                ))}
              </div>

              {processingComplete && (
                <div className="flex justify-end pt-2">
                  <Button
                    onClick={() => {
                      if ((mode === 'image' || mode === 'text') && readyCount > 0) {
                        setStep('ocr-review');
                      } else if (readyCount > 0) {
                        // URLs and files are already structured — go to CRF parse
                        parseAllMutation.mutate();
                      }
                    }}
                    disabled={readyCount === 0}
                  >
                    Continue ({readyCount} recipe{readyCount !== 1 ? 's' : ''})
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* OCR REVIEW STEP */}
          {step === 'ocr-review' && (
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground">
                Review and fix any errors in the extracted text for each recipe. Then click Parse All.
              </p>

              {readyItems.map((item, i) => (
                <Collapsible key={item.id} defaultOpen={i === 0}>
                  <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted/50">
                    <span>{item.label}</span>
                    <ChevronDown className="h-4 w-4" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2">
                    <Textarea
                      value={item.ocrText || ''}
                      onChange={(e) => setItems(prev => prev.map(it => it.id === item.id ? { ...it, ocrText: e.target.value } : it))}
                      rows={12}
                      className="font-mono text-sm"
                    />
                  </CollapsibleContent>
                </Collapsible>
              ))}

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setStep('processing')}>
                  <ChevronLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button onClick={() => parseAllMutation.mutate()} disabled={parseAllMutation.isPending}>
                  {parseAllMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Parse All ({readyCount})
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* RECIPE REVIEW STEP */}
          {step === 'recipe-review' && activeImportSession?.parsedRecipe && (() => {
            const recipe = activeImportSession.parsedRecipe!;
            const ov = activeOverrides;
            return (
              <div className="space-y-4 py-4">
                {/* Recipe tabs */}
                <div className="flex gap-1 overflow-x-auto pb-1">
                  {readyItems.map((item, i) => (
                    <Button
                      key={item.id}
                      variant={i === activeRecipeIndex ? 'default' : 'outline'}
                      size="sm"
                      className="shrink-0 text-xs"
                      onClick={() => setActiveRecipeIndex(i)}
                    >
                      {i + 1}. {(importSessions.get(item.importSessionId!)?.parsedRecipe?.title || item.label).slice(0, 20)}
                    </Button>
                  ))}
                </div>

                <p className="text-xs text-muted-foreground">Recipe {activeRecipeIndex + 1} of {readyItems.length}</p>

                {/* Editable fields */}
                <div className="space-y-3">
                  <div>
                    <Label>Title</Label>
                    <Input
                      value={(ov.title as string) ?? recipe.title}
                      onChange={(e) => setActiveOverrides({ title: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea
                      value={(ov.description as string) ?? recipe.description ?? ''}
                      onChange={(e) => setActiveOverrides({ description: e.target.value })}
                      rows={2}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label>Prep (min)</Label>
                      <Input type="number" value={(ov.prepTimeMinutes as number) ?? recipe.prepTimeMinutes ?? ''} onChange={(e) => setActiveOverrides({ prepTimeMinutes: parseInt(e.target.value) || undefined })} />
                    </div>
                    <div>
                      <Label>Cook (min)</Label>
                      <Input type="number" value={(ov.cookTimeMinutes as number) ?? recipe.cookTimeMinutes ?? ''} onChange={(e) => setActiveOverrides({ cookTimeMinutes: parseInt(e.target.value) || undefined })} />
                    </div>
                    <div>
                      <Label>Servings</Label>
                      <Input type="number" value={(ov.servings as number) ?? recipe.servings ?? ''} onChange={(e) => setActiveOverrides({ servings: parseInt(e.target.value) || undefined })} />
                    </div>
                  </div>

                  {/* Ingredients */}
                  <div>
                    <Label>Ingredients ({((ov.ingredients as unknown[]) || recipe.ingredients).length})</Label>
                    <Card className="mt-1">
                      <CardContent className="p-2 max-h-40 overflow-y-auto space-y-1">
                        {((ov.ingredients as typeof recipe.ingredients) || recipe.ingredients).map((ing, i) => (
                          <div key={i} className="flex items-center gap-1">
                            <Input className="w-14 h-7 text-xs px-1" placeholder="Qty" value={ing.quantity ?? ''} onChange={(e) => {
                              const current = (ov.ingredients as typeof recipe.ingredients) || [...recipe.ingredients];
                              const updated = [...current];
                              updated[i] = { ...updated[i], quantity: e.target.value ? parseFloat(e.target.value) : undefined };
                              setActiveOverrides({ ingredients: updated });
                            }} />
                            <Input className="w-14 h-7 text-xs px-1" placeholder="Unit" value={ing.unit ?? ''} onChange={(e) => {
                              const current = (ov.ingredients as typeof recipe.ingredients) || [...recipe.ingredients];
                              const updated = [...current];
                              updated[i] = { ...updated[i], unit: e.target.value || undefined };
                              setActiveOverrides({ ingredients: updated });
                            }} />
                            <Input className="flex-1 h-7 text-xs px-1" value={ing.name} onChange={(e) => {
                              const current = (ov.ingredients as typeof recipe.ingredients) || [...recipe.ingredients];
                              const updated = [...current];
                              updated[i] = { ...updated[i], name: e.target.value };
                              setActiveOverrides({ ingredients: updated });
                            }} />
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => {
                              const current = (ov.ingredients as typeof recipe.ingredients) || [...recipe.ingredients];
                              setActiveOverrides({ ingredients: current.filter((_, j) => j !== i) });
                            }}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Instructions */}
                  <div>
                    <Label>Instructions ({((ov.instructions as string[]) || recipe.instructions).length} steps)</Label>
                    <Card className="mt-1">
                      <CardContent className="p-2 max-h-40 overflow-y-auto space-y-1">
                        {((ov.instructions as string[]) || recipe.instructions).map((inst, i) => (
                          <div key={i} className="flex items-start gap-1">
                            <span className="text-xs text-muted-foreground mt-1.5 w-4 text-right shrink-0">{i + 1}.</span>
                            <Textarea className="flex-1 text-xs min-h-[1.75rem]" rows={1} value={inst} onChange={(e) => {
                              const current = (ov.instructions as string[]) || [...recipe.instructions];
                              const updated = [...current];
                              updated[i] = e.target.value;
                              setActiveOverrides({ instructions: updated });
                            }} />
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive shrink-0" onClick={() => {
                              const current = (ov.instructions as string[]) || [...recipe.instructions];
                              setActiveOverrides({ instructions: current.filter((_, j) => j !== i) });
                            }}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </div>
                </div>

                <div className="flex justify-between pt-2">
                  <Button variant="outline" onClick={() => setStep(mode === 'image' || mode === 'text' ? 'ocr-review' : 'processing')}>
                    <ChevronLeft className="mr-2 h-4 w-4" /> Back
                  </Button>
                  <Button onClick={() => setStep('catalog')}>
                    Continue to Catalog
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })()}

          {/* CATALOG STEP */}
          {step === 'catalog' && (
            <div className="space-y-4 py-4">
              <div>
                <h3 className="font-medium">Link Ingredients to Catalog</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {allIngredientMatches.length} unique ingredients across {readyCount} recipes.
                  Match once — applies to all recipes using that ingredient.
                </p>
              </div>

              <BulkIngredientActions
                matches={allIngredientMatches}
                onAutoAccept={handleAutoAccept}
                onCreateAll={handleCreateAllUnmatched}
                onSkipAll={() => {}}
                isCreating={rematchMutation.isPending}
              />

              <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                {allIngredientMatches.map((match, i) => {
                  const group = deduplicatedIngredients.get(normalizeIngredientName(match.parsedName));
                  return (
                    <div key={i}>
                      <IngredientMatchRow
                        match={match}
                        onUpdate={handleMatchUpdate}
                        onCreateNew={handleCreateNewItem}
                      />
                      {group && group.recipeCount > 1 && (
                        <p className="text-xs text-muted-foreground ml-2 mt-0.5">Used in {group.recipeCount} recipes</p>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setStep('recipe-review')}>
                  <ChevronLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button onClick={() => setStep('confirm')}>
                  Continue to Save
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* CONFIRM STEP */}
          {step === 'confirm' && (
            <div className="space-y-4 py-4">
              <div className="text-center py-4">
                <Check className="h-12 w-12 mx-auto text-green-500" />
                <h3 className="mt-3 text-lg font-medium">Ready to Import</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {readyItems.filter(i => !i.excluded).length} recipe{readyItems.filter(i => !i.excluded).length !== 1 ? 's' : ''} will be created
                </p>
              </div>

              <div className="space-y-1.5">
                {readyItems.map(item => {
                  const session = item.importSessionId ? importSessions.get(item.importSessionId) : null;
                  const title = session?.parsedRecipe?.title || item.label;
                  const ingCount = session?.parsedRecipe?.ingredients?.length || 0;
                  return (
                    <label key={item.id} className="flex items-center gap-2 px-3 py-2 rounded bg-muted/30 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!item.excluded}
                        onChange={(e) => setItems(prev => prev.map(i => i.id === item.id ? { ...i, excluded: !e.target.checked } : i))}
                        className="rounded"
                      />
                      <span className="flex-1 text-sm truncate">{title}</span>
                      <Badge variant="outline" className="text-xs">{ingCount} ingredients</Badge>
                    </label>
                  );
                })}
              </div>

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setStep('catalog')}>
                  <ChevronLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending || readyItems.every(i => i.excluded)}>
                  {confirmMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Import {readyItems.filter(i => !i.excluded).length} Recipes
                </Button>
              </div>
            </div>
          )}
        </div>
    </>
  );

  if (embedded) {
    return open ? body : null;
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {body}
      </DialogContent>
    </Dialog>
  );
}
