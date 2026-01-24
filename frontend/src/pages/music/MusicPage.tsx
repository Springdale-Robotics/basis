import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Music,
  Disc,
  User,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  List,
  Clock,
  Search,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  musicApi,
  filesMediaApi,
  type Artist,
  type MusicAlbum,
  type Track,
} from '@/api/media';
import { usePlayerStore } from '@/stores/playerStore';
import { cn, formatDuration } from '@/lib/utils';

type TabType = 'artists' | 'albums' | 'recent';

export function MusicPage() {
  const [activeTab, setActiveTab] = useState<TabType>('albums');
  const [search, setSearch] = useState('');
  const { playTrack, addToQueue, currentTrack, isPlaying } = usePlayerStore();

  const { data: artistsData, isLoading: artistsLoading } = useQuery({
    queryKey: ['artists', search],
    queryFn: () => musicApi.getArtists({ search: search || undefined, limit: 100 }),
    enabled: activeTab === 'artists',
  });

  const { data: albumsData, isLoading: albumsLoading } = useQuery({
    queryKey: ['albums'],
    queryFn: () => musicApi.getAlbums({ limit: 100 }),
    enabled: activeTab === 'albums',
  });

  const { data: recentData, isLoading: recentLoading } = useQuery({
    queryKey: ['recent-music'],
    queryFn: () => musicApi.getRecent(50),
    enabled: activeTab === 'recent',
  });

  const { data: genresData } = useQuery({
    queryKey: ['music-genres'],
    queryFn: () => musicApi.getGenres(),
  });

  const artists = artistsData?.artists || [];
  const albums = albumsData?.albums || [];
  const recentTracks = recentData?.tracks || [];
  const genres = genresData?.genres || [];

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
                <AlbumCardSkeleton key={i} />
              ))}
            </div>
          ) : albums.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Disc className="mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-lg font-medium">No albums found</p>
                <p className="text-sm text-muted-foreground">
                  Add music files to build your library
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
              {albums.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Artists Tab */}
        <TabsContent value="artists" className="mt-6">
          {artistsLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 12 }).map((_, i) => (
                <ArtistCardSkeleton key={i} />
              ))}
            </div>
          ) : artists.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <User className="mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-lg font-medium">No artists found</p>
                <p className="text-sm text-muted-foreground">
                  {search ? 'Try a different search' : 'Add music files to build your library'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
              {artists.map((artist) => (
                <ArtistCard key={artist.id} artist={artist} />
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
          ) : recentTracks.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Clock className="mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-lg font-medium">No recent plays</p>
                <p className="text-sm text-muted-foreground">
                  Start listening to see your history
                </p>
              </CardContent>
            </Card>
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

interface AlbumCardProps {
  album: MusicAlbum;
}

function AlbumCard({ album }: AlbumCardProps) {
  const year = album.releaseDate
    ? new Date(album.releaseDate).getFullYear()
    : null;

  return (
    <Link to={`/music/albums/${album.id}`}>
      <Card className="group cursor-pointer overflow-hidden transition-shadow hover:shadow-lg">
        <div className="relative aspect-square bg-muted">
          {album.coverArtPath ? (
            <img
              src={album.coverArtPath}
              alt={album.name}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Disc className="h-12 w-12 text-muted-foreground" />
            </div>
          )}
          <div className="absolute bottom-2 right-2 opacity-0 transition-opacity group-hover:opacity-100">
            <Button size="icon" className="h-10 w-10 rounded-full shadow-lg">
              <Play className="h-5 w-5" />
            </Button>
          </div>
        </div>
        <CardContent className="p-3">
          <h3 className="truncate font-medium">{album.name}</h3>
          <p className="truncate text-sm text-muted-foreground">
            {album.artistName || 'Unknown Artist'}
            {year && ` \u2022 ${year}`}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

interface ArtistCardProps {
  artist: Artist;
}

function ArtistCard({ artist }: ArtistCardProps) {
  return (
    <Link to={`/music/artists/${artist.id}`}>
      <Card className="group cursor-pointer overflow-hidden transition-shadow hover:shadow-lg">
        <div className="relative aspect-square bg-muted">
          {artist.imageUrl || artist.imagePath ? (
            <img
              src={artist.imageUrl || artist.imagePath}
              alt={artist.name}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <User className="h-12 w-12 text-muted-foreground" />
            </div>
          )}
        </div>
        <CardContent className="p-3 text-center">
          <h3 className="truncate font-medium">{artist.name}</h3>
          <p className="text-sm text-muted-foreground">Artist</p>
        </CardContent>
      </Card>
    </Link>
  );
}

function AlbumCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className="aspect-square" />
      <CardContent className="p-3">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="mt-2 h-4 w-1/2" />
      </CardContent>
    </Card>
  );
}

function ArtistCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className="aspect-square" />
      <CardContent className="p-3 text-center">
        <Skeleton className="mx-auto h-5 w-3/4" />
        <Skeleton className="mx-auto mt-2 h-4 w-1/2" />
      </CardContent>
    </Card>
  );
}
