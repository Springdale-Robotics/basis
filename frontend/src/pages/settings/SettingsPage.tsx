import { useMemo } from 'react';
import { NavLink, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SETTINGS_NAV, ADMIN_ONLY_SETTINGS } from '@/lib/constants';
import { useFeaturePermissions } from '@/hooks/useFeaturePermissions';
import { cn } from '@/lib/utils';

// Settings sub-pages (simplified versions)
import { ProfileSettingsPage } from './ProfileSettingsPage';
import { ThemeSettingsPage } from './ThemeSettingsPage';
import { HouseholdSettingsPage } from './HouseholdSettingsPage';
import { MembersSettingsPage } from './MembersSettingsPage';
import { CalendarSettingsPage } from './CalendarSettingsPage';
import { StorageSettingsPage } from './StorageSettingsPage';
import { GroupsSettingsPage } from './GroupsSettingsPage';
import { FeaturePermissionsPage } from './FeaturePermissionsPage';
import { FeatureSettingsPage } from './FeatureSettingsPage';
import { RemoteAccessSettingsPage } from './RemoteAccessSettingsPage';
import { TerminalSettingsPage } from './TerminalSettingsPage';
import { UpdatesSettingsPage } from './UpdatesSettingsPage';
import { SystemSettingsPage } from './SystemSettingsPage';
import { BackupSettingsPage } from './BackupSettingsPage';
import { BugReportsSettingsPage } from './BugReportsSettingsPage';

export function SettingsPage() {
  const { canAdmin } = useFeaturePermissions();
  const { pathname } = useLocation();
  const isSettingsAdmin = canAdmin('settings');

  // Filter settings navigation to hide admin-only sections from non-admins
  const filteredNav = useMemo(() => {
    return SETTINGS_NAV.filter((item) =>
      ADMIN_ONLY_SETTINGS.includes(item.href) ? isSettingsAdmin : true
    );
  }, [isSettingsAdmin]);

  // Active section, for the heading above the sub-page content. Especially
  // important on mobile where the nav list scrolls away.
  const activeSection = useMemo(
    () => SETTINGS_NAV.find((item) => pathname.startsWith(item.href)),
    [pathname]
  );

  return (
    <div>
      <PageHeader title="Settings" />

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Navigation sidebar */}
        <Card className="lg:w-64 shrink-0">
          <CardContent className="p-2">
            <nav className="space-y-1">
              {filteredNav.map((item) => (
                <NavLink
                  key={item.href}
                  to={item.href}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-secondary text-secondary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )
                  }
                >
                  {item.label}
                  {item.soon && (
                    <Badge variant="secondary" className="text-[10px] font-medium">
                      Soon
                    </Badge>
                  )}
                </NavLink>
              ))}
            </nav>
          </CardContent>
        </Card>

        {/* Content area */}
        <div className="flex-1">
          {activeSection && (
            <div className="mb-4">
              <h2 className="text-lg font-semibold tracking-tight">
                {activeSection.label}
              </h2>
              <p className="text-sm text-muted-foreground">
                {activeSection.description}
              </p>
            </div>
          )}
          <Routes>
            <Route index element={<Navigate to="profile" replace />} />
            <Route path="profile" element={<ProfileSettingsPage />} />
            <Route path="theme" element={<ThemeSettingsPage />} />
            <Route
              path="notifications"
              element={
                <PlaceholderSettings
                  description="Choose which household events trigger push notifications, emails, or in-app toasts — per category, per quiet-hours window."
                />
              }
            />
            <Route path="household" element={<HouseholdSettingsPage />} />
            <Route path="members" element={<MembersSettingsPage />} />
            <Route path="groups" element={<GroupsSettingsPage />} />
            <Route path="permissions" element={<FeaturePermissionsPage />} />
            <Route path="storage" element={<StorageSettingsPage />} />
            <Route path="calendars" element={<CalendarSettingsPage />} />
            <Route
              path="devices"
              element={
                <PlaceholderSettings
                  description="Manage the iOS, Android, and desktop clients that have been provisioned for this household — view last-seen, revoke access, rename, or push a fresh CalDAV/ICS profile."
                />
              }
            />
            <Route path="remote-access" element={<RemoteAccessSettingsPage />} />
            <Route path="backup" element={<BackupSettingsPage />} />
            <Route path="features" element={<FeatureSettingsPage />} />
            <Route
              path="sessions"
              element={
                <PlaceholderSettings
                  description="See where you're currently signed in (browser, OS, last activity) and sign out individual sessions or all other devices at once."
                />
              }
            />
            <Route path="updates" element={<UpdatesSettingsPage />} />
            <Route path="system" element={<SystemSettingsPage />} />
            <Route path="bug-reports" element={<BugReportsSettingsPage />} />
            <Route path="terminal" element={<TerminalSettingsPage />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

function PlaceholderSettings({ description }: { description: string }) {
  return (
    <Card>
      <CardContent className="p-6">
        <Badge variant="secondary" className="font-medium text-muted-foreground">
          Coming soon
        </Badge>
        <p className="mt-3 text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
