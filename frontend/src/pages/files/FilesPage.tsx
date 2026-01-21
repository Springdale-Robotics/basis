import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Plus,
  FolderOpen,
  Grid,
  List,
  Upload,
  Folder,
  File,
  Image,
  Video,
  Music,
  FileText,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/EmptyState';
import { SearchInput } from '@/components/shared/SearchInput';
import { filesApi } from '@/api/files';
import { cn, formatDate } from '@/lib/utils';
import type { FileItem } from '@/types/models';

type ViewMode = 'grid' | 'list';

const fileTypeIcons: Record<string, typeof File> = {
  folder: Folder,
  image: Image,
  video: Video,
  audio: Music,
  document: FileText,
  default: File,
};

function getFileIcon(file: FileItem) {
  if (file.type === 'folder') return Folder;
  if (file.mimeType?.startsWith('image/')) return Image;
  if (file.mimeType?.startsWith('video/')) return Video;
  if (file.mimeType?.startsWith('audio/')) return Music;
  return File;
}

export function FilesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const parentId = searchParams.get('folder') || undefined;
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['files', parentId, search],
    queryFn: () =>
      filesApi.list({ parentId, search: search || undefined }),
  });

  const { data: storageData } = useQuery({
    queryKey: ['storage'],
    queryFn: filesApi.getStorageUsage,
  });

  const files = data?.files || [];
  const folders = files.filter((f: FileItem) => f.type === 'folder');
  const otherFiles = files.filter((f: FileItem) => f.type === 'file');

  const navigateToFolder = (folderId: string) => {
    setSearchParams({ folder: folderId });
  };

  const navigateUp = () => {
    searchParams.delete('folder');
    setSearchParams(searchParams);
  };

  return (
    <div>
      <PageHeader
        title="Files"
        description={storageData ? `${formatBytes(storageData.usedBytes)} used` : undefined}
        actions={
          <div className="flex gap-2">
            <Button variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              New Folder
            </Button>
            <Button>
              <Upload className="mr-2 h-4 w-4" />
              Upload
            </Button>
          </div>
        }
      />

      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search files..."
          className="max-w-sm"
        />

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

      {/* Breadcrumb */}
      {parentId && (
        <div className="mb-4">
          <Button variant="ghost" size="sm" onClick={navigateUp}>
            <FolderOpen className="mr-2 h-4 w-4" />
            Back to parent
          </Button>
        </div>
      )}

      {/* File list */}
      {isLoading ? (
        <div className={cn('grid gap-4', viewMode === 'grid' ? 'sm:grid-cols-2 lg:grid-cols-4' : '')}>
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
            <Button>
              <Upload className="mr-2 h-4 w-4" />
              Upload Files
            </Button>
          }
        />
      ) : viewMode === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {folders.map((folder) => (
            <FileGridItem
              key={folder.id}
              file={folder}
              onClick={() => navigateToFolder(folder.id)}
            />
          ))}
          {otherFiles.map((file) => (
            <FileGridItem key={file.id} file={file} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {folders.map((folder) => (
            <FileListItem
              key={folder.id}
              file={folder}
              onClick={() => navigateToFolder(folder.id)}
            />
          ))}
          {otherFiles.map((file) => (
            <FileListItem key={file.id} file={file} />
          ))}
        </div>
      )}
    </div>
  );
}

interface FileItemProps {
  file: FileItem;
  onClick?: () => void;
}

function FileGridItem({ file, onClick }: FileItemProps) {
  const Icon = getFileIcon(file);
  const isImage = file.mimeType?.startsWith('image/');

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={onClick}
    >
      <CardContent className="p-4">
        {isImage && file.thumbnailUrl ? (
          <div className="mb-2 aspect-square overflow-hidden rounded-md bg-muted">
            <img
              src={file.thumbnailUrl}
              alt={file.name}
              className="h-full w-full object-cover"
            />
          </div>
        ) : (
          <div className="mb-2 flex aspect-square items-center justify-center rounded-md bg-muted">
            <Icon className="h-12 w-12 text-muted-foreground" />
          </div>
        )}
        <p className="truncate font-medium">{file.name}</p>
        <p className="text-xs text-muted-foreground">
          {file.type === 'folder' ? 'Folder' : formatBytes(file.size || 0)}
        </p>
      </CardContent>
    </Card>
  );
}

function FileListItem({ file, onClick }: FileItemProps) {
  const Icon = getFileIcon(file);

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={onClick}
    >
      <CardContent className="flex items-center gap-4 p-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{file.name}</p>
          <p className="text-sm text-muted-foreground">
            {formatDate(file.updatedAt)}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          {file.type === 'folder' ? 'Folder' : formatBytes(file.size || 0)}
        </p>
      </CardContent>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
