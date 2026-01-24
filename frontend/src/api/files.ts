import { apiGet, apiPost, apiPut, apiDelete, apiUpload } from './client';
import type { FileItem, Album } from '@/types/models';

export interface GetFilesParams {
  parentId?: string;
  type?: 'file' | 'folder';
  mimeType?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface CreateFolderRequest {
  name: string;
  parentId?: string;
}

// Albums
export interface CreateAlbumRequest {
  name: string;
}

export interface AddToAlbumRequest {
  fileIds: string[];
}

// Storage - matches backend response
export interface StorageUsage {
  usedBytes: number;
  breakdown: Record<string, number>;
  filesystem: {
    totalBytes: number;
    availableBytes: number;
  } | null;
  effectiveLimit: number;
  percentUsed: number;
  limitSource: 'household' | 'system' | 'disk';
  householdLimitGb: number | null;
  systemLimitGb: number | null;
}

export const filesApi = {
  list: (params?: GetFilesParams) =>
    apiGet<{ files: FileItem[] }>('/files', {
      params: params as Record<string, string | number | boolean | undefined>
    }),

  get: (id: string) =>
    apiGet<{ file: FileItem }>(`/files/${id}`),

  upload: (file: File, parentId?: string, onProgress?: (progress: number) => void) =>
    apiUpload<{ file: FileItem }>('/files/upload', file, {
      params: { parentId },
      onProgress
    }),

  createFolder: (data: CreateFolderRequest) =>
    apiPost<{ folder: FileItem }>('/files/folders', data),

  delete: (id: string) =>
    apiDelete<{ message: string }>(`/files/${id}`),

  move: (id: string, targetFolderId: string | null) =>
    apiPut<{ message: string }>(`/files/${id}/move`, { targetFolderId }),

  // Download streams file directly - use window.open or fetch blob
  getDownloadUrl: (id: string) => `/api/files/${id}/download`,

  // Folders
  getFolders: () =>
    apiGet<{ folders: FileItem[] }>('/files/folders'),

  getFolder: (id: string) =>
    apiGet<{ folder: FileItem; subfolders: FileItem[]; files: FileItem[] }>(`/files/folders/${id}`),

  getFolderBreadcrumb: (id: string) =>
    apiGet<{ breadcrumb: { id: string; name: string; parentId: string | null }[] }>(`/files/folders/${id}/breadcrumb`),

  // Albums
  getAlbums: () =>
    apiGet<{ albums: Album[] }>('/files/albums'),

  getAlbum: (id: string) =>
    apiGet<{ album: Album; photos: FileItem[] }>(`/files/albums/${id}`),

  createAlbum: (data: CreateAlbumRequest) =>
    apiPost<{ album: Album }>('/files/albums', data),

  deleteAlbum: (id: string) =>
    apiDelete<{ message: string }>(`/files/albums/${id}`),

  addToAlbum: (id: string, data: AddToAlbumRequest) =>
    apiPost<{ message: string }>(`/files/albums/${id}/photos`, data),

  removeFromAlbum: (albumId: string, fileId: string) =>
    apiDelete<{ message: string }>(`/files/albums/${albumId}/photos/${fileId}`),

  // Storage
  getStorageUsage: () =>
    apiGet<StorageUsage>('/files/storage/usage'),

  // Bulk operations
  bulkExclude: (data: { fileIds?: string[]; folderIds?: string[]; excluded: boolean }) =>
    apiPut<{ message: string; affectedCount: number }>('/files/bulk/exclude', data),

  bulkDelete: (data: { fileIds?: string[]; folderIds?: string[] }) =>
    apiDelete<{ message: string; deletedFiles: number; deletedFolders: number }>('/files/bulk', { data }),

  bulkMove: (data: { fileIds?: string[]; folderIds?: string[]; targetFolderId: string | null }) =>
    apiPut<{ message: string; movedFiles: number; movedFolders: number }>('/files/bulk/move', data),

  // Thumbnail operations
  regenerateThumbnails: (fileIds?: string[]) =>
    apiPost<{ message: string; queuedCount: number }>('/files/thumbnails/regenerate', { fileIds }),

  // Restriction operations
  setFileRestriction: (fileId: string, restricted: boolean) =>
    apiPut<{ message: string; isRestricted: boolean }>(`/files/${fileId}/restrict`, { restricted }),

  getFileRestriction: (fileId: string) =>
    apiGet<{
      isRestricted: boolean;
      restrictedDirectly: boolean;
      restrictedBy: { type: 'file' | 'folder'; id: string; name: string } | null;
    }>(`/files/${fileId}/restriction`),

  setFolderRestriction: (folderId: string, restricted: boolean) =>
    apiPut<{
      message: string;
      isRestricted: boolean;
      affectedFolders: number;
      affectedFiles: number;
    }>(`/files/folders/${folderId}/restrict`, { restricted }),

  getFolderRestriction: (folderId: string) =>
    apiGet<{
      isRestricted: boolean;
      restrictedDirectly: boolean;
      restrictedBy: { type: 'file' | 'folder'; id: string; name: string } | null;
    }>(`/files/folders/${folderId}/restriction`),
};
