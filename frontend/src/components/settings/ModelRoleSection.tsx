import { AlertTriangle, Check, Loader2, X } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { cn, formatFileSize } from '@/lib/utils';
import type { CatalogEntry, FitVerdict, LlmStatus, ModelRole, PullState } from '@/api/llm';

/** MB → a rounded "N GB" string, dropping a trailing ".0". Mirrors the copy
 *  used for hardware VRAM elsewhere on this page. */
function formatGb(mb: number): string {
  const gb = Math.round((mb / 1024) * 10) / 10;
  return `${gb} GB`;
}

const FIT_BADGE: Record<
  FitVerdict,
  { variant: 'default' | 'secondary' | 'outline'; label: string; className?: string }
> = {
  recommended: { variant: 'default', label: 'Recommended' },
  fits: { variant: 'secondary', label: 'Works on your GPU' },
  'cpu-only': {
    variant: 'outline',
    label: 'CPU only — expect minutes per scan, not seconds',
  },
  'too-large': {
    variant: 'outline',
    label: 'Too large for this machine',
    className: 'border-destructive text-destructive',
  },
};

function FitBadge({ fit }: { fit: FitVerdict }) {
  const { variant, label, className } = FIT_BADGE[fit];
  return (
    <Badge variant={variant} className={cn('whitespace-normal font-normal', className)}>
      {label}
    </Badge>
  );
}

/**
 * Live progress for one pull: bytes downloaded, Ollama's current phase, and
 * a Cancel control. Shared between a catalog row (ModelRow, below) and the
 * advanced tag field, which pulls tags outside the catalog and so has no row
 * of its own to attach to.
 */
export function PullProgressRow({
  progress,
  onCancel,
}: {
  progress: PullState;
  onCancel: (pullId: string) => void;
}) {
  const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="capitalize">{progress.status || 'starting'}</span>
        <span>
          {progress.total > 0
            ? `${formatFileSize(progress.completed)} / ${formatFileSize(progress.total)}`
            : formatFileSize(progress.completed)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Progress value={pct} className="h-2" />
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
          onClick={() => onCancel(progress.id)}
          title="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export interface ModelRoleSectionProps {
  role: ModelRole;
  title: string;
  description: string;
  models: CatalogEntry[];
  status: LlmStatus;
  /** Select an already-installed model for this role. */
  onSelect: (tag: string) => void;
  /** Install an uninstalled model. The caller selects it once installed —
   *  one click, two operations. */
  onInstall: (tag: string) => void;
  /** Request removal (the caller confirms before actually deleting). */
  onRemove: (tag: string) => void;
  /** True when Ollama is unreachable — actions are disabled, catalog stays visible. */
  disabled?: boolean;
  /** Tags currently mid-operation (install, select, or remove). A set, not a
   *  single tag, so installing a text model and a vision model at once can
   *  each show their own busy state. */
  busyTags?: Set<string>;
  /** Live progress for tags currently being pulled, keyed by tag. A running
   *  entry replaces that row's action button with a progress bar. */
  pullProgress?: Map<string, PullState>;
  /** Emits `pull:cancel` for the given pull id. */
  onCancelPull?: (pullId: string) => void;
}

function ModelRow({
  model,
  role,
  status,
  disabled,
  busyTags,
  pullProgress,
  onSelect,
  onInstall,
  onRemove,
  onCancelPull,
}: {
  model: CatalogEntry;
  role: ModelRole;
  status: LlmStatus;
  disabled?: boolean;
  busyTags?: Set<string>;
  pullProgress?: Map<string, PullState>;
  onSelect: (tag: string) => void;
  onInstall: (tag: string) => void;
  onRemove: (tag: string) => void;
  onCancelPull?: (pullId: string) => void;
}) {
  const isInstalled = status.installed.includes(model.tag);
  const isSelected = status.selected[role] === model.tag;
  const isBusy = busyTags?.has(model.tag) ?? false;
  const actionsDisabled = Boolean(disabled) || isBusy;
  const progress = pullProgress?.get(model.tag);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{model.label}</span>
          <FitBadge fit={model.fit} />
        </div>
        <p className="text-xs text-muted-foreground">
          {formatFileSize(model.downloadBytes)} download · {formatGb(model.vramMb)} VRAM
        </p>
        <p className="text-xs text-muted-foreground">{model.notes}</p>
      </div>
      {progress ? (
        <div className="w-full shrink-0 sm:w-64">
          <PullProgressRow progress={progress} onCancel={(id) => onCancelPull?.(id)} />
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          {isSelected ? (
            <Button size="sm" variant="secondary" disabled>
              <Check className="mr-2 h-4 w-4" />
              Selected
            </Button>
          ) : isInstalled ? (
            <>
              <Button size="sm" onClick={() => onSelect(model.tag)} disabled={actionsDisabled}>
                {isBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isBusy ? 'Selecting…' : 'Select'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRemove(model.tag)}
                disabled={actionsDisabled}
              >
                Remove
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onInstall(model.tag)}
              disabled={actionsDisabled}
            >
              {isBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isBusy ? 'Installing…' : 'Install'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function ModelRoleSection({
  role,
  title,
  description,
  models,
  status,
  onSelect,
  onInstall,
  onRemove,
  disabled,
  busyTags,
  pullProgress,
  onCancelPull,
}: ModelRoleSectionProps) {
  const selectedTag = status.selected[role];
  const isMissing = status.missing[role];
  const isReinstalling = busyTags?.has(selectedTag) ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isMissing && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Selected model isn't installed</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                <code className="rounded bg-muted px-1">{selectedTag}</code> is selected for this
                role but is no longer on disk —{' '}
                {role === 'text' ? 'receipt and text scans' : 'photo scans'} will fail until it's
                reinstalled.
              </p>
              {pullProgress?.get(selectedTag) ? (
                <div className="max-w-xs">
                  <PullProgressRow
                    progress={pullProgress.get(selectedTag)!}
                    onCancel={(id) => onCancelPull?.(id)}
                  />
                </div>
              ) : (
                <Button
                  size="sm"
                  onClick={() => onInstall(selectedTag)}
                  disabled={disabled || isReinstalling}
                >
                  {isReinstalling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Re-install {selectedTag}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {models.map((model) => (
          <ModelRow
            key={model.tag}
            model={model}
            role={role}
            status={status}
            disabled={disabled}
            busyTags={busyTags}
            pullProgress={pullProgress}
            onSelect={onSelect}
            onInstall={onInstall}
            onRemove={onRemove}
            onCancelPull={onCancelPull}
          />
        ))}
      </CardContent>
    </Card>
  );
}
