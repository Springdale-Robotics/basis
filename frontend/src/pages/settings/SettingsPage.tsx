import { useMemo } from 'react';
import { NavLink, Routes, Route, Navigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
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
  const isSettingsAdmin = canAdmin('settings');

  // Filter settings navigation to hide admin-only sections from non-admins
  const filteredNav = useMemo(() => {
    return SETTINGS_NAV.filter((item) =>
      ADMIN_ONLY_SETTINGS.includes(item.href) ? isSettingsAdmin : true
    );
  }, [isSettingsAdmin]);

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
                      'block rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-secondary text-secondary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </CardContent>
        </Card>

        {/* Content area */}
        <div className="flex-1">
          <Routes>
            <Route index element={<Navigate to="profile" replace />} />
            <Route path="profile" element={<ProfileSettingsPage />} />
            <Route path="theme" element={<ThemeSettingsPage />} />
            <Route
              path="notifications"
              element={
                <PlaceholderSettings
                  title="Notifications"
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
                  title="Devices"
                  description="Manage the iOS, Android, and desktop clients that have been provisioned for this household — view last-seen, revoke access, rename, or push a fresh CalDAV/ICS profile."
                />
              }
            />
            <Route path="remote-access" element={<RemoteAccessSettingsPage />} />
            <Route path="backup" element={<BackupSettingsPage />} />
            <Route
              path="connections"
              element={
                <PlaceholderSettings
                  title="Connections"
                  description="Link external accounts the household pulls from — Google Photos, smart-home hubs, music services, recipe sources — and manage their OAuth tokens."
                />
              }
            />
            <Route path="features" element={<FeatureSettingsPage />} />
            <Route
              path="sessions"
              element={
                <PlaceholderSettings
                  title="Sessions"
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

function PlaceholderSettings({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            Coming soon
          </span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
