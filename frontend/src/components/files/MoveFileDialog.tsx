import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { Folder, FolderOpen, ChevronRight, ChevronDown, Loader2, Home } from 'lucide-react';
import { filesApi } from '@/api/files';
import { cn } from '@/lib/utils';
import type { FileItem } from '@/types/models';

interface MoveFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  currentFolderId?: string;
  onMove: (targetFolderId: string | null) => void;
  isMoving?: boolean;
}

interface FolderNode {
  folder: FileItem;
  children: FolderNode[];
}

function buildFolderTree(folders: FileItem[]): FolderNode[] {
  const folderMap = new Map<string, FolderNode>();
  const rootNodes: FolderNode[] = [];

  // Create nodes for all folders
  for (const folder of folders) {
    folderMap.set(folder.id, { folder, children: [] });
  }

  // Build tree structure
  for (const folder of folders) {
    const node = folderMap.get(folder.id)!;
    if (folder.parentId && folderMap.has(folder.parentId)) {
      folderMap.get(folder.parentId)!.children.push(node);
    } else {
      rootNodes.push(node);
    }
  }

  // Sort children alphabetically
  const sortNodes = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => a.folder.name.localeCompare(b.folder.name));
    for (const node of nodes) {
      sortNodes(node.children);
    }
  };
  sortNodes(rootNodes);

  return rootNodes;
}

export function MoveFileDialog({
  open,
  onOpenChange,
  fileName,
  currentFolderId,
  onMove,
  isMoving,
}: MoveFileDialogProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['folders'],
    queryFn: filesApi.getFolders,
    enabled: open,
  });

  const folders = data?.folders || [];

  // Build the folder tree
  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);

  // Auto-expand path to current folder (and the current folder itself) when dialog opens
  useMemo(() => {
    if (currentFolderId && folders.length > 0) {
      const pathToExpand = new Set<string>();
      // Expand the current folder itself so subfolders are visible
      pathToExpand.add(currentFolderId);

      // Also expand all parent folders
      let folderId: string | undefined = currentFolderId;
      while (folderId) {
        const folder = folders.find(f => f.id === folderId);
        if (folder?.parentId) {
          pathToExpand.add(folder.parentId);
          folderId = folder.parentId;
        } else {
          break;
        }
      }

      if (pathToExpand.size > 0) {
        setExpandedFolders(prev => new Set([...prev, ...pathToExpand]));
      }
    }
  }, [currentFolderId, folders]);

  const handleMove = () => {
    onMove(selectedFolderId);
  };

  const handleClose = () => {
    setSelectedFolderId(null);
    setExpandedFolders(new Set());
    onOpenChange(false);
  };

  const toggleExpand = (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const renderFolderNode = (node: FolderNode, depth: number = 0): React.ReactNode => {
    const isSelected = selectedFolderId === node.folder.id;
    const isExpanded = expandedFolders.has(node.folder.id);
    const hasChildren = node.children.length > 0;
    const isCurrent = node.folder.id === currentFolderId;

    return (
      <div key={node.folder.id}>
        <div
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors',
            isSelected
              ? 'bg-primary text-primary-foreground'
              : isCurrent
              ? 'bg-muted/70'
              : 'hover:bg-muted cursor-pointer'
          )}
          style={{ paddingLeft: `${12 + depth * 20}px` }}
          onClick={() => !isCurrent && setSelectedFolderId(node.folder.id)}
        >
          {/* Expand/collapse button */}
          {hasChildren ? (
            <button
              type="button"
              className={cn(
                "p-0.5 -ml-1 rounded transition-colors",
                isSelected ? "hover:bg-white/20" : "hover:bg-black/10"
              )}
              onClick={(e) => toggleExpand(node.folder.id, e)}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : (
            <span className="w-5" />
          )}

          {/* Folder icon */}
          {isSelected ? (
            <FolderOpen className="h-5 w-5 shrink-0" />
          ) : (
            <Folder className={cn("h-5 w-5 shrink-0", isCurrent && "text-muted-foreground")} />
          )}

          {/* Folder name */}
          <span className={cn("truncate flex-1", isCurrent && "text-muted-foreground")}>
            {node.folder.name}
          </span>

          {/* Current location indicator */}
          {isCurrent && (
            <span className="text-xs bg-muted-foreground/20 text-muted-foreground px-2 py-0.5 rounded">
              current
            </span>
          )}
        </div>

        {/* Children */}
        {hasChildren && isExpanded && (
          <div>
            {node.children.map(child => renderFolderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Move to Folder</DialogTitle>
          <DialogDescription>
            Select a destination folder for "{fileName}".
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : (
            <div className="space-y-1 max-h-[350px] overflow-y-auto">
              {/* Root folder option */}
              <button
                type="button"
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors',
                  selectedFolderId === null
                    ? 'bg-primary text-primary-foreground'
                    : !currentFolderId
                    ? 'bg-muted/70 text-muted-foreground opacity-60'
                    : 'hover:bg-muted'
                )}
                onClick={() => currentFolderId && setSelectedFolderId(null)}
                disabled={!currentFolderId}
              >
                <span className="w-5" />
                <Home className="h-5 w-5 shrink-0" />
                <span className="font-medium">Root</span>
                {!currentFolderId && (
                  <span className="text-xs bg-muted-foreground/20 px-2 py-0.5 rounded ml-auto">
                    current
                  </span>
                )}
              </button>

              {/* Folder tree */}
              {folderTree.map(node => renderFolderNode(node))}

              {folderTree.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No folders available
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleMove}
            disabled={isMoving || isLoading || (selectedFolderId === null && !currentFolderId)}
          >
            {isMoving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
