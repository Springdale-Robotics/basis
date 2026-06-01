import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { io, type Socket } from 'socket.io-client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle2, ExternalLink, Loader2, XCircle } from 'lucide-react';

interface GuidedInstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commandId: string;
  title: string;
  description: string;
  /** Fires after the PTY exits successfully (exit code 0; postCheck passes if defined). */
  onSuccess?: () => void;
}

interface ExitInfo {
  code: number;
  postCheckOk?: boolean;
}

// Detects a Tailscale auth URL printed by `tailscale up` (and the install
// script that runs it). Surfaced as a clickable button so the user doesn't
// have to right-click → copy → open.
const TAILSCALE_AUTH_RE = /https:\/\/login\.tailscale\.com\/[^\s\r\n]+/;

export function GuidedInstallDialog({
  open,
  onOpenChange,
  commandId,
  title,
  description,
  onSuccess,
}: GuidedInstallDialogProps) {
  const termContainerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<Socket | null>(null);
  // Stash the callback in a ref so changing parent props doesn't tear down
  // and re-spawn the PTY on every re-render.
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  const [phase, setPhase] = useState<
    'idle' | 'connecting' | 'running' | 'done' | 'error'
  >('idle');
  const [exitInfo, setExitInfo] = useState<ExitInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);

  // Reset state when dialog opens. We re-create the terminal each open rather
  // than try to keep state — keeps the lifecycle obvious and matches the
  // user's mental model of "this is a fresh run."
  useEffect(() => {
    if (!open) return;

    setPhase('connecting');
    setExitInfo(null);
    setErrorMessage(null);
    setAuthUrl(null);

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      theme: { background: '#0a0a0a' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);

    // Defer attach until container is mounted.
    const attachTimer = setTimeout(() => {
      if (!termContainerRef.current) return;
      term.open(termContainerRef.current);
      fit.fit();

      // No auto-reconnect: commands like `update-self` deliberately restart the
      // backend, which drops this socket. With reconnection on (the default),
      // socket.io would reconnect to the new backend, fire `connect` again, and
      // re-emit `start` — re-running the ENTIRE update in a loop every time the
      // backend restarts, until the user closes the dialog. A dropped socket
      // here means "the command finished / the server is restarting," not
      // "retry the command."
      const socket = io('/install', { withCredentials: true, reconnection: false });
      socketRef.current = socket;

      // Guard against any stray duplicate `connect` — only ever start once.
      let started = false;
      socket.on('connect', () => {
        if (started) return;
        started = true;
        socket.emit('start', {
          id: commandId,
          cols: term.cols,
          rows: term.rows,
        });
      });

      socket.on('ready', () => {
        setPhase('running');
      });

      socket.on('data', (data: string) => {
        term.write(data);
        const match = data.match(TAILSCALE_AUTH_RE);
        if (match) setAuthUrl(match[0]);
      });

      socket.on('exit', (info: ExitInfo) => {
        setExitInfo(info);
        const ok =
          info.code === 0 && (info.postCheckOk === undefined || info.postCheckOk);
        setPhase(ok ? 'done' : 'error');
        if (ok) onSuccessRef.current?.();
      });

      // `update-self` deliberately restarts the backend. Normally its script
      // exits (emitting `exit`) ~3s before the detached restart fires, so the
      // happy path resolves via `exit`. But if the restart races ahead and
      // drops this socket while still 'running', treat that as success
      // ("backend restarting onto the new version") instead of a perpetual
      // spinner. Scope strictly to update-self: for other commands a mid-run
      // disconnect is an interruption, not success.
      if (commandId === 'update-self') {
        socket.on('disconnect', (reason) => {
          // Ignore client-initiated disconnects (dialog close / unmount).
          if (reason === 'io client disconnect') return;
          setPhase((p) => {
            if (p === 'running') {
              term.writeln('\r\n\x1b[32m[connection closed — backend is restarting]\x1b[0m');
              onSuccessRef.current?.();
              return 'done';
            }
            return p;
          });
        });
      }

      socket.on('error', (err: { message: string }) => {
        setErrorMessage(err.message);
        setPhase('error');
        term.writeln(`\r\n\x1b[31m[error] ${err.message}\x1b[0m`);
      });

      socket.on('connect_error', (err) => {
        setErrorMessage(err.message);
        setPhase('error');
      });

      term.onData((data) => {
        socket.emit('data', data);
      });
    }, 0);

    termRef.current = term;
    fitRef.current = fit;

    const onResize = () => {
      try {
        fitRef.current?.fit();
        const t = termRef.current;
        const s = socketRef.current;
        if (t && s?.connected) {
          s.emit('resize', { cols: t.cols, rows: t.rows });
        }
      } catch {
        /* xterm not ready */
      }
    };
    window.addEventListener('resize', onResize);

    return () => {
      clearTimeout(attachTimer);
      window.removeEventListener('resize', onResize);
      socketRef.current?.emit('stop');
      socketRef.current?.disconnect();
      socketRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [open, commandId]);

  const isRunning = phase === 'running' || phase === 'connecting';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && isRunning) {
          // Block accidental close while running — user can use Cancel.
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {authUrl && phase === 'running' && (
          <Alert>
            <ExternalLink className="h-4 w-4" />
            <AlertTitle>Tailscale wants you to sign in</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>Open this URL on any device to authorize this machine:</p>
              <Button asChild size="sm" variant="outline">
                <a href={authUrl} target="_blank" rel="noreferrer">
                  Open Tailscale auth page <ExternalLink className="ml-2 h-3 w-3" />
                </a>
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {phase === 'done' && (
          <Alert>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertTitle>Install completed</AlertTitle>
            <AlertDescription>
              Exit code {exitInfo?.code}. You can close this window.
            </AlertDescription>
          </Alert>
        )}

        {phase === 'error' && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Install did not complete</AlertTitle>
            <AlertDescription>
              {errorMessage ??
                (exitInfo
                  ? `Exit code ${exitInfo.code}${
                      exitInfo.postCheckOk === false ? ' (post-install check failed)' : ''
                    }.`
                  : 'Unknown error.')}
            </AlertDescription>
          </Alert>
        )}

        <div
          ref={termContainerRef}
          className="h-80 w-full overflow-hidden rounded-md bg-black p-2"
        />

        <DialogFooter>
          {isRunning ? (
            <Button
              variant="outline"
              onClick={() => {
                socketRef.current?.emit('stop');
              }}
            >
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Running…
            </Button>
          ) : (
            <Button onClick={() => onOpenChange(false)}>
              {phase === 'done' ? 'Done' : 'Close'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
