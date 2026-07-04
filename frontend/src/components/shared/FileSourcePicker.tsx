import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  File as FileIcon,
  FileText,
  Folder,
  HardDrive,
  Home,
  Loader2,
  Music,
  Upload,
  Video,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorState } from '@/components/shared/ErrorState';
import { SearchInput } from '@/components/shared/SearchInput';
import { filesApi } from '@/api/files';
import { filesMediaApi } from '@/api/media';
import { API_BASE_URL } from '@/lib/constants';
import { toast } from '@/hooks/useToast';
import { cn, formatFileSize } from '@/lib/utils';
import { getErrorMessage } from '@/lib/api-error';
import type { FileItem } from '@/types/models';

/**
 * FileSourcePicker — a two-step dialog shown wherever the app asks the user
 * for a file. Step 1 offers a source: the household's file library on the
 * home server, or the current device. Step 2a browses the library (folders,
 * breadcrumb, search, thumbnails); step 2b immediately opens the native file
 * chooser.
 *
 * Contract: `onSelect` always receives plain `File` objects regardless of
 * source. Library picks are downloaded as blobs (cookie-authenticated, same
 * as every other API call) and wrapped in `new File(...)`, so consumers keep
 * their existing File-handling code unchanged.
 */

interface FileSourcePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Always called with plain File objects, whichever source was used. */
  onSelect: (files: File[]) => void;
  /** Native accept string, e.g. "image/*" or ".ics,text/calendar". */
  accept?: string;
  /** Allow picking more than one file. */
  multiple?: boolean;
  /** Dialog title, e.g. "Add recipe image". */
  title?: string;
  /** Optional one-line description under the title. */
  description?: string;
}

type PickerStep = 'source' | 'library';

/** Normalized library file — the backend returns raw DB rows (`filename`,
 *  `sizeBytes`) while the FileItem type declares `name`/`size`; cover both. */
interface LibraryFile {
  id: string;
  name: string;
  mimeType?: string;
  sizeBytes: number;
}

interface LibraryFolder {
  id: string;
  name: string;
}

function toLibraryFile(raw: FileItem): LibraryFile {
  const r = raw as FileItem & { filename?: string; sizeBytes?: number };
  return {
    id: raw.id,
    name: r.filename || raw.name || 'Untitled',
    mimeType: raw.mimeType ?? undefined,
    sizeBytes: r.sizeBytes ?? raw.size ?? 0,
  };
}

function parseAcceptTokens(accept?: string): string[] {
  return (accept ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/** Mirrors native `accept` semantics: ".ext", "type/*", or "type/subtype". */
function matchesAccept(file: LibraryFile, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const name = file.name.toLowerCase();
  const mime = (file.mimeType ?? '').toLowerCase();
  return tokens.some((token) => {
    if (token.startsWith('.')) return name.endsWith(token);
    if (token.endsWith('/*')) return mime.startsWith(token.slice(0, -1));
    return mime === token;
  });
}

/** Best-effort mimeType param for the list API; the real filtering happens
 *  client-side via matchesAccept since the server filter is coarser. */
function acceptToMimeParam(tokens: string[]): string | undefined {
  const mimeToken = tokens.find((t) => t.includes('/'));
  return mimeToken?.replace('/*', '/');
}

function fileTypeIcon(mimeType?: string) {
  if (mimeType?.startsWith('video/')) return Video;
  if (mimeType?.startsWith('audio/')) return Music;
  if (mimeType?.startsWith('text/') || mimeType === 'application/pdf') return FileText;
  return FileIcon;
}

/** Image thumbnail that degrades to a type icon if the thumbnail 404s. */
function FileThumbnail({ file }: { file: LibraryFile }) {
  const [failed, setFailed] = useState(false);
  const isImage = file.mimeType?.startsWith('image/');

  if (isImage && !failed) {
    return (
      <img
        src={filesMediaApi.getThumbnailUrl(file.id, 'md')}
        alt={file.name}
        loading="lazy"
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }

  const Icon = fileTypeIcon(file.mimeType);
  return <Icon className="h-8 w-8 text-muted-foreground" />;
}

export function FileSourcePicker({
  open,
  onOpenChange,
  onSelect,
  accept,
  multiple = false,
  title = 'Add a file',
  description,
}: FileSourcePickerProps) {
  const [step, setStep] = useState<PickerStep>('source');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Map<string, LibraryFile>>(new Map());
  const [isPreparing, setIsPreparing] = useState(false);
  const deviceInputRef = useRef<HTMLInputElement>(null);

  const acceptTokens = useMemo(() => parseAcceptTokens(accept), [accept]);

  // Fresh start every time the picker opens.
  useEffect(() => {
    if (open) {
      setStep('source');
      setFolderId(null);
      setSearch('');
      setSelected(new Map());
      setIsPreparing(false);
    }
  }, [open]);

  const searching = search.trim().length > 0;

  // Browse: root = all root folders + root files; folder = its contents.
  const browseQuery = useQuery({
    queryKey: ['file-source-picker', 'browse', folderId ?? 'root'],
    queryFn: async (): Promise<{ folders: LibraryFolder[]; files: LibraryFile[] }> => {
      if (folderId) {
        const { subfolders, files } = await filesApi.getFolder(folderId);
        return {
          folders: subfolders.map((f) => ({ id: f.id, name: f.name })),
          files: files.map(toLibraryFile),
        };
      }
      const [foldersRes, filesRes] = await Promise.all([
        filesApi.getFolders(),
        filesApi.list({}),
      ]);
      return {
        // getFolders returns every folder in the household; root = no parent.
        folders: foldersRes.folders
          .filter((f) => !f.parentId)
          .map((f) => ({ id: f.id, name: f.name })),
        // Rows are always real files (type is a media enum: photo/video/…);
        // folders live in their own table and come from getFolders above.
        files: filesRes.files.map(toLibraryFile),
      };
    },
    enabled: open && step === 'library' && !searching,
  });

  // Search: the list API's search/mimeType filters are coarse (and only cover
  // the top level), so we always re-filter client-side by name + accept.
  const searchQuery = useQuery({
    queryKey: ['file-source-picker', 'search', search, accept ?? ''],
    queryFn: () =>
      filesApi.list({ search, mimeType: acceptToMimeParam(acceptTokens) }),
    enabled: open && step === 'library' && searching,
  });

  const breadcrumbQuery = useQuery({
    queryKey: ['file-source-picker', 'breadcrumb', folderId],
    queryFn: () => filesApi.getFolderBreadcrumb(folderId!),
    enabled: open && step === 'library' && !!folderId && !searching,
  });

  const activeQuery = searching ? searchQuery : browseQuery;

  const visibleFolders: LibraryFolder[] = searching ? [] : browseQuery.data?.folders ?? [];
  const visibleFiles: LibraryFile[] = useMemo(() => {
    if (searching) {
      const term = search.trim().toLowerCase();
      return (searchQuery.data?.files ?? [])
        .map(toLibraryFile)
        .filter((f) => f.name.toLowerCase().includes(term))
        .filter((f) => matchesAccept(f, acceptTokens));
    }
    return (browseQuery.data?.files ?? []).filter((f) => matchesAccept(f, acceptTokens));
  }, [searching, search, searchQuery.data, browseQuery.data, acceptTokens]);

  const toggleFile = useCallback(
    (file: LibraryFile) => {
      setSelected((prev) => {
        const next = new Map(multiple ? prev : []);
        if (prev.has(file.id)) {
          next.delete(file.id);
        } else {
          next.set(file.id, file);
        }
        return next;
      });
    },
    [multiple]
  );

  const handleDeviceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // Reset so the same file can be picked again next time.
    e.target.value = '';
    if (files.length === 0) return;
    onSelect(files);
    onOpenChange(false);
  };

  // Library confirm: download each pick (cookie auth, same as the API client)
  // and wrap it in a plain File so consumers never know the difference.
  const handleConfirm = async () => {
    const entries = Array.from(selected.values());
    if (entries.length === 0) return;
    setIsPreparing(true);
    try {
      const files = await Promise.all(
        entries.map(async (entry) => {
          // filesApi.getDownloadUrl points at the unversioned /api path; the
          // backend only serves /api/v1/files/:id/download, so build it here.
          const res = await fetch(`${API_BASE_URL}/files/${entry.id}/download`, {
            credentials: 'include',
          });
          if (!res.ok) {
            throw new Error(`Couldn't download "${entry.name}" (${res.status})`);
          }
          const blob = await res.blob();
          return new File([blob], entry.name, {
            type: entry.mimeType || blob.type || 'application/octet-stream',
          });
        })
      );
      onSelect(files);
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Couldn't fetch file",
        description: getErrorMessage(err, 'Download failed'),
        variant: 'destructive',
      });
    } finally {
      setIsPreparing(false);
    }
  };

  const breadcrumb = breadcrumbQuery.data?.breadcrumb ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => !isPreparing && onOpenChange(o)}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>
            {step === 'library' ? 'Choose from Basis' : title}
          </DialogTitle>
          <DialogDescription>
            {step === 'library'
              ? "Pick from your household's file library."
              : description ?? 'Choose where the file comes from.'}
          </DialogDescription>
        </DialogHeader>

        {/* Hidden native input for the device path. Triggered directly from
            the source card so the user doesn't have to click twice. */}
        <input
          ref={deviceInputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={handleDeviceChange}
        />

        {step === 'source' && (
          <div className="grid gap-3 py-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setStep('library')}
              className="flex flex-col items-start gap-2 rounded-xl border p-5 text-left transition-colors hover:border-primary hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <HardDrive className="h-8 w-8 text-primary" />
              <span className="font-medium">From Basis</span>
              <span className="text-sm text-muted-foreground">
                Pick a file already stored in your household's library.
              </span>
            </button>
            <button
              type="button"
              onClick={() => deviceInputRef.current?.click()}
              className="flex flex-col items-start gap-2 rounded-xl border p-5 text-left transition-colors hover:border-primary hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Upload className="h-8 w-8 text-primary" />
              <span className="font-medium">From this device</span>
              <span className="text-sm text-muted-foreground">
                Upload a new file from this phone or computer.
              </span>
            </button>
          </div>
        )}

        {step === 'library' && (
          <>
            <div className="flex flex-shrink-0 items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => setStep('source')}
                aria-label="Back to source choice"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search files..."
                className="flex-1"
              />
            </div>

            {/* Breadcrumb row */}
            {!searching && (
              <div className="flex flex-shrink-0 items-center gap-1 overflow-x-auto text-sm text-muted-foreground">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2"
                  onClick={() => setFolderId(null)}
                >
                  <Home className="mr-1 h-3.5 w-3.5" />
                  Files
                </Button>
                {folderId &&
                  (breadcrumbQuery.isLoading ? (
                    <Skeleton className="h-4 w-24" />
                  ) : (
                    breadcrumb.map((crumb) => (
                      <span key={crumb.id} className="flex shrink-0 items-center gap-1">
                        <ChevronRight className="h-3.5 w-3.5" />
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            'h-7 px-2',
                            crumb.id === folderId && 'font-medium text-foreground'
                          )}
                          onClick={() => setFolderId(crumb.id)}
                        >
                          {crumb.name}
                        </Button>
                      </span>
                    ))
                  ))}
              </div>
            )}

            <div className="min-h-[16rem] flex-1 overflow-y-auto">
              {activeQuery.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-9 w-full" />
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <Skeleton key={i} className="aspect-square w-full" />
                    ))}
                  </div>
                </div>
              ) : activeQuery.isError ? (
                <ErrorState
                  title="Couldn't load files"
                  error={activeQuery.error}
                  onRetry={() => activeQuery.refetch()}
                />
              ) : visibleFolders.length === 0 && visibleFiles.length === 0 ? (
                <EmptyState
                  icon={<Folder className="h-10 w-10" />}
                  title={searching ? 'No matching files' : 'Nothing here'}
                  description={
                    searching
                      ? 'Try a different search, or upload from this device instead.'
                      : 'This folder has no files the app can use here.'
                  }
                />
              ) : (
                <div className="space-y-3">
                  {visibleFolders.length > 0 && (
                    <div className="space-y-1">
                      {visibleFolders.map((folder) => (
                        <button
                          key={folder.id}
                          type="button"
                          onClick={() => setFolderId(folder.id)}
                          className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {folder.name}
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      ))}
                    </div>
                  )}

                  {visibleFiles.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {visibleFiles.map((file) => {
                        const isSelected = selected.has(file.id);
                        return (
                          <button
                            key={file.id}
                            type="button"
                            onClick={() => toggleFile(file)}
                            title={file.name}
                            className={cn(
                              'group relative flex flex-col overflow-hidden rounded-lg border text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              isSelected
                                ? 'border-primary ring-2 ring-primary'
                                : 'hover:border-muted-foreground/40'
                            )}
                          >
                            <div className="flex aspect-square w-full items-center justify-center overflow-hidden bg-muted">
                              <FileThumbnail file={file} />
                            </div>
                            <div className="w-full px-2 py-1.5">
                              <p className="truncate text-xs font-medium">{file.name}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {formatFileSize(file.sizeBytes)}
                              </p>
                            </div>
                            {isSelected && (
                              <span className="absolute right-1.5 top-1.5 rounded-full bg-primary p-0.5 text-primary-foreground">
                                <Check className="h-3 w-3" />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            <DialogFooter className="flex-shrink-0 items-center gap-2 sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {selected.size > 0
                  ? `${selected.size} file${selected.size === 1 ? '' : 's'} selected`
                  : multiple
                    ? 'Select one or more files'
                    : 'Select a file'}
              </p>
              <Button onClick={handleConfirm} disabled={selected.size === 0 || isPreparing}>
                {isPreparing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Preparing...
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    {multiple && selected.size > 1 ? `Use ${selected.size} files` : 'Use file'}
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
