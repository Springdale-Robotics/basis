import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Check, Loader2, AlertCircle, X, RotateCw, ImageUp, Crop, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { imageParseApi, type BatchScan } from '@/api/image-parse';
import { CropOverlay, type CropRect } from '@/components/recipes/CropOverlay';
import { BulkImportRecipeDialog } from './BulkImportRecipeDialog';
import { measureFrame, judgeFrame, type PhotoVerdict } from '@/lib/photo-quality';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

/**
 * Photographing a binder.
 *
 * The camera stays open. A page is captured, judged, uploaded and forgotten
 * about in the time it takes to turn to the next one — the reading happens
 * later, on the box, whether or not this page is still open. That is the whole
 * point: the work here is pointing a camera at paper, and it should take as
 * long as pointing a camera at paper.
 *
 * Two things follow from that and shape everything below.
 *
 * Photographs upload the moment they are taken, rather than being held until
 * some later "done" button. A dropped phone or a closed tab then costs
 * nothing, and the parsing has already started by the time the next page is
 * turned.
 *
 * And a page is judged before it counts. Refusing a dark or blurry frame costs
 * a couple of seconds while the binder is open; discovering it tomorrow costs
 * fetching the binder back off the shelf.
 */

type Shot = {
  /** Local id, since the server id arrives after the upload. */
  key: string;
  label: string;
  thumbnail: string;
  sessionId?: string;
  state: 'uploading' | 'sent' | 'failed';
  error?: string;
};

const POLL_MS = 4000;

export function CaptureRecipesPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [rejected, setRejected] = useState<{ verdict: PhotoVerdict; blob: Blob; thumbnail: string } | null>(null);
  /**
   * The page just taken, kept at full size so it can be cropped.
   *
   * Only the last one. A binder is hundreds of pages and a decoded frame is
   * megabytes, so holding them all would exhaust the phone — and the moment
   * anybody notices the neighbouring recipe crept into shot is the moment
   * they took it.
   */
  const [lastShot, setLastShot] = useState<{ key: string; blob: Blob; url: string } | null>(null);
  const [cropping, setCropping] = useState(false);
  const [savingCrop, setSavingCrop] = useState(false);
  /** Recipes composed out of the batch, waiting to be looked at. */
  const [composed, setComposed] = useState<string[] | null>(null);
  const [composing, setComposing] = useState(false);
  const [scans, setScans] = useState<BatchScan[]>([]);

  // ─── The camera ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('This device has no camera we can open directly.');
        return;
      }
      try {
        // The back camera, and as much detail as it will give us — recipe
        // cards are read by a model that needs the small handwriting.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 2560 },
            height: { ideal: 1440 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setCameraReady(true);
      } catch {
        setCameraError('Basis could not open the camera. You can still add photos from this device.');
      }
    })();

    return () => {
      cancelled = true;
      // Leaving the page must release the camera, or the light stays on.
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  // ─── The batch ─────────────────────────────────────────────────────────
  /** Made on the first page taken, so an abandoned visit leaves nothing. */
  const ensureBatch = useCallback(async () => {
    if (batchId) return batchId;
    const { batch } = await imageParseApi.createBatch(
      `Binder ${new Date().toLocaleDateString()}`
    );
    setBatchId(batch.id);
    return batch.id;
  }, [batchId]);

  // Progress comes from the server, so it survives this page being closed.
  useEffect(() => {
    if (!batchId) return;
    let stopped = false;

    const tick = async () => {
      try {
        const { scans: latest } = await imageParseApi.getBatch(batchId);
        if (!stopped) setScans(latest);
      } catch {
        // A failed poll is not worth interrupting a photographing session.
      }
    };

    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [batchId]);

  // ─── Taking a page ─────────────────────────────────────────────────────
  const upload = useCallback(
    async (blob: Blob, thumbnail: string, replaces?: { key: string; label: string; sessionId?: string }) => {
      const key = replaces?.key ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const label = replaces?.label ?? `Recipe ${shots.length + 1}`;
      setShots((prev) =>
        replaces
          ? prev.map((shot) => (shot.key === key ? { ...shot, thumbnail, state: 'uploading' } : shot))
          : [...prev, { key, label, thumbnail, state: 'uploading' }]
      );

      try {
        const id = await ensureBatch();
        const file = new File([blob], `${label}.jpg`, { type: 'image/jpeg' });
        const { sessionId } = await imageParseApi.uploadImage(file, 'recipe', undefined, 'accurate', {
          batchId: id,
          label,
        });
        setShots((prev) =>
          prev.map((shot) => (shot.key === key ? { ...shot, sessionId, state: 'sent' } : shot))
        );
        // The uncropped page is no longer wanted — cancelled after the crop is
        // safely up, never before, so a failure leaves the original standing.
        if (replaces?.sessionId) {
          void imageParseApi.cancel(replaces.sessionId).catch(() => undefined);
        }
        return key;
        return key;
      } catch (error) {
        setShots((prev) =>
          prev.map((shot) =>
            shot.key === key
              ? { ...shot, state: 'failed', error: (error as Error).message }
              : shot
          )
        );
        return null;
      }
    },
    [ensureBatch, shots.length]
  );

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0);

    // Judged before it counts, while the binder is still open.
    const verdict = judgeFrame(measureFrame(video, video.videoWidth, video.videoHeight));
    const thumbnail = canvas.toDataURL('image/jpeg', 0.5);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92)
    );
    if (!blob) return;

    if (!verdict.usable) {
      setRejected({ verdict, blob, thumbnail });
      return;
    }

    const key = await upload(blob, thumbnail);
    // Held so the page just taken can still be cropped; the one before it is
    // released, because a binder's worth of decoded frames would not fit.
    setLastShot((previous) => {
      if (previous) URL.revokeObjectURL(previous.url);
      return key ? { key, blob, url: URL.createObjectURL(blob) } : null;
    });
    setCropping(false);
  }, [upload]);

  /**
   * Replace the page just taken with the part of it that matters.
   *
   * Cropped from the frame still in memory rather than by fetching the upload
   * back, and sent as a new page before the uncropped one is cancelled — so a
   * failure anywhere leaves the original page standing rather than nothing.
   */
  const applyCrop = useCallback(
    async (rect: CropRect) => {
      if (!lastShot) return;
      setSavingCrop(true);
      try {
        const bitmap = await createImageBitmap(lastShot.blob);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * rect.width));
        canvas.height = Math.max(1, Math.round(bitmap.height * rect.height));
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(
          bitmap,
          Math.round(bitmap.width * rect.x),
          Math.round(bitmap.height * rect.y),
          canvas.width,
          canvas.height,
          0,
          0,
          canvas.width,
          canvas.height
        );
        bitmap.close();

        const cropped = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', 0.92)
        );
        if (!cropped) return;

        const existing = shots.find((shot) => shot.key === lastShot.key);
        await upload(cropped, canvas.toDataURL('image/jpeg', 0.5), {
          key: lastShot.key,
          label: existing?.label ?? 'Recipe',
          sessionId: existing?.sessionId,
        });

        URL.revokeObjectURL(lastShot.url);
        setLastShot(null);
        setCropping(false);
      } catch {
        toast({ variant: 'destructive', title: 'That crop could not be saved' });
      } finally {
        setSavingCrop(false);
      }
    },
    [lastShot, shots, upload]
  );

  /**
   * For devices where the camera cannot be opened in the page.
   *
   * The last of them is retained just as a captured page is, because a photo
   * from the camera roll is every bit as likely to have caught the recipe
   * next to it — and these are the devices with no other way to crop.
   */
  const addFromDevice = useCallback(
    async (files: FileList | null) => {
      const chosen = Array.from(files ?? []);
      for (const [index, file] of chosen.entries()) {
        const key = await upload(file, URL.createObjectURL(file));
        if (index === chosen.length - 1 && key) {
          setLastShot((previous) => {
            if (previous) URL.revokeObjectURL(previous.url);
            return { key, blob: file, url: URL.createObjectURL(file) };
          });
          setCropping(false);
        }
      }
    },
    [upload]
  );

  const rename = useCallback(async (shot: Shot, label: string) => {
    setShots((prev) => prev.map((s) => (s.key === shot.key ? { ...s, label } : s)));
    if (shot.sessionId) {
      try {
        await imageParseApi.renameScan(shot.sessionId, label);
      } catch {
        toast({ variant: 'destructive', title: 'That name could not be saved' });
      }
    }
  }, []);

  const leaveForLater = useCallback(() => {
    // The batch stays open deliberately: reviewing is a separate sitting, and
    // the parses continue whether or not anybody is watching.
    navigate('/recipes');
    toast({
      title: 'Photographs are being read',
      description: 'You can close Basis — the work carries on, and the results will be waiting.',
    });
  }, [navigate]);

  /**
   * Turn what has been photographed into recipes to look at.
   *
   * Pages wearing the same name become one recipe, joined in the order they
   * were taken. The grouping is decided on the server so it is one rule
   * rather than two.
   */
  const review = useCallback(async () => {
    if (!batchId) return;
    setComposing(true);
    try {
      const { recipes, unread } = await imageParseApi.composeBatch(batchId);
      if (recipes.length === 0) {
        toast({
          title: 'Nothing has been read yet',
          description: 'Give the box a moment, or check back later — it carries on without you.',
        });
        return;
      }
      if (unread > 0) {
        toast({
          title: `${unread} page${unread === 1 ? '' : 's'} could not be read`,
          description: 'The rest are ready. The unreadable ones stay in this batch.',
        });
      }
      setComposed(recipes.map((recipe) => recipe.text));
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not gather those pages', description: (error as Error).message });
    } finally {
      setComposing(false);
    }
  }, [batchId]);

  const statusOf = (shot: Shot) =>
    scans.find((scan) => scan.id === shot.sessionId)?.status ?? null;

  const readyCount = scans.filter((scan) => scan.status === 'review').length;
  const failedCount = scans.filter((scan) => scan.status === 'failed').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Photograph recipes</h1>
          <p className="text-sm text-muted-foreground">
            Take a page at a time. Each one uploads straight away and is read on the box, so you
            can close this when you&apos;re done photographing.
          </p>
        </div>
        {shots.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={leaveForLater}>
              Leave it for later
            </Button>
            <Button onClick={() => void review()} disabled={composing || readyCount === 0}>
              {composing ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Gathering</>
              ) : (
                <><Check className="mr-2 h-4 w-4" /> Review {readyCount || ''} read</>
              )}
            </Button>
          </div>
        )}
      </div>

      {cameraError && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{cameraError}</span>
            <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
              <ImageUp className="mr-2 h-4 w-4" />
              Add photos from this device
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="relative overflow-hidden rounded-xl border bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className={cn('w-full max-h-[55vh] object-contain', !cameraReady && 'opacity-0')}
        />

        {cameraReady && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-4 bg-gradient-to-t from-black/70 to-transparent p-4">
            <Button size="lg" className="rounded-full px-8" onClick={() => void capture()}>
              <Camera className="mr-2 h-5 w-5" />
              Take page
            </Button>
          </div>
        )}
      </div>

      {/* Offered only for the page just taken, which is the moment anybody
          notices the recipe next to it crept into shot. Taking the next page
          quietly withdraws the offer. */}
      {lastShot && !cropping && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCropping(true)}>
            <Crop className="mr-2 h-4 w-4" />
            Crop that page
          </Button>
          <span className="text-xs text-muted-foreground">
            If another recipe crept into the shot.
          </span>
        </div>
      )}

      {lastShot && cropping && (
        <CropOverlay
          imageUrl={lastShot.url}
          busy={savingCrop}
          onCancel={() => setCropping(false)}
          onConfirm={(rect) => void applyCrop(rect)}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => void addFromDevice(event.target.files)}
      />

      {/* A refused page, with the reason and the way out. */}
      {rejected && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <p className="font-medium">
              {!rejected.verdict.usable && rejected.verdict.reason}
            </p>
            <p className="text-sm">{!rejected.verdict.usable && rejected.verdict.advice}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" onClick={() => setRejected(null)}>
                <RotateCw className="mr-2 h-3.5 w-3.5" />
                Take it again
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  // Never a dead end: the judgement is a guess, and the
                  // photographer can see the page and we cannot.
                  void upload(rejected.blob, rejected.thumbnail);
                  setRejected(null);
                }}
              >
                Keep it anyway
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Names already used, so grouping is a choice rather than a retype. */}
      <datalist id="page-names">
        {[...new Set(shots.map((shot) => shot.label))].map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {composed && (
        <BulkImportRecipeDialog
          open
          initialTextEntries={composed}
          onOpenChange={(next) => !next && setComposed(null)}
          onSuccess={() => {
            setComposed(null);
            navigate('/recipes');
          }}
        />
      )}

      {shots.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              {shots.length} page{shots.length === 1 ? '' : 's'} photographed
            </span>
            {readyCount > 0 && <Badge variant="outline">{readyCount} read</Badge>}
            {failedCount > 0 && <Badge variant="destructive">{failedCount} couldn&apos;t be read</Badge>}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {shots.map((shot, index) => {
              const status = statusOf(shot);
              return (
                <div key={shot.key} className="flex items-center gap-3 rounded-lg border p-2">
                  <img
                    src={shot.thumbnail}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded object-cover"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-1">
                      <Input
                        value={shot.label}
                        onChange={(event) => void rename(shot, event.target.value)}
                        className="h-8"
                        aria-label="Name this page"
                        list="page-names"
                      />
                      {/* Two pages of one recipe is the common case — the back
                          of a card — and retyping a name exactly is a poor way
                          to ask for it. */}
                      {index > 0 && shots[index - 1].label !== shot.label && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="shrink-0 px-2 text-xs"
                          title={`Group with "${shots[index - 1].label}"`}
                          onClick={() => void rename(shot, shots[index - 1].label)}
                        >
                          <Link2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {shot.state === 'uploading' && (
                        <span className="flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" /> Sending
                        </span>
                      )}
                      {shot.state === 'failed' && (
                        <span className="flex items-center gap-1 text-destructive">
                          <X className="h-3 w-3" /> {shot.error ?? 'Could not send'}
                        </span>
                      )}
                      {shot.state === 'sent' && status === 'review' && (
                        <span className="flex items-center gap-1 text-success">
                          <Check className="h-3 w-3" /> Read
                        </span>
                      )}
                      {shot.state === 'sent' && status === 'failed' && (
                        <span className="text-destructive">Couldn&apos;t be read</span>
                      )}
                      {shot.state === 'sent' && (status === null || status === 'uploading' || status === 'processing') && (
                        <span className="flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" /> Being read
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
