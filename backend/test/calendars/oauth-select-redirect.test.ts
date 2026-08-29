import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The OAuth callback's success redirect must land on a URL the settings page
 * actually reacts to.
 *
 * `CalendarSettingsPage` opens the calendar picker from a query parameter:
 *
 *   const selectCalendar = searchParams.get('select');
 *   if (selectCalendar === 'google') setGoogleSelectOpen(true);
 *
 * The callback used to redirect to the PATH `/settings/calendars/google/select`,
 * which no route serves and which sets no `select` param — so a household that
 * completed consent landed on a page that did nothing. The token exchange had
 * succeeded and the tokens were waiting in Redis; there was simply no way to
 * reach the picker. Outlook had the identical bug.
 *
 * This is a contract between two files that cannot import each other, so it is
 * asserted against their source. A route-level test would need the whole OAuth
 * exchange mocked and would still not prove the frontend reads the same shape.
 */

const repoRoot = join(__dirname, '..', '..', '..');
const routes = readFileSync(
  join(repoRoot, 'backend/src/modules/calendars/sync.routes.ts'),
  'utf8'
);
const settingsPage = readFileSync(
  join(repoRoot, 'frontend/src/pages/settings/CalendarSettingsPage.tsx'),
  'utf8'
);

describe('OAuth success redirect', () => {
  it.each(['google', 'outlook'])(
    '%s redirects to the ?select= query the settings page reads',
    (provider) => {
      expect(routes).toContain(`/settings/calendars?select=${provider}`);
    }
  );

  it.each(['google', 'outlook'])(
    'no longer redirects %s to a path no route serves',
    (provider) => {
      expect(routes).not.toContain(`/settings/calendars/${provider}/select`);
    }
  );

  it('the settings page still opens the picker from the select param', () => {
    // If this changes shape, the assertions above are testing the wrong thing.
    expect(settingsPage).toContain("searchParams.get('select')");
    expect(settingsPage).toContain("selectCalendar === 'google'");
    expect(settingsPage).toContain("selectCalendar === 'outlook'");
  });
});
