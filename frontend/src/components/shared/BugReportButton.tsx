import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Bug } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/useToast';
import { bugReportsApi } from '@/api/bug-reports';
import {
  clearConsoleBuffer,
  getConsoleBuffer,
  type ConsoleLogEntry,
} from '@/lib/consoleBuffer';

const POSITION_KEY = 'bugButtonPosition';
const BUTTON_SIZE = 44;
const SCREENSHOT_MAX_BYTES = 1_200_000;

interface Position {
  x: number;
  y: number;
}

function defaultPosition(): Position {
  if (typeof window === 'undefined') return { x: 16, y: 16 };
  return {
    x: window.innerWidth - BUTTON_SIZE - 16,
    y: window.innerHeight - BUTTON_SIZE - 96,
  };
}

function loadPosition(): Position {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return defaultPosition();
    const parsed = JSON.parse(raw) as Position;
    return clampPosition(parsed);
  } catch {
    return defaultPosition();
  }
}

function clampPosition(p: Position): Position {
  if (typeof window === 'undefined') return p;
  return {
    x: Math.max(8, Math.min(window.innerWidth - BUTTON_SIZE - 8, p.x)),
    y: Math.max(8, Math.min(window.innerHeight - BUTTON_SIZE - 8, p.y)),
  };
}

async function captureScreenshot(): Promise<string | undefined> {
  try {
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(document.body, {
      logging: false,
      useCORS: true,
      // Cap at a reasonable size so payloads stay small.
      scale: Math.min(1, 1280 / Math.max(window.innerWidth, 1)),
    });
    // Try progressively lower quality until under the cap.
    for (const quality of [0.7, 0.5, 0.3]) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= SCREENSHOT_MAX_BYTES) return dataUrl;
    }
    return undefined; // Couldn't get small enough; skip rather than send a giant payload.
  } catch (err) {
    console.warn('Bug report screenshot failed', err);
    return undefined;
  }
}

export function BugReportButton() {
  const location = useLocation();
  const [position, setPosition] = useState<Position>(() => loadPosition());
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [bufferSnapshot, setBufferSnapshot] = useState<ConsoleLogEntry[]>([]);

  // Pointer-drag state — we treat anything under a small threshold as a click.
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    const handleResize = () => setPosition((p) => clampPosition(p));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Snapshot console buffer when opening so the count shown matches what we send.
  useEffect(() => {
    if (open) setBufferSnapshot(getConsoleBuffer());
  }, [open]);

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      moved: false,
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    setPosition(clampPosition({ x: drag.originX + dx, y: drag.originY + dy }));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    if (drag.moved) {
      try {
        localStorage.setItem(POSITION_KEY, JSON.stringify(position));
      } catch {
        /* localStorage full / unavailable — ignore */
      }
    } else {
      setOpen(true);
    }
  }

  async function handleSubmit() {
    if (!description.trim()) return;
    setSubmitting(true);
    try {
      const screenshot = includeScreenshot ? await captureScreenshot() : undefined;
      await bugReportsApi.create({
        description: description.trim(),
        url: location.pathname + location.search,
        userAgent: navigator.userAgent.slice(0, 500),
        consoleLog: bufferSnapshot,
        screenshot,
        viewport: { w: window.innerWidth, h: window.innerHeight },
      });
      toast({ title: 'Bug report sent', description: 'Thanks — Sam will take a look.' });
      setDescription('');
      setOpen(false);
      // Fresh slate for the next report.
      clearConsoleBuffer();
    } catch (err) {
      toast({
        title: 'Could not submit bug report',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label="Report a bug"
        title="Report a bug (drag to move)"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={cn(
          'fixed z-50 flex items-center justify-center rounded-full',
          'bg-destructive text-destructive-foreground shadow-lg',
          'hover:scale-105 active:scale-95 transition-transform',
          'touch-none select-none'
        )}
        style={{
          width: BUTTON_SIZE,
          height: BUTTON_SIZE,
          left: position.x,
          top: position.y,
        }}
      >
        <Bug className="h-5 w-5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Report a bug</DialogTitle>
            <DialogDescription>
              Describe what you were trying to do. We'll attach the current page,
              recent console output, and (optionally) a screenshot.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Textarea
              autoFocus
              placeholder="What were you trying to do? What happened instead?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              maxLength={5000}
            />

            <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
              <div>
                <span className="font-medium text-foreground">Page:</span>{' '}
                <code>{location.pathname}</code>
              </div>
              <div>
                <span className="font-medium text-foreground">Console entries:</span>{' '}
                {bufferSnapshot.length}
              </div>
              <div>
                <span className="font-medium text-foreground">Viewport:</span>{' '}
                {window.innerWidth}×{window.innerHeight}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="bug-screenshot" className="text-sm">
                Include screenshot
              </Label>
              <Switch
                id="bug-screenshot"
                checked={includeScreenshot}
                onCheckedChange={setIncludeScreenshot}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || !description.trim()}>
              {submitting ? 'Sending…' : 'Send report'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
