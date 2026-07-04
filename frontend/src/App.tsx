import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryProvider } from './providers/QueryProvider';
import { AuthProvider } from './providers/AuthProvider';
import { ThemeProvider } from './providers/ThemeProvider';
import { WebSocketProvider } from './providers/WebSocketProvider';
import { Toaster } from './components/ui/toaster';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { LoadingPage } from './components/shared/LoadingSpinner';

import { AppShell } from './components/layout/AppShell';
import { ProtectedRoute } from './components/auth/ProtectedRoute';

// LoginPage stays eager so the first paint of an unauthenticated visit needs no
// extra round trip. Everything else is code-split: the pages behind auth (and
// their heavy deps — xterm, hls.js, recharts, the emoji dataset) load on demand
// instead of shipping in the initial bundle. `lazy` needs a default export, so
// adapt each named page export.
import { LoginPage } from './pages/auth/LoginPage';

const lazyPage = <T extends Record<string, React.ComponentType<unknown>>>(
  loader: () => Promise<T>,
  name: keyof T
) => lazy(() => loader().then((m) => ({ default: m[name] })));

const RegisterPage = lazyPage(() => import('./pages/auth/RegisterPage'), 'RegisterPage');
const ForgotPasswordPage = lazyPage(() => import('./pages/auth/ForgotPasswordPage'), 'ForgotPasswordPage');
const ResetPasswordPage = lazyPage(() => import('./pages/auth/ResetPasswordPage'), 'ResetPasswordPage');
const JoinPage = lazyPage(() => import('./pages/auth/JoinPage'), 'JoinPage');
const SetupPage = lazyPage(() => import('./pages/setup/SetupPage'), 'SetupPage');
const DashboardPage = lazyPage(() => import('./pages/dashboard/DashboardPage'), 'DashboardPage');
const CalendarPage = lazyPage(() => import('./pages/calendar/CalendarPage'), 'CalendarPage');
const ConnectDevicePage = lazyPage(() => import('./pages/calendar/ConnectDevicePage'), 'ConnectDevicePage');
const RecipesPage = lazyPage(() => import('./pages/recipes/RecipesPage'), 'RecipesPage');
const RecipeDetailPage = lazyPage(() => import('./pages/recipes/RecipeDetailPage'), 'RecipeDetailPage');
const CookModePage = lazyPage(() => import('./pages/recipes/CookModePage'), 'CookModePage');
const MealPlanPage = lazyPage(() => import('./pages/recipes/MealPlanPage'), 'MealPlanPage');
const InventoryPage = lazyPage(() => import('./pages/inventory/InventoryPage'), 'InventoryPage');
const ShoppingListPage = lazyPage(() => import('./pages/inventory/ShoppingListPage'), 'ShoppingListPage');
const TasksPage = lazyPage(() => import('./pages/tasks/TasksPage'), 'TasksPage');
const RewardsPage = lazyPage(() => import('./pages/tasks/RewardsPage'), 'RewardsPage');
const ListsPage = lazyPage(() => import('./pages/lists/ListsPage'), 'ListsPage');
const ListDetailPage = lazyPage(() => import('./pages/lists/ListDetailPage'), 'ListDetailPage');
const FilesPage = lazyPage(() => import('./pages/files/FilesPage'), 'FilesPage');
const PhotosPage = lazyPage(() => import('./pages/photos/PhotosPage'), 'PhotosPage');
const VideosPage = lazyPage(() => import('./pages/videos/VideosPage'), 'VideosPage');
const MoviesPage = lazyPage(() => import('./pages/movies/MoviesPage'), 'MoviesPage');
const MovieDetailPage = lazyPage(() => import('./pages/movies/MovieDetailPage'), 'MovieDetailPage');
const TvShowDetailPage = lazyPage(() => import('./pages/movies/TvShowDetailPage'), 'TvShowDetailPage');
const MusicPage = lazyPage(() => import('./pages/music/MusicPage'), 'MusicPage');
const AlbumDetailPage = lazyPage(() => import('./pages/music/AlbumDetailPage'), 'AlbumDetailPage');
const ArtistDetailPage = lazyPage(() => import('./pages/music/ArtistDetailPage'), 'ArtistDetailPage');
const SettingsPage = lazyPage(() => import('./pages/settings/SettingsPage'), 'SettingsPage');
const NotFoundPage = lazyPage(() => import('./pages/NotFoundPage'), 'NotFoundPage');

export function App() {
  return (
    <QueryProvider>
      <ThemeProvider defaultTheme="system" storageKey="homemanager-theme">
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthProvider>
            <WebSocketProvider>
              <ErrorBoundary>
              <Suspense fallback={<LoadingPage />}>
              <Routes>
                {/* Public routes */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/join/:inviteCode" element={<JoinPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/setup" element={<SetupPage />} />

                {/* Protected routes */}
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <AppShell />
                    </ProtectedRoute>
                  }
                >
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  <Route path="dashboard" element={<DashboardPage />} />

                  {/* Calendar */}
                  <Route path="calendar" element={<CalendarPage />} />
                  <Route path="calendar/connect" element={<ConnectDevicePage />} />

                  {/* Recipes */}
                  <Route path="recipes" element={<RecipesPage />} />
                  <Route path="recipes/:id" element={<RecipeDetailPage />} />
                  <Route path="recipes/:id/cook" element={<CookModePage />} />
                  <Route path="meal-plan" element={<MealPlanPage />} />

                  {/* Inventory */}
                  <Route path="inventory" element={<InventoryPage />} />
                  <Route path="shopping-list" element={<ShoppingListPage />} />

                  {/* Tasks */}
                  <Route path="tasks" element={<TasksPage />} />
                  <Route path="rewards" element={<RewardsPage />} />

                  {/* Lists */}
                  <Route path="lists" element={<ListsPage />} />
                  <Route path="lists/:id" element={<ListDetailPage />} />

                  {/* Files */}
                  <Route path="files/*" element={<FilesPage />} />

                  {/* Media */}
                  <Route path="photos" element={<PhotosPage />} />
                  <Route path="videos" element={<VideosPage />} />
                  <Route path="movies" element={<MoviesPage />} />
                  <Route path="movies/:id" element={<MovieDetailPage />} />
                  <Route path="tv/:id" element={<TvShowDetailPage />} />
                  <Route path="music" element={<MusicPage />} />
                  <Route path="music/albums/:id" element={<AlbumDetailPage />} />
                  <Route path="music/artists/:id" element={<ArtistDetailPage />} />

                  {/* Settings */}
                  <Route path="settings/*" element={<SettingsPage />} />

                  {/* Catch-all: unknown routes get a proper 404 inside the shell */}
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Routes>
              </Suspense>
              </ErrorBoundary>
              <Toaster />
            </WebSocketProvider>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryProvider>
  );
}
