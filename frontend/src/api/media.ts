import { apiGet, apiPost, apiPut, apiDelete } from './client';

// ==================== Types ====================

export interface Photo {
  id: string;
  householdId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  type: string;
  createdAt: string;
  updatedAt: string;
  metadata?: PhotoMetadata | null;
}

export interface PhotoMetadata {
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  focalLength?: number;
  aperture?: number;
  shutterSpeed?: string;
  iso?: number;
  latitude?: number;
  longitude?: number;
  dateTaken?: string;
  orientation?: number;
}

export interface SmartAlbum {
  id: string;
  householdId: string;
  name: string;
  description?: string;
  criteria: SmartAlbumCriteria;
  coverFileId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SmartAlbumCriteria {
  dateRange?: { start: string; end: string };
  location?: { lat: number; lng: number; radiusKm: number };
  locationName?: string;
  cameraMake?: string;
  cameraModel?: string;
  tags?: string[];
  minRating?: number;
  isFavorite?: boolean;
}

export interface TimelineGroup {
  date: string;
  count: number;
  photos: Photo[];
}

export interface Video {
  id: string;
  householdId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  type: string;
  createdAt: string;
  updatedAt: string;
}

export interface VideoTimelineGroup {
  date: string;
  count: number;
  videos: Video[];
}

export interface LocationCluster {
  lat: number;
  lng: number;
  count: number;
  photos: string[];
}

export interface CameraInfo {
  make: string;
  models: string[];
}

export interface Movie {
  id: string;
  fileId: string;
  householdId: string;
  title: string;
  overview?: string;
  releaseDate?: string;
  runtime?: number;
  genres?: string[];
  posterPath?: string;
  backdropPath?: string;
  director?: string;
  cast?: { name: string; character?: string; profilePath?: string }[];
  tmdbId?: number;
  imdbId?: string;
  tmdbRating?: number;
  manualMatch?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TvShow {
  id: string;
  householdId: string;
  name: string;
  overview?: string;
  status?: string;
  firstAirDate?: string;
  genres?: string[];
  posterPath?: string;
  backdropPath?: string;
  numberOfSeasons: number;
  numberOfEpisodes: number;
  tmdbId?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TvEpisode {
  id: string;
  showId: string;
  fileId: string;
  seasonNumber: number;
  episodeNumber: number;
  name?: string;
  overview?: string;
  airDate?: string;
  stillPath?: string;
  runtime?: number;
  progress?: WatchProgress | null;
  createdAt: string;
  updatedAt: string;
}

export interface TvSeason {
  number: number;
  episodes: TvEpisode[];
}

export interface WatchProgress {
  id: string;
  userId: string;
  fileId: string;
  positionSeconds: number;
  durationSeconds?: number;
  completed: boolean;
  completedAt?: string;
  lastWatchedAt: string;
}

export interface ContinueWatchingItem {
  type: 'movie' | 'episode';
  item: Movie | TvEpisode;
  progress: WatchProgress;
}

export interface HlsStream {
  id: string;
  fileId: string;
  profile: '1080p' | '720p' | '480p';
  ready: boolean;
}

export interface Artist {
  id: string;
  householdId: string;
  name: string;
  sortName?: string;
  musicbrainzId?: string;
  biography?: string;
  imageUrl?: string;
  imagePath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MusicAlbum {
  id: string;
  householdId: string;
  artistId?: string;
  name: string;
  releaseDate?: string;
  releaseType?: string;
  genres?: string[];
  coverArtPath?: string;
  totalTracks: number;
  totalDiscs: number;
  createdAt: string;
  updatedAt: string;
  artistName?: string;
}

export interface Track {
  id: string;
  fileId: string;
  albumId?: string;
  artistId?: string;
  title: string;
  trackNumber?: number;
  discNumber?: number;
  duration?: number;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  albumArtist?: string;
  composer?: string;
  genre?: string;
  year?: number;
  createdAt: string;
  updatedAt: string;
  file?: { mimeType: string } | null;
  lastPlayed?: string;
}

export interface PlayQueue {
  id: string;
  userId: string;
  currentIndex: number;
  currentPosition: number;
  shuffled: boolean;
  repeatMode: 'off' | 'all' | 'one';
  updatedAt: string;
}

export interface PlayQueueItem {
  id: string;
  queueId: string;
  trackId: string;
  sortOrder: number;
  track: Track | null;
}

export interface ListenHistoryItem {
  id: string;
  userId: string;
  trackId: string;
  listenedAt: string;
  duration?: number;
  track: Track | null;
}

// ==================== Photos API ====================

export const photosApi = {
  list: (params?: {
    startDate?: string;
    endDate?: string;
    cameraMake?: string;
    cameraModel?: string;
    hasLocation?: boolean;
    limit?: number;
    offset?: number;
  }) =>
    apiGet<{ photos: Photo[]; hasMore: boolean; total: number }>('/photos', {
      params: params as Record<string, string | number | boolean | undefined>,
    }),

  getTimeline: (params?: { year?: number; month?: number }) =>
    apiGet<{ timeline: TimelineGroup[] }>('/photos/timeline', {
      params: params as Record<string, string | number | boolean | undefined>,
    }),

  getLocations: () =>
    apiGet<{ locations: LocationCluster[] }>('/photos/locations'),

  getMetadata: (id: string) =>
    apiGet<{ photo: Photo; metadata: PhotoMetadata | null }>(`/photos/${id}/metadata`),

  getCameras: () => apiGet<{ cameras: CameraInfo[] }>('/photos/cameras'),

  // Smart Albums
  getSmartAlbums: () => apiGet<{ albums: SmartAlbum[] }>('/photos/smart-albums'),

  getSmartAlbum: (id: string) =>
    apiGet<{ album: SmartAlbum; photos: Photo[] }>(`/photos/smart-albums/${id}`),

  createSmartAlbum: (data: { name: string; description?: string; criteria: SmartAlbumCriteria }) =>
    apiPost<{ album: SmartAlbum }>('/photos/smart-albums', data),

  updateSmartAlbum: (
    id: string,
    data: Partial<{ name: string; description?: string; criteria: SmartAlbumCriteria }>
  ) => apiPut<{ album: SmartAlbum }>(`/photos/smart-albums/${id}`, data),

  deleteSmartAlbum: (id: string) =>
    apiDelete<{ message: string }>(`/photos/smart-albums/${id}`),
};

// ==================== Videos API ====================

export const videosApi = {
  list: (params?: {
    limit?: number;
    offset?: number;
    sort?: 'date' | 'name' | 'size';
    order?: 'asc' | 'desc';
  }) =>
    apiGet<{ videos: Video[]; hasMore: boolean; total: number }>('/videos', {
      params: params as Record<string, string | number | boolean | undefined>,
    }),

  getTimeline: (params?: { year?: number; month?: number }) =>
    apiGet<{ timeline: VideoTimelineGroup[] }>('/videos/timeline', {
      params: params as Record<string, string | number | boolean | undefined>,
    }),
};

// ==================== Movies API ====================

export const moviesApi = {
  // Movies
  list: (params?: {
    genre?: string;
    year?: number;
    unwatched?: boolean;
    sortBy?: 'title' | 'releaseDate' | 'addedDate' | 'rating';
    limit?: number;
    offset?: number;
  }) =>
    apiGet<{ movies: Movie[]; total: number; hasMore: boolean }>('/media/movies', {
      params: params as Record<string, string | number | boolean | undefined>,
    }),

  getContinueWatching: () =>
    apiGet<{ items: ContinueWatchingItem[] }>('/media/movies/continue'),

  get: (id: string) =>
    apiGet<{
      movie: Movie;
      file: { id: string; mimeType: string; sizeBytes: number } | null;
      progress: WatchProgress | null;
      streams: HlsStream[];
    }>(`/media/movies/${id}`),

  create: (data: { fileId: string; title: string }) =>
    apiPost<{ movie: Movie }>('/media/movies', data),

  setMetadata: (
    id: string,
    data: {
      title: string;
      overview?: string;
      releaseDate?: string;
      runtime?: number;
      genres?: string[];
      director?: string;
      tmdbId?: number;
      imdbId?: string;
    }
  ) => apiPost<{ movie: Movie }>(`/media/movies/${id}/metadata`, data),

  delete: (id: string) => apiDelete<{ message: string }>(`/media/movies/${id}`),

  // TV Shows
  getTvShows: () => apiGet<{ shows: TvShow[] }>('/media/tv'),

  getTvShow: (id: string) =>
    apiGet<{ show: TvShow; seasons: TvSeason[] }>(`/media/tv/${id}`),

  createTvShow: (data: {
    name: string;
    overview?: string;
    status?: string;
    firstAirDate?: string;
    genres?: string[];
    tmdbId?: number;
  }) => apiPost<{ show: TvShow }>('/media/tv', data),

  addEpisode: (
    showId: string,
    data: {
      fileId: string;
      seasonNumber: number;
      episodeNumber: number;
      name?: string;
    }
  ) => apiPost<{ episode: TvEpisode }>(`/media/tv/${showId}/episodes`, data),

  deleteTvShow: (id: string) => apiDelete<{ message: string }>(`/media/tv/${id}`),

  // Watch Progress
  updateProgress: (
    fileId: string,
    data: { positionSeconds: number; durationSeconds?: number; completed?: boolean }
  ) => apiPut<{ message: string }>(`/media/progress/${fileId}`, data),

  getProgress: (fileId: string) =>
    apiGet<{ progress: WatchProgress | null }>(`/media/progress/${fileId}`),

  // Genres
  getGenres: () => apiGet<{ genres: string[] }>('/media/genres'),

  // Streaming URLs (for direct use in video elements)
  getStreamUrl: (fileId: string) => `/api/v1/files/${fileId}/stream`,
};

// ==================== Music API ====================

export const musicApi = {
  // Artists
  getArtists: (params?: { search?: string; limit?: number; offset?: number }) =>
    apiGet<{ artists: Artist[]; total: number; hasMore: boolean }>('/music/artists', {
      params: params as Record<string, string | number | boolean | undefined>,
    }),

  getArtist: (id: string) =>
    apiGet<{ artist: Artist; albums: MusicAlbum[]; looseTracks: Track[] }>(
      `/music/artists/${id}`
    ),

  createArtist: (data: { name: string; sortName?: string; biography?: string }) =>
    apiPost<{ artist: Artist }>('/music/artists', data),

  // Albums
  getAlbums: (params?: {
    artistId?: string;
    genre?: string;
    sortBy?: 'name' | 'releaseDate' | 'artist';
    limit?: number;
    offset?: number;
  }) =>
    apiGet<{ albums: MusicAlbum[]; total: number; hasMore: boolean }>('/music/albums', {
      params: params as Record<string, string | number | boolean | undefined>,
    }),

  getAlbum: (id: string) =>
    apiGet<{
      album: MusicAlbum;
      artist: Artist | null;
      tracks: (Track & { file: { mimeType: string } | null })[];
    }>(`/music/albums/${id}`),

  // Tracks
  getStreamUrl: (trackId: string) => `/api/v1/music/tracks/${trackId}/stream`,

  recordListen: (trackId: string, duration?: number) =>
    apiPost<{ message: string }>(`/music/tracks/${trackId}/listen`, { duration }),

  // Play Queue
  getQueue: () => apiGet<{ queue: PlayQueue; items: PlayQueueItem[] }>('/music/queue'),

  updateQueue: (data: {
    trackIds?: string[];
    currentIndex?: number;
    currentPosition?: number;
    shuffled?: boolean;
    repeatMode?: 'off' | 'all' | 'one';
  }) => apiPut<{ message: string }>('/music/queue', data),

  addToQueue: (trackIds: string[], position?: 'end' | 'next') =>
    apiPost<{ message: string }>('/music/queue/add', { trackIds, position }),

  clearQueue: () => apiDelete<{ message: string }>('/music/queue'),

  // History
  getHistory: (params?: { limit?: number; offset?: number }) =>
    apiGet<{ history: ListenHistoryItem[]; hasMore: boolean }>('/music/history', {
      params: params as Record<string, string | number | boolean | undefined>,
    }),

  getRecent: (limit?: number) =>
    apiGet<{ tracks: (Track & { lastPlayed: string })[] }>('/music/recent', {
      params: { limit },
    }),

  // Genres
  getGenres: () => apiGet<{ genres: string[] }>('/music/genres'),
};

// ==================== Files Extensions ====================

export const filesMediaApi = {
  // Thumbnails
  getThumbnailUrl: (fileId: string, size: 'sm' | 'md' | 'lg' = 'md') =>
    `/api/v1/files/${fileId}/thumbnail/${size}`,

  // Favorites
  getFavorites: () => apiGet<{ files: Photo[] }>('/files/favorites'),

  addFavorite: (fileId: string) =>
    apiPost<{ message: string }>(`/files/${fileId}/favorite`),

  removeFavorite: (fileId: string) =>
    apiDelete<{ message: string }>(`/files/${fileId}/favorite`),

  // Ratings
  setRating: (fileId: string, rating: number) =>
    apiPut<{ rating: number }>(`/files/${fileId}/rating`, { rating }),

  getRating: (fileId: string) =>
    apiGet<{ rating: number | null }>(`/files/${fileId}/rating`),

  deleteRating: (fileId: string) =>
    apiDelete<{ message: string }>(`/files/${fileId}/rating`),

  // Streaming
  getStreamUrl: (fileId: string) => `/api/v1/files/${fileId}/stream`,
};
