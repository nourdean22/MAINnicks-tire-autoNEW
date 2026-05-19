export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/**
 * Generate the appropriate sign-in URL at runtime.
 *
 * On localhost dev:
 *   → hits /api/dev/signin which mints a real session cookie for the
 *     OWNER user. No Google OAuth round-trip. Works in Claude Preview
 *     (which blocks navigation away from localhost).
 *
 * On production (nickstire.org):
 *   → Google OAuth flow with localhost/production redirect URI.
 */
export const getLoginUrl = () => {
  const isLocalhost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname.startsWith("192.168.") ||
      window.location.hostname.endsWith(".local"));

  if (isLocalhost) {
    // Include the current path as `next=` so we return to where the user clicked
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    return `/api/dev/signin?next=${next}`;
  }

  // wave-181.71 (chip #1 · OAuth state CSRF protection)
  // The Google auth URL is now built SERVER-SIDE at /api/oauth/initiate
  // so the server can mint a fresh `state` parameter, store it in an
  // HTTP-only cookie, and validate it on the callback. Pre-fix the
  // client built the URL inline with NO state parameter — an attacker
  // could trick an admin into clicking a callback URL with a stolen
  // auth code, binding the admin's session to the attacker's Google
  // account. With state validation the callback rejects mismatches.
  return "/api/oauth/initiate";
};
