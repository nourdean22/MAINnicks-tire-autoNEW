/**
 * Visible text of a prerendered artifact.
 *
 * WHY THIS EXISTS (2026-09-10). Google Search Console reports 17 Soft 404s on
 * nickstire.org with validation FAILED. Three prerendered blog artifacts were
 * measured at ~32 KB against a ~110 KB median, and their VISIBLE text was 595
 * characters — all of it leaked HTML comments, no prose — against 6,936 for a
 * healthy post. The database rows are fine: sectionsJson is 2,878-4,017 chars
 * for exactly those three slugs, and 14 rows are published. The prerenderer
 * emitted empty shells, and every gate we had said OK, because
 * scripts/check-prerender.mjs compares FILE NAMES. An artifact that exists and
 * an artifact that has content are different claims.
 *
 * The prerender workflow tolerates this twice over: it commits when up to 10%
 * of routes fail, and a route that renders EMPTY is not counted as a failure at
 * all — today's run logged "339 succeeded, 1 failed out of 340 routes".
 *
 * WHAT COUNTS AS VISIBLE. Script and style bodies are code, not prose. HTML
 * comments are invisible to a reader and to Google — and counting them is
 * exactly how 595 characters of nothing looked like content. Tags collapse to a
 * space so adjacent words do not fuse into one long token.
 *
 * ONE MODULE, imported by the gate and by anything that reports on it. The
 * fail-open-slice pair in this directory drifted twice when each side carried
 * its own copy of the scan.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";

/**
 * Client copy that means "this page has no article on it".
 *
 * THE LIST WAS ONE STATE TOO NARROW, and that is the whole soft-404 story.
 * BlogPost.tsx renders "LOADING ARTICLE..." while the tRPC query is in flight
 * (line 458) and "ARTICLE NOT FOUND" once it has settled empty (line 469). Both
 * scripts/prerender.mjs and scripts/check-prerender-semantic.mjs carried their
 * own copy of a list holding only the SETTLED strings — so a page captured
 * mid-flight was retried by neither and flagged by neither. Three artifacts
 * shipped in exactly that state and sat in Google's index as Soft 404s.
 *
 * Measured over the 339 committed artifacts: "LOADING ARTICLE" matches exactly
 * those three and nothing else, and matches identically against raw HTML and
 * against visible text — so adding it costs no false positives.
 *
 * ONE LIST. prerender.mjs:289 already carried a comment pointing at the other
 * copy; a comment is not a mechanism.
 */
// AND THEN IT HAPPENED A THIRD TIME. Hours after the list above was widened to
// cover the in-flight state, an audit of sitemap-vs-noindex found
// /tires/info serving HTTP 200 with the visible copy "SERVICE NOT FOUND" and
// the title "Service Not Found" — at sitemap priority 0.8, group "service".
// The list had "PAGE NOT FOUND". It did not have "SERVICE NOT FOUND".
//
// Twice is a coincidence; three times is the method being wrong. A list of copy
// somebody remembered to enumerate will always trail the copy somebody wrote.
// So the list below is now DERIVED BY MEASUREMENT — every uppercase
// "<WORD> NOT FOUND" heading in client/src, enumerated with a grep — and
// server/prerenderEmptyArtifactGate.test.ts re-derives it from the source on
// every run and fails if the two disagree. Adding a new not-found page without
// adding its string here is now a red test, not a silent hole.
export const SOFT_404_MARKERS = [
  "ARTICLE NOT FOUND", // BlogPost.tsx:469
  "PAGE NOT FOUND", // CityPage.tsx:210, SeasonalPage.tsx:118, NeighborhoodPage.tsx:212
  "SERVICE NOT FOUND", // GenericServicePage.tsx:127
  "GUIDE NOT FOUND", // GuidePage.tsx:46
  "CUSTOMER NOT FOUND", // admin/customers/CustomerProfile.tsx:169 — never
  // prerendered, but listed so the derived test needs no exceptions to argue
  // about. An exception list is the same failure mode one level up.
  // The unsettled branch. Without this the retry never fires and the empty
  // capture is committed.
  "LOADING ARTICLE", // BlogPost.tsx:458
];

/**
 * Visible characters below which a prerendered page is not a page.
 *
 * MEASURED, not chosen. Across the 339 committed artifacts the distribution is
 * bimodal with nothing in the middle: the three known-bad sit at 102 visible
 * characters, the next smallest legitimate page (careers/tire-technician, a
 * genuinely short job posting) is 1,672, and the median is 6,968. Any floor
 * inside (102, 1672) separates them; 500 sits near the widest part of that
 * empty band — 4.9x above the observed failure, 3.3x below the thinnest real
 * page — so it fires on a page that rendered nothing without ever arguing with
 * a page that is merely short.
 */
export const MIN_VISIBLE_CHARS = 500;

const COMMENT = /<!--[\s\S]*?-->/g;
const SCRIPT = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const STYLE = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
const TAG = /<[^>]+>/g;
const WS = /\s+/g;

/** Reader-visible text of one HTML string, whitespace-collapsed. */
export function visibleText(html) {
  return html
    .replace(COMMENT, " ")
    .replace(SCRIPT, " ")
    .replace(STYLE, " ")
    .replace(TAG, " ")
    .replace(WS, " ")
    .trim();
}

/**
 * Every prerendered index.html under `dir`, as { rel, chars, markers },
 * ascending by visible length so the worst offenders read first.
 *
 * SCANS EVERY ARTIFACT ON DISK, deliberately — not the expected set.
 * check-prerender.mjs derives `expected` from PRERENDER_ROUTES + BLOG_SLUGS,
 * and all three known-bad slugs are DB-dynamic: absent from BLOG_SLUGS, so they
 * land in that script's `extra` bucket, which is printed as informational and
 * never gated. A thin check scoped to `expected` would have scored green on
 * 100% of the actual defect. What is on disk is what is served.
 */
export function measureArtifacts(dir) {
  const out = [];
  walk(dir, "", out);
  out.sort((a, b) => a.chars - b.chars);
  return out;
}

/**
 * Artifacts that render no article: too short to be a page, or showing one of
 * the empty-state strings. Matching runs against VISIBLE text so a marker
 * appearing in a script body or an HTML comment cannot fake a hit — and,
 * measured on the current tree, that costs nothing: raw-HTML and visible-text
 * matching return identical sets for every marker.
 */
export function emptyArtifacts(dir, { floor = MIN_VISIBLE_CHARS } = {}) {
  return measureArtifacts(dir).filter((a) => a.chars < floor || a.markers.length > 0);
}

/**
 * Split empty artifacts against the baseline into the three verdicts the gate
 * acts on. Pure, so every arm can be proven with a constructed input instead of
 * writing fixture files into the shared prerendered/ tree that sibling sessions
 * are reading.
 *
 *   fresh      — empty and NOT in the baseline. Fatal: a new soft 404.
 *   stale      — in the baseline but no longer empty. Fatal: prune the row.
 *   stillEmpty — empty and known. Reported, awaiting a prerender refresh.
 */
export function classifyEmptyArtifacts(empties, known) {
  const knownSet = new Set(known);
  const liveSet = new Set(empties.map((a) => a.rel));
  return {
    fresh: empties.filter((a) => !knownSet.has(a.rel)),
    stale: [...known].filter((rel) => !liveSet.has(rel)),
    stillEmpty: empties.filter((a) => knownSet.has(a.rel)),
  };
}

/**
 * Copy every .html in `fromDir` that `intoDir` does not already have, and
 * return the relative paths carried forward.
 *
 * THE OTHER HALF OF REFUSING TO WRITE AN EMPTY RENDER, and it lives in this
 * file on purpose. prerender.mjs now omits a route that rendered empty; but
 * regen-prerender.mjs swaps the tracked tree wholesale with renameSync, so an
 * omitted route would have its artifact VANISH — the same contentless page for
 * crawlers, minus any gate that can see it. prerender.mjs:413 records ten blog
 * routes losing their files exactly this way on 2026-08-19.
 *
 * Split these two across separate modules and someone deletes one of them.
 */
export function backfillMissingArtifacts(fromDir, intoDir) {
  const carried = [];
  const recurse = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const from = join(dir, entry.name);
      const key = rel ? rel + "/" + entry.name : entry.name;
      if (entry.isDirectory()) recurse(from, key);
      else if (entry.isFile() && entry.name.endsWith(".html")) {
        const to = join(intoDir, key);
        if (existsSync(to)) continue;
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
        carried.push(key);
      }
    }
  };
  recurse(fromDir, "");
  return carried;
}

function walk(dir, prefix, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.isDirectory()) walk(full, rel, out);
    else if (entry.name === "index.html") {
      const text = visibleText(readFileSync(full, "utf8"));
      out.push({
        rel,
        chars: text.length,
        markers: SOFT_404_MARKERS.filter((m) => text.includes(m)),
      });
    }
  }
}
