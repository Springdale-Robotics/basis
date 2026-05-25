import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryProvider } from './providers/QueryProvider';
import { AuthProvider } from './providers/AuthProvider';
import { ThemeProvider } from './providers/ThemeProvider';
import { WebSocketProvider } from './providers/WebSocketProvider';
import { Toaster } from './components/ui/toaster';

import { AppShell } from './components/layout/AppShell';
import { ProtectedRoute } from './components/auth/ProtectedRoute';

// Auth pages
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { JoinPage } from './pages/auth/JoinPage';

// Setup
import { SetupPage } from './pages/setup/SetupPage';

// Main pages
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { CalendarPage } from './pages/calendar/CalendarPage';
import { ConnectDevicePage } from './pages/calendar/ConnectDevicePage';
import { RecipesPage } from './pages/recipes/RecipesPage';
import { RecipeDetailPage } from './pages/recipes/RecipeDetailPage';
import { CookModePage } from './pages/recipes/CookModePage';
import { MealPlanPage } from './pages/recipes/MealPlanPage';
import { InventoryPage } from './pages/inventory/InventoryPage';
import { ShoppingListPage } from './pages/inventory/ShoppingListPage';
import { TasksPage } from './pages/tasks/TasksPage';
import { RewardsPage } from './pages/tasks/RewardsPage';
import { ListsPage } from './pages/lists/ListsPage';
import { ListDetailPage } from './pages/lists/ListDetailPage';
import { FilesPage } from './pages/files/FilesPage';
import { PhotosPage } from './pages/photos/PhotosPage';
import { VideosPage } from './pages/videos/VideosPage';
import { MoviesPage } from './pages/movies/MoviesPage';
import { MusicPage } from './pages/music/MusicPage';
import { SettingsPage } from './pages/settings/SettingsPage';

export function App() {
  return (
    <QueryProvider>
      <ThemeProvider defaultTheme="system" storageKey="homemanager-theme">
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthProvider>
            <WebSocketProvider>
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
                  <Route path="movies/:id" element={<MoviesPage />} />
                  <Route path="tv/:id" element={<MoviesPage />} />
                  <Route path="music" element={<MusicPage />} />
                  <Route path="music/albums/:id" element={<MusicPage />} />
                  <Route path="music/artists/:id" element={<MusicPage />} />

                  {/* Settings */}
                  <Route path="settings/*" element={<SettingsPage />} />
                </Route>

                {/* Catch-all */}
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
              <Toaster />
            </WebSocketProvider>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryProvider>
  );
}
