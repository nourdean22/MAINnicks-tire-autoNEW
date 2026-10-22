/**
 * Sign-in redirect target · shared by app/auth/sign-in/page.tsx and the
 * POST /auth/sign-in/google route, so both apply one gate.
 *
 * Audit 2026-10-10 F11 · only a same-origin PATH may be a redirect target.
 * The old check rejected only "//", so "/\evil.com" passed (browsers read "\"
 * as "/") and so did its encoded twin "/%5Cevil.com". Parsing against a fixed
 * base also catches what the URL parser strips ("/\t/evil.com" is "//evil.com").
 * Relative resolution never depends on the base's host, so a placeholder works.
 */
const CALLBACK_BASE = "https://callback.invalid";

export function isSameOriginPath(cb: string): boolean {
  if (!cb.startsWith("/") || /^\/(?:[\\/]|%5c)/i.test(cb)) return false;
  try {
    return new URL(cb, CALLBACK_BASE).origin === CALLBACK_BASE;
  } catch {
    return false;
  }
}

/** The callbackUrl if it is a same-origin path, else the app's default landing. */
export function resolveCallbackUrl(raw: string): string {
  return isSameOriginPath(raw) ? raw : process.env.NEXT_PUBLIC_APP_URL || "/chat";
}
