import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Disc, User, Play, Clock, Search } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/shared/ErrorState';
import { EmptyState } from '@/components/shared/EmptyState';
import { MediaCard, MediaCardSkeleton } from '@/components/media/MediaCard';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { musicApi, type Track } from '@/api/media';
import { usePlayerStore } from '@/stores/playerStore';
import { cn, formatDuration } from '@/lib/utils';

type TabType = 'artists' | 'albums' | 'recent';

export function MusicPage() {
  const [activeTab, setActiveTab] = useState<TabType>('albums');
  const [search, setSearch] = useState('');
  const { playTrack, currentTrack, isPlaying } = usePlayerStore();

  const { data: artistsData, isLoading: artistsLoading, isError: artistsError, error: artistsErrorObj, refetch: refetchArtists } = useQuery({
    queryKey: ['artists', search],
    queryFn: () => musicApi.getArtists({ search: search || undefined, limit: 100 }),
    enabled: activeTab === 'artists',
  });

  const { data: albumsData, isLoading: albumsLoading, isError: albumsError, error: albumsErrorObj, refetch: refetchAlbums } = useQuery({
    queryKey: ['albums'],
    queryFn: () => musicApi.getAlbums({ limit: 100 }),
    enabled: activeTab === 'albums',
  });

  const { data: recentData, isLoading: recentLoading, isError: recentError, error: recentErrorObj, refetch: refetchRecent } = useQuery({
    queryKey: ['recent-music'],
    queryFn: () => musicApi.getRecent(50),
    enabled: activeTab === 'recent',
  });

  const artists = artistsData?.artists || [];
  const albums = albumsData?.albums || [];
  const recentTracks = recentData?.tracks || [];

  const handlePlayTrack = (track: Track, allTracks?: Track[]) => {
    playTrack(track, allTracks);
  };

  return (
    <div>
      <PageHeader
        title="Music"
        description={`${artists.length} artists, ${albums.length} albums`}
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabType)} className="mb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            <TabsTrigger value="albums">
              <Disc className="mr-2 h-4 w-4" />
              Albums
            </TabsTrigger>
            <TabsTrigger value="artists">
              <User className="mr-2 h-4 w-4" />
              Artists
            </TabsTrigger>
            <TabsTrigger value="recent">
              <Clock className="mr-2 h-4 w-4" />
              Recent
            </TabsTrigger>
          </TabsList>

          {activeTab === 'artists' && (
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search artists..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          )}
        </div>

        {/* Albums Tab */}
        <TabsContent value="albums" className="mt-6">
          {albumsLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <MediaCardSkeleton key={i} aspect="square" />
              ))}
            </div>
          ) : albumsError ? (
            <ErrorState
              title="Couldn't load albums"
              error={albumsErrorObj}
              onRetry={refetchAlbums}
            />
          ) : albums.length === 0 ? (
            <EmptyState
              icon={<Disc className="h-12 w-12" />}
              title="No albums found"
              description="Add music files to build your library"
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
                    aspect="square"
                    fallbackIcon={Disc}
                    subtitle={
                      <>
                        {album.artistName || 'Unknown Artist'}
                        {year && ` • ${year}`}
                      </>
                    }
                    overlay={
                      <div className="absolute bottom-2 right-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button size="icon" className="h-10 w-10 rounded-full shadow-lg">
                          <Play className="h-5 w-5" />
                        </Button>
                      </div>
                    }
                  />
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Artists Tab */}
        <TabsContent value="artists" className="mt-6">
          {artistsLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 12 }).map((_, i) => (
                <MediaCardSkeleton key={i} aspect="square" centered />
              ))}
            </div>
          ) : artistsError ? (
            <ErrorState
              title="Couldn't load artists"
              error={artistsErrorObj}
              onRetry={refetchArtists}
            />
          ) : artists.length === 0 ? (
            <EmptyState
              icon={<User className="h-12 w-12" />}
              title="No artists found"
              description={
                search ? 'Try a different search' : 'Add music files to build your library'
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
              {artists.map((artist) => (
                <MediaCard
                  key={artist.id}
                  href={`/music/artists/${artist.id}`}
                  image={artist.imageUrl || artist.imagePath}
                  title={artist.name}
                  subtitle="Artist"
                  aspect="square"
                  fallbackIcon={User}
                  centered
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Recent Tab */}
        <TabsContent value="recent" className="mt-6">
          {recentLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : recentError ? (
            <ErrorState
              title="Couldn't load recent plays"
              error={recentErrorObj}
              onRetry={refetchRecent}
            />
          ) : recentTracks.length === 0 ? (
            <EmptyState
              icon={<Clock className="h-12 w-12" />}
              title="No recent plays"
              description="Start listening to see your history"
            />
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Artist</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentTracks.map((track, index) => (
                    <TableRow
                      key={`${track.id}-${index}`}
                      className={cn(
                        'cursor-pointer',
                        currentTrack?.id === track.id && 'bg-muted'
                      )}
                      onClick={() => handlePlayTrack(track, recentTracks)}
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
                      <TableCell className="text-muted-foreground">
                        {track.albumArtist || 'Unknown Artist'}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {track.duration ? formatDuration(track.duration) : '--:--'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
