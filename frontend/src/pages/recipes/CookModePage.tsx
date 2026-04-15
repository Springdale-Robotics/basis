import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  PlayCircle,
  PauseCircle,
  RotateCcw,
  Check,
  Timer,
  List,
  ListChecks,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { recipesApi } from '@/api/recipes';
import { useCookingSession } from '@/hooks/useCookingSession';
import { useTimers } from '@/hooks/useTimers';
import { cn } from '@/lib/utils';
import { FinishCookingDialog } from './FinishCookingDialog';
import { ExitCookingWarningDialog } from './ExitCookingWarningDialog';
import { AddTimerDialog } from './AddTimerDialog';
import type { CookingTimer } from '@/stores/timerStore';

type CookingMode = 'linear' | 'checklist';

export function CookModePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [showFinishDialog, setShowFinishDialog] = useState(false);
  const [showExitWarning, setShowExitWarning] = useState(false);
  const [cookingMode, setCookingMode] = useState<CookingMode>('linear');
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['recipes', id],
    queryFn: () => recipesApi.get(id!),
    enabled: !!id,
  });

  const recipe = data?.recipe;
  // Use the separately returned ingredients which include inventoryItemId
  const recipeIngredients = data?.ingredients;

  const {
    session,
    isActive,
    currentStep,
    totalSteps,
    start,
    end,
    next,
    prev,
    goToStep,
  } = useCookingSession();

  const {
    timers,
    addTimer,
    startTimer,
    pauseTimer,
    resetTimer,
    addTime,
    dismissTimer,
  } = useTimers();

  // Start session when recipe loads
  useEffect(() => {
    if (recipe && !isActive) {
      start(recipe);
    }
  }, [recipe, isActive, start]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!recipe) {
    return <div>Recipe not found</div>;
  }

  const instructions = recipe.instructions ?? [];
  // Merge recipe ingredients with the separately fetched ones that have inventoryItemId
  const ingredients = (recipeIngredients || recipe.ingredients || []).map((ing, idx) => ({
    id: ing.id || `ing-${idx}`,
    name: ing.name, // Use original recipe text, not linked item name
    amount: typeof ing.quantity === 'string' ? parseFloat(ing.quantity) : (ing.quantity || ing.amount || 0),
    unit: ing.unit || '',
    notes: ing.notes,
    optional: ing.optional ?? false,
    inventoryItemId: ing.inventoryItemId,
    groupName: ing.groupName || null,
  }));
  const currentInstruction = instructions[currentStep];
  const effectiveTotalSteps = instructions.length || 1;

  // Progress calculation based on mode
  const progress = cookingMode === 'linear'
    ? ((currentStep + 1) / effectiveTotalSteps) * 100
    : (completedSteps.size / effectiveTotalSteps) * 100;

  const toggleStepComplete = (stepIndex: number) => {
    setCompletedSteps(prev => {
      const newSet = new Set(prev);
      if (newSet.has(stepIndex)) {
        newSet.delete(stepIndex);
      } else {
        newSet.add(stepIndex);
      }
      return newSet;
    });
  };

  if (instructions.length === 0) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-xl font-semibold mb-2">No Instructions</h2>
        <p className="text-muted-foreground mb-4">This recipe doesn't have any cooking instructions yet.</p>
        <Button asChild>
          <Link to={`/recipes/${id}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Recipe
          </Link>
        </Button>
      </div>
    );
  }

  const handleFinishClick = () => {
    setShowFinishDialog(true);
  };

  const handleFinishComplete = () => {
    setShowFinishDialog(false);
    end();
    navigate(`/recipes/${id}`);
  };

  const handleExitClick = () => {
    setShowExitWarning(true);
  };

  const handleConfirmExit = () => {
    setShowExitWarning(false);
    end();
    navigate(`/recipes/${id}`);
  };

  const handleExitToFinish = () => {
    setShowExitWarning(false);
    setShowFinishDialog(true);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between p-4">
          <Button variant="ghost" onClick={handleExitClick}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Exit
          </Button>
          <div className="flex flex-col items-center gap-1">
            <h1 className="text-lg font-semibold">{recipe.title}</h1>
            {/* Mode Toggle */}
            <div className="flex rounded-lg border bg-muted p-0.5">
              <button
                onClick={() => setCookingMode('linear')}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  cookingMode === 'linear'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <List className="h-3.5 w-3.5" />
                Step-by-step
              </button>
              <button
                onClick={() => setCookingMode('checklist')}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  cookingMode === 'checklist'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <ListChecks className="h-3.5 w-3.5" />
                Checklist
              </button>
            </div>
          </div>
          <Button onClick={handleFinishClick}>
            <Check className="mr-2 h-4 w-4" />
            Finish
          </Button>
        </div>
        <Progress value={progress} className="h-1" />
      </div>

      <div className="container mx-auto max-w-4xl p-4 pb-24">
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main instruction area */}
          <div className="lg:col-span-2">
            {cookingMode === 'linear' ? (
              /* Linear Mode - Step by step */
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">
                      Step {currentStep + 1} of {effectiveTotalSteps}
                    </CardTitle>
                    <Badge variant="secondary">
                      {Math.round(progress)}% complete
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xl leading-relaxed">{currentInstruction?.text || 'No instruction text'}</p>

                  {/* Navigation */}
                  <div className="mt-8 flex items-center justify-between">
                    <Button
                      variant="outline"
                      onClick={prev}
                      disabled={currentStep === 0}
                    >
                      <ChevronLeft className="mr-2 h-4 w-4" />
                      Previous
                    </Button>
                    <div className="flex gap-1">
                      {instructions.map((_, i) => (
                        <button
                          key={i}
                          onClick={() => goToStep(i)}
                          className={cn(
                            'h-2 w-2 rounded-full transition-colors',
                            i === currentStep
                              ? 'bg-primary'
                              : i < currentStep
                              ? 'bg-primary/50'
                              : 'bg-muted'
                          )}
                        />
                      ))}
                    </div>
                    <Button
                      onClick={currentStep === effectiveTotalSteps - 1 ? handleFinishClick : next}
                    >
                      {currentStep === effectiveTotalSteps - 1 ? (
                        <>
                          <Check className="mr-2 h-4 w-4" />
                          Finish
                        </>
                      ) : (
                        <>
                          Next
                          <ChevronRight className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              /* Checklist Mode - All steps visible */
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">All Steps</CardTitle>
                    <Badge variant="secondary">
                      {completedSteps.size} of {effectiveTotalSteps} complete
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {instructions.map((instruction, index) => (
                      <div
                        key={index}
                        className={cn(
                          'flex gap-3 rounded-lg border p-4 transition-colors',
                          completedSteps.has(index) && 'bg-muted/50'
                        )}
                      >
                        <Checkbox
                          id={`step-${index}`}
                          checked={completedSteps.has(index)}
                          onCheckedChange={() => toggleStepComplete(index)}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <label
                            htmlFor={`step-${index}`}
                            className={cn(
                              'block cursor-pointer text-base leading-relaxed',
                              completedSteps.has(index) && 'text-muted-foreground line-through'
                            )}
                          >
                            <span className="font-medium text-muted-foreground mr-2">
                              {index + 1}.
                            </span>
                            {instruction.text}
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Finish button when all steps complete */}
                  {completedSteps.size === effectiveTotalSteps && (
                    <div className="mt-6 text-center">
                      <Button onClick={handleFinishClick} size="lg">
                        <Check className="mr-2 h-4 w-4" />
                        Finish Cooking
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Timers sidebar */}
          <div>
            <Card className="sticky top-32">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Timer className="h-4 w-4" />
                    Timers
                  </CardTitle>
                  <AddTimerDialog onAdd={addTimer} />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {timers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No active timers. Add one to get started!
                  </p>
                ) : (
                  timers.map((timer) => (
                    <TimerDisplay
                      key={timer.id}
                      timer={timer}
                      onStart={() => startTimer(timer.id)}
                      onPause={() => pauseTimer(timer.id)}
                      onReset={() => resetTimer(timer.id)}
                      onAddTime={(mins) => addTime(timer.id, mins)}
                      onDismiss={() => dismissTimer(timer.id)}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Floating Ingredients Button */}
      <Sheet>
        <SheetTrigger asChild>
          <Button
            size="lg"
            className="fixed bottom-6 right-6 z-20 h-14 rounded-full shadow-lg"
          >
            <UtensilsCrossed className="mr-2 h-5 w-5" />
            Ingredients
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="h-[50vh]">
          <SheetHeader>
            <SheetTitle>Ingredients</SheetTitle>
          </SheetHeader>
          <div className="mt-4 overflow-y-auto">
            {(() => {
              const groups = new Map<string, typeof ingredients>();
              for (const ing of ingredients) {
                const key = ing.groupName || '';
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push(ing);
              }
              return Array.from(groups.entries()).map(([groupName, groupIngs]) => (
                <div key={groupName || '__default'} className="mb-4">
                  {groupName && (
                    <h4 className="text-sm font-medium text-muted-foreground mb-2">{groupName}</h4>
                  )}
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {groupIngs.map((ingredient) => (
                      <li
                        key={ingredient.id}
                        className="flex items-center gap-2 rounded-lg border p-3"
                      >
                        <span className="font-medium">
                          {ingredient.amount} {ingredient.unit}
                        </span>
                        <span className="text-muted-foreground">{ingredient.name}</span>
                        {ingredient.optional && (
                          <Badge variant="outline" className="ml-auto text-xs">
                            Optional
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ));
            })()}
          </div>
        </SheetContent>
      </Sheet>

      {/* Finish Cooking Dialog */}
      <FinishCookingDialog
        open={showFinishDialog}
        onOpenChange={setShowFinishDialog}
        recipeId={id!}
        ingredients={ingredients}
        onComplete={handleFinishComplete}
      />

      {/* Exit Warning Dialog */}
      <ExitCookingWarningDialog
        open={showExitWarning}
        onOpenChange={setShowExitWarning}
        onConfirmExit={handleConfirmExit}
        onFinishCooking={handleExitToFinish}
      />
    </div>
  );
}

interface TimerDisplayProps {
  timer: CookingTimer;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onAddTime: (minutes: number) => void;
  onDismiss: () => void;
}

function TimerDisplay({ timer, onStart, onPause, onReset, onAddTime, onDismiss }: TimerDisplayProps) {
  const minutes = Math.floor(timer.remainingSeconds / 60);
  const seconds = timer.remainingSeconds % 60;

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        timer.isComplete && 'border-green-500 bg-green-50 dark:bg-green-950 animate-pulse',
        timer.isRunning && 'border-primary'
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium truncate">{timer.name}</span>
        {timer.isComplete && <Badge variant="default">Done!</Badge>}
        {timer.isPaused && !timer.isComplete && <Badge variant="outline">Paused</Badge>}
      </div>
      <div className="mt-2 text-3xl font-mono tabular-nums text-center">
        {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
      </div>

      {/* Main controls */}
      <div className="mt-3 flex gap-2">
        {timer.isRunning ? (
          <Button size="sm" variant="outline" onClick={onPause} className="flex-1">
            <PauseCircle className="mr-1 h-4 w-4" />
            Pause
          </Button>
        ) : (
          <Button
            size="sm"
            variant={timer.isComplete ? 'outline' : 'default'}
            onClick={onStart}
            disabled={timer.isComplete && timer.remainingSeconds === 0}
            className="flex-1"
          >
            <PlayCircle className="mr-1 h-4 w-4" />
            {timer.isPaused ? 'Resume' : 'Start'}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onReset} title="Reset">
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>

      {/* Add time buttons */}
      <div className="mt-2 grid grid-cols-3 gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onAddTime(1)}
          className="text-xs h-7 px-1"
        >
          +1m
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onAddTime(5)}
          className="text-xs h-7 px-1"
        >
          +5m
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onAddTime(10)}
          className="text-xs h-7 px-1"
        >
          +10m
        </Button>
      </div>

      {/* Dismiss button for completed timers */}
      {timer.isComplete && (
        <Button
          size="sm"
          variant="secondary"
          onClick={onDismiss}
          className="w-full mt-2"
        >
          Dismiss
        </Button>
      )}

      {/* Cancel button for non-complete timers */}
      {!timer.isComplete && !timer.isRunning && (
        <Button
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          className="w-full mt-2 text-muted-foreground hover:text-destructive"
        >
          Cancel Timer
        </Button>
      )}
    </div>
  );
}
