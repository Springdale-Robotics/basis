import { useCallback, useRef, useState } from 'react';
import { Check, X, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** A rectangle in fractions of the image, so it survives any display size. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  imageUrl: string;
  onCancel: () => void;
  onConfirm: (rect: CropRect) => void;
  busy?: boolean;
}

/**
 * Drawing a box around the recipe you actually want.
 *
 * A binder page often cannot be photographed without catching the recipe next
 * to it, and that stray text confuses the reader — it has no way of knowing
 * which words belong together, while the person holding the page does.
 *
 * Drag one corner to the other. Deliberately no resize handles: they need
 * precision that a thumb on a phone does not have, and redrawing the box is
 * faster than nudging its edges. The rectangle is kept as fractions of the
 * image so it means the same thing whatever size it is shown at.
 */
export function CropOverlay({ imageUrl, onCancel, onConfirm, busy = false }: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<CropRect | null>(null);

  /** Pointer position as a fraction of the frame, clamped to it. */
  const positionIn = useCallback((event: React.PointerEvent) => {
    const bounds = frameRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  }, []);

  const begin = useCallback(
    (event: React.PointerEvent) => {
      const point = positionIn(event);
      if (!point) return;
      // Keeps the drag alive if the finger leaves the image, but is not worth
      // failing over: it throws for a pointer the element never saw, and an
      // exception here would swallow the whole gesture.
      try {
        (event.target as Element).setPointerCapture?.(event.pointerId);
      } catch {
        // Dragging still works without capture.
      }
      setStart(point);
      setRect({ x: point.x, y: point.y, width: 0, height: 0 });
    },
    [positionIn]
  );

  const extend = useCallback(
    (event: React.PointerEvent) => {
      if (!start) return;
      const point = positionIn(event);
      if (!point) return;
      // Drawn from any corner towards any other, so it does not matter which
      // way round the drag goes.
      setRect({
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        width: Math.abs(point.x - start.x),
        height: Math.abs(point.y - start.y),
      });
    },
    [positionIn, start]
  );

  const end = useCallback(() => setStart(null), []);

  // A stray tap is not a crop.
  const usable = rect !== null && rect.width > 0.05 && rect.height > 0.05;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Drag a box around the recipe you want. Anything outside it is left behind, so the reader
        never sees the recipe next to it.
      </p>

      <div
        ref={frameRef}
        className="relative touch-none overflow-hidden rounded-lg border bg-black"
        onPointerDown={begin}
        onPointerMove={extend}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <img src={imageUrl} alt="" className="w-full max-h-[55vh] object-contain select-none" draggable={false} />

        {rect && (
          <>
            {/* Everything outside the box is dimmed, so what will be kept is
                obvious at a glance rather than by inspecting a thin outline. */}
            <div
              className="pointer-events-none absolute inset-0 bg-black/55"
              style={{
                clipPath: `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
                  ${rect.x * 100}% ${rect.y * 100}%,
                  ${rect.x * 100}% ${(rect.y + rect.height) * 100}%,
                  ${(rect.x + rect.width) * 100}% ${(rect.y + rect.height) * 100}%,
                  ${(rect.x + rect.width) * 100}% ${rect.y * 100}%,
                  ${rect.x * 100}% ${rect.y * 100}%)`,
              }}
            />
            <div
              className="pointer-events-none absolute border-2 border-primary"
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.width * 100}%`,
                height: `${rect.height * 100}%`,
              }}
            />
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => usable && rect && onConfirm(rect)} disabled={!usable || busy}>
          <Check className="mr-2 h-4 w-4" />
          Use this area
        </Button>
        <Button variant="outline" onClick={() => setRect(null)} disabled={!rect || busy}>
          <Undo2 className="mr-2 h-4 w-4" />
          Start again
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          <X className="mr-2 h-4 w-4" />
          Keep the whole page
        </Button>
      </div>
    </div>
  );
}
