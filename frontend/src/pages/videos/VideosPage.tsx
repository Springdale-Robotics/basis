import { useState } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { Video, Calendar, Grid, Play, ArrowUpDown } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/shared/ErrorState';
import { EmptyState } from '@/components/shared/EmptyState';
import { TimelineSection } from '@/components/media/TimelineSection';
import { MediaLightbox } from '@/components/media/MediaLightbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { videosApi, filesMediaApi, type Video as VideoType } from '@/api/media';
import { cn, formatDate, formatFileSize } from '@/lib/utils';

type ViewMode = 'grid' | 'timeline';
type SortOption = 'date' | 'name' | 'size';
type SortOrder = 'asc' | 'desc';

export function VideosPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sort, setSort] = useState<SortOption>('date');
  const [order, setOrder] = useState<SortOrder>('desc');
  const [selectedYear, setSelectedYear] = useState<number | undefined>();
  const [selectedMonth, setSelectedMonth] = useState<number | undefined>();
  const [previewVideo, setPreviewVideo] = useState<VideoType | null>(null);

  const VIDEOS_PAGE_SIZE = 100;
  const {
    data: videosData,
    isLoading: videosLoading,
    isError: videosError,
    error: videosErrorObj,
    refetch: refetchVideos,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['videos', sort, order],
    queryFn: ({ pageParam }) =>
      videosApi.list({ limit: VIDEOS_PAGE_SIZE, offset: pageParam, sort, order }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.length * VIDEOS_PAGE_SIZE : undefined,
    enabled: viewMode === 'grid',
  });

  const { data: timelineData, isLoading: timelineLoading, isError: timelineError, error: timelineErrorObj, refetch: refetchTimeline } = useQuery({
    queryKey: ['videos-timeline', selectedYear, selectedMonth],
    queryFn: () => videosApi.getTimeline({ year: selectedYear, month: selectedMonth }),
    enabled: viewMode === 'timeline',
  });

  const videos = videosData?.pages.flatMap((p) => p.videos) || [];
  const timeline = timelineData?.timeline || [];
  const total = videosData?.pages[0]?.total || videos.length;

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

  // Lightbox navigation within the currently loaded video set
  const previewIndex = previewVideo
    ? videos.findIndex((v) => v.id === previewVideo.id)
    : -1;
  const hasPrev = previewIndex > 0;
  const hasNext = previewIndex >= 0 && previewIndex < videos.length - 1;

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
          ) : videosError ? (
            <ErrorState
              title="Couldn't load videos"
              error={videosErrorObj}
              onRetry={refetchVideos}
            />
          ) : videos.length === 0 ? (
            <EmptyState
              icon={<Video className="h-12 w-12" />}
              title="No videos yet"
              description="Upload some videos to get started"
            />
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {videos.map((video) => (
                  <VideoThumbnail
                    key={video.id}
                    video={video}
                    onClick={() => setPreviewVideo(video)}
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
                <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <Skeleton key={j} className="aspect-video" />
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
              title="No videos in timeline"
            />
          ) : (
            timeline.map((group) => (
              <TimelineSection
                key={group.date}
                date={group.date}
                count={group.count}
                gridClassName="sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
              >
                {group.videos.map((video) => (
                  <VideoThumbnail
                    key={video.id}
                    video={video}
                    onClick={() => setPreviewVideo(video)}
                  />
                ))}
              </TimelineSection>
            ))
          )}
        </div>
      )}

      {/* Video Lightbox */}
      {previewVideo && (
        <MediaLightbox
          title={previewVideo.filename}
          onClose={() => setPreviewVideo(null)}
          onPrev={hasPrev ? () => setPreviewVideo(videos[previewIndex - 1]) : undefined}
          onNext={hasNext ? () => setPreviewVideo(videos[previewIndex + 1]) : undefined}
          info={
            <div>
              <p className="font-medium">{previewVideo.filename}</p>
              <p className="text-sm text-white/70">
                {formatDate(previewVideo.createdAt)} &middot;{' '}
                {formatFileSize(previewVideo.sizeBytes)}
              </p>
            </div>
          }
        >
          <video
            src={filesMediaApi.getStreamUrl(previewVideo.id)}
            className="max-h-[90vh] max-w-[90vw]"
            controls
            autoPlay
          />
        </MediaLightbox>
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
        <p className="text-xs text-white/70">{formatFileSize(video.sizeBytes)}</p>
      </div>
    </div>
  );
}
