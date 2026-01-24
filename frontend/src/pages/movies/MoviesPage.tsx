import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Film,
  Tv,
  Play,
  Clock,
  Calendar,
  Star,
  Filter,
  Grid,
  List,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  moviesApi,
  filesMediaApi,
  type Movie,
  type TvShow,
  type ContinueWatchingItem,
} from '@/api/media';
import { cn } from '@/lib/utils';

type ContentType = 'movies' | 'tv';
type SortBy = 'title' | 'releaseDate' | 'addedDate' | 'rating';

export function MoviesPage() {
  const [contentType, setContentType] = useState<ContentType>('movies');
  const [sortBy, setSortBy] = useState<SortBy>('addedDate');
  const [genreFilter, setGenreFilter] = useState<string>('all');
  const [showUnwatched, setShowUnwatched] = useState(false);

  const { data: moviesData, isLoading: moviesLoading } = useQuery({
    queryKey: ['movies', sortBy, genreFilter, showUnwatched],
    queryFn: () =>
      moviesApi.list({
        sortBy,
        genre: genreFilter === 'all' ? undefined : genreFilter,
        unwatched: showUnwatched || undefined,
        limit: 100,
      }),
    enabled: contentType === 'movies',
  });

  const { data: tvShowsData, isLoading: tvLoading } = useQuery({
    queryKey: ['tv-shows'],
    queryFn: () => moviesApi.getTvShows(),
    enabled: contentType === 'tv',
  });

  const { data: continueData } = useQuery({
    queryKey: ['continue-watching'],
    queryFn: () => moviesApi.getContinueWatching(),
  });

  const { data: genresData } = useQuery({
    queryKey: ['movie-genres'],
    queryFn: () => moviesApi.getGenres(),
  });

  const movies = moviesData?.movies || [];
  const tvShows = tvShowsData?.shows || [];
  const continueWatching = continueData?.items || [];
  const genres = genresData?.genres || [];

  return (
    <div>
      <PageHeader
        title="Movies & TV"
        description={`${movies.length} movies, ${tvShows.length} TV shows`}
      />

      {/* Continue Watching */}
      {continueWatching.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-4 text-lg font-semibold">Continue Watching</h2>
          <ScrollArea className="w-full whitespace-nowrap">
            <div className="flex gap-4 pb-4">
              {continueWatching.map((item) => (
                <ContinueWatchingCard key={item.progress.id} item={item} />
              ))}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </section>
      )}

      {/* Content Type Tabs */}
      <Tabs
        value={contentType}
        onValueChange={(v) => setContentType(v as ContentType)}
        className="mb-6"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            <TabsTrigger value="movies">
              <Film className="mr-2 h-4 w-4" />
              Movies
            </TabsTrigger>
            <TabsTrigger value="tv">
              <Tv className="mr-2 h-4 w-4" />
              TV Shows
            </TabsTrigger>
          </TabsList>

          {contentType === 'movies' && (
            <div className="flex gap-2">
              <Select value={genreFilter} onValueChange={setGenreFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Genre" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Genres</SelectItem>
                  {genres.map((genre) => (
                    <SelectItem key={genre} value={genre}>
                      {genre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="addedDate">Recently Added</SelectItem>
                  <SelectItem value="title">Title</SelectItem>
                  <SelectItem value="releaseDate">Release Date</SelectItem>
                  <SelectItem value="rating">Rating</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant={showUnwatched ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowUnwatched(!showUnwatched)}
              >
                Unwatched
              </Button>
            </div>
          )}
        </div>

        <TabsContent value="movies" className="mt-6">
          {moviesLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <MovieCardSkeleton key={i} />
              ))}
            </div>
          ) : movies.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Film className="mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-lg font-medium">No movies found</p>
                <p className="text-sm text-muted-foreground">
                  Add video files and they'll appear here
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
              {movies.map((movie) => (
                <MovieCard key={movie.id} movie={movie} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="tv" className="mt-6">
          {tvLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <MovieCardSkeleton key={i} />
              ))}
            </div>
          ) : tvShows.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Tv className="mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-lg font-medium">No TV shows found</p>
                <p className="text-sm text-muted-foreground">
                  Add video files and organize them into shows
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
              {tvShows.map((show) => (
                <TvShowCard key={show.id} show={show} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface MovieCardProps {
  movie: Movie;
}

function MovieCard({ movie }: MovieCardProps) {
  const year = movie.releaseDate
    ? new Date(movie.releaseDate).getFullYear()
    : null;

  return (
    <Link to={`/movies/${movie.id}`}>
      <Card className="group cursor-pointer overflow-hidden transition-shadow hover:shadow-lg">
        <div className="relative aspect-[2/3] bg-muted">
          {movie.posterPath ? (
            <img
              src={movie.posterPath}
              alt={movie.title}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Film className="h-12 w-12 text-muted-foreground" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
          <div className="absolute bottom-0 left-0 right-0 p-3 opacity-0 transition-opacity group-hover:opacity-100">
            <Button size="sm" className="w-full">
              <Play className="mr-2 h-4 w-4" />
              Play
            </Button>
          </div>
        </div>
        <CardContent className="p-3">
          <h3 className="truncate font-medium">{movie.title}</h3>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            {year && <span>{year}</span>}
            {movie.runtime && (
              <>
                <span>&bull;</span>
                <span>{movie.runtime} min</span>
              </>
            )}
            {movie.tmdbRating && (
              <>
                <span>&bull;</span>
                <span className="flex items-center">
                  <Star className="mr-1 h-3 w-3 fill-yellow-500 text-yellow-500" />
                  {movie.tmdbRating.toFixed(1)}
                </span>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

interface TvShowCardProps {
  show: TvShow;
}

function TvShowCard({ show }: TvShowCardProps) {
  const year = show.firstAirDate
    ? new Date(show.firstAirDate).getFullYear()
    : null;

  return (
    <Link to={`/tv/${show.id}`}>
      <Card className="group cursor-pointer overflow-hidden transition-shadow hover:shadow-lg">
        <div className="relative aspect-[2/3] bg-muted">
          {show.posterPath ? (
            <img
              src={show.posterPath}
              alt={show.name}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Tv className="h-12 w-12 text-muted-foreground" />
            </div>
          )}
        </div>
        <CardContent className="p-3">
          <h3 className="truncate font-medium">{show.name}</h3>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            {year && <span>{year}</span>}
            <span>&bull;</span>
            <span>
              {show.numberOfSeasons} {show.numberOfSeasons === 1 ? 'Season' : 'Seasons'}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

interface ContinueWatchingCardProps {
  item: ContinueWatchingItem;
}

function ContinueWatchingCard({ item }: ContinueWatchingCardProps) {
  const isMovie = item.type === 'movie';
  const title = isMovie
    ? (item.item as Movie).title
    : `S${(item.item as any).seasonNumber}E${(item.item as any).episodeNumber}`;
  const progress =
    item.progress.durationSeconds
      ? Math.round((item.progress.positionSeconds / item.progress.durationSeconds) * 100)
      : 0;

  return (
    <Card className="w-[200px] shrink-0 overflow-hidden">
      <div className="relative aspect-video bg-muted">
        <div className="flex h-full items-center justify-center">
          {isMovie ? (
            <Film className="h-8 w-8 text-muted-foreground" />
          ) : (
            <Tv className="h-8 w-8 text-muted-foreground" />
          )}
        </div>
        <Link
          to={isMovie ? `/movies/${(item.item as Movie).id}` : `/tv/${(item.item as any).showId}`}
          className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity hover:opacity-100"
        >
          <Play className="h-12 w-12 text-white" />
        </Link>
        {/* Progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-muted">
          <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <CardContent className="p-2">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">
          {Math.floor(item.progress.positionSeconds / 60)} min watched
        </p>
      </CardContent>
    </Card>
  );
}

function MovieCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className="aspect-[2/3]" />
      <CardContent className="p-3">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="mt-2 h-4 w-1/2" />
      </CardContent>
    </Card>
  );
}
