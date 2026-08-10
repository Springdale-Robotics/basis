import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Cpu, Download, MemoryStick, MonitorX } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { GuidedInstallDialog } from '@/components/settings/GuidedInstallDialog';
import { ModelRoleSection } from '@/components/settings/ModelRoleSection';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { llmApi, type HardwareProfile, type LlmStatus, type ModelRole } from '@/api/llm';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/api-error';

/** How long to keep polling `status` after an install click before giving up
 *  on auto-selecting and telling the user it's still going in the background.
 *  Task 12 replaces this poll with real progress over the /llm socket. */
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
            <MemoryStick className="h-3.5 w-3.5" />
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

export function AiModelsSettingsPage() {
  const queryClient = useQueryClient();

  const [installingTag, setInstallingTag] = useState<string | null>(null);
  const [installingRole, setInstallingRole] = useState<ModelRole | null>(null);
  const installStartedAtRef = useRef<number | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ tag: string; role: ModelRole } | null>(null);

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
    // Poll while an install is in flight so we notice the model land and can
    // auto-select it — the only "progress" this task builds; Task 12 swaps
    // this for the real thing over the /llm socket.
    refetchInterval: installingTag ? 2000 : false,
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
      setInstallingTag(null);
      setInstallingRole(null);
      installStartedAtRef.current = null;
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

  // Detect an in-flight install landing (polled via `status` above) and chain
  // the select automatically — "one click, two operations". If it's still not
  // installed after a long while, stop polling and say so rather than
  // spinning forever; the pull itself keeps going on the server regardless.
  useEffect(() => {
    if (!installingTag || !installingRole || !status) return;

    if (status.installed.includes(installingTag)) {
      const tag = installingTag;
      const role = installingRole;
      setInstallingTag(null);
      setInstallingRole(null);
      installStartedAtRef.current = null;
      selectMutation.mutate({ role, tag });
      return;
    }

    const startedAt = installStartedAtRef.current;
    if (startedAt && Date.now() - startedAt > INSTALL_POLL_TIMEOUT_MS) {
      const tag = installingTag;
      setInstallingTag(null);
      setInstallingRole(null);
      installStartedAtRef.current = null;
      toast({
        title: 'Still downloading',
        description: `${tag} hasn't finished downloading yet — larger models can take a while. It's still going in the background; check back shortly.`,
      });
    }
    // selectMutation is stable across renders (from useMutation); omitting it
    // avoids re-running this effect on every mutation state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, installingTag, installingRole]);

  const handleInstall = (role: ModelRole, tag: string) => {
    installStartedAtRef.current = Date.now();
    setInstallingRole(role);
    setInstallingTag(tag);
    installMutation.mutate(tag);
  };

  const handleSelect = (role: ModelRole, tag: string) => {
    selectMutation.mutate({ role, tag });
  };

  const handleRemoveRequest = (role: ModelRole, tag: string) => {
    setRemoveTarget({ tag, role });
  };

  const busyTag =
    installingTag ??
    (selectMutation.isPending ? selectMutation.variables?.tag ?? null : null) ??
    (removeMutation.isPending ? (removeMutation.variables as string | undefined) ?? null : null);

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
        status={status}
        disabled={actionsDisabled}
        busyTag={busyTag}
        onSelect={(tag) => handleSelect('text', tag)}
        onInstall={(tag) => handleInstall('text', tag)}
        onRemove={(tag) => handleRemoveRequest('text', tag)}
      />

      <ModelRoleSection
        role="vision"
        title="Image understanding"
        description="Reads photos — recipes, handwritten lists, receipts you snap instead of scan."
        models={visionModels}
        status={status}
        disabled={actionsDisabled}
        busyTag={busyTag}
        onSelect={(tag) => handleSelect('vision', tag)}
        onInstall={(tag) => handleInstall('vision', tag)}
        onRemove={(tag) => handleRemoveRequest('vision', tag)}
      />

      <FootprintNotice footprint={status.footprint} hw={hardware} />

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
