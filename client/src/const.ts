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

  const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");

  return url.toString();
};
