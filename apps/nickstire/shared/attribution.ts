/**
 * attribution — pure helpers for displaying/aggregating attribution data.
 *
 * `landingPage` is stored as the FULL href (utm.ts captures
 * window.location.href, e.g. "https://nickstire.org/brakes?utm_source=google").
 * Grouping or displaying raw hrefs fragments counts per UTM variant and leaks
 * query noise into the UI — always normalize to the pathname first.
 *
 * Pure + side-effect-free; shared by the server aggregation
 * (trafficFunnel.topBookingPages) and the admin display chips.
 */

/**
 * Reduce a stored landing-page value (full href, path, or junk) to a clean
 * pathname ("/brakes"). Returns null for null/empty/unparseable input so
 * callers can skip rendering instead of showing garbage.
 */
export function normalizePathname(href: string | null | undefined): string | null {
  if (!href) return null;
  const raw = href.trim();
  if (!raw) return null;
  try {
    // Absolute URL — strip origin/query/hash.
    if (/^https?:\/\//i.test(raw)) {
      return new URL(raw).pathname || "/";
    }
    // Already a path — strip query/hash.
    if (raw.startsWith("/")) {
      const cut = raw.split(/[?#]/)[0];
      return cut || "/";
    }
    // Protocol-less host ("nickstire.org/brakes") — best-effort parse.
    const parsed = new URL(`https://${raw}`);
    // Reject values that were never URL-ish (no dot, no slash) — e.g. "hero".
    if (!raw.includes("/") && !raw.includes(".")) return null;
    return parsed.pathname || "/";
  } catch {
    return null;
  }
}
