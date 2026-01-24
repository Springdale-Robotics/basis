import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Camera,
  Calendar,
  MapPin,
  Grid,
  List,
  Heart,
  Star,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { photosApi, filesMediaApi, type Photo, type TimelineGroup } from '@/api/media';
import { cn, formatDate } from '@/lib/utils';

type ViewMode = 'grid' | 'timeline' | 'map';

export function PhotosPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [selectedYear, setSelectedYear] = useState<number | undefined>();
  const [selectedMonth, setSelectedMonth] = useState<number | undefined>();
  const [previewPhoto, setPreviewPhoto] = useState<Photo | null>(null);

  const { data: photosData, isLoading: photosLoading } = useQuery({
    queryKey: ['photos', selectedYear, selectedMonth],
    queryFn: () => photosApi.list({ limit: 200 }),
    enabled: viewMode === 'grid',
  });

  const { data: timelineData, isLoading: timelineLoading } = useQuery({
    queryKey: ['photos-timeline', selectedYear, selectedMonth],
    queryFn: () => photosApi.getTimeline({ year: selectedYear, month: selectedMonth }),
    enabled: viewMode === 'timeline',
  });

  const { data: locationsData, isLoading: locationsLoading } = useQuery({
    queryKey: ['photos-locations'],
    queryFn: () => photosApi.getLocations(),
    enabled: viewMode === 'map',
  });

  const { data: camerasData } = useQuery({
    queryKey: ['cameras'],
    queryFn: () => photosApi.getCameras(),
  });

  const photos = photosData?.photos || [];
  const timeline = timelineData?.timeline || [];
  const locations = locationsData?.locations || [];
  const cameras = camerasData?.cameras || [];

  const years = Array.from(
    new Set(timeline.map((t) => new Date(t.date).getFullYear()))
  ).sort((a, b) => b - a);

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

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
          ) : photos.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Camera className="mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-lg font-medium">No photos yet</p>
                <p className="text-sm text-muted-foreground">
                  Upload some photos to get started
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {photos.map((photo) => (
                <PhotoThumbnail
                  key={photo.id}
                  photo={photo}
                  onClick={() => setPreviewPhoto(photo)}
                />
              ))}
            </div>
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
          ) : timeline.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Calendar className="mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-lg font-medium">No photos in timeline</p>
              </CardContent>
            </Card>
          ) : (
            timeline.map((group) => (
              <TimelineGroupSection
                key={group.date}
                group={group}
                onPhotoClick={setPreviewPhoto}
              />
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

      {/* Photo Preview Modal */}
      {previewPhoto && (
        <PhotoPreviewModal
          photo={previewPhoto}
          photos={photos}
          onClose={() => setPreviewPhoto(null)}
          onNavigate={setPreviewPhoto}
        />
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

interface TimelineGroupSectionProps {
  group: TimelineGroup;
  onPhotoClick: (photo: Photo) => void;
}

function TimelineGroupSection({ group, onPhotoClick }: TimelineGroupSectionProps) {
  const date = new Date(group.date);
  const formattedDate = date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-lg font-semibold">{formattedDate}</h3>
        <Badge variant="secondary">{group.count}</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
        {group.photos.map((photo) => (
          <PhotoThumbnail
            key={photo.id}
            photo={photo}
            onClick={() => onPhotoClick(photo)}
          />
        ))}
      </div>
    </div>
  );
}

interface PhotoPreviewModalProps {
  photo: Photo;
  photos: Photo[];
  onClose: () => void;
  onNavigate: (photo: Photo) => void;
}

function PhotoPreviewModal({ photo, photos, onClose, onNavigate }: PhotoPreviewModalProps) {
  const currentIndex = photos.findIndex((p) => p.id === photo.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < photos.length - 1;

  const handlePrev = () => {
    if (hasPrev) onNavigate(photos[currentIndex - 1]);
  };

  const handleNext = () => {
    if (hasNext) onNavigate(photos[currentIndex + 1]);
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
        className="absolute top-4 right-4 text-white hover:text-gray-300"
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
          className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
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
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
          onClick={(e) => {
            e.stopPropagation();
            handleNext();
          }}
        >
          <ChevronRight className="h-8 w-8" />
        </button>
      )}

      {/* Image */}
      <img
        src={filesMediaApi.getThumbnailUrl(photo.id, 'lg')}
        alt={photo.filename}
        className="max-h-[90vh] max-w-[90vw] object-contain"
        onClick={(e) => e.stopPropagation()}
        onError={(e) => {
          const img = e.currentTarget;
          const streamUrl = filesMediaApi.getStreamUrl(photo.id);
          if (img.src !== streamUrl) {
            img.src = streamUrl;
          }
        }}
      />

      {/* Info bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-4 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">{photo.filename}</p>
            {photo.metadata?.dateTaken && (
              <p className="text-sm text-gray-300">
                {formatDate(photo.metadata.dateTaken)}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {photo.metadata?.cameraMake && (
              <Badge variant="secondary">
                <Camera className="mr-1 h-3 w-3" />
                {photo.metadata.cameraModel || photo.metadata.cameraMake}
              </Badge>
            )}
            {photo.metadata?.latitude && (
              <Badge variant="secondary">
                <MapPin className="mr-1 h-3 w-3" />
                Location
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
