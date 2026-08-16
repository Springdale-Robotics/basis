import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Check, Loader2, AlertCircle, X, RotateCw, ImageUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { imageParseApi, type BatchScan } from '@/api/image-parse';
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
    async (blob: Blob, thumbnail: string) => {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const label = `Recipe ${shots.length + 1}`;
      setShots((prev) => [...prev, { key, label, thumbnail, state: 'uploading' }]);

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
      } catch (error) {
        setShots((prev) =>
          prev.map((shot) =>
            shot.key === key
              ? { ...shot, state: 'failed', error: (error as Error).message }
              : shot
          )
        );
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
    void upload(blob, thumbnail);
  }, [upload]);

  /** For devices where the camera cannot be opened in the page. */
  const addFromDevice = useCallback(
    (files: FileList | null) => {
      for (const file of Array.from(files ?? [])) {
        void upload(file, URL.createObjectURL(file));
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

  const finish = useCallback(() => {
    // The batch stays open deliberately: reviewing is a separate sitting, and
    // the parses continue whether or not anybody is watching.
    navigate('/recipes');
    toast({
      title: 'Photographs are being read',
      description: 'You can close Basis — the work carries on, and the results will be waiting.',
    });
  }, [navigate]);

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
          <Button onClick={finish}>
            <Check className="mr-2 h-4 w-4" />
            Done photographing
          </Button>
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

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => addFromDevice(event.target.files)}
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
            {shots.map((shot) => {
              const status = statusOf(shot);
              return (
                <div key={shot.key} className="flex items-center gap-3 rounded-lg border p-2">
                  <img
                    src={shot.thumbnail}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded object-cover"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <Input
                      value={shot.label}
                      onChange={(event) => void rename(shot, event.target.value)}
                      className="h-8"
                      aria-label="Name this page"
                    />
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
