import { useState, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Upload, X, File, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UploadFile {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload: (file: File, onProgress: (progress: number) => void) => Promise<void>;
  onComplete?: () => void;
  currentFolderName?: string;
}

let fileIdCounter = 0;

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function UploadDialog({
  open,
  onOpenChange,
  onUpload,
  onComplete,
  currentFolderName,
}: UploadDialogProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const uploadFiles: UploadFile[] = Array.from(newFiles).map((file) => ({
      id: `upload-${++fileIdCounter}`,
      file,
      progress: 0,
      status: 'pending' as const,
    }));
    setFiles((prev) => [...prev, ...uploadFiles]);
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
      }
      // Reset input so same file can be selected again
      e.target.value = '';
    },
    [addFiles]
  );

  const uploadFiles = async () => {
    const pendingFiles = files.filter((f) => f.status === 'pending');
    if (pendingFiles.length === 0) return;

    setIsUploading(true);

    for (const uploadFile of pendingFiles) {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === uploadFile.id ? { ...f, status: 'uploading' } : f
        )
      );

      try {
        await onUpload(uploadFile.file, (progress) => {
          setFiles((prev) =>
            prev.map((f) => (f.id === uploadFile.id ? { ...f, progress } : f))
          );
        });

        setFiles((prev) =>
          prev.map((f) =>
            f.id === uploadFile.id
              ? { ...f, status: 'success', progress: 100 }
              : f
          )
        );
      } catch (err) {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === uploadFile.id
              ? {
                  ...f,
                  status: 'error',
                  error: err instanceof Error ? err.message : 'Upload failed',
                }
              : f
          )
        );
      }
    }

    setIsUploading(false);
    onComplete?.();
  };

  const handleClose = () => {
    if (!isUploading) {
      setFiles([]);
      onOpenChange(false);
    }
  };

  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const successCount = files.filter((f) => f.status === 'success').length;
  const errorCount = files.filter((f) => f.status === 'error').length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Upload Files</DialogTitle>
          <DialogDescription>
            {currentFolderName
              ? `Upload files to "${currentFolderName}".`
              : 'Upload files to the root directory.'}
          </DialogDescription>
        </DialogHeader>

        {/* Drop zone */}
        <div
          className={cn(
            'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-primary/50',
            isUploading && 'pointer-events-none opacity-50'
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            Drop files here or click to browse
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="max-h-[240px] overflow-y-auto space-y-2">
            {files.map((uploadFile) => (
              <div
                key={uploadFile.id}
                className="flex items-center gap-3 p-2 rounded-lg bg-muted/50"
              >
                <div className="shrink-0">
                  {uploadFile.status === 'success' ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : uploadFile.status === 'error' ? (
                    <AlertCircle className="h-5 w-5 text-destructive" />
                  ) : (
                    <File className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {uploadFile.file.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(uploadFile.file.size)}
                    {uploadFile.error && (
                      <span className="text-destructive ml-2">
                        {uploadFile.error}
                      </span>
                    )}
                  </p>
                  {uploadFile.status === 'uploading' && (
                    <Progress value={uploadFile.progress} className="h-1 mt-1" />
                  )}
                </div>
                {uploadFile.status === 'pending' && !isUploading && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(uploadFile.id);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Summary */}
        {files.length > 0 && (
          <div className="text-sm text-muted-foreground">
            {pendingCount > 0 && `${pendingCount} pending`}
            {successCount > 0 && `${pendingCount > 0 ? ', ' : ''}${successCount} uploaded`}
            {errorCount > 0 && `${pendingCount > 0 || successCount > 0 ? ', ' : ''}${errorCount} failed`}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isUploading}>
            {successCount > 0 && pendingCount === 0 ? 'Done' : 'Cancel'}
          </Button>
          {pendingCount > 0 && (
            <Button onClick={uploadFiles} disabled={isUploading}>
              {isUploading ? 'Uploading...' : `Upload ${pendingCount} file${pendingCount !== 1 ? 's' : ''}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
