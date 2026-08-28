/**
 * URL logic for the Basis OAuth relay at connect.home-basis.com.
 *
 * The relay's whole job is to be a redirect URI Google will accept — one
 * fixed HTTPS address — and then hand the browser on to whichever box
 * started the flow. It has no server, no storage beyond this origin's
 * localStorage, and it must never learn a box address in a way that could
 * reach the cloud host: the box URL travels in the URL fragment, which
 * browsers do not send to servers.
 *
 * Kept free of DOM access so it can be tested directly; index.html and
 * start.html are the only callers that touch window.
 */

const CALLBACK_PATH = '/api/v1/calendars/sync/google/callback';

/** Google is the only place we will ever send a user mid-flow. */
const GOOGLE_AUTH_ORIGIN = 'https://accounts.google.com';

function assertBoxUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('The address of your Basis box is not a valid URL.');
  }
  // Absolute http(s) only. A protocol-relative or relative value would
  // resolve against this origin, and a javascript: URL would execute here.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('The address of your Basis box must be http or https.');
  }
  return parsed;
}

/**
 * Read the `#return=...&to=...` fragment the box sent us to.
 * Throws with a message fit to show the user if anything is missing or unsafe.
 */
export function parseStartFragment(fragment) {
  const params = new URLSearchParams(
    fragment.startsWith('#') ? fragment.slice(1) : fragment
  );

  const returnUrl = params.get('return');
  const to = params.get('to');

  if (!returnUrl || !to) {
    throw new Error('This link is incomplete. Start again from your Basis box.');
  }

  assertBoxUrl(returnUrl);

  let destination;
  try {
    destination = new URL(to);
  } catch {
    throw new Error('This link is malformed. Start again from your Basis box.');
  }
  if (destination.origin !== GOOGLE_AUTH_ORIGIN) {
    throw new Error('This link does not point at Google. Start again from your Basis box.');
  }

  return { returnUrl, to };
}

/**
 * Where to send the browser once Google has redirected back to us.
 * The query string is passed through byte for byte — it carries `code` and
 * `state`, and the box validates `state` itself.
 */
export function buildCallbackUrl(returnUrl, search) {
  const base = assertBoxUrl(returnUrl);
  const origin = base.origin;
  const query = search.startsWith('?') ? search : `?${search}`;
  return `${origin}${CALLBACK_PATH}${query}`;
}

/** What did Google put on the redirect back to us? */
export function classifyCallback(search) {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);

  const error = params.get('error');
  if (error) {
    return {
      kind: 'error',
      message:
        error === 'access_denied'
          ? 'You declined access at Google (access_denied). Nothing was connected.'
          : `Google returned an error: ${error}`,
    };
  }

  if (!params.get('code')) {
    return {
      kind: 'error',
      message: 'Google did not send an authorization code. Start again from your Basis box.',
    };
  }

  return { kind: 'code' };
}
