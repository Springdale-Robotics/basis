import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Disc, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { MediaCard, MediaCardSkeleton } from '@/components/media/MediaCard';
import { musicApi } from '@/api/media';
import { usePlayerStore } from '@/stores/playerStore';
import { cn, formatDuration } from '@/lib/utils';

export function ArtistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { playTrack, currentTrack, isPlaying } = usePlayerStore();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['artist', id],
    queryFn: () => musicApi.getArtist(id!),
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
        <div className="mb-6 flex items-center gap-6">
          <Skeleton className="h-32 w-32 shrink-0 rounded-full" />
          <div className="space-y-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <MediaCardSkeleton key={i} aspect="square" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div>
        {backLink}
        <ErrorState title="Couldn't load artist" error={error} onRetry={refetch} />
      </div>
    );
  }

  if (!data?.artist) {
    return (
      <div>
        {backLink}
        <ErrorState title="Artist not found" description="They may have been removed from the library." />
      </div>
    );
  }

  const { artist, albums, looseTracks } = data;
  const image = artist.imageUrl || artist.imagePath;

  return (
    <div>
      {backLink}

      {/* Artist header */}
      <div className="mb-8 flex items-center gap-6">
        <div className="h-32 w-32 shrink-0 overflow-hidden rounded-full bg-muted">
          {image ? (
            <img
              src={image}
              alt={artist.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <User className="h-12 w-12 text-muted-foreground" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            {artist.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {albums.length} {albums.length === 1 ? 'album' : 'albums'}
            {looseTracks.length > 0 &&
              ` • ${looseTracks.length} other ${looseTracks.length === 1 ? 'track' : 'tracks'}`}
          </p>
          {artist.biography && (
            <p className="mt-3 line-clamp-3 max-w-prose text-sm text-muted-foreground">
              {artist.biography}
            </p>
          )}
        </div>
      </div>

      {/* Albums */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold">Albums</h2>
        {albums.length === 0 ? (
          <EmptyState
            icon={<Disc className="h-12 w-12" />}
            title="No albums"
            description="Albums from this artist will appear here."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {albums.map((album) => {
              const year = album.releaseDate
                ? new Date(album.releaseDate).getFullYear()
                : null;
              return (
                <MediaCard
                  key={album.id}
                  href={`/music/albums/${album.id}`}
                  image={album.coverArtPath}
                  title={album.name}
                  subtitle={
                    <>
                      {album.totalTracks}{' '}
                      {album.totalTracks === 1 ? 'track' : 'tracks'}
                      {year && ` • ${year}`}
                    </>
                  }
                  aspect="square"
                  fallbackIcon={Disc}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* Loose tracks */}
      {looseTracks.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">Other Tracks</h2>
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
                {looseTracks.map((track, index) => (
                  <TableRow
                    key={track.id}
                    className={cn(
                      'cursor-pointer',
                      currentTrack?.id === track.id && 'bg-muted'
                    )}
                    onClick={() => playTrack(track, looseTracks)}
                  >
                    <TableCell>
                      {currentTrack?.id === track.id && isPlaying ? (
                        <div className="flex h-4 w-4 items-center justify-center">
                          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                        </div>
                      ) : (
                        <span className="text-muted-foreground">{index + 1}</span>
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
        </section>
      )}
    </div>
  );
}
