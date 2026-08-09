import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { receiptsApi, type ReceiptProcessingStage } from '@/api/receipts';

interface ReceiptUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STAGE_LABELS: Record<ReceiptProcessingStage, string> = {
  queued: 'Waiting for a free slot…',
  ocr: 'Reading the receipt…',
  structuring: 'Working out the line items…',
  matching: 'Matching against your inventory…',
  done: 'Done',
};

export function ReceiptUploadDialog({ open, onOpenChange }: ReceiptUploadDialogProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [stage, setStage] = useState<ReceiptProcessingStage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  // Identifies the current upload attempt. Bumped when an attempt starts and
  // again whenever the dialog closes or unmounts, so any async work that
  // resolves later can tell whether it still owns the dialog.
  //
  // A single boolean is not enough here. Close mid-upload, reopen, start a
  // second upload, and the first promise resolves into a flag the second
  // attempt has already re-armed — the stale attempt reads "not cancelled",
  // clobbers pollRef with its own interval, and can navigate to the abandoned
  // scan. Comparing a captured generation against the current one distinguishes
  // "this attempt was cancelled" from "some attempt is active."
  const attemptRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      attemptRef.current += 1;
      stopPolling();
    },
    [stopPolling]
  );

  const reset = useCallback(() => {
    attemptRef.current += 1;
    stopPolling();
    setUploadProgress(0);
    setStage(null);
    setBusy(false);
    setError(null);
  }, [stopPolling]);

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);

    // Claim this attempt. Anything that resolves later compares against this
    // and stays quiet if a newer attempt — or a close — has superseded it.
    const attempt = (attemptRef.current += 1);
    const isCurrent = () => attemptRef.current === attempt;

    try {
      const { id } = await receiptsApi.uploadScan(file, setUploadProgress);

      // Closing the dialog or leaving the page during the upload itself resolves
      // nothing — the promise above still settles. Without this guard we would
      // start an interval nobody is tracking and, minutes later, yank the
      // browser to the review page for a dialog the user already dismissed.
      if (!isCurrent()) return;

      setStage('queued');

      pollRef.current = window.setInterval(async () => {
        try {
          const status = await receiptsApi.getScanStatus(id);
          // A tick already in flight when the dialog closes still resolves;
          // stopPolling only prevents future ones.
          if (!isCurrent()) return;
          setStage(status.processingStage);

          if (status.status === 'review') {
            stopPolling();
            onOpenChange(false);
            navigate(`/inventory/receipts/${id}`);
            reset();
          } else if (status.status === 'failed') {
            stopPolling();
            setBusy(false);
            setError(status.errorMessage ?? 'The receipt could not be read.');
          }
        } catch {
          if (!isCurrent()) return;
          stopPolling();
          setBusy(false);
          setError('Lost contact with the server while the receipt was processing.');
        }
      }, 2000);
    } catch (err) {
      if (!isCurrent()) return;
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Scan a receipt</DialogTitle>
          <DialogDescription>
            Photograph a grocery receipt and we'll match its lines to your inventory. Items you
            match once are remembered for next time.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {busy ? (
          <div className="space-y-3 py-4">
            <Progress value={uploadProgress < 100 ? uploadProgress : undefined} />
            <p className="text-sm text-muted-foreground">
              {uploadProgress < 100
                ? `Uploading… ${uploadProgress}%`
                : stage
                  ? STAGE_LABELS[stage]
                  : 'Processing…'}
            </p>
            <p className="text-xs text-muted-foreground">
              A long receipt can take a couple of minutes. You can close this and come back to it
              from the receipts list.
            </p>
          </div>
        ) : (
          <div className="py-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <Button className="w-full" onClick={() => fileInputRef.current?.click()}>
              <Camera className="mr-2 h-4 w-4" />
              Take photo or choose a file
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {busy ? 'Close (keeps processing)' : 'Cancel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
