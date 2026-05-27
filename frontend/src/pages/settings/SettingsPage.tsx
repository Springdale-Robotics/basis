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
            <Route path="notifications" element={<PlaceholderSettings title="Notifications" />} />
            <Route path="household" element={<HouseholdSettingsPage />} />
            <Route path="members" element={<MembersSettingsPage />} />
            <Route path="groups" element={<GroupsSettingsPage />} />
            <Route path="permissions" element={<FeaturePermissionsPage />} />
            <Route path="storage" element={<StorageSettingsPage />} />
            <Route path="calendars" element={<CalendarSettingsPage />} />
            <Route path="devices" element={<PlaceholderSettings title="Devices" />} />
            <Route path="remote-access" element={<RemoteAccessSettingsPage />} />
            <Route path="backup" element={<PlaceholderSettings title="Backup" />} />
            <Route path="connections" element={<PlaceholderSettings title="Connections" />} />
            <Route path="features" element={<FeatureSettingsPage />} />
            <Route path="sessions" element={<PlaceholderSettings title="Sessions" />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

function PlaceholderSettings({ title }: { title: string }) {
  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-muted-foreground">
          {title} settings will be implemented here.
        </p>
      </CardContent>
    </Card>
  );
}
