import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Cpu, Download, MemoryStick, MonitorX } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { GuidedInstallDialog } from '@/components/settings/GuidedInstallDialog';
import { llmApi, type HardwareProfile } from '@/api/llm';

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

export function AiModelsSettingsPage() {
  const queryClient = useQueryClient();

  const { data: hardware, isLoading: hardwareLoading } = useQuery({
    queryKey: ['llm', 'hardware'],
    queryFn: llmApi.getHardware,
  });

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['llm', 'status'],
    queryFn: llmApi.getStatus,
  });

  const invalidateStatus = () => {
    queryClient.invalidateQueries({ queryKey: ['llm', 'status'] });
  };

  if (hardwareLoading || statusLoading || !hardware || !status) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <HardwareSummaryCard hw={hardware} />

      <DriverBlockerCard hw={hardware} />

      {!status.reachable && <OllamaBlockerCard onSuccess={invalidateStatus} />}
    </div>
  );
}
