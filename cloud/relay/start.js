// Absolute import, not './lib.js'. Caddy serves this page at
// /oauth/google/start while the file sits at the relay root, so a relative
// specifier would resolve to /oauth/google/lib.js and 404.
import { parseStartFragment, returnStorageKey, stateFromAuthUrl } from '/lib.js';

const status = document.getElementById('status');
try {
  const { returnUrl, to } = parseStartFragment(window.location.hash);
  // `state` is the random token the box minted for this flow. Keying the
  // stash by it (rather than a fixed name) is what stops an attacker's
  // top-level navigation to this same page from overwriting the address a
  // concurrent, legitimate flow is relying on — see returnStorageKey in
  // lib.js and "Fix I1" in the fix-wave report.
  const state = stateFromAuthUrl(to);
  // Stored on THIS origin, in this browser only. It is how we find our way
  // back after Google redirects here with no memory of the box.
  window.localStorage.setItem(returnStorageKey(state), returnUrl);
  // replace(), not assign(): leaves no history entry holding the box
  // address, and stops Back from Google's consent screen landing here and
  // immediately bouncing the user forward again.
  window.location.replace(to);
} catch (err) {
  status.textContent = err.message;
  status.className = 'error';
}
