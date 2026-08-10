import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
import { AlertTriangle, ChevronDown, Cpu, Download, MonitorX } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { GuidedInstallDialog } from '@/components/settings/GuidedInstallDialog';
import { ModelRoleSection, PullProgressRow } from '@/components/settings/ModelRoleSection';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import {
  llmApi,
  connectLlmSocket,
  cancelPull,
  isTagInstalled,
  normalizeTag,
  type HardwareProfile,
  type LlmStatus,
  type ModelRole,
  type PullState,
} from '@/api/llm';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/api-error';
import { cn } from '@/lib/utils';

/** How long to keep polling `status` after an install click before giving up
 *  on auto-selecting and telling the user it's still going in the background.
 *  Kept as a last-resort fallback for the unlikely case a pull's terminal
 *  event never arrives (e.g. the socket was down the whole time) — the
 *  normal path now resolves immediately off `pull:progress` over the /llm
 *  socket instead of waiting on this timeout. */
const INSTALL_POLL_TIMEOUT_MS = 5 * 60 * 1000;

/** MB → a rounded "N GB" string, dropping a trailing ".0". */
function formatGb(mb: number): string {
  const gb = Math.round((mb / 1024) * 10) / 10;
  return `${gb} GB`;
}

/**
 * The plain-language diagnosis sentence. `gpu` and `gpuNameFromPci` are kept
 * separate by the backend on purpose: lspci sees the card even with no driver
 * loaded, so a card can be present (`gpuNameFromPci`) while `gpu` is null.
 * Collapsing that distinction reports "no GPU" on a machine that has one —
 * this is the exact state of the production box (RTX 3050 + nouveau).
 */
function describeHardware(hw: HardwareProfile): string {
  const ram = `${formatGb(hw.ramTotalMb)} system RAM`;
  const cores = `${hw.cpuCores} core${hw.cpuCores === 1 ? '' : 's'}`;

  if (hw.driverState === 'ok' && hw.gpu) {
    return `${hw.gpu.name}, ${formatGb(hw.gpu.vramTotalMb)} VRAM · ${ram} · ${cores}.`;
  }

  if (hw.gpuNameFromPci) {
    const why =
      hw.driverState === 'nouveau'
        ? 'only the open-source nouveau driver is loaded — it can\'t run inference'
        : 'no NVIDIA driver is loaded';
    return `${hw.gpuNameFromPci} detected, but ${why} · ${ram} · ${cores}.`;
  }

  return `No GPU detected · ${ram} · ${cores}.`;
}

function HardwareSummaryCard({ hw }: { hw: HardwareProfile }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-5 w-5" />
          Hardware
        </CardTitle>
        <CardDescription>What this server can run models on.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm">{describeHardware(hw)}</p>
        {!hw.hasAvx2 && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {/* AVX2 is a CPU instruction set, not memory. */}
            <Cpu className="h-3.5 w-3.5" />
            This CPU lacks AVX2 — CPU-only inference will be noticeably slower.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function DriverBlockerCard({ hw }: { hw: HardwareProfile }) {
  if (hw.driverState === 'ok' || !hw.gpuNameFromPci) return null;

  const title =
    hw.driverState === 'nouveau'
      ? `${hw.gpuNameFromPci} is using the open-source nouveau driver`
      : `${hw.gpuNameFromPci} has no NVIDIA driver installed`;

  return (
    <Alert variant="destructive">
      <MonitorX className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          Ollama needs the proprietary NVIDIA driver to use this GPU. Nouveau (or no driver at
          all) means models will fall back to the CPU — much slower, and some larger models won't
          fit in RAM at all.
        </p>
        <div className="rounded-md border bg-muted/50 p-3 font-mono text-xs">
          <div>sudo ubuntu-drivers install</div>
          <div>sudo reboot</div>
        </div>
        <p className="flex items-center gap-1.5 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Installing the driver requires a reboot to take effect. Run this from a terminal on the
          server when a reboot is convenient — not from here, since a reboot would also drop this
          page.
        </p>
      </AlertDescription>
    </Alert>
  );
}

function OllamaBlockerCard({ onSuccess }: { onSuccess: () => void }) {
  const [installOpen, setInstallOpen] = useState(false);

  return (
    <>
      <Alert variant="destructive">
        <Download className="h-4 w-4" />
        <AlertTitle>Ollama is not reachable</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            Ollama runs the local models this server uses for receipt parsing and photo
            understanding. It isn't installed, or isn't running.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setInstallOpen(true)}>
              Install Ollama
            </Button>
          </div>
        </AlertDescription>
      </Alert>
      <GuidedInstallDialog
        open={installOpen}
        onOpenChange={setInstallOpen}
        commandId="ollama"
        title="Install Ollama"
        description="Runs Ollama's official install script. You'll be prompted for your sudo password — Ollama installs as a system service."
        onSuccess={onSuccess}
      />
    </>
  );
}

/**
 * Two models that each fit alone may not fit together — this is the entire
 * reason the backend computes footprint jointly rather than per-model. When
 * they don't fit, Ollama swaps between them on demand rather than failing,
 * but that swap costs ~10s on first use after idle, so it's worth spelling
 * out with the real numbers rather than a generic warning.
 */
function describeFootprint(footprint: LlmStatus['footprint'], hw: HardwareProfile): string | null {
  if (!footprint.exceedsVram || !hw.gpu) return null;
  const needed = formatGb(footprint.totalVramMb);
  const have = formatGb(hw.gpu.vramTotalMb);
  return (
    `Your two selections need ${needed} of VRAM together; your card has ${have}. ` +
    `They'll work — Ollama swaps between them — but expect about 10 seconds extra ` +
    `on the first use after idle.`
  );
}

function FootprintNotice({ footprint, hw }: { footprint: LlmStatus['footprint']; hw: HardwareProfile }) {
  const message = describeFootprint(footprint, hw);
  if (!message) return null;

  return (
    <Alert>
      <AlertTriangle className="h-4 w-4 text-warning" />
      <AlertTitle>Your selected models won't both fit in VRAM at once</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/** One entry per tag currently being pulled, so two roles can install
 *  concurrently without clobbering each other's tracking. */
interface InstallEntry {
  role: ModelRole;
  startedAt: number;
}

export function AiModelsSettingsPage() {
  const queryClient = useQueryClient();

  const [installing, setInstalling] = useState<Map<string, InstallEntry>>(new Map());
  const [removeTarget, setRemoveTarget] = useState<{ tag: string; role: ModelRole } | null>(null);
  // Live pull progress from the /llm socket, keyed by tag (matches `installing`
  // and the catalog). Holds only pulls that are currently 'running' — terminal
  // events remove their entry once handled (see the socket effect below), so a
  // row's presence here is exactly "show the progress bar, not the button."
  const [pullProgress, setPullProgress] = useState<Map<string, PullState>>(new Map());
  const socketRef = useRef<Socket | null>(null);
  // Advanced field: the tag currently locked in as pulling, if any. Cleared
  // by the socket effect once that tag's pull reaches a terminal state.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedTag, setAdvancedTag] = useState('');
  const [advancedPullTag, setAdvancedPullTag] = useState<string | null>(null);
  const advancedPullTagRef = useRef<string | null>(null);
  useEffect(() => {
    advancedPullTagRef.current = advancedPullTag;
  }, [advancedPullTag]);

  const { data: hardware, isLoading: hardwareLoading } = useQuery({
    queryKey: ['llm', 'hardware'],
    queryFn: llmApi.getHardware,
  });

  const { data: catalog, isLoading: catalogLoading } = useQuery({
    queryKey: ['llm', 'catalog'],
    queryFn: llmApi.getCatalog,
  });

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['llm', 'status'],
    queryFn: llmApi.getStatus,
    // The socket effect below invalidates this query the instant a pull
    // reports 'done', so this poll rarely does the work in practice — it's
    // the fallback for a socket that never delivers a terminal event.
    refetchInterval: installing.size > 0 ? 2000 : false,
  });

  const invalidateStatus = () => {
    queryClient.invalidateQueries({ queryKey: ['llm', 'status'] });
  };

  const selectMutation = useMutation({
    mutationFn: ({ role, tag }: { role: ModelRole; tag: string }) =>
      llmApi.setModels(role === 'text' ? { textModel: tag } : { visionModel: tag }),
    onSuccess: (_data, { tag }) => {
      invalidateStatus();
      toast({ title: 'Model selected', description: tag });
    },
    onError: (err) => {
      toast({
        title: 'Could not select model',
        description: getErrorMessage(err),
        variant: 'destructive',
      });
    },
  });

  const installMutation = useMutation({
    mutationFn: (tag: string) => llmApi.pullModel(tag),
    onError: (err, tag) => {
      setInstalling((prev) => {
        if (!prev.has(tag)) return prev;
        const next = new Map(prev);
        next.delete(tag);
        return next;
      });
      toast({
        title: `Could not start installing ${tag}`,
        description: getErrorMessage(err),
        variant: 'destructive',
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (tag: string) => llmApi.deleteModel(tag),
    onSuccess: (_data, tag) => {
      invalidateStatus();
      setRemoveTarget(null);
      toast({ title: 'Model removed', description: tag });
    },
    onError: (err) => {
      setRemoveTarget(null);
      toast({
        title: 'Could not remove model',
        description: getErrorMessage(err),
        variant: 'destructive',
      });
    },
  });

  // Detect each in-flight install landing (polled via `status` above) and
  // chain its select automatically — "one click, two operations", tracked
  // per-tag so installing a text model and a vision model at once each
  // resolve independently rather than one clobbering the other's tracking.
  // If a given tag is still not installed after a long while, stop polling
  // it and say so rather than spinning forever; the pull itself keeps going
  // on the server regardless — we just lose the ability to tell.
  useEffect(() => {
    if (installing.size === 0 || !status) return;

    const now = Date.now();
    let changed = false;
    const next = new Map(installing);

    for (const [tag, entry] of installing) {
      // Normalised: Ollama reports a pulled `moondream` as `moondream:latest`,
      // so a raw includes() would never match and the row would spin until the
      // timeout, then revert to "Install" on a model that installed fine.
      if (isTagInstalled(status.installed, tag)) {
        next.delete(tag);
        changed = true;
        selectMutation.mutate({ role: entry.role, tag });
        continue;
      }

      if (now - entry.startedAt > INSTALL_POLL_TIMEOUT_MS) {
        next.delete(tag);
        changed = true;
        toast({
          title: 'Still installing',
          description: `${tag} may still be downloading, or it may have failed. Try again if it doesn't appear shortly.`,
        });
      }
    }

    if (changed) setInstalling(next);
    // selectMutation is stable across renders (from useMutation); omitting it
    // avoids re-running this effect on every mutation state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, installing]);

  // Live pull progress over the /llm socket namespace — same connection
  // pattern as the /install namespace used by the guided-install terminal
  // (PtyTerminal / GuidedInstallDialog): session cookie carries auth, no
  // token plumbing. On connect the server replays any pull still running,
  // so a refresh mid-download picks progress back up instead of looking
  // idle. Connects once per mount and disconnects on unmount — a settings
  // page users visit and leave repeatedly shouldn't leak sockets.
  useEffect(() => {
    const socket = connectLlmSocket();
    socketRef.current = socket;

    socket.on('pull:progress', (state: PullState) => {
      setPullProgress((prev) => {
        const next = new Map(prev);
        if (state.state === 'running') {
          next.set(state.tag, state);
        } else {
          next.delete(state.tag);
        }
        return next;
      });

      if (state.state === 'failed' || state.state === 'cancelled') {
        // A real signal, not a guess: clear the tag from `installing`
        // immediately instead of waiting on the timeout, and show Ollama's
        // own message verbatim — it distinguishes disk-full from
        // network-refused, which a generic "pull failed" would not.
        setInstalling((prev) => {
          if (!prev.has(state.tag)) return prev;
          const next = new Map(prev);
          next.delete(state.tag);
          return next;
        });
        toast({
          title: state.state === 'failed' ? `${state.tag} failed to install` : 'Install cancelled',
          description:
            state.state === 'failed'
              ? (state.error ?? 'The pull ended without a specific error.')
              : `${state.tag} was cancelled.`,
          variant: state.state === 'failed' ? 'destructive' : undefined,
        });
      }

      if (state.state === 'done') {
        queryClient.invalidateQueries({ queryKey: ['llm', 'status'] });
      }

      if (state.state !== 'running' && advancedPullTagRef.current === state.tag) {
        setAdvancedPullTag(null);
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // Mount-once: queryClient and toast are stable across renders. Re-running
    // this per-render would tear down and reopen the socket constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancelPull = (pullId: string) => {
    if (socketRef.current) cancelPull(socketRef.current, pullId);
  };

  const handleAdvancedPull = () => {
    const tag = advancedTag.trim();
    if (!tag) return;
    setAdvancedPullTag(tag);
    installMutation.mutate(tag, { onError: () => setAdvancedPullTag(null) });
  };

  const handleInstall = (role: ModelRole, tag: string) => {
    setInstalling((prev) => {
      const next = new Map(prev);
      next.set(tag, { role, startedAt: Date.now() });
      return next;
    });
    installMutation.mutate(tag);
  };

  const handleSelect = (role: ModelRole, tag: string) => {
    selectMutation.mutate({ role, tag });
  };

  const handleRemoveRequest = (role: ModelRole, tag: string) => {
    setRemoveTarget({ tag, role });
  };

  // Scoped to this field's own pull. `installMutation` is shared with the
  // catalog rows, so gating on its isPending greyed out the advanced input
  // whenever any row was installing — two unrelated operations blocking each
  // other. Set on click, cleared by the socket effect on the terminal event
  // (or by the mutation's onError).
  const advancedPullPending = advancedPullTag !== null;

  const busyTags = useMemo(() => {
    const tags = new Set(installing.keys());
    if (selectMutation.isPending && selectMutation.variables) {
      tags.add(selectMutation.variables.tag);
    }
    if (removeMutation.isPending && removeMutation.variables) {
      tags.add(removeMutation.variables);
    }
    return tags;
  }, [installing, selectMutation.isPending, selectMutation.variables, removeMutation.isPending, removeMutation.variables]);

  if (hardwareLoading || statusLoading || catalogLoading || !hardware || !status || !catalog) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  const textModels = catalog.models.filter((m) => m.role === 'text');
  const visionModels = catalog.models.filter((m) => m.role === 'vision');
  const actionsDisabled = !status.reachable;

  // Tags Ollama reports that the catalog doesn't cover — pulled through the
  // advanced field, possibly in an earlier session. Without a row of their own
  // no control anywhere can select them, so the pull only consumes disk. The
  // role of an arbitrary tag can't be inferred from its name, so they appear
  // under both sections and the admin picks.
  const uncataloguedTags = status.installed.filter(
    (tag) => !catalog.models.some((m) => normalizeTag(m.tag) === normalizeTag(tag))
  );

  return (
    <div className="space-y-6">
      <HardwareSummaryCard hw={hardware} />

      <DriverBlockerCard hw={hardware} />

      {!status.reachable && <OllamaBlockerCard onSuccess={invalidateStatus} />}

      <ModelRoleSection
        role="text"
        title="Receipt & text understanding"
        description="Parses receipt text into line items — prices, quantities, store names."
        models={textModels}
        extraTags={uncataloguedTags}
        status={status}
        disabled={actionsDisabled}
        busyTags={busyTags}
        pullProgress={pullProgress}
        onCancelPull={handleCancelPull}
        onSelect={(tag) => handleSelect('text', tag)}
        onInstall={(tag) => handleInstall('text', tag)}
        onRemove={(tag) => handleRemoveRequest('text', tag)}
      />

      <ModelRoleSection
        role="vision"
        title="Image understanding"
        description="Reads photos — recipes, handwritten lists, receipts you snap instead of scan."
        models={visionModels}
        extraTags={uncataloguedTags}
        status={status}
        disabled={actionsDisabled}
        busyTags={busyTags}
        pullProgress={pullProgress}
        onCancelPull={handleCancelPull}
        onSelect={(tag) => handleSelect('vision', tag)}
        onInstall={(tag) => handleInstall('vision', tag)}
        onRemove={(tag) => handleRemoveRequest('vision', tag)}
      />

      <FootprintNotice footprint={status.footprint} hw={hardware} />

      <Card>
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CardHeader className="pb-3">
            <CollapsibleTrigger className="flex w-full items-center justify-between text-left">
              <div>
                <CardTitle className="text-base">Advanced</CardTitle>
                <CardDescription>Pull any Ollama tag, not just the catalog above.</CardDescription>
              </div>
              <ChevronDown
                className={cn(
                  'h-5 w-5 shrink-0 text-muted-foreground transition-transform',
                  advancedOpen && 'rotate-180'
                )}
              />
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-3 pt-0">
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Fit can&apos;t be predicted for a tag outside the catalog above — there&apos;s no
                  size on file for it. If it&apos;s too large for this machine, the pull will
                  succeed but the model will simply fail to load. Only pull a tag you already know
                  fits. Once it&apos;s pulled it appears under &ldquo;Also installed on this
                  server&rdquo; in both sections above, ready to select for either role.
                </AlertDescription>
              </Alert>

              {advancedPullTag && pullProgress.get(advancedPullTag) ? (
                <div className="max-w-sm space-y-1.5">
                  <p className="text-sm font-medium">{advancedPullTag}</p>
                  <PullProgressRow
                    progress={pullProgress.get(advancedPullTag)!}
                    onCancel={handleCancelPull}
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="advanced-tag">Model tag</Label>
                    <Input
                      id="advanced-tag"
                      placeholder="e.g. llama3.1:8b-instruct-q4_K_M"
                      value={advancedTag}
                      onChange={(e) => setAdvancedTag(e.target.value)}
                      disabled={actionsDisabled || advancedPullPending}
                    />
                  </div>
                  <Button
                    onClick={handleAdvancedPull}
                    disabled={actionsDisabled || !advancedTag.trim() || advancedPullPending}
                  >
                    Pull
                  </Button>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title="Remove this model?"
        description={
          removeTarget
            ? `${removeTarget.tag} will be deleted from disk. You can reinstall it later, but that means downloading it again.`
            : undefined
        }
        confirmText="Remove"
        variant="destructive"
        isPending={removeMutation.isPending}
        onConfirm={() => {
          if (removeTarget) removeMutation.mutate(removeTarget.tag);
        }}
      />
    </div>
  );
}
