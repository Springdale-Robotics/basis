import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Disc, Play, ListPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ErrorState } from '@/components/shared/ErrorState';
import { EmptyState } from '@/components/shared/EmptyState';
import { musicApi } from '@/api/media';
import { usePlayerStore } from '@/stores/playerStore';
import { cn, formatDuration } from '@/lib/utils';

export function AlbumDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { playTrack, addToQueue, currentTrack, isPlaying } = usePlayerStore();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['album', id],
    queryFn: () => musicApi.getAlbum(id!),
    enabled: !!id,
  });

  const backLink = (
    <div className="mb-4">
      <Button variant="ghost" asChild>
        <Link to="/music">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Music
        </Link>
      </Button>
    </div>
  );

  if (isLoading) {
    return (
      <div>
        {backLink}
        <div className="flex flex-col gap-6 md:flex-row">
          <Skeleton className="h-48 w-48 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-10 w-48" />
          </div>
        </div>
        <div className="mt-6 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div>
        {backLink}
        <ErrorState title="Couldn't load album" error={error} onRetry={refetch} />
      </div>
    );
  }

  if (!data?.album) {
    return (
      <div>
        {backLink}
        <ErrorState title="Album not found" description="It may have been removed from the library." />
      </div>
    );
  }

  const { album, artist, tracks } = data;
  const year = album.releaseDate ? new Date(album.releaseDate).getFullYear() : null;
  const totalSeconds = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);

  return (
    <div>
      {backLink}

      {/* Album header */}
      <div className="mb-6 flex flex-col gap-6 md:flex-row">
        <div className="h-48 w-48 shrink-0 overflow-hidden rounded-lg bg-muted">
          {album.coverArtPath ? (
            <img
              src={album.coverArtPath}
              alt={album.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Disc className="h-16 w-16 text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            {album.name}
          </h1>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {artist ? (
              <Link
                to={`/music/artists/${artist.id}`}
                className="font-medium text-foreground hover:underline"
              >
                {artist.name}
              </Link>
            ) : (
              <span>{album.artistName || 'Unknown Artist'}</span>
            )}
            {year && <span>&bull; {year}</span>}
            <span>
              &bull; {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
            </span>
            {totalSeconds > 0 && <span>&bull; {formatDuration(totalSeconds)}</span>}
          </div>

          {album.genres && album.genres.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {album.genres.map((genre) => (
                <Badge key={genre} variant="secondary">
                  {genre}
                </Badge>
              ))}
            </div>
          )}

          {tracks.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => playTrack(tracks[0], tracks)}>
                <Play className="mr-2 h-4 w-4" />
                Play album
              </Button>
              <Button variant="outline" onClick={() => addToQueue(tracks)}>
                <ListPlus className="mr-2 h-4 w-4" />
                Add to queue
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Track list */}
      {tracks.length === 0 ? (
        <EmptyState
          icon={<Disc className="h-12 w-12" />}
          title="No tracks in this album"
          description="Add music files and they'll appear here."
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="text-right">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tracks.map((track, index) => (
                <TableRow
                  key={track.id}
                  className={cn(
                    'cursor-pointer',
                    currentTrack?.id === track.id && 'bg-muted'
                  )}
                  onClick={() => playTrack(track, tracks)}
                >
                  <TableCell>
                    {currentTrack?.id === track.id && isPlaying ? (
                      <div className="flex h-4 w-4 items-center justify-center">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                      </div>
                    ) : (
                      <span className="text-muted-foreground">
                        {track.trackNumber ?? index + 1}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{track.title}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {track.duration ? formatDuration(track.duration) : '--:--'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
