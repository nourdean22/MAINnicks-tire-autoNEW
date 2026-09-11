/**
 * Decide which slug a blog page is for.
 *
 * WHY THIS IS A MODULE AND NOT FOUR LINES INSIDE BlogPost.tsx.
 *
 * The rule below is the whole fix for a Soft-404 class: App.tsx matches
 * `/blog/:slug` to render BlogPost, and BlogPost then re-ran useRoute to read
 * the param. When that second match came back empty, `slug` was "" — which
 * misses the static lookup AND disables the dynamic query, because the query is
 * gated on `slug.length > 0`. The page rendered "ARTICLE NOT FOUND" having
 * asked nobody anything, and the prerenderer captured that at HTTP 200.
 *
 * It lives here because the hook that uses it cannot be imported without a
 * React renderer and a wouter Router, and a test that cannot import its subject
 * ends up asserting against a COPY of the logic. That copy then drifts, silently,
 * in exactly the direction the bug came from. This module is the smallest thing
 * both the component and its test can hold onto at once.
 *
 * It is deliberately pure: no React, no wouter, no window. The caller supplies
 * the pathname, so the SSR case is `undefined` rather than a global check hidden
 * in here where a test could not reach it.
 */

/** Matches the slug segment of `/blog/<slug>`, stopping at `/`, `?` or `#`. */
const BLOG_PATH = /^\/blog\/([^/?#]+)/;

/**
 * @param matchedSlug the route match, when there is one — it always wins
 * @param pathname    `window.location.pathname`, or undefined during SSR
 * @returns the slug, or "" when the location genuinely names no article
 */
export function deriveBlogSlug(
  matchedSlug: string | undefined,
  pathname: string | undefined,
): string {
  if (matchedSlug) return matchedSlug;
  if (!pathname) return "";

  const m = BLOG_PATH.exec(pathname);
  if (!m) return "";

  try {
    return decodeURIComponent(m[1]);
  } catch {
    // A malformed escape ("%E0%A4%A") throws. A hand-typed bad URL must not
    // white-screen the blog; the raw segment is a worse slug than the decoded
    // one but a far better outcome than an exception during render.
    return m[1];
  }
}
