# Frontend Map

All paths relative to project root (`homemanager/`).

## frontend/
- `package.json` - Dependencies, scripts (dev, build, lint, preview)
- `tsconfig.json` - TypeScript config (ES2020, ES2022.Intl, strict mode, path aliases)
- `vite.config.ts` - Vite config with React plugin, API proxy to backend
- `tailwind.config.js` - Tailwind CSS config with custom theme colors and animations
- `postcss.config.js` - PostCSS with Tailwind and autoprefixer
- `index.html` - HTML entry point, mounts React app to #root
- `.gitignore` - Git ignores (node_modules, dist, .env, etc.)

## frontend/public/
- `favicon.svg` - App favicon (home icon)

## frontend/src/

### frontend/src/main.tsx
- Entry point: renders App inside StrictMode, imports global CSS

### frontend/src/App.tsx
- Root component with all providers (Query, Auth, Theme, WebSocket)
- React Router setup with all routes
- Routes: auth, setup, dashboard, calendar, recipes, inventory, tasks, lists, files, smart-home, settings

### frontend/src/index.css
- Global styles and CSS variables for theming
- Light/dark mode color definitions using HSL values
- Tailwind base, components, utilities imports

### frontend/src/vite-env.d.ts
- Vite client type references

## frontend/src/types/

### models.ts
Domain model interfaces:
- `Household`, `HouseholdSettings`, `ThemeConfig`
- `User`, `Session`, `Device`, `DeviceSettings`
- `Calendar`, `CalendarEvent`, `RecurrenceRule`
- `Recipe`, `RecipeIngredient`, `RecipeInstruction`, `RecipeTimer`, `MealPlan`
- `StorageArea`, `InventoryItem`, `StockEntry`, `ShoppingListItem`
- `Task`, `UserRewards`, `Achievement`
- `List`, `ListItem`
- `FileItem`, `Folder`, `FileMetadata`, `Album`
- `Notification`, `HouseholdConnection`, `ConnectionPermissions`, `BackupConfig`

### forms.ts
Zod validation schemas:
- Auth: `loginFormSchema`, `registerFormSchema`, `forgotPasswordFormSchema`, `resetPasswordFormSchema`
- Setup: `setupHouseholdFormSchema`, `setupAdminFormSchema`
- Calendar: `eventFormSchema` (alias: `eventSchema`)
- Recipe: `recipeFormSchema` (alias: `recipeSchema`)
- Inventory: `storageAreaFormSchema`, `inventoryItemFormSchema`, `addStockFormSchema`
- Task: `taskFormSchema` (alias: `taskSchema`)
- List: `listFormSchema`, `listItemFormSchema`

### api.ts
API response types:
- `ApiResponse<T>`, `PaginatedResponse<T>`, `ErrorResponse`
- `LoginResponse`, `SetupStatus`, `SetupRequest`

### socket.ts
WebSocket event types:
- `ServerToClientEvents` - calendar:update, inventory:update, task:update, notification, cooking:timer:alert, etc.
- `ClientToServerEvents` - join:household, cooking:timer:start/pause/reset, typing:start/stop

## frontend/src/api/

### client.ts
- Fetch wrapper with base URL, credentials, JSON handling
- Error response parsing, ApiError creation

### Domain API modules:
- `auth.ts` - login(), register(), logout(), forgotPassword(), resetPassword(), getMe()
- `households.ts` - get(), update(), getMembers(), inviteMember(), removeMember()
- `users.ts` - get(), update(), uploadAvatar(), changePassword()
- `calendars.ts` - CRUD calendars, CRUD events, getEventsByRange()
- `recipes.ts` - CRUD recipes, search(), importFromUrl(), scale(), getMealPlans()
- `inventory.ts` - CRUD areas, CRUD items, adjustStock(), getShoppingList(), addToShoppingList()
- `tasks.ts` - CRUD tasks, complete(), assign(), getRewards(), getAchievements()
- `lists.ts` - CRUD lists, CRUD items, toggleItem(), reorder(), clearChecked()
- `files.ts` - upload(), download(), list(), createFolder(), move(), delete(), getAlbums()
- `notifications.ts` - list(), markRead(), markAllRead(), delete()
- `devices.ts` - list(), register(), update(), delete()
- `settings.ts` - getHousehold(), updateHousehold(), getTheme(), updateTheme()
- `connections.ts` - list(), invite(), accept(), decline(), remove()
- `backup.ts` - list(), create(), download(), restore(), getSchedules()
- `setup.ts` - getStatus(), initialize()
- `smart-home.ts` - getConnectionStatus(), getDevices(), controlDevice(), getAutomations()

## frontend/src/stores/

### authStore.ts
Zustand store for auth state:
- State: user, household, isAuthenticated, isLoading
- Actions: setUser(), setHousehold(), logout(), hydrate()
- Persistence via localStorage

### uiStore.ts
Zustand store for UI state:
- State: sidebarOpen, sidebarCollapsed, mobileNavOpen
- Actions: toggleSidebar(), setSidebarCollapsed(), toggleMobileNav()

### themeStore.ts
Zustand store for theme:
- State: theme ('light' | 'dark' | 'system')
- Actions: setTheme()
- Persistence via localStorage

### notificationStore.ts
Zustand store for client-side notifications:
- State: notifications array
- Actions: add(), remove(), clear(), markRead()

### cookingStore.ts
Zustand store for cooking sessions:
- State: sessions map, activeTimers
- Actions: startSession(), endSession(), startTimer(), pauseTimer(), resetTimer()

## frontend/src/providers/

### QueryProvider.tsx
- TanStack Query client setup
- Default options: 5min staleTime, 30min cacheTime, refetchOnWindowFocus

### AuthProvider.tsx
- Auth context with user, household, isAuthenticated
- login(), logout(), refetch() methods
- Session validation on mount

### ThemeProvider.tsx
- Theme context synced with themeStore
- Applies 'dark' class to document.documentElement
- Handles system preference detection

### WebSocketProvider.tsx
- Socket.io client connection
- Auto-joins household room on auth
- Real-time event listeners that invalidate React Query caches
- Events: calendar:update, inventory:update, task:update, notification, etc.

## frontend/src/hooks/

### useAuth.ts
- Returns auth context (user, household, login, logout, etc.)

### useTheme.ts
- Returns theme context (theme, setTheme, systemTheme)

### useWebSocket.ts
- Returns socket instance and connection status

### useToast.ts
- Toast notification hook (toast(), dismiss())

### useDebounce.ts
- Debounces value changes with configurable delay

### useLocalStorage.ts
- localStorage wrapper with SSR safety

### usePermissions.ts
- Role-based permission checking (canView, canEdit, canDelete, isAdmin)

### useDevice.ts
- Device detection (isMobile, isTablet, isDesktop)

### useScreensaver.ts
- Idle detection for screensaver activation
- Returns isActive, deactivate()

### useFeatureFlags.ts
- Feature toggle checking from household settings

### useNotifications.ts
- Notification management (mark read, clear, etc.)

### useCookingSession.ts
- Cooking mode state management
- Timer controls synced via WebSocket

## frontend/src/lib/

### utils.ts
- `cn()` - Tailwind class name merger (clsx + tailwind-merge)
- `formatDate()`, `formatRelativeTime()`, `formatCurrency()`
- `debounce()`, `throttle()`
- `generateId()`, `slugify()`

### constants.ts
- `MAIN_NAV` - Main navigation items with icons and paths
- `SETTINGS_NAV` - Settings sub-navigation
- `STALE_TIMES` - React Query stale time constants
- `QUERY_KEYS` - Query key constants

### api-error.ts
- `ApiError` class with code, message, details
- `getErrorMessage()` helper for user-friendly messages

## frontend/src/components/ui/
shadcn/ui primitives (Radix UI based):
- `button.tsx` - Button with variants (default, destructive, outline, ghost, link)
- `input.tsx` - Text input
- `label.tsx` - Form label
- `card.tsx` - Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter
- `dialog.tsx` - Modal dialog
- `dropdown-menu.tsx` - Dropdown menu
- `select.tsx` - Select dropdown
- `checkbox.tsx` - Checkbox
- `switch.tsx` - Toggle switch
- `tabs.tsx` - Tab navigation
- `badge.tsx` - Status badge
- `avatar.tsx` - User avatar with fallback
- `separator.tsx` - Visual separator
- `skeleton.tsx` - Loading skeleton
- `tooltip.tsx` - Hover tooltip
- `slider.tsx` - Range slider
- `toast.tsx`, `toaster.tsx` - Toast notifications
- `scroll-area.tsx` - Custom scrollbar area
- `alert-dialog.tsx` - Confirmation dialog
- `popover.tsx` - Popover panel
- `sheet.tsx` - Slide-over panel
- `progress.tsx` - Progress bar
- `command.tsx` - Command palette (cmdk)
- `calendar.tsx` - Date picker (react-day-picker)

## frontend/src/components/layout/

### AppShell.tsx
- Main app layout wrapper
- Contains Sidebar, Header, MobileNav, and main content area
- Responsive layout switching

### Sidebar.tsx
- Desktop navigation sidebar
- Collapsible with icon-only mode
- Navigation items from MAIN_NAV constant

### Header.tsx
- Top header bar
- User menu dropdown
- Notification bell with panel
- Theme toggle button
- Mobile menu trigger

### MobileNav.tsx
- Bottom navigation bar for mobile
- Shows main nav items as icons

### PageHeader.tsx
- Reusable page title pattern
- Title, description, and action buttons

### ScreensaverOverlay.tsx
- Full-screen overlay for idle devices
- Photo slideshow with clock display
- Touch/click to dismiss

## frontend/src/components/auth/
- `LoginForm.tsx` - Email/password login form
- `RegisterForm.tsx` - Registration with password confirmation
- `ForgotPasswordForm.tsx` - Email input for password reset
- `ResetPasswordForm.tsx` - New password with confirmation
- `ProtectedRoute.tsx` - Auth guard wrapper, redirects to login

## frontend/src/components/setup/
- `SetupWizard.tsx` - Multi-step setup flow container
- `HouseholdSetup.tsx` - Step 1: Household name and timezone
- `AdminSetup.tsx` - Step 2: Admin user creation
- `RemoteAccessSetup.tsx` - Step 3: Remote access configuration
- `SetupComplete.tsx` - Success message with login redirect

## frontend/src/components/calendar/
- `CalendarView.tsx` - Main calendar with month/week/day views, event display
- `CalendarSidebar.tsx` - Calendar list with visibility toggles
- `EventForm.tsx` - Create/edit event dialog with recurrence options

## frontend/src/components/recipes/
- `RecipeCard.tsx` - Recipe grid card with image, time, tags; also RecipeListItem
- `RecipeForm.tsx` - Create/edit recipe with tabs (details, ingredients, instructions)

## frontend/src/components/inventory/
- `AreaCard.tsx` - Storage area card with expandable item list, low stock/expiring badges
- `ItemForm.tsx` - Create/edit inventory item with keep-in-stock settings
- `ShoppingListItem.tsx` - Shopping list item with checkbox, source badge

## frontend/src/components/tasks/
- `TaskCard.tsx` - Task card with priority, due date, assignee, points; also TaskList
- `TaskForm.tsx` - Create/edit task with chore/reward settings

## frontend/src/components/lists/
- `ListItem.tsx` - Checklist item with inline edit, drag handle; also AddListItem

## frontend/src/components/files/
- `FileBrowser.tsx` - File/folder grid and list views, breadcrumb navigation, upload

## frontend/src/components/notifications/
- `NotificationPanel.tsx` - Dropdown notification list
- `NotificationItem.tsx` - Single notification with actions

## frontend/src/components/shared/
- `EmptyState.tsx` - No data placeholder with icon and action
- `LoadingSpinner.tsx` - Centered loading indicator
- `ErrorBoundary.tsx` - React error boundary with fallback UI
- `ConfirmDialog.tsx` - Confirmation modal wrapper
- `SearchInput.tsx` - Debounced search input
- `UserAvatar.tsx` - User avatar with initials fallback

## frontend/src/pages/

### auth/
- `LoginPage.tsx` - Login page with form and register link
- `RegisterPage.tsx` - Registration page
- `ForgotPasswordPage.tsx` - Password reset request
- `ResetPasswordPage.tsx` - Password reset with token
- `AcceptInvitePage.tsx` - Accept household invitation

### setup/
- `SetupPage.tsx` - Initial setup wizard page

### dashboard/
- `DashboardPage.tsx` - Home dashboard with widgets (calendar, tasks, inventory alerts)

### calendar/
- `CalendarPage.tsx` - Full calendar view with sidebar

### recipes/
- `RecipesPage.tsx` - Recipe library with search and filters
- `RecipeDetailPage.tsx` - Single recipe view with ingredients, instructions
- `CookModePage.tsx` - Cooking mode with step navigation and timers
- `MealPlanPage.tsx` - Weekly meal planning calendar

### inventory/
- `InventoryPage.tsx` - Inventory overview with storage areas
- `ShoppingListPage.tsx` - Shopping list with add, check, clear

### tasks/
- `TasksPage.tsx` - Task list with filters (all, mine, chores)
- `RewardsPage.tsx` - Rewards dashboard with points and achievements

### lists/
- `ListsPage.tsx` - All lists overview
- `ListDetailPage.tsx` - Single list view with items

### files/
- `FilesPage.tsx` - File browser with folder navigation
- `PhotosPage.tsx` - Photo gallery view
- `VideosPage.tsx` - Video library
- `MusicPage.tsx` - Music library with player

### smart-home/
- `SmartHomePage.tsx` - Device dashboard with controls, automations tab

### settings/
- `SettingsPage.tsx` - Settings layout with sub-navigation
- `ProfileSettingsPage.tsx` - User profile, avatar, password
- `ThemeSettingsPage.tsx` - Theme customization (mode, colors, fonts)
- `HouseholdSettingsPage.tsx` - Household name, timezone, danger zone

## Build Output

Production build creates:
- `dist/index.html` - Entry HTML
- `dist/assets/index-[hash].css` - Compiled CSS (~48KB, ~9KB gzipped)
- `dist/assets/index-[hash].js` - Compiled JS (~695KB, ~203KB gzipped)
