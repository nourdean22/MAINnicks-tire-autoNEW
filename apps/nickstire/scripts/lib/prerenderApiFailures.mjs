/**
 * Make the prerenderer's API failures VISIBLE.
 *
 * WHY THIS EXISTS. The prerenderer captured HTML and never once looked at what
 * the page's network layer did — no `page.on("response")`, no
 * `page.on("requestfailed")`, nothing. So when every tRPC call on a route came
 * back 429, the page rendered its not-found branch and the capture looked like
 * a CONTENT problem. It was diagnosed as a missing DB row, then a dead DB
 * handle, then an empty route param, then a capture-timing race — four wrong
 * theories over weeks, none of which could be refuted from the artifact,
 * because the one fact that would have settled it in a minute was never
 * recorded.
 *
 * The actual cause: `app.use("/api/trpc", apiLimiter)` charges 100 requests per
 * 15 minutes to anonymous callers, and the prerenderer walks 339 routes through
 * that same server. Static pages shrugged it off; DB-backed blog posts have
 * nothing without their query.
 *
 * A 429 is returned by rate-limit middleware BEFORE tRPC runs, so no
 * server-side instrument could see it either. The browser is the only observer
 * positioned to notice, and nobody was asking it.
 */

/** Strip the origin so a line is about the route, not about localhost:4173. */
function pathOf(url) {
  return String(url).replace(/^[a-z]+:\/\/[^/]+/i, "");
}

/**
 * @param {{status?: number, url: string, errorText?: string}} entry
 * @returns {string} one compact `CODE /path` token
 */
export function formatApiFailure(entry) {
  const code = entry.status ?? `FAILED(${entry.errorText ?? "unknown"})`;
  return `${code} ${pathOf(entry.url).slice(0, 100)}`;
}

/**
 * Collapse a route's failures into ONE line, because 8 identical 429s is one
 * fact and eight lines is noise that gets filtered out and then not read.
 *
 * @param {Array<{status?: number, url: string, errorText?: string}>} failures
 * @returns {string|null} null when there is nothing to report
 */
export function summarizeApiFailures(failures) {
  if (!Array.isArray(failures) || failures.length === 0) return null;

  const byCode = new Map();
  for (const f of failures) {
    const code = f.status ?? `FAILED(${f.errorText ?? "unknown"})`;
    byCode.set(code, (byCode.get(code) ?? 0) + 1);
  }

  // Most frequent first — the dominant failure is the one worth acting on.
  const parts = [...byCode.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([code, n]) => `${n}x ${code}`);

  return `${parts.join(", ")} — first: ${formatApiFailure(failures[0])}`;
}

/** Only these are worth recording; a 2xx is not a failure and 3xx is routing. */
export function isApiFailureResponse(url, status) {
  if (!String(url).includes("/api/")) return false;
  return typeof status === "number" && (status < 200 || status >= 400);
}
