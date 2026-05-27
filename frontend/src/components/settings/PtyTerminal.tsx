import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { io, type Socket } from 'socket.io-client';
import { Button } from '@/components/ui/button';
import { Loader2, RotateCcw } from 'lucide-react';

interface PtyTerminalProps {
  /** Allowlisted command id from the backend installer-commands.ts. */
  commandId: string;
  /** Optional className for the container. Defaults to a sensible height. */
  className?: string;
}

/**
 * Lean embedded terminal: connects to the /install socket.io namespace,
 * spawns the named command in a PTY, streams I/O to an xterm. Unlike
 * GuidedInstallDialog this doesn't track phases or surface success state —
 * the shell stays open until the user reconnects or navigates away.
 */
export function PtyTerminal({ commandId, className }: PtyTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // Bumping this remounts the effect and reconnects the socket — used by
  // the "Reset session" button after the shell exits or hangs.
  const [generation, setGeneration] = useState(0);
  const [status, setStatus] = useState<'connecting' | 'live' | 'exited' | 'error'>(
    'connecting'
  );

  useEffect(() => {
    setStatus('connecting');

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      theme: { background: '#0a0a0a' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);

    const attachTimer = setTimeout(() => {
      if (!containerRef.current) return;
      term.open(containerRef.current);
      fit.fit();

      const socket = io('/install', { withCredentials: true });
      socketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('start', { id: commandId, cols: term.cols, rows: term.rows });
      });

      socket.on('ready', () => setStatus('live'));
      socket.on('data', (data: string) => term.write(data));

      socket.on('exit', ({ code }: { code: number }) => {
        setStatus('exited');
        term.writeln(`\r\n\x1b[90m[shell exited with code ${code}]\x1b[0m`);
      });

      socket.on('error', (err: { message: string }) => {
        setStatus('error');
        term.writeln(`\r\n\x1b[31m[error] ${err.message}\x1b[0m`);
      });

      socket.on('connect_error', () => setStatus('error'));

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
        /* not mounted */
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
  }, [commandId, generation]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {status === 'connecting' && (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Connecting…
            </span>
          )}
          {status === 'live' && <span>● Connected</span>}
          {status === 'exited' && <span>Shell exited</span>}
          {status === 'error' && <span className="text-destructive">Connection error</span>}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setGeneration((g) => g + 1)}
          disabled={status === 'connecting'}
        >
          <RotateCcw className="mr-2 h-3 w-3" />
          Reset session
        </Button>
      </div>
      <div
        ref={containerRef}
        className={className ?? 'h-[500px] w-full overflow-hidden rounded-md bg-black p-2'}
      />
    </div>
  );
}
