import { useState } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { Camera, Calendar, MapPin, Grid } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/shared/ErrorState';
import { EmptyState } from '@/components/shared/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TimelineSection } from '@/components/media/TimelineSection';
import { MediaLightbox } from '@/components/media/MediaLightbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { photosApi, filesMediaApi, type Photo } from '@/api/media';
import { formatDate } from '@/lib/utils';

type ViewMode = 'grid' | 'timeline' | 'map';

export function PhotosPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [selectedYear, setSelectedYear] = useState<number | undefined>();
  const [selectedMonth, setSelectedMonth] = useState<number | undefined>();
  const [previewPhoto, setPreviewPhoto] = useState<Photo | null>(null);

  const PHOTOS_PAGE_SIZE = 100;
  const {
    data: photosData,
    isLoading: photosLoading,
    isError: photosError,
    error: photosErrorObj,
    refetch: refetchPhotos,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['photos', selectedYear, selectedMonth],
    queryFn: ({ pageParam }) =>
      photosApi.list({ limit: PHOTOS_PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.length * PHOTOS_PAGE_SIZE : undefined,
    enabled: viewMode === 'grid',
  });

  const { data: timelineData, isLoading: timelineLoading, isError: timelineError, error: timelineErrorObj, refetch: refetchTimeline } = useQuery({
    queryKey: ['photos-timeline', selectedYear, selectedMonth],
    queryFn: () => photosApi.getTimeline({ year: selectedYear, month: selectedMonth }),
    enabled: viewMode === 'timeline',
  });

  const { data: locationsData } = useQuery({
    queryKey: ['photos-locations'],
    queryFn: () => photosApi.getLocations(),
    enabled: viewMode === 'map',
  });

  const photos = photosData?.pages.flatMap((p) => p.photos) || [];
  const timeline = timelineData?.timeline || [];
  const locations = locationsData?.locations || [];

  const years = Array.from(
    new Set(timeline.map((t) => new Date(t.date).getFullYear()))
  ).sort((a, b) => b - a);

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  // Lightbox navigation within the currently loaded photo set
  const previewIndex = previewPhoto
    ? photos.findIndex((p) => p.id === previewPhoto.id)
    : -1;
  const hasPrev = previewIndex > 0;
  const hasNext = previewIndex >= 0 && previewIndex < photos.length - 1;

  return (
    <div>
      <PageHeader
        title="Photos"
        description={`${photos.length} photos`}
      />

      {/* View Controls */}
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
          <TabsList>
            <TabsTrigger value="grid">
              <Grid className="mr-2 h-4 w-4" />
              Grid
            </TabsTrigger>
            <TabsTrigger value="timeline">
              <Calendar className="mr-2 h-4 w-4" />
              Timeline
            </TabsTrigger>
            <TabsTrigger value="map">
              <MapPin className="mr-2 h-4 w-4" />
              Map
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {viewMode === 'timeline' && (
          <div className="flex gap-2">
            <Select
              value={selectedYear?.toString() || 'all'}
              onValueChange={(v) => setSelectedYear(v === 'all' ? undefined : parseInt(v, 10))}
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {years.map((year) => (
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={selectedMonth?.toString() || 'all'}
              onValueChange={(v) => setSelectedMonth(v === 'all' ? undefined : parseInt(v, 10))}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Months</SelectItem>
                {months.map((month, i) => (
                  <SelectItem key={i} value={(i + 1).toString()}>
                    {month}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Grid View */}
      {viewMode === 'grid' && (
        <div>
          {photosLoading ? (
            <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 24 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square" />
              ))}
            </div>
          ) : photosError ? (
            <ErrorState
              title="Couldn't load photos"
              error={photosErrorObj}
              onRetry={refetchPhotos}
            />
          ) : photos.length === 0 ? (
            <EmptyState
              icon={<Camera className="h-12 w-12" />}
              title="No photos yet"
              description="Upload some photos to get started"
            />
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {photos.map((photo) => (
                  <PhotoThumbnail
                    key={photo.id}
                    photo={photo}
                    onClick={() => setPreviewPhoto(photo)}
                  />
                ))}
              </div>
              {hasNextPage && (
                <div className="mt-6 flex justify-center">
                  <Button
                    variant="outline"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Timeline View */}
      {viewMode === 'timeline' && (
        <div className="space-y-8">
          {timelineLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-4">
                <Skeleton className="h-6 w-40" />
                <div className="grid gap-2 sm:grid-cols-4 md:grid-cols-6">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <Skeleton key={j} className="aspect-square" />
                  ))}
                </div>
              </div>
            ))
          ) : timelineError ? (
            <ErrorState
              title="Couldn't load timeline"
              error={timelineErrorObj}
              onRetry={refetchTimeline}
            />
          ) : timeline.length === 0 ? (
            <EmptyState
              icon={<Calendar className="h-12 w-12" />}
              title="No photos in timeline"
            />
          ) : (
            timeline.map((group) => (
              <TimelineSection
                key={group.date}
                date={group.date}
                count={group.count}
                gridClassName="sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8"
              >
                {group.photos.map((photo) => (
                  <PhotoThumbnail
                    key={photo.id}
                    photo={photo}
                    onClick={() => setPreviewPhoto(photo)}
                  />
                ))}
              </TimelineSection>
            ))
          )}
        </div>
      )}

      {/* Map View */}
      {viewMode === 'map' && (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center">
              <MapPin className="mb-4 h-12 w-12 text-muted-foreground" />
              <p className="text-lg font-medium">Location View</p>
              <p className="text-sm text-muted-foreground mb-4">
                {locations.length} location clusters with photos
              </p>
              {locations.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 max-w-2xl">
                  {locations.slice(0, 9).map((loc, i) => (
                    <div key={i} className="rounded-lg border p-3">
                      <p className="font-medium">{loc.count} photos</p>
                      <p className="text-xs text-muted-foreground">
                        {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Photo Lightbox */}
      {previewPhoto && (
        <MediaLightbox
          title={previewPhoto.filename}
          onClose={() => setPreviewPhoto(null)}
          onPrev={hasPrev ? () => setPreviewPhoto(photos[previewIndex - 1]) : undefined}
          onNext={hasNext ? () => setPreviewPhoto(photos[previewIndex + 1]) : undefined}
          info={
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{previewPhoto.filename}</p>
                {previewPhoto.metadata?.dateTaken && (
                  <p className="text-sm text-white/70">
                    {formatDate(previewPhoto.metadata.dateTaken)}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {previewPhoto.metadata?.cameraMake && (
                  <Badge variant="secondary">
                    <Camera className="mr-1 h-3 w-3" />
                    {previewPhoto.metadata.cameraModel || previewPhoto.metadata.cameraMake}
                  </Badge>
                )}
                {previewPhoto.metadata?.latitude && (
                  <Badge variant="secondary">
                    <MapPin className="mr-1 h-3 w-3" />
                    Location
                  </Badge>
                )}
              </div>
            </div>
          }
        >
          <img
            src={filesMediaApi.getThumbnailUrl(previewPhoto.id, 'lg')}
            alt={previewPhoto.filename}
            className="max-h-[90vh] max-w-[90vw] object-contain"
            onError={(e) => {
              const img = e.currentTarget;
              const streamUrl = filesMediaApi.getStreamUrl(previewPhoto.id);
              if (img.src !== streamUrl) {
                img.src = streamUrl;
              }
            }}
          />
        </MediaLightbox>
      )}
    </div>
  );
}

interface PhotoThumbnailProps {
  photo: Photo;
  onClick: () => void;
}

function PhotoThumbnail({ photo, onClick }: PhotoThumbnailProps) {
  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    // Fallback to stream URL if thumbnail fails to load
    const img = e.currentTarget;
    const streamUrl = filesMediaApi.getStreamUrl(photo.id);
    if (img.src !== streamUrl) {
      img.src = streamUrl;
    }
  };

  return (
    <div
      className="group relative aspect-square cursor-pointer overflow-hidden rounded-md bg-muted"
      onClick={onClick}
    >
      <img
        src={filesMediaApi.getThumbnailUrl(photo.id, 'md')}
        alt={photo.filename}
        className="h-full w-full object-cover transition-transform group-hover:scale-105"
        loading="lazy"
        onError={handleImageError}
      />
      <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/20" />
    </div>
  );
}
