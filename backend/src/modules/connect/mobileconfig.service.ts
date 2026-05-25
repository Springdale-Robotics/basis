import { randomUUID } from 'crypto';
import { getCanonicalUrl } from '../../lib/url.js';
import { createAppPassword } from '../app-passwords/app-passwords.service.js';
import type { FastifyRequest } from 'fastify';

/**
 * Build an Apple Configuration Profile (.mobileconfig) that pre-configures a
 * CalDAV account in iOS Calendar. The user opens the URL once in Safari, taps
 * "Install" + their device passcode, and the account appears — no typing of
 * the hostname, no copy-pasting a 24-char password into a masked field.
 *
 * Format: Apple Property List (XML plist). Documented at
 * https://developer.apple.com/business/documentation/Configuration-Profile-Reference.pdf
 *
 * We ship the profile unsigned. iOS will show "Verification: Not Signed" at
 * install time — for self-hosted personal use, this is acceptable. Signing
 * requires a code-signing cert chained to a trusted CA, which we can't
 * provide for arbitrary self-hosters.
 */

interface MobileconfigArgs {
  request: FastifyRequest;
  userId: string;
  householdId: string;
  email: string;
  displayName: string;
  deviceLabel: string; // e.g. "Sam's iPhone"
  organizationName?: string;
}

export interface MobileconfigResult {
  filename: string;
  contentType: string;
  body: string;
  appPasswordId: string;
}

const xmlEscape = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export async function buildIosCalendarProfile(
  args: MobileconfigArgs
): Promise<MobileconfigResult> {
  // Mint a fresh app password specifically for this device. The user can
  // revoke it from /settings/profile if they lose the device.
  const { summary, secret } = await createAppPassword(
    args.userId,
    args.deviceLabel || 'iOS Calendar',
    ['caldav']
  );

  const baseUrl = await getCanonicalUrl(args.request, args.householdId);
  // Strip scheme/port for the CalendarAccountHostName field — iOS wants the
  // bare host. CalDAV protocol fields handle SSL and port separately.
  let host: string;
  let port = 443;
  let useSSL = true;
  try {
    const u = new URL(baseUrl);
    host = u.hostname;
    if (u.port) port = parseInt(u.port, 10);
    if (u.protocol === 'http:') {
      useSSL = false;
      port = u.port ? parseInt(u.port, 10) : 80;
    }
  } catch {
    host = baseUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }

  const profileUuid = randomUUID();
  const payloadUuid = randomUUID();
  const orgName = args.organizationName || 'Home Manager';
  const profileDisplayName = `${orgName} Calendar`;
  const profileDescription = `Adds the ${orgName} CalDAV account so your calendar appears in iOS Calendar. To remove it later: Settings → General → VPN & Device Management.`;

  // The CalDAV payload identifier and the outer profile identifier share a
  // reverse-DNS prefix — iOS uses this for de-duplication on re-install.
  const reverseDns = `app.homemanager.${host.replace(/[^a-zA-Z0-9.-]/g, '')}`;
  const payloadId = `${reverseDns}.caldav`;
  const profileId = `${reverseDns}.profile`;

  // Account URL points at the user's principal so iOS doesn't have to do
  // the discovery walk after install.
  const principalUrl = `/dav/principals/users/${args.userId}/`;

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadDisplayName</key>
  <string>${xmlEscape(profileDisplayName)}</string>
  <key>PayloadIdentifier</key>
  <string>${xmlEscape(profileId)}</string>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${profileUuid}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
  <key>PayloadDescription</key>
  <string>${xmlEscape(profileDescription)}</string>
  <key>PayloadOrganization</key>
  <string>${xmlEscape(orgName)}</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key>
      <string>com.apple.caldav.account</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>PayloadIdentifier</key>
      <string>${xmlEscape(payloadId)}</string>
      <key>PayloadUUID</key>
      <string>${payloadUuid}</string>
      <key>PayloadDisplayName</key>
      <string>${xmlEscape(orgName)}</string>
      <key>PayloadDescription</key>
      <string>CalDAV account for ${xmlEscape(args.email)}</string>
      <key>CalDAVAccountDescription</key>
      <string>${xmlEscape(orgName)}</string>
      <key>CalDAVHostName</key>
      <string>${xmlEscape(host)}</string>
      <key>CalDAVPort</key>
      <integer>${port}</integer>
      <key>CalDAVPrincipalURL</key>
      <string>${xmlEscape(principalUrl)}</string>
      <key>CalDAVUseSSL</key>
      <${useSSL ? 'true' : 'false'}/>
      <key>CalDAVUsername</key>
      <string>${xmlEscape(args.email)}</string>
      <key>CalDAVPassword</key>
      <string>${xmlEscape(secret)}</string>
    </dict>
  </array>
</dict>
</plist>
`;

  const safeName = (args.deviceLabel || 'iphone')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'iphone';

  return {
    filename: `homemanager-${safeName}.mobileconfig`,
    contentType: 'application/x-apple-aspen-config',
    body,
    appPasswordId: summary.id,
  };
}
