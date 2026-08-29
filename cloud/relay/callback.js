// Absolute import — see the note in start.js. Served at /oauth/google, a
// relative specifier would resolve to /oauth/lib.js.
import { buildCallbackUrl, classifyCallback, returnStorageKey } from '/lib.js';

const status = document.getElementById('status');

// Google delivered the authorization code in this page's URL. Read it once,
// then take it out of the address bar and the history entry. It is
// single-use, short-lived and useless without the client secret, but there
// is no reason to leave it sitting in a browser's history.
const search = window.location.search;

const fail = (message) => {
  try {
    window.history.replaceState(null, '', window.location.pathname);
  } catch {
    // Best effort — an unscrubbed URL is not worth failing over.
  }
  status.textContent = message;
  status.className = 'error';
};

const state = new URLSearchParams(search).get('state');

// Best-effort cleanup: Google echoes `state` back on the access_denied path
// too, so a real box's stashed address doesn't need to linger in this
// origin's localStorage past a flow that ended in refusal.
const clearStored = () => {
  if (!state) return;
  try {
    window.localStorage.removeItem(returnStorageKey(state));
  } catch {
    // Best effort — see the try/catch below for why this can throw.
  }
};

const verdict = classifyCallback(search);
if (verdict.kind === 'error') {
  clearStored();
  fail(verdict.message);
} else if (!state) {
  // Our own OAuth flow always sends state. Its absence here means this
  // request didn't come from a real callback, so there is no keyed entry to
  // even look for.
  fail('This link is missing its state parameter. Start again from your Basis box.');
} else {
  try {
    // Inside the try: where site storage is blocked, the accessor itself
    // throws, and the page must say so rather than hang.
    const key = returnStorageKey(state);
    const returnUrl = window.localStorage.getItem(key);
    if (!returnUrl) {
      // Consent finished in a different browser from the one that started
      // it — or the `state` in this URL doesn't match any flow this browser
      // stored (including one an attacker forged). There is deliberately no
      // way for this page to guess the box's address — see "Why not carry
      // the return URL in state" in the spec.
      fail(
        'This browser did not start the connection, so Basis cannot tell ' +
          'which box to return you to. Open Basis on your box and start ' +
          'the connection again from Settings → Calendars.'
      );
    } else {
      window.localStorage.removeItem(key);
      // replace(), not assign(): the code must not survive in history.
      window.location.replace(buildCallbackUrl(returnUrl, search));
    }
  } catch (err) {
    fail(err.message);
  }
}
