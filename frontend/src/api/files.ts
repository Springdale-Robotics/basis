import { apiGet, apiPost, apiDelete, apiUpload } from './client';
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

  // Download streams file directly - use window.open or fetch blob
  getDownloadUrl: (id: string) => `/api/files/${id}/download`,

  // Folders
  getFolders: () =>
    apiGet<{ folders: FileItem[] }>('/files/folders'),

  getFolder: (id: string) =>
    apiGet<{ folder: FileItem; subfolders: FileItem[]; files: FileItem[] }>(`/files/folders/${id}`),

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
};
