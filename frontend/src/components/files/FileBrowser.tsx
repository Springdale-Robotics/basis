import { useState } from 'react';
import { format } from 'date-fns';
import {
  Folder,
  File,
  Image,
  Video,
  Music,
  FileText,
  MoreVertical,
  Grid,
  List,
  ChevronRight,
  Upload,
  FolderPlus,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { FileItem, Folder as FolderType } from '@/types/models';

interface FileBrowserProps {
  files: FileItem[];
  folders: FolderType[];
  currentPath: string[];
  view: 'grid' | 'list';
  onViewChange: (view: 'grid' | 'list') => void;
  onFolderClick: (folder: FolderType) => void;
  onFileClick: (file: FileItem) => void;
  onNavigate: (path: string[]) => void;
  onUpload: () => void;
  onCreateFolder: () => void;
  onDelete: (item: FileItem | FolderType) => void;
  onRename: (item: FileItem | FolderType) => void;
  onMove: (item: FileItem | FolderType) => void;
}

export function FileBrowser({
  files,
  folders,
  currentPath,
  view,
  onViewChange,
  onFolderClick,
  onFileClick,
  onNavigate,
  onUpload,
  onCreateFolder,
  onDelete,
  onRename,
  onMove,
}: FileBrowserProps) {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  const handleBreadcrumbClick = (index: number) => {
    onNavigate(currentPath.slice(0, index + 1));
  };

  const getFileIcon = (file: FileItem) => {
    if (file.mimeType?.startsWith('image/')) {
      return <Image className="h-8 w-8 text-blue-500" />;
    }
    if (file.mimeType?.startsWith('video/')) {
      return <Video className="h-8 w-8 text-purple-500" />;
    }
    if (file.mimeType?.startsWith('audio/')) {
      return <Music className="h-8 w-8 text-pink-500" />;
    }
    if (file.mimeType?.startsWith('text/') || file.mimeType?.includes('pdf')) {
      return <FileText className="h-8 w-8 text-orange-500" />;
    }
    return <File className="h-8 w-8 text-muted-foreground" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onUpload}>
            <Upload className="h-4 w-4 mr-2" />
            Upload
          </Button>
          <Button variant="outline" size="sm" onClick={onCreateFolder}>
            <FolderPlus className="h-4 w-4 mr-2" />
            New Folder
          </Button>
        </div>
        <div className="flex items-center gap-1 border rounded-md p-0.5">
          <Button
            variant={view === 'grid' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={() => onViewChange('grid')}
          >
            <Grid className="h-4 w-4" />
          </Button>
          <Button
            variant={view === 'list' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={() => onViewChange('list')}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-sm">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={() => onNavigate([])}
        >
          Home
        </Button>
        {currentPath.map((segment, index) => (
          <div key={index} className="flex items-center">
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => handleBreadcrumbClick(index)}
            >
              {segment}
            </Button>
          </div>
        ))}
      </div>

      {/* Content */}
      {view === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {folders.map((folder) => (
            <Card
              key={folder.id}
              className="cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => onFolderClick(folder)}
            >
              <CardContent className="p-4 flex flex-col items-center gap-2">
                <Folder className="h-12 w-12 text-yellow-500" />
                <p className="text-sm font-medium text-center truncate w-full">
                  {folder.name}
                </p>
              </CardContent>
            </Card>
          ))}
          {files.map((file) => (
            <Card
              key={file.id}
              className="cursor-pointer hover:bg-muted/50 transition-colors group"
              onClick={() => onFileClick(file)}
            >
              <CardContent className="p-4 flex flex-col items-center gap-2 relative">
                {file.thumbnailUrl ? (
                  <div className="h-12 w-12 rounded overflow-hidden">
                    <img
                      src={file.thumbnailUrl}
                      alt={file.name}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  getFileIcon(file)
                )}
                <p className="text-sm font-medium text-center truncate w-full">
                  {file.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(file.size)}
                </p>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => onRename(file)}>
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onMove(file)}>
                      Move
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onDelete(file)}
                      className="text-destructive"
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {folders.map((folder) => (
            <div
              key={folder.id}
              className="flex items-center gap-3 p-3 hover:bg-muted/50 cursor-pointer"
              onClick={() => onFolderClick(folder)}
            >
              <Folder className="h-5 w-5 text-yellow-500" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{folder.name}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                {format(new Date(folder.updatedAt), 'MMM d, yyyy')}
              </p>
            </div>
          ))}
          {files.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-3 p-3 hover:bg-muted/50 cursor-pointer group"
              onClick={() => onFileClick(file)}
            >
              <div className="shrink-0">{getFileIcon(file)}</div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(file.size)}
                </p>
              </div>
              <p className="text-sm text-muted-foreground shrink-0">
                {format(new Date(file.updatedAt), 'MMM d, yyyy')}
              </p>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => onRename(file)}>
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onMove(file)}>
                    Move
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onDelete(file)}
                    className="text-destructive"
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      {folders.length === 0 && files.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Folder className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>This folder is empty</p>
          <Button variant="link" onClick={onUpload}>
            Upload files
          </Button>
        </div>
      )}
    </div>
  );
}
