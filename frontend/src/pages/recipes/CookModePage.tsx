import { useParams, Link, useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { recipesApi } from '@/api/recipes';
import { useCookingSession } from '@/hooks/useCookingSession';
import { cn } from '@/lib/utils';

export function CookModePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['recipes', id],
    queryFn: () => recipesApi.get(id!),
    enabled: !!id,
  });

  const recipe = data?.recipe;

  const {
    session,
    isActive,
    currentStep,
    totalSteps,
    timers,
    start,
    end,
    next,
    prev,
    goToStep,
    startTimer,
    pauseTimer,
    resetTimer,
  } = useCookingSession();

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

  const currentInstruction = recipe.instructions[currentStep];
  const progress = ((currentStep + 1) / totalSteps) * 100;

  const handleFinish = () => {
    end();
    navigate(`/recipes/${id}`);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between p-4">
          <Button variant="ghost" asChild>
            <Link to={`/recipes/${id}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Exit
            </Link>
          </Button>
          <h1 className="text-lg font-semibold">{recipe.title}</h1>
          <Button onClick={handleFinish}>
            <Check className="mr-2 h-4 w-4" />
            Finish
          </Button>
        </div>
        <Progress value={progress} className="h-1" />
      </div>

      <div className="container mx-auto max-w-4xl p-4">
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main instruction area */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">
                    Step {currentStep + 1} of {totalSteps}
                  </CardTitle>
                  <Badge variant="secondary">
                    {Math.round(progress)}% complete
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xl leading-relaxed">{currentInstruction.text}</p>

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
                    {recipe.instructions.map((_, i) => (
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
                    onClick={currentStep === totalSteps - 1 ? handleFinish : next}
                  >
                    {currentStep === totalSteps - 1 ? (
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

            {/* Ingredients reference */}
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="text-base">Ingredients</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid grid-cols-2 gap-2 text-sm">
                  {recipe.ingredients.map((ingredient) => (
                    <li key={ingredient.id} className="flex items-center gap-2">
                      <span className="font-medium">
                        {ingredient.amount} {ingredient.unit}
                      </span>
                      <span className="text-muted-foreground">{ingredient.name}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          {/* Timers sidebar */}
          <div>
            <Card className="sticky top-24">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Timer className="h-4 w-4" />
                  Timers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {timers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No timers for this recipe
                  </p>
                ) : (
                  timers.map((timer) => (
                    <TimerDisplay
                      key={timer.id}
                      timer={timer}
                      onStart={() => startTimer(timer.id)}
                      onPause={() => pauseTimer(timer.id)}
                      onReset={() => resetTimer(timer.id)}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

interface TimerDisplayProps {
  timer: {
    id: string;
    name: string;
    remainingSeconds: number;
    isRunning: boolean;
    isPaused: boolean;
  };
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
}

function TimerDisplay({ timer, onStart, onPause, onReset }: TimerDisplayProps) {
  const minutes = Math.floor(timer.remainingSeconds / 60);
  const seconds = timer.remainingSeconds % 60;
  const isComplete = timer.remainingSeconds === 0;

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        isComplete && 'border-green-500 bg-green-50 dark:bg-green-950'
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">{timer.name}</span>
        {isComplete && <Badge variant="default">Done!</Badge>}
      </div>
      <div className="mt-2 text-2xl font-mono tabular-nums">
        {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
      </div>
      <div className="mt-2 flex gap-2">
        {timer.isRunning ? (
          <Button size="sm" variant="outline" onClick={onPause}>
            <PauseCircle className="mr-1 h-4 w-4" />
            Pause
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={onStart}
            disabled={isComplete}
          >
            <PlayCircle className="mr-1 h-4 w-4" />
            Start
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onReset}>
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
