import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  FolderOpen,
  Grid,
  Grid2X2,
  Grid3X3,
  List,
  Upload,
  Folder,
  File,
  Image,
  Video,
  Music,
  FileText,
  MoreVertical,
  Download,
  Trash2,
  FolderInput,
  Home,
  ChevronRight,
  ChevronLeft,
  LayoutGrid,
  Check,
  X,
  EyeOff,
  Eye,
  Play,
  Lock,
  Unlock,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/shared/EmptyState';
import { SearchInput } from '@/components/shared/SearchInput';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { CreateFolderDialog } from '@/components/files/CreateFolderDialog';
import { UploadDialog } from '@/components/files/UploadDialog';
import { MoveFileDialog } from '@/components/files/MoveFileDialog';
import { StorageIndicator } from '@/components/files/StorageIndicator';
import { RestrictionDialog } from '@/components/files/RestrictionDialog';
import { filesApi } from '@/api/files';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/api-error';
import { cn, formatDate } from '@/lib/utils';
import type { FileItem } from '@/types/models';

type ViewMode = 'grid' | 'list';
type GridSize = 'sm' | 'md' | 'lg';

const GRID_CONFIGS = {
  sm: {
    className: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8',
    thumbnailSize: 'sm' as const,
  },
  md: {
    className: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
    thumbnailSize: 'md' as const,
  },
  lg: {
    className: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    thumbnailSize: 'lg' as const,
  },
};

interface DeleteTarget {
  id: string;
  name: string;
  type: 'file' | 'folder';
}

interface MoveTarget {
  id: string;
  name: string;
  folderId?: string;
}

interface RestrictTarget {
  id: string;
  name: string;
  type: 'file' | 'folder';
}

function getFileIcon(file: FileItem) {
  if (file.type === 'folder') return Folder;
  if (file.mimeType?.startsWith('image/')) return Image;
  if (file.mimeType?.startsWith('video/')) return Video;
  if (file.mimeType?.startsWith('audio/')) return Music;
  return File;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Get display name - backend uses 'filename' for files, 'name' for folders
function getFileName(file: FileItem): string {
  return (file as any).filename || file.name || 'Untitled';
}

// Get file size - backend uses 'sizeBytes' but type expects 'size'
function getFileSize(file: FileItem): number {
  return (file as any).sizeBytes || file.size || 0;
}

export function FilesPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const parentId = searchParams.get('folder') || undefined;
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [gridSize, setGridSize] = useState<GridSize>(() => {
    const saved = localStorage.getItem('files-grid-size');
    return (saved as GridSize) || 'md';
  });
  const [search, setSearch] = useState('');

  // Persist grid size preference
  useEffect(() => {
    localStorage.setItem('files-grid-size', gridSize);
  }, [gridSize]);

  // Dialog states
  const [uploadOpen, setUploadOpen] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [restrictTarget, setRestrictTarget] = useState<RestrictTarget | null>(null);

  // Bulk selection state - track both files and folders
  const [selectedItems, setSelectedItems] = useState<{
    files: Set<string>;
    folders: Set<string>;
  }>({ files: new Set(), folders: new Set() });
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);

  // Media preview state
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['files', parentId, search],
    queryFn: () =>
      filesApi.list({ parentId, search: search || undefined }),
  });

  const { data: storageData } = useQuery({
    queryKey: ['storage'],
    queryFn: filesApi.getStorageUsage,
  });

  // Fetch breadcrumb when inside a folder
  const { data: breadcrumbData } = useQuery({
    queryKey: ['folder-breadcrumb', parentId],
    queryFn: () => filesApi.getFolderBreadcrumb(parentId!),
    enabled: !!parentId,
  });

  // Create folder mutation
  const createFolderMutation = useMutation({
    mutationFn: (name: string) =>
      filesApi.createFolder({ name, parentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      setCreateFolderOpen(false);
      toast({ title: 'Folder created' });
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (target: DeleteTarget) => filesApi.delete(target.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      queryClient.invalidateQueries({ queryKey: ['storage'] });
      setDeleteTarget(null);
      toast({ title: 'Deleted successfully' });
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  // Move mutation
  const moveMutation = useMutation({
    mutationFn: ({ id, targetFolderId }: { id: string; targetFolderId: string | null }) =>
      filesApi.move(id, targetFolderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      setMoveTarget(null);
      toast({ title: 'File moved' });
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  // Single file exclude mutation (reuses bulk endpoint)
  const excludeMutation = useMutation({
    mutationFn: (data: { fileId: string; excluded: boolean }) =>
      filesApi.bulkExclude({ fileIds: [data.fileId], excluded: data.excluded }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      // Also invalidate category views since exclusion affects them
      queryClient.invalidateQueries({ queryKey: ['photos'] });
      queryClient.invalidateQueries({ queryKey: ['photos-timeline'] });
      queryClient.invalidateQueries({ queryKey: ['photos-locations'] });
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      queryClient.invalidateQueries({ queryKey: ['videos'] });
      queryClient.invalidateQueries({ queryKey: ['videos-timeline'] });
      queryClient.invalidateQueries({ queryKey: ['music'] });
      queryClient.invalidateQueries({ queryKey: ['movies'] });
      toast({ title: variables.excluded ? 'File excluded from categories' : 'File included in categories' });
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  // Folder exclude mutation (excludes all files inside folder)
  const folderExcludeMutation = useMutation({
    mutationFn: (data: { folderId: string; excluded: boolean }) =>
      filesApi.bulkExclude({ folderIds: [data.folderId], excluded: data.excluded }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['photos'] });
      queryClient.invalidateQueries({ queryKey: ['photos-timeline'] });
      queryClient.invalidateQueries({ queryKey: ['photos-locations'] });
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      queryClient.invalidateQueries({ queryKey: ['videos'] });
      queryClient.invalidateQueries({ queryKey: ['videos-timeline'] });
      queryClient.invalidateQueries({ queryKey: ['music'] });
      queryClient.invalidateQueries({ queryKey: ['movies'] });
      toast({ title: variables.excluded ? 'Folder contents excluded from categories' : 'Folder contents included in categories' });
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  // Bulk mutations
  const bulkExcludeMutation = useMutation({
    mutationFn: (data: { fileIds?: string[]; folderIds?: string[]; excluded: boolean }) =>
      filesApi.bulkExclude(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      // Also invalidate category views (photos, videos, music, movies) since exclusion affects them
      queryClient.invalidateQueries({ queryKey: ['photos'] });
      queryClient.invalidateQueries({ queryKey: ['photos-timeline'] });
      queryClient.invalidateQueries({ queryKey: ['photos-locations'] });
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      queryClient.invalidateQueries({ queryKey: ['videos'] });
      queryClient.invalidateQueries({ queryKey: ['videos-timeline'] });
      queryClient.invalidateQueries({ queryKey: ['music'] });
      queryClient.invalidateQueries({ queryKey: ['movies'] });
      setSelectedItems({ files: new Set(), folders: new Set() });
      setBulkMode(false);
      toast({ title: variables.excluded ? 'Items excluded from categories' : 'Items included in categories' });
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (data: { fileIds?: string[]; folderIds?: string[] }) => filesApi.bulkDelete(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      queryClient.invalidateQueries({ queryKey: ['storage'] });
      setSelectedItems({ files: new Set(), folders: new Set() });
      setBulkMode(false);
      setDeleteTarget(null);
      toast({ title: 'Items deleted' });
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  const bulkMoveMutation = useMutation({
    mutationFn: (data: { fileIds?: string[]; folderIds?: string[]; targetFolderId: string | null }) =>
      filesApi.bulkMove(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      setSelectedItems({ files: new Set(), folders: new Set() });
      setBulkMode(false);
      setBulkMoveOpen(false);
      toast({ title: 'Items moved' });
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  const handleUpload = async (file: File, onProgress: (progress: number) => void) => {
    await filesApi.upload(file, parentId, onProgress);
  };

  const handleUploadComplete = () => {
    queryClient.invalidateQueries({ queryKey: ['files'] });
    queryClient.invalidateQueries({ queryKey: ['storage'] });
  };

  const handleDownload = (file: FileItem) => {
    window.open(filesApi.getDownloadUrl(file.id), '_blank');
  };

  const files = data?.files || [];
  const folders = files.filter((f: FileItem) => f.type === 'folder');
  const otherFiles = files.filter((f: FileItem) => f.type !== 'folder');
  const breadcrumb = breadcrumbData?.breadcrumb || [];

  // Bulk selection handlers
  const handleSelectFile = (fileId: string, checked: boolean) => {
    setSelectedItems((prev) => {
      const nextFiles = new Set(prev.files);
      if (checked) {
        nextFiles.add(fileId);
      } else {
        nextFiles.delete(fileId);
      }
      return { ...prev, files: nextFiles };
    });
  };

  const handleSelectFolder = (folderId: string, checked: boolean) => {
    setSelectedItems((prev) => {
      const nextFolders = new Set(prev.folders);
      if (checked) {
        nextFolders.add(folderId);
      } else {
        nextFolders.delete(folderId);
      }
      return { ...prev, folders: nextFolders };
    });
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedItems({
        files: new Set(otherFiles.map((f) => f.id)),
        folders: new Set(folders.map((f) => f.id)),
      });
    } else {
      setSelectedItems({ files: new Set(), folders: new Set() });
    }
  };

  const exitBulkMode = () => {
    setBulkMode(false);
    setSelectedItems({ files: new Set(), folders: new Set() });
  };

  const totalSelected = selectedItems.files.size + selectedItems.folders.size;

  const handleBulkDelete = () => {
    // Create a delete target for confirmation dialog
    const fileCount = selectedItems.files.size;
    const folderCount = selectedItems.folders.size;
    let name = '';
    if (folderCount > 0 && fileCount > 0) {
      name = `${folderCount} folder${folderCount > 1 ? 's' : ''} and ${fileCount} file${fileCount > 1 ? 's' : ''}`;
    } else if (folderCount > 0) {
      name = `${folderCount} folder${folderCount > 1 ? 's' : ''}`;
    } else {
      name = `${fileCount} file${fileCount > 1 ? 's' : ''}`;
    }
    setDeleteTarget({
      id: 'bulk',
      name,
      type: 'file',
    });
  };

  // Calculate which selected files are excluded/included for context-aware bulk buttons
  const selectedFilesData = otherFiles.filter((f) => selectedItems.files.has(f.id));
  const hasExcludedSelected = selectedFilesData.some((f) => (f as any).excludedFromCategories);
  const hasIncludedSelected = selectedFilesData.some((f) => !(f as any).excludedFromCategories);

  const navigateToFolder = (folderId: string | null) => {
    if (folderId) {
      setSearchParams({ folder: folderId });
    } else {
      searchParams.delete('folder');
      setSearchParams(searchParams);
    }
  };

  // Get the current folder's parent ID from breadcrumb
  const currentFolder = breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1] : null;
  const parentFolderId = currentFolder?.parentId || null;

  return (
    <div>
      <PageHeader
        title="Files"
        description={storageData ? <StorageIndicator storage={storageData} /> : undefined}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCreateFolderOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Folder
            </Button>
            <Button onClick={() => setUploadOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Upload
            </Button>
          </div>
        }
      />

      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search files..."
            className="max-w-sm"
          />
          {!bulkMode && (folders.length > 0 || otherFiles.length > 0) && (
            <Button variant="outline" size="sm" onClick={() => setBulkMode(true)}>
              <Check className="mr-2 h-4 w-4" />
              Select
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Grid size controls (only visible in grid view) */}
          {viewMode === 'grid' && (
            <Tabs value={gridSize} onValueChange={(v) => setGridSize(v as GridSize)}>
              <TabsList>
                <TabsTrigger value="sm" title="Small thumbnails">
                  <LayoutGrid className="h-4 w-4" />
                </TabsTrigger>
                <TabsTrigger value="md" title="Medium thumbnails">
                  <Grid3X3 className="h-4 w-4" />
                </TabsTrigger>
                <TabsTrigger value="lg" title="Large thumbnails">
                  <Grid2X2 className="h-4 w-4" />
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          {/* View mode toggle */}
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <TabsList>
              <TabsTrigger value="grid">
                <Grid className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="list">
                <List className="h-4 w-4" />
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Bulk selection toolbar */}
      {bulkMode && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/50 p-3">
          <div className="flex items-center gap-3">
            <Checkbox
              checked={(folders.length + otherFiles.length) > 0 && totalSelected === (folders.length + otherFiles.length)}
              onCheckedChange={(checked) => handleSelectAll(!!checked)}
            />
            <span className="text-sm">
              {totalSelected > 0 ? `${totalSelected} selected` : 'Select all'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {totalSelected > 0 && (
              <>
                {/* Show both buttons when folders are selected (mixed state possible) */}
                {(hasIncludedSelected || selectedItems.folders.size > 0) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => bulkExcludeMutation.mutate({
                      fileIds: Array.from(selectedItems.files),
                      folderIds: Array.from(selectedItems.folders),
                      excluded: true,
                    })}
                    disabled={bulkExcludeMutation.isPending}
                  >
                    <EyeOff className="mr-2 h-4 w-4" />
                    Exclude from Categories
                  </Button>
                )}
                {(hasExcludedSelected || selectedItems.folders.size > 0) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => bulkExcludeMutation.mutate({
                      fileIds: Array.from(selectedItems.files),
                      folderIds: Array.from(selectedItems.folders),
                      excluded: false,
                    })}
                    disabled={bulkExcludeMutation.isPending}
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    Include in Categories
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBulkMoveOpen(true)}
                >
                  <FolderInput className="mr-2 h-4 w-4" />
                  Move
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleBulkDelete}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete ({totalSelected})
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={exitBulkMode}>
              <X className="mr-2 h-4 w-4" />
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-1 text-sm">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2"
          onClick={() => navigateToFolder(null)}
        >
          <Home className="h-4 w-4" />
        </Button>
        {breadcrumb.map((folder, index) => (
          <div key={folder.id} className="flex items-center">
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            {index === breadcrumb.length - 1 ? (
              <span className="px-2 py-1 font-medium">{folder.name}</span>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={() => navigateToFolder(folder.id)}
              >
                {folder.name}
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* File list */}
      {isLoading ? (
        <div className={cn('grid gap-4', viewMode === 'grid' ? GRID_CONFIGS[gridSize].className : '')}>
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className={viewMode === 'grid' ? 'h-32' : 'h-16'} />
          ))}
        </div>
      ) : files.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="h-12 w-12" />}
          title="No files here"
          description="Upload files or create a new folder"
          action={
            <Button onClick={() => setUploadOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Upload Files
            </Button>
          }
        />
      ) : viewMode === 'grid' ? (
        <div className={cn('grid gap-4', GRID_CONFIGS[gridSize].className)}>
          {folders.map((folder) => (
            <FileGridItem
              key={folder.id}
              file={folder}
              thumbnailSize={GRID_CONFIGS[gridSize].thumbnailSize}
              onClick={() => navigateToFolder(folder.id)}
              onDelete={() => setDeleteTarget({ id: folder.id, name: getFileName(folder), type: 'folder' })}
              onRestrict={() => setRestrictTarget({ id: folder.id, name: getFileName(folder), type: 'folder' })}
              onToggleExclude={(excluded) => folderExcludeMutation.mutate({ folderId: folder.id, excluded })}
              bulkMode={bulkMode}
              isSelected={selectedItems.folders.has(folder.id)}
              onSelect={(checked) => handleSelectFolder(folder.id, checked)}
            />
          ))}
          {otherFiles.map((file) => (
            <FileGridItem
              key={file.id}
              file={file}
              thumbnailSize={GRID_CONFIGS[gridSize].thumbnailSize}
              onClick={
                file.mimeType?.startsWith('image/') || file.mimeType?.startsWith('video/')
                  ? () => setPreviewFile(file)
                  : undefined
              }
              onDownload={() => handleDownload(file)}
              onDelete={() => setDeleteTarget({ id: file.id, name: getFileName(file), type: 'file' })}
              onMove={() => setMoveTarget({ id: file.id, name: getFileName(file), folderId: parentId })}
              onRestrict={() => setRestrictTarget({ id: file.id, name: getFileName(file), type: 'file' })}
              onToggleExclude={(excluded) => excludeMutation.mutate({ fileId: file.id, excluded })}
              bulkMode={bulkMode}
              isSelected={selectedItems.files.has(file.id)}
              onSelect={(checked) => handleSelectFile(file.id, checked)}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {folders.map((folder) => (
            <FileListItem
              key={folder.id}
              file={folder}
              onClick={() => navigateToFolder(folder.id)}
              onDelete={() => setDeleteTarget({ id: folder.id, name: getFileName(folder), type: 'folder' })}
              onRestrict={() => setRestrictTarget({ id: folder.id, name: getFileName(folder), type: 'folder' })}
              onToggleExclude={(excluded) => folderExcludeMutation.mutate({ folderId: folder.id, excluded })}
              bulkMode={bulkMode}
              isSelected={selectedItems.folders.has(folder.id)}
              onSelect={(checked) => handleSelectFolder(folder.id, checked)}
            />
          ))}
          {otherFiles.map((file) => (
            <FileListItem
              key={file.id}
              file={file}
              onClick={
                file.mimeType?.startsWith('image/') || file.mimeType?.startsWith('video/')
                  ? () => setPreviewFile(file)
                  : undefined
              }
              onDownload={() => handleDownload(file)}
              onDelete={() => setDeleteTarget({ id: file.id, name: getFileName(file), type: 'file' })}
              onMove={() => setMoveTarget({ id: file.id, name: getFileName(file), folderId: parentId })}
              onRestrict={() => setRestrictTarget({ id: file.id, name: getFileName(file), type: 'file' })}
              onToggleExclude={(excluded) => excludeMutation.mutate({ fileId: file.id, excluded })}
              bulkMode={bulkMode}
              isSelected={selectedItems.files.has(file.id)}
              onSelect={(checked) => handleSelectFile(file.id, checked)}
            />
          ))}
        </div>
      )}

      {/* Dialogs */}
      <CreateFolderDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        onSubmit={(name) => createFolderMutation.mutate(name)}
        isSubmitting={createFolderMutation.isPending}
        currentFolderName={currentFolder?.name}
      />

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUpload={handleUpload}
        onComplete={handleUploadComplete}
        currentFolderName={currentFolder?.name}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={deleteTarget?.id === 'bulk' ? `Delete ${deleteTarget.name}?` : `Delete ${deleteTarget?.type === 'folder' ? 'folder' : 'file'}?`}
        description={deleteTarget?.id === 'bulk'
          ? `Are you sure you want to delete ${deleteTarget.name}?${selectedItems.folders.size > 0 ? ' All files inside the selected folders will also be deleted.' : ''} This action cannot be undone.`
          : `Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`
        }
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => {
          if (deleteTarget?.id === 'bulk') {
            bulkDeleteMutation.mutate({
              fileIds: Array.from(selectedItems.files),
              folderIds: Array.from(selectedItems.folders),
            });
          } else if (deleteTarget) {
            deleteMutation.mutate(deleteTarget);
          }
        }}
      />

      {moveTarget && (
        <MoveFileDialog
          open={!!moveTarget}
          onOpenChange={(open) => !open && setMoveTarget(null)}
          fileName={moveTarget.name}
          currentFolderId={moveTarget.folderId}
          onMove={(targetFolderId) =>
            moveMutation.mutate({ id: moveTarget.id, targetFolderId })
          }
          isMoving={moveMutation.isPending}
        />
      )}

      {/* Bulk move dialog */}
      <MoveFileDialog
        open={bulkMoveOpen}
        onOpenChange={setBulkMoveOpen}
        fileName={`${totalSelected} item${totalSelected !== 1 ? 's' : ''}`}
        currentFolderId={parentId}
        onMove={(targetFolderId) =>
          bulkMoveMutation.mutate({
            fileIds: Array.from(selectedItems.files),
            folderIds: Array.from(selectedItems.folders),
            targetFolderId,
          })
        }
        isMoving={bulkMoveMutation.isPending}
      />

      {/* Media preview modal */}
      {previewFile && (
        <MediaPreviewModal
          file={previewFile}
          files={otherFiles.filter(
            (f) => f.mimeType?.startsWith('image/') || f.mimeType?.startsWith('video/')
          )}
          onClose={() => setPreviewFile(null)}
          onNavigate={setPreviewFile}
        />
      )}

      {/* Restriction dialog */}
      {restrictTarget && (
        <RestrictionDialog
          open={!!restrictTarget}
          onOpenChange={(open) => !open && setRestrictTarget(null)}
          resourceType={restrictTarget.type}
          resourceId={restrictTarget.id}
          resourceName={restrictTarget.name}
        />
      )}
    </div>
  );
}

interface FileItemProps {
  file: FileItem;
  thumbnailSize?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  onDownload?: () => void;
  onDelete?: () => void;
  onMove?: () => void;
  onRestrict?: () => void;
  onToggleExclude?: (excluded: boolean) => void;
  bulkMode?: boolean;
  isSelected?: boolean;
  onSelect?: (checked: boolean) => void;
}

function FileGridItem({ file, thumbnailSize = 'md', onClick, onDownload, onDelete, onMove, onRestrict, onToggleExclude, bulkMode, isSelected, onSelect }: FileItemProps) {
  const Icon = getFileIcon(file);
  const isImage = file.mimeType?.startsWith('image/');
  const isVideo = file.mimeType?.startsWith('video/');
  const hasThumbnail = isImage || isVideo; // Both images and videos can have thumbnails
  const isFolder = file.type === 'folder';
  const isExcluded = (file as any).excludedFromCategories;
  const fileIsRestricted = (file as any).isRestricted;
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    // For images, fallback to stream URL
    if (isImage) {
      const img = e.currentTarget;
      const streamUrl = `/api/v1/files/${file.id}/stream`;
      if (!img.src.includes('/stream')) {
        img.src = streamUrl;
        return;
      }
    }
    // For videos or if stream also fails, show icon
    setThumbnailFailed(true);
  };

  const handleClick = () => {
    if (bulkMode && onSelect) {
      onSelect(!isSelected);
    } else if (onClick) {
      onClick();
    }
  };

  return (
    <Card className={cn(
      "group relative cursor-pointer transition-shadow hover:shadow-md",
      isSelected && "ring-2 ring-primary"
    )}>
      <div onClick={handleClick}>
        <CardContent className="p-4">
          {/* Checkbox overlay for bulk mode */}
          {bulkMode && (
            <div className="absolute left-2 top-2 z-10">
              <Checkbox
                checked={isSelected}
                onCheckedChange={(checked) => onSelect?.(!!checked)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          {hasThumbnail && !thumbnailFailed ? (
            <div className="mb-2 aspect-square overflow-hidden rounded-md bg-muted relative">
              <img
                src={`/api/v1/files/${file.id}/thumbnail/${thumbnailSize}`}
                alt={getFileName(file)}
                className="h-full w-full object-cover"
                onError={handleImageError}
              />
              {isVideo && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="rounded-full bg-black/50 p-2">
                    <Play className="h-6 w-6 text-white" fill="white" />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mb-2 flex aspect-square items-center justify-center rounded-md bg-muted">
              <Icon className="h-12 w-12 text-muted-foreground" />
            </div>
          )}
          <p className="truncate font-medium">{getFileName(file)}</p>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>{isFolder ? 'Folder' : formatBytes(getFileSize(file))}</span>
            {fileIsRestricted && (
              <Badge variant="outline" className="ml-1 text-xs border-amber-500 text-amber-600">
                <Lock className="mr-1 h-3 w-3" />
                Restricted
              </Badge>
            )}
            {isExcluded && !isFolder && (
              <Badge variant="secondary" className="ml-1 text-xs">
                <EyeOff className="mr-1 h-3 w-3" />
                Hidden
              </Badge>
            )}
          </div>
        </CardContent>
      </div>

      {/* Context menu */}
      <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              className="h-8 w-8"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            {!isFolder && onDownload && (
              <DropdownMenuItem onClick={onDownload}>
                <Download className="mr-2 h-4 w-4" />
                Download
              </DropdownMenuItem>
            )}
            {!isFolder && onMove && (
              <DropdownMenuItem onClick={onMove}>
                <FolderInput className="mr-2 h-4 w-4" />
                Move
              </DropdownMenuItem>
            )}
            {onRestrict && (
              <DropdownMenuItem onClick={onRestrict}>
                <Lock className="mr-2 h-4 w-4" />
                Restrict Access
              </DropdownMenuItem>
            )}
            {onToggleExclude && !isFolder && (
              <DropdownMenuItem onClick={() => onToggleExclude(!isExcluded)}>
                {isExcluded ? (
                  <>
                    <Eye className="mr-2 h-4 w-4" />
                    Include in Categories
                  </>
                ) : (
                  <>
                    <EyeOff className="mr-2 h-4 w-4" />
                    Exclude from Categories
                  </>
                )}
              </DropdownMenuItem>
            )}
            {onToggleExclude && isFolder && (
              <>
                <DropdownMenuItem onClick={() => onToggleExclude(true)}>
                  <EyeOff className="mr-2 h-4 w-4" />
                  Exclude Contents from Categories
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onToggleExclude(false)}>
                  <Eye className="mr-2 h-4 w-4" />
                  Include Contents in Categories
                </DropdownMenuItem>
              </>
            )}
            {(onDownload || onMove || onRestrict || onToggleExclude) && onDelete && <DropdownMenuSeparator />}
            {onDelete && (
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
  );
}

function FileListItem({ file, onClick, onDownload, onDelete, onMove, onRestrict, onToggleExclude, bulkMode, isSelected, onSelect }: FileItemProps) {
  const Icon = getFileIcon(file);
  const isFolder = file.type === 'folder';
  const isExcluded = (file as any).excludedFromCategories;
  const fileIsRestricted = (file as any).isRestricted;

  const handleClick = () => {
    if (bulkMode && onSelect) {
      onSelect(!isSelected);
    } else if (onClick) {
      onClick();
    }
  };

  return (
    <Card className={cn(
      "group cursor-pointer transition-shadow hover:shadow-md",
      isSelected && "ring-2 ring-primary"
    )}>
      <CardContent className="flex items-center gap-4 p-4">
        {/* Checkbox for bulk mode */}
        {bulkMode && (
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onSelect?.(!!checked)}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <div className="flex-1 flex items-center gap-4 min-w-0" onClick={handleClick}>
          <Icon className="h-8 w-8 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium">{getFileName(file)}</p>
              {fileIsRestricted && (
                <Badge variant="outline" className="text-xs shrink-0 border-amber-500 text-amber-600">
                  <Lock className="mr-1 h-3 w-3" />
                  Restricted
                </Badge>
              )}
              {isExcluded && !isFolder && (
                <Badge variant="secondary" className="text-xs shrink-0">
                  <EyeOff className="mr-1 h-3 w-3" />
                  Hidden
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {formatDate(file.updatedAt)}
            </p>
          </div>
          <p className="text-sm text-muted-foreground shrink-0">
            {isFolder ? 'Folder' : formatBytes(getFileSize(file))}
          </p>
        </div>

        {/* Context menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            {!isFolder && onDownload && (
              <DropdownMenuItem onClick={onDownload}>
                <Download className="mr-2 h-4 w-4" />
                Download
              </DropdownMenuItem>
            )}
            {!isFolder && onMove && (
              <DropdownMenuItem onClick={onMove}>
                <FolderInput className="mr-2 h-4 w-4" />
                Move
              </DropdownMenuItem>
            )}
            {onRestrict && (
              <DropdownMenuItem onClick={onRestrict}>
                <Lock className="mr-2 h-4 w-4" />
                Restrict Access
              </DropdownMenuItem>
            )}
            {onToggleExclude && !isFolder && (
              <DropdownMenuItem onClick={() => onToggleExclude(!isExcluded)}>
                {isExcluded ? (
                  <>
                    <Eye className="mr-2 h-4 w-4" />
                    Include in Categories
                  </>
                ) : (
                  <>
                    <EyeOff className="mr-2 h-4 w-4" />
                    Exclude from Categories
                  </>
                )}
              </DropdownMenuItem>
            )}
            {onToggleExclude && isFolder && (
              <>
                <DropdownMenuItem onClick={() => onToggleExclude(true)}>
                  <EyeOff className="mr-2 h-4 w-4" />
                  Exclude Contents from Categories
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onToggleExclude(false)}>
                  <Eye className="mr-2 h-4 w-4" />
                  Include Contents in Categories
                </DropdownMenuItem>
              </>
            )}
            {(onDownload || onMove || onRestrict || onToggleExclude) && onDelete && <DropdownMenuSeparator />}
            {onDelete && (
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </CardContent>
    </Card>
  );
}

interface MediaPreviewModalProps {
  file: FileItem;
  files: FileItem[];
  onClose: () => void;
  onNavigate: (file: FileItem) => void;
}

function MediaPreviewModal({ file, files, onClose, onNavigate }: MediaPreviewModalProps) {
  const currentIndex = files.findIndex((f) => f.id === file.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < files.length - 1;

  const isVideo = file.mimeType?.startsWith('video/');
  const isImage = file.mimeType?.startsWith('image/');

  const handlePrev = () => {
    if (hasPrev) onNavigate(files[currentIndex - 1]);
  };

  const handleNext = () => {
    if (hasNext) onNavigate(files[currentIndex + 1]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowLeft') handlePrev();
    if (e.key === 'ArrowRight') handleNext();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Close button */}
      <button
        className="absolute top-4 right-4 text-white hover:text-gray-300 z-10"
        onClick={onClose}
      >
        <span className="sr-only">Close</span>
        <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Navigation */}
      {hasPrev && (
        <button
          className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 z-10"
          onClick={(e) => {
            e.stopPropagation();
            handlePrev();
          }}
        >
          <ChevronLeft className="h-8 w-8" />
        </button>
      )}

      {hasNext && (
        <button
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 z-10"
          onClick={(e) => {
            e.stopPropagation();
            handleNext();
          }}
        >
          <ChevronRight className="h-8 w-8" />
        </button>
      )}

      {/* Media content */}
      {isVideo ? (
        <video
          src={`/api/v1/files/${file.id}/stream`}
          className="max-h-[90vh] max-w-[90vw]"
          controls
          autoPlay
          onClick={(e) => e.stopPropagation()}
        />
      ) : isImage ? (
        <img
          src={`/api/v1/files/${file.id}/stream`}
          alt={getFileName(file)}
          className="max-h-[90vh] max-w-[90vw] object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      ) : null}

      {/* Info bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-4 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">{getFileName(file)}</p>
            <p className="text-sm text-gray-300">
              {formatDate(file.createdAt)} &middot; {formatBytes(getFileSize(file))}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
