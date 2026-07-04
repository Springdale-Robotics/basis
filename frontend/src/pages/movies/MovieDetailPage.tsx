import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Film, Play, RotateCcw, Star, Clock, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/shared/ErrorState';
import { VideoPlayer } from '@/components/media/VideoPlayer';
import { moviesApi } from '@/api/media';
import { formatDuration } from '@/lib/utils';

export function MovieDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [isPlaying, setIsPlaying] = useState(false);
  const [resumeFrom, setResumeFrom] = useState(0);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['movie', id],
    queryFn: () => moviesApi.get(id!),
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
          <Skeleton className="h-64 w-full rounded-lg" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div>
        {backLink}
        <ErrorState title="Couldn't load movie" error={error} onRetry={refetch} />
      </div>
    );
  }

  if (!data?.movie) {
    return (
      <div>
        {backLink}
        <ErrorState title="Movie not found" description="It may have been removed from the library." />
      </div>
    );
  }

  const { movie, file, progress } = data;
  const year = movie.releaseDate ? new Date(movie.releaseDate).getFullYear() : null;
  const canResume =
    !!progress &&
    !progress.completed &&
    progress.positionSeconds > 0 &&
    (!progress.durationSeconds ||
      progress.positionSeconds < progress.durationSeconds - 5);

  const startPlayback = (from: number) => {
    setResumeFrom(from);
    setIsPlaying(true);
  };

  return (
    <div>
      {backLink}

      {/* Player */}
      {isPlaying && file && (
        <div className="mb-6">
          <VideoPlayer fileId={file.id} startAt={resumeFrom} className="max-h-[70vh]" />
        </div>
      )}

      {/* Backdrop */}
      {!isPlaying && movie.backdropPath && (
        <div className="mb-6 h-48 overflow-hidden rounded-lg bg-muted md:h-64">
          <img
            src={movie.backdropPath}
            alt=""
            className="h-full w-full object-cover"
          />
        </div>
      )}

      <div className="flex flex-col gap-6 md:flex-row">
        {/* Poster */}
        <div className="w-40 shrink-0 md:w-48">
          <div className="aspect-[2/3] overflow-hidden rounded-lg bg-muted">
            {movie.posterPath ? (
              <img
                src={movie.posterPath}
                alt={movie.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Film className="h-12 w-12 text-muted-foreground" />
              </div>
            )}
          </div>
        </div>

        {/* Details */}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            {movie.title}
          </h1>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {year && (
              <span className="flex items-center">
                <Calendar className="mr-1 h-4 w-4" />
                {year}
              </span>
            )}
            {movie.runtime && (
              <span className="flex items-center">
                <Clock className="mr-1 h-4 w-4" />
                {movie.runtime} min
              </span>
            )}
            {movie.tmdbRating && (
              <span className="flex items-center">
                <Star className="mr-1 h-4 w-4 fill-yellow-500 text-yellow-500" />
                {movie.tmdbRating.toFixed(1)}
              </span>
            )}
          </div>

          {movie.genres && movie.genres.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {movie.genres.map((genre) => (
                <Badge key={genre} variant="secondary">
                  {genre}
                </Badge>
              ))}
            </div>
          )}

          {/* Play actions */}
          <div className="mt-4 flex flex-wrap gap-2">
            {file ? (
              <>
                {canResume && progress && (
                  <Button onClick={() => startPlayback(progress.positionSeconds)}>
                    <Play className="mr-2 h-4 w-4" />
                    Resume from {formatDuration(progress.positionSeconds)}
                  </Button>
                )}
                <Button
                  variant={canResume ? 'outline' : 'default'}
                  onClick={() => startPlayback(0)}
                >
                  {canResume ? (
                    <RotateCcw className="mr-2 h-4 w-4" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  {canResume ? 'Play from beginning' : 'Play'}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No video file is linked to this movie.
              </p>
            )}
          </div>

          {movie.overview && (
            <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted-foreground">
              {movie.overview}
            </p>
          )}

          {movie.director && (
            <p className="mt-4 text-sm">
              <span className="font-medium">Director:</span>{' '}
              <span className="text-muted-foreground">{movie.director}</span>
            </p>
          )}

          {movie.cast && movie.cast.length > 0 && (
            <div className="mt-4">
              <h2 className="text-sm font-medium">Cast</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {movie.cast
                  .slice(0, 12)
                  .map((member) =>
                    member.character
                      ? `${member.name} (${member.character})`
                      : member.name
                  )
                  .join(', ')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
