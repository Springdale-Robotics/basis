import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Tv, Play, Calendar, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ErrorState } from '@/components/shared/ErrorState';
import { EmptyState } from '@/components/shared/EmptyState';
import { VideoPlayer } from '@/components/media/VideoPlayer';
import { moviesApi, type TvEpisode } from '@/api/media';
import { cn, formatDuration } from '@/lib/utils';

interface PlayingEpisode {
  fileId: string;
  startAt: number;
  label: string;
}

export function TvShowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [playing, setPlaying] = useState<PlayingEpisode | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['tv-show', id],
    queryFn: () => moviesApi.getTvShow(id!),
    enabled: !!id,
  });

  const backLink = (
    <div className="mb-4">
      <Button variant="ghost" asChild>
        <Link to="/movies">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Movies & TV
        </Link>
      </Button>
    </div>
  );

  if (isLoading) {
    return (
      <div>
        {backLink}
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div>
        {backLink}
        <ErrorState title="Couldn't load TV show" error={error} onRetry={refetch} />
      </div>
    );
  }

  if (!data?.show) {
    return (
      <div>
        {backLink}
        <ErrorState title="TV show not found" description="It may have been removed from the library." />
      </div>
    );
  }

  const { show, seasons } = data;
  const year = show.firstAirDate ? new Date(show.firstAirDate).getFullYear() : null;

  const playEpisode = (episode: TvEpisode) => {
    const startAt =
      episode.progress && !episode.progress.completed
        ? episode.progress.positionSeconds
        : 0;
    setPlaying({
      fileId: episode.fileId,
      startAt,
      label: `S${episode.seasonNumber}E${episode.episodeNumber}${episode.name ? ` – ${episode.name}` : ''}`,
    });
  };

  return (
    <div>
      {backLink}

      {/* Player */}
      {playing && (
        <div className="mb-6">
          <VideoPlayer
            fileId={playing.fileId}
            startAt={playing.startAt}
            className="max-h-[70vh]"
          />
          <p className="mt-2 text-sm text-muted-foreground">
            Now playing: {playing.label}
          </p>
        </div>
      )}

      {/* Show header */}
      <div className="mb-6 flex flex-col gap-6 md:flex-row">
        <div className="w-40 shrink-0 md:w-48">
          <div className="aspect-[2/3] overflow-hidden rounded-lg bg-muted">
            {show.posterPath ? (
              <img
                src={show.posterPath}
                alt={show.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Tv className="h-12 w-12 text-muted-foreground" />
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            {show.name}
          </h1>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {year && (
              <span className="flex items-center">
                <Calendar className="mr-1 h-4 w-4" />
                {year}
              </span>
            )}
            <span>
              {show.numberOfSeasons}{' '}
              {show.numberOfSeasons === 1 ? 'season' : 'seasons'}
            </span>
            <span>
              {show.numberOfEpisodes}{' '}
              {show.numberOfEpisodes === 1 ? 'episode' : 'episodes'}
            </span>
            {show.status && <span>{show.status}</span>}
          </div>

          {show.genres && show.genres.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {show.genres.map((genre) => (
                <Badge key={genre} variant="secondary">
                  {genre}
                </Badge>
              ))}
            </div>
          )}

          {show.overview && (
            <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted-foreground">
              {show.overview}
            </p>
          )}
        </div>
      </div>

      {/* Seasons */}
      {seasons.length === 0 ? (
        <EmptyState
          icon={<Tv className="h-12 w-12" />}
          title="No episodes yet"
          description="Add video files to this show and they'll appear here."
        />
      ) : (
        <Tabs defaultValue={String(seasons[0].number)}>
          <TabsList className="flex-wrap">
            {seasons.map((season) => (
              <TabsTrigger key={season.number} value={String(season.number)}>
                Season {season.number}
              </TabsTrigger>
            ))}
          </TabsList>

          {seasons.map((season) => (
            <TabsContent
              key={season.number}
              value={String(season.number)}
              className="mt-4"
            >
              <div className="divide-y rounded-lg border">
                {season.episodes.map((episode) => (
                  <EpisodeRow
                    key={episode.id}
                    episode={episode}
                    isPlaying={playing?.fileId === episode.fileId}
                    onPlay={() => playEpisode(episode)}
                  />
                ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}

interface EpisodeRowProps {
  episode: TvEpisode;
  isPlaying: boolean;
  onPlay: () => void;
}

function EpisodeRow({ episode, isPlaying, onPlay }: EpisodeRowProps) {
  const watched = episode.progress?.completed;
  const inProgress =
    episode.progress && !episode.progress.completed && episode.progress.positionSeconds > 0;

  return (
    <div
      className={cn(
        'flex items-center gap-4 p-3 transition-colors hover:bg-muted/50',
        isPlaying && 'bg-muted'
      )}
    >
      <div className="w-10 shrink-0 text-center text-sm text-muted-foreground">
        {episode.episodeNumber}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {episode.name || `Episode ${episode.episodeNumber}`}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          {episode.airDate && (
            <span>{new Date(episode.airDate).toLocaleDateString()}</span>
          )}
          {episode.runtime && <span>{episode.runtime} min</span>}
          {watched && (
            <span className="flex items-center text-primary">
              <Check className="mr-1 h-3 w-3" />
              Watched
            </span>
          )}
          {inProgress && episode.progress && (
            <span>
              Resume from {formatDuration(episode.progress.positionSeconds)}
            </span>
          )}
        </div>
      </div>

      <Button size="sm" variant={isPlaying ? 'secondary' : 'outline'} onClick={onPlay}>
        <Play className="mr-2 h-4 w-4" />
        {inProgress ? 'Resume' : 'Play'}
      </Button>
    </div>
  );
}
