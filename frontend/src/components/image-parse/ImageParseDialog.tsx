import { useState, useCallback, useRef, useEffect, useReducer } from 'react';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import {
  Camera,
  Upload,
  Clipboard,
  Loader2,
  AlertCircle,
  ListChecks,
  ChefHat,
  Calendar,
  HelpCircle,
  Check,
  RotateCw,
  Cpu,
  Zap,
  ChevronDown,
  Bug,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  imageParseApi,
  type ParsedContentType,
  type ImageParseSession,
  type ExtractionMode,
} from '@/api/image-parse';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { ListPreview } from './previews/ListPreview';
import { RecipePreview } from './previews/RecipePreview';
import { CalendarEventsPreview } from './previews/CalendarEventsPreview';

type DialogStep = 'mode-selection' | 'upload' | 'processing' | 'type-selection' | 'review' | 'confirm';

interface ImageParseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultType?: ParsedContentType;
  onSuccess?: (type: string, createdIds: string[]) => void;
  // For pre-selecting target (e.g., existing list to add to)
  targetListId?: string;
  targetCalendarId?: string;
}

const CONTENT_TYPE_INFO: Record<
  ParsedContentType,
  { icon: typeof ListChecks; label: string; description: string }
> = {
  list: {
    icon: ListChecks,
    label: 'List',
    description: 'Shopping list, to-do list, or notes',
  },
  recipe: {
    icon: ChefHat,
    label: 'Recipe',
    description: 'Cooking recipe with ingredients and instructions',
  },
  calendar_event: {
    icon: Calendar,
    label: 'Calendar Events',
    description: 'Appointments, meetings, or schedules',
  },
  mixed: {
    icon: HelpCircle,
    label: 'Mixed Content',
    description: 'Contains multiple content types',
  },
  unknown: {
    icon: HelpCircle,
    label: 'Unknown',
    description: 'Content type could not be determined',
  },
};

export function ImageParseDialog({
  open,
  onOpenChange,
  defaultType,
  onSuccess,
  targetListId,
  targetCalendarId,
}: ImageParseDialogProps) {
  const [step, setStep] = useState<DialogStep>('mode-selection');
  const [extractionMode, setExtractionMode] = useState<ExtractionMode>('accurate');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [editedContent, setEditedContent] = useState<unknown>(null);
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);

  // Force re-render for progress updates
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Check AI status
  const { data: aiStatus } = useQuery({
    queryKey: ['ai-status'],
    queryFn: imageParseApi.getStatus,
    staleTime: 30000,
  });

  // Poll session status during processing
  const { data: sessionData, refetch: refetchSession } = useQuery({
    queryKey: ['image-parse-session', sessionId],
    queryFn: () => imageParseApi.getSession(sessionId!),
    enabled: !!sessionId,
    refetchInterval: (query) => {
      const session = query.state.data?.session;
      if (session?.status === 'processing') {
        return 2000; // Poll every 2 seconds during processing
      }
      return false;
    },
  });

  const session = sessionData?.session;

  // Handle session status changes
  useEffect(() => {
    if (!session) return;

    if (session.status === 'processing') {
      setStep('processing');
      // Track when processing started
      if (!processingStartTime) {
        setProcessingStartTime(Date.now());
      }
    } else if (session.status === 'review') {
      // Reset processing start time when done
      setProcessingStartTime(null);
      // If we have a default type, skip type selection
      if (defaultType || session.detectedType === session.selectedType) {
        setStep('review');
      } else {
        setStep('type-selection');
      }
    } else if (session.status === 'failed') {
      setProcessingStartTime(null);
      setStep('upload'); // Go back to upload on failure
    }
  }, [session?.status, defaultType, processingStartTime]);

  // Force re-render every second during processing for progress bar updates
  useEffect(() => {
    if (step === 'processing') {
      const interval = setInterval(forceUpdate, 1000);
      return () => clearInterval(interval);
    }
  }, [step]);

  // Upload mutation - pass extractionMode as parameter to avoid stale closure
  const uploadMutation = useMutation({
    mutationFn: async ({ file, mode }: { file: File; mode: ExtractionMode }) => {
      return imageParseApi.uploadImage(file, defaultType, setUploadProgress, mode);
    },
    onSuccess: (data) => {
      setSessionId(data.sessionId);
      setStep('processing');
    },
    onError: () => {
      setUploadProgress(0);
    },
  });

  // Update type mutation
  const updateTypeMutation = useMutation({
    mutationFn: (type: ParsedContentType) =>
      imageParseApi.updateType(sessionId!, type),
    onSuccess: () => {
      refetchSession();
      setStep('review');
    },
  });

  // Reprocess mutation
  const reprocessMutation = useMutation({
    mutationFn: () => imageParseApi.reprocess(sessionId!),
    onSuccess: () => {
      setStep('processing');
      refetchSession();
    },
  });

  // Confirm mutation
  const confirmMutation = useMutation({
    mutationFn: async () => {
      // Save any user edits to the session before confirming
      if (editedContent && sessionId && session?.selectedType) {
        switch (session.selectedType) {
          case 'list':
            await imageParseApi.updateListContent(sessionId, editedContent as Parameters<typeof imageParseApi.updateListContent>[1]);
            break;
          case 'recipe':
            await imageParseApi.updateRecipeContent(sessionId, editedContent as Parameters<typeof imageParseApi.updateRecipeContent>[1]);
            break;
          case 'calendar_event':
            await imageParseApi.updateCalendarContent(sessionId, editedContent as Parameters<typeof imageParseApi.updateCalendarContent>[1]);
            break;
        }
      }

      const options: Parameters<typeof imageParseApi.confirm>[1] = {};

      if (session?.selectedType === 'list') {
        if (targetListId) {
          options.listId = targetListId;
        }
      } else if (session?.selectedType === 'calendar_event') {
        if (targetCalendarId) {
          options.calendarId = targetCalendarId;
        }
      }

      return imageParseApi.confirm(sessionId!, options);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
      onSuccess?.(data.type, data.createdIds);
      handleClose();
    },
  });

  // Cancel mutation
  const cancelMutation = useMutation({
    mutationFn: () => imageParseApi.cancel(sessionId!),
  });

  const handleClose = useCallback(() => {
    if (sessionId && session?.status === 'review') {
      cancelMutation.mutate();
    }
    setStep('mode-selection');
    setExtractionMode('accurate');
    setSessionId(null);
    setUploadProgress(0);
    setEditedContent(null);
    setProcessingStartTime(null);
    setDebugOpen(false);
    onOpenChange(false);
  }, [sessionId, session?.status, cancelMutation, onOpenChange]);

  const handleFileSelect = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        return;
      }
      uploadMutation.mutate({ file, mode: extractionMode });
    },
    [uploadMutation, extractionMode]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);

      const file = e.dataTransfer.files?.[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect]
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            handleFileSelect(file);
            break;
          }
        }
      }
    },
    [handleFileSelect]
  );

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 0.8) {
      return <Badge variant="default">High Confidence ({Math.round(confidence * 100)}%)</Badge>;
    }
    if (confidence >= 0.5) {
      return <Badge variant="secondary">Medium Confidence ({Math.round(confidence * 100)}%)</Badge>;
    }
    return <Badge variant="destructive">Low Confidence ({Math.round(confidence * 100)}%)</Badge>;
  };

  // Get status message based on actual processing stage
  const getStatusMessage = (stage: string | null | undefined): string => {
    switch (stage) {
      case 'queued':
        return 'Queued for processing...';
      case 'vlm_started':
        return 'Reading image with vision AI...';
      case 'vlm_done':
        return 'Image read, starting text structuring...';
      case 'llm_started':
        return 'Structuring extracted content...';
      case 'llm_done':
        return 'Finalizing...';
      default:
        return 'Processing...';
    }
  };

  // Get progress percentage based on actual processing stage
  const getProgressFromStage = (stage: string | null | undefined): number => {
    switch (stage) {
      case 'queued':
        return 5;
      case 'vlm_started':
        return 15;
      case 'vlm_done':
        return 60;
      case 'llm_started':
        return 70;
      case 'llm_done':
        return 95;
      default:
        return 10;
    }
  };

  // Format remaining time as human-readable string
  const formatTimeRemaining = (ms: number) => {
    if (ms <= 0) return 'Almost done...';
    const seconds = Math.ceil(ms / 1000);
    if (seconds < 60) return `~${seconds}s remaining`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `~${minutes}m ${remainingSeconds}s remaining`;
  };

  const renderModeSelectionStep = () => (
    <div className="space-y-6">
      <div className="text-center">
        <p className="text-sm text-muted-foreground mb-4">
          Choose how you'd like to process your image
        </p>
      </div>

      <RadioGroup
        value={extractionMode}
        onValueChange={(value) => setExtractionMode(value as ExtractionMode)}
        className="space-y-3"
      >
        <div className="flex items-start space-x-3 p-4 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
          <RadioGroupItem value="accurate" id="accurate" className="mt-1" />
          <div className="flex-1">
            <Label htmlFor="accurate" className="font-medium cursor-pointer">
              Accurate
            </Label>
            <p className="text-sm text-muted-foreground mt-1">
              Best balance of speed and accuracy. Uses preprocessing and verification.
              Recommended for most images.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              ~1-2 minutes (GPU) / ~10-15 minutes (CPU)
            </p>
          </div>
        </div>

        <div className="flex items-start space-x-3 p-4 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
          <RadioGroupItem value="thorough" id="thorough" className="mt-1" />
          <div className="flex-1">
            <Label htmlFor="thorough" className="font-medium cursor-pointer">
              Thorough
            </Label>
            <p className="text-sm text-muted-foreground mt-1">
              Multiple passes with verification. Better for difficult handwriting
              or low-quality images.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              ~2-3 minutes (GPU) / ~15-20 minutes (CPU)
            </p>
          </div>
        </div>

      </RadioGroup>

      <div className="flex justify-end">
        <Button onClick={() => setStep('upload')}>
          Continue
        </Button>
      </div>
    </div>
  );

  const renderUploadStep = () => (
    <div className="space-y-4">
      {!aiStatus?.available && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            AI service is not available. Image parsing will have limited functionality.
          </AlertDescription>
        </Alert>
      )}

      <div
        className={cn(
          'relative rounded-lg border-2 border-dashed p-8 text-center transition-colors',
          dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
          uploadMutation.isPending && 'pointer-events-none opacity-50'
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onPaste={handlePaste}
        tabIndex={0}
      >
        {uploadMutation.isPending ? (
          <div className="space-y-4">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
            <Progress value={uploadProgress} className="mx-auto max-w-xs" />
            <p className="text-sm text-muted-foreground">Uploading... {uploadProgress}%</p>
          </div>
        ) : (
          <>
            <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-4 text-lg font-medium">Drop an image here</p>
            <p className="text-sm text-muted-foreground">
              or click to select, paste from clipboard, or use camera
            </p>

            <div className="mt-6 flex justify-center gap-3">
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mr-2 h-4 w-4" />
                Select File
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  // Trigger camera on mobile
                  if (fileInputRef.current) {
                    fileInputRef.current.accept = 'image/*';
                    fileInputRef.current.capture = 'environment';
                    fileInputRef.current.click();
                    // Reset after click
                    setTimeout(() => {
                      if (fileInputRef.current) {
                        fileInputRef.current.removeAttribute('capture');
                      }
                    }, 100);
                  }
                }}
              >
                <Camera className="mr-2 h-4 w-4" />
                Camera
              </Button>
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
              Supports: JPG, PNG, GIF, WebP, HEIC (max 10MB)
            </p>
          </>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelect(file);
            e.target.value = '';
          }}
        />
      </div>

      {uploadMutation.error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {uploadMutation.error instanceof Error
              ? uploadMutation.error.message
              : 'Upload failed'}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );

  const renderProcessingStep = () => {
    // Use actual processing stage from session if available
    const processingStage = session?.processingStage;
    const stageProgress = getProgressFromStage(processingStage);

    // Also track elapsed time for "time remaining" estimate
    const elapsedMs = processingStartTime ? Date.now() - processingStartTime : 0;
    const expectedMs = aiStatus?.expectedProcessingMs || 240000;
    const timeRemainingMs = Math.max(expectedMs - elapsedMs, 0);

    // Determine current stage name for display
    const currentStageName = processingStage === 'vlm_started' || processingStage === 'queued'
      ? 'Vision AI'
      : processingStage === 'llm_started' || processingStage === 'vlm_done'
        ? 'Text Structuring'
        : 'Processing';

    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        {/* Mode Badge */}
        <Badge
          variant={aiStatus?.gpuAccelerated ? 'default' : 'secondary'}
          className="mb-2"
        >
          {aiStatus?.gpuAccelerated ? (
            <>
              <Zap className="mr-1 h-3 w-3" />
              GPU Mode
            </>
          ) : (
            <>
              <Cpu className="mr-1 h-3 w-3" />
              CPU Mode (slower)
            </>
          )}
        </Badge>

        {/* Model Info */}
        <p className="text-xs text-muted-foreground mb-6">
          {aiStatus?.model || 'AI'} • Stage: {currentStageName}
        </p>

        {/* Spinner */}
        <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />

        {/* Status Message - based on actual stage */}
        <p className="text-lg font-medium mb-2">{getStatusMessage(processingStage)}</p>

        {/* Progress Bar - based on actual stage */}
        <div className="w-full max-w-xs mb-4">
          <Progress value={stageProgress} className="h-2" />
        </div>

        {/* Time Info */}
        <p className="text-sm text-muted-foreground">
          {formatTimeRemaining(timeRemainingMs)}
        </p>
        {!aiStatus?.gpuAccelerated && (
          <p className="text-xs text-muted-foreground mt-1">
            CPU processing is slower than GPU
          </p>
        )}

        {session?.parseWarnings && session.parseWarnings.length > 0 && (
          <Alert className="mt-4 max-w-md">
            <AlertDescription className="text-left">
              {session.parseWarnings.join('. ')}
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  };

  const renderTypeSelectionStep = () => {
    const detectableTypes: ParsedContentType[] = ['list', 'recipe', 'calendar_event'];

    return (
      <div className="space-y-4">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            We detected this might be a{' '}
            <strong>{CONTENT_TYPE_INFO[session?.detectedType || 'unknown'].label}</strong>
          </p>
          {session?.confidence && getConfidenceBadge(parseFloat(session.confidence))}
        </div>

        <div className="grid gap-3">
          {detectableTypes.map((type) => {
            const info = CONTENT_TYPE_INFO[type];
            const Icon = info.icon;
            const isDetected = type === session?.detectedType;

            return (
              <Card
                key={type}
                className={cn(
                  'cursor-pointer transition-colors hover:bg-muted/50',
                  isDetected && 'border-primary'
                )}
                onClick={() => updateTypeMutation.mutate(type)}
              >
                <CardContent className="flex items-center gap-4 p-4">
                  <Icon className="h-8 w-8 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="font-medium">
                      {info.label}
                      {isDetected && (
                        <Badge variant="outline" className="ml-2">
                          Detected
                        </Badge>
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">{info.description}</p>
                  </div>
                  {updateTypeMutation.isPending &&
                    updateTypeMutation.variables === type && (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    );
  };

  const renderReviewStep = () => {
    if (!session?.parsedContent) {
      return (
        <div className="py-8 text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-4">No content was extracted from the image.</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => reprocessMutation.mutate()}
            disabled={reprocessMutation.isPending}
          >
            {reprocessMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RotateCw className="mr-2 h-4 w-4" />
            )}
            Try Again
          </Button>
        </div>
      );
    }

    const content = session.parsedContent;

    return (
      <div className="space-y-4">
        {session.parseWarnings && session.parseWarnings.length > 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {session.parseWarnings.join('. ')}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {(() => {
              const info = CONTENT_TYPE_INFO[session.selectedType || 'unknown'];
              const Icon = info.icon;
              return (
                <>
                  <Icon className="h-5 w-5" />
                  <span className="font-medium">{info.label}</span>
                </>
              );
            })()}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setStep('type-selection')}
          >
            Change Type
          </Button>
        </div>

        {content.type === 'list' && (
          <ListPreview
            content={content.data}
            onContentChange={(updated) => setEditedContent(updated)}
          />
        )}

        {content.type === 'recipe' && (
          <RecipePreview
            content={content.data}
            onContentChange={(updated) => setEditedContent(updated)}
          />
        )}

        {content.type === 'calendar_event' && (
          <CalendarEventsPreview
            content={content.data}
            onContentChange={(updated) => setEditedContent(updated)}
          />
        )}

        {/* Debug section - Raw VLM output */}
        {session.rawText && (
          <Collapsible open={debugOpen} onOpenChange={setDebugOpen} className="mt-4">
            <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border bg-muted/50 px-4 py-2 text-sm font-medium hover:bg-muted">
              <span className="flex items-center gap-2">
                <Bug className="h-4 w-4" />
                Debug: Raw VLM Output
              </span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", debugOpen && "rotate-180")} />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="rounded-lg border bg-muted/30 p-4">
                <pre className="whitespace-pre-wrap text-xs text-muted-foreground font-mono max-h-64 overflow-y-auto">
                  {session.rawText}
                </pre>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => setStep('type-selection')}>
            Back
          </Button>
          <Button
            onClick={() => confirmMutation.mutate()}
            disabled={confirmMutation.isPending}
          >
            {confirmMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            Create {CONTENT_TYPE_INFO[session.selectedType || 'unknown'].label}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 'mode-selection' && 'Choose Processing Mode'}
            {step === 'upload' && 'Scan Image'}
            {step === 'processing' && 'Processing'}
            {step === 'type-selection' && 'Select Content Type'}
            {step === 'review' && 'Review Content'}
          </DialogTitle>
          <DialogDescription>
            {step === 'mode-selection' &&
              'Select how you want to process your image.'}
            {step === 'upload' &&
              'Upload a photo of a list, recipe, or schedule to automatically extract the content.'}
            {step === 'processing' && 'Analyzing your image with AI...'}
            {step === 'type-selection' && 'What type of content is in this image?'}
            {step === 'review' && 'Review and edit the extracted content before creating.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'mode-selection' && renderModeSelectionStep()}
        {step === 'upload' && renderUploadStep()}
        {step === 'processing' && renderProcessingStep()}
        {step === 'type-selection' && renderTypeSelectionStep()}
        {step === 'review' && renderReviewStep()}
      </DialogContent>
    </Dialog>
  );
}
