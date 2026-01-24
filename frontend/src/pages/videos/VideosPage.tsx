import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Video,
  Calendar,
  Grid,
  ChevronLeft,
  ChevronRight,
  Play,
  ArrowUpDown,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { videosApi, filesMediaApi, type Video as VideoType, type VideoTimelineGroup } from '@/api/media';
import { cn, formatDate } from '@/lib/utils';

type ViewMode = 'grid' | 'timeline';
type SortOption = 'date' | 'name' | 'size';
type SortOrder = 'asc' | 'desc';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function VideosPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sort, setSort] = useState<SortOption>('date');
  const [order, setOrder] = useState<SortOrder>('desc');
  const [selectedYear, setSelectedYear] = useState<number | undefined>();
  const [selectedMonth, setSelectedMonth] = useState<number | undefined>();
  const [previewVideo, setPreviewVideo] = useState<VideoType | null>(null);

  const { data: videosData, isLoading: videosLoading } = useQuery({
    queryKey: ['videos', sort, order],
    queryFn: () => videosApi.list({ limit: 200, sort, order }),
    enabled: viewMode === 'grid',
  });

  const { data: timelineData, isLoading: timelineLoading } = useQuery({
    queryKey: ['videos-timeline', selectedYear, selectedMonth],
    queryFn: () => videosApi.getTimeline({ year: selectedYear, month: selectedMonth }),
    enabled: viewMode === 'timeline',
  });

  const videos = videosData?.videos || [];
  const timeline = timelineData?.timeline || [];
  const total = videosData?.total || videos.length;

  const years = Array.from(
    new Set(timeline.map((t) => new Date(t.date).getFullYear()))
  ).sort((a, b) => b - a);

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const toggleOrder = () => {
    setOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  };

  return (
    <div>
      <PageHeader
        title="Videos"
        description={`${total} videos`}
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
          </TabsList>
        </Tabs>

        {viewMode === 'grid' && (
          <div className="flex gap-2">
            <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date">Date</SelectItem>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="size">Size</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={toggleOrder}>
              <ArrowUpDown className={cn("h-4 w-4", order === 'asc' && "rotate-180")} />
            </Button>
          </div>
        )}

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
          {videosLoading ? (
            <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 24 }).map((_, i) => (
                <Skeleton key={i} className="aspect-video" />
              ))}
            </div>
          ) : videos.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Video className="mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-lg font-medium">No videos yet</p>
                <p className="text-sm text-muted-foreground">
                  Upload some videos to get started
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {videos.map((video) => (
                <VideoThumbnail
                  key={video.id}
                  video={video}
                  onClick={() => setPreviewVideo(video)}
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
                <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <Skeleton key={j} className="aspect-video" />
                  ))}
                </div>
              </div>
            ))
          ) : timeline.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Calendar className="mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-lg font-medium">No videos in timeline</p>
              </CardContent>
            </Card>
          ) : (
            timeline.map((group) => (
              <TimelineGroupSection
                key={group.date}
                group={group}
                onVideoClick={setPreviewVideo}
              />
            ))
          )}
        </div>
      )}

      {/* Video Preview Modal */}
      {previewVideo && (
        <VideoPreviewModal
          video={previewVideo}
          videos={videos}
          onClose={() => setPreviewVideo(null)}
          onNavigate={setPreviewVideo}
        />
      )}
    </div>
  );
}

interface VideoThumbnailProps {
  video: VideoType;
  onClick: () => void;
}

function VideoThumbnail({ video, onClick }: VideoThumbnailProps) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  const handleImageError = () => {
    setThumbnailFailed(true);
  };

  return (
    <div
      className="group relative aspect-video cursor-pointer overflow-hidden rounded-md bg-muted"
      onClick={onClick}
    >
      {!thumbnailFailed ? (
        <img
          src={filesMediaApi.getThumbnailUrl(video.id, 'md')}
          alt={video.filename}
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
          loading="lazy"
          onError={handleImageError}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Video className="h-12 w-12 text-muted-foreground" />
        </div>
      )}
      <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/20" />

      {/* Play button overlay */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="rounded-full bg-black/50 p-3 opacity-80 group-hover:opacity-100 transition-opacity">
          <Play className="h-6 w-6 text-white" fill="white" />
        </div>
      </div>

      {/* Video info overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
        <p className="truncate text-xs text-white">{video.filename}</p>
        <p className="text-xs text-white/70">{formatBytes(video.sizeBytes)}</p>
      </div>
    </div>
  );
}

interface TimelineGroupSectionProps {
  group: VideoTimelineGroup;
  onVideoClick: (video: VideoType) => void;
}

function TimelineGroupSection({ group, onVideoClick }: TimelineGroupSectionProps) {
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
      <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {group.videos.map((video) => (
          <VideoThumbnail
            key={video.id}
            video={video}
            onClick={() => onVideoClick(video)}
          />
        ))}
      </div>
    </div>
  );
}

interface VideoPreviewModalProps {
  video: VideoType;
  videos: VideoType[];
  onClose: () => void;
  onNavigate: (video: VideoType) => void;
}

function VideoPreviewModal({ video, videos, onClose, onNavigate }: VideoPreviewModalProps) {
  const currentIndex = videos.findIndex((v) => v.id === video.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < videos.length - 1;

  const handlePrev = () => {
    if (hasPrev) onNavigate(videos[currentIndex - 1]);
  };

  const handleNext = () => {
    if (hasNext) onNavigate(videos[currentIndex + 1]);
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

      {/* Video player */}
      <video
        src={filesMediaApi.getStreamUrl(video.id)}
        className="max-h-[90vh] max-w-[90vw]"
        controls
        autoPlay
        onClick={(e) => e.stopPropagation()}
      />

      {/* Info bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-4 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">{video.filename}</p>
            <p className="text-sm text-gray-300">
              {formatDate(video.createdAt)} &middot; {formatBytes(video.sizeBytes)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
