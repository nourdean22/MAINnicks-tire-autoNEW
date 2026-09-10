/**
 * A prerendered page that renders NOTHING must not reach crawlers.
 *
 * WHAT HAPPENED. Google Search Console reported 17 Soft 404s on nickstire.org
 * with validation FAILED. Three committed blog artifacts carry 102 visible
 * characters inside a 32 KB SPA shell — the body is literally
 * "LOADING ARTICLE...". The database rows are healthy (sectionsJson 2,878-4,017
 * chars, status published), so the content exists; the prerenderer captured the
 * page mid-fetch and committed the shell.
 *
 * FOUR INSTRUMENTS WERE POINTED AT THIS AND ALL FOUR READ GREEN:
 *   1. scripts/check-prerender.mjs compares FILE NAMES. Existence, never
 *      content — and worse, it derives its expected set from BLOG_SLUGS, which
 *      these three DB-dynamic slugs are absent from. They land in its `extra`
 *      bucket, printed as informational. A thin check scoped to `expected`
 *      would have scored green on 100% of the defect.
 *   2. check-prerender-semantic.mjs matched ["ARTICLE NOT FOUND",
 *      "PAGE NOT FOUND"] — the SETTLED empty states. The one that shipped is
 *      the IN-FLIGHT state, and it was in neither copy of the list.
 *   3. prerender.mjs held a second copy of that same list, kept in sync by a
 *      comment, missing the same string. So the retry never fired either.
 *   4. prerender.mjs's own content check ran AFTER writeFileSync and AFTER
 *      success++, measured html.length > 5000 (raw bytes — a 32 KB shell sails
 *      past it), and used the answer to choose between "✓" and "⚠". It printed
 *      a warning glyph for pages it was committing, and the summary counted
 *      them as successes.
 *
 * WHAT THIS TEST PINS. Each arm below is constructed so it FAILS if the thing
 * it names stops working — including the two that agree with each other on the
 * live tree today. The length floor and the marker list currently flag the
 * exact same three files, so neither one agreeing with the other is evidence
 * that both fire; each gets an input the other cannot catch.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import {
  visibleText,
  measureArtifacts,
  emptyArtifacts,
  classifyEmptyArtifacts,
  backfillMissingArtifacts,
  SOFT_404_MARKERS,
  MIN_VISIBLE_CHARS,
} from "../scripts/lib/prerenderText.mjs";
import { readCode, readSource } from "./testUtils/sourceAssertions";

const APP = process.cwd();
const fixtures = mkdtempSync(join(tmpdir(), "prerender-empty-gate-"));
afterAll(() => rmSync(fixtures, { recursive: true, force: true }));

/** Write one artifact into an isolated fixture tree — never into prerendered/. */
function artifact(name: string, body: string): string {
  const dir = join(fixtures, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), `<html><head><title>t</title></head><body>${body}</body></html>`);
  return `${name}/index.html`;
}

/** Prose long enough to clear the floor with room to spare. */
const REAL_PROSE = "Cleveland brake fluid service. ".repeat(60);

describe("visibleText measures what a reader sees", () => {
  it("strips comments, scripts and styles — the positive control", () => {
    // Without this the three bad artifacts measure 595 characters instead of
    // 102, because their only "content" is leaked HTML comments. A length
    // floor fed by raw markup is measuring the shell it is supposed to detect.
    const html =
      "<!-- a long buried comment that no reader ever sees -->" +
      "<script>const noise = 'x'.repeat(5000);</script>" +
      "<style>.a{color:red}</style>" +
      "<p>Hello</p><p>world</p>";
    expect(visibleText(html)).toBe("Hello world");
  });

  it("inserts a separator for tags so adjacent words do not fuse", () => {
    expect(visibleText("<p>Hello</p><p>world</p>")).toContain("Hello world");
  });
});

describe("the scanner actually reads the committed tree", () => {
  const live = measureArtifacts(resolve(APP, "prerendered"));

  it("finds the artifacts at all — the positive control", () => {
    // A scanner returning nothing makes every assertion below pass against an
    // empty set. That is the failure mode this whole class is about, so it is
    // asserted first.
    expect(live.length).toBeGreaterThan(300);
    expect(live.some((a) => a.chars > 5000)).toBe(true);
  });

  it("the floor sits in a real gap, not in the middle of the distribution", () => {
    // Measured 2026-09-10: bad = 102, next-smallest-legitimate = 1,672
    // (careers/tire-technician, a genuinely short job posting), median 6,968.
    // If a future page legitimately lands between them this assertion fails and
    // the floor gets re-derived, rather than the gate quietly false-positiving.
    const above = live.filter((a) => a.chars >= MIN_VISIBLE_CHARS);
    const smallestLegit = Math.min(...above.map((a) => a.chars));
    expect(smallestLegit).toBeGreaterThan(MIN_VISIBLE_CHARS * 2);
  });
});

describe("the two signals fire independently", () => {
  it("the length floor catches an empty page carrying NO known marker", () => {
    // The arm that matters. On the live tree the floor and the markers flag the
    // same three files, so the floor could be dead code and nothing would show.
    // This page renders a plausible empty state nobody enumerated.
    const rel = artifact("mystery-blank", "<div>Something went wrong.</div>");
    const found = emptyArtifacts(fixtures).map((a) => a.rel);
    expect(found).toContain(rel);
    const hit = emptyArtifacts(fixtures).find((a) => a.rel === rel)!;
    expect(hit.markers).toEqual([]); // caught by length alone
  });

  it("the markers catch a LONG page that still shows an empty state", () => {
    // The mirror arm: a page can be wordy — nav, footer, related links — and
    // still have no article on it. Length alone would pass this.
    const rel = artifact("wordy-but-empty", `<div>LOADING ARTICLE...</div><div>${REAL_PROSE}</div>`);
    const hit = emptyArtifacts(fixtures).find((a) => a.rel === rel);
    expect(hit, "a long page showing an empty state must still be flagged").toBeTruthy();
    expect(hit!.chars).toBeGreaterThan(MIN_VISIBLE_CHARS); // length would have passed it
    expect(hit!.markers).toContain("LOADING ARTICLE");
  });

  it("a healthy page is flagged by neither", () => {
    // Without this, a gate that flags EVERYTHING would pass both arms above.
    const rel = artifact("healthy", `<article>${REAL_PROSE}</article>`);
    expect(emptyArtifacts(fixtures).map((a) => a.rel)).not.toContain(rel);
  });

  it("the in-flight state is in the marker list — the string that actually shipped", () => {
    expect(SOFT_404_MARKERS).toContain("LOADING ARTICLE");
    expect(SOFT_404_MARKERS).toContain("ARTICLE NOT FOUND");
  });

  it("the marker list is DERIVED from the client, not remembered", () => {
    // The list was one state too narrow TWICE. First it had only the settled
    // strings and missed "LOADING ARTICLE...", which shipped three soft 404s.
    // Hours after that was fixed, an audit found /tires/info serving HTTP 200
    // with "SERVICE NOT FOUND" — at sitemap priority 0.8 — because the list had
    // "PAGE NOT FOUND" and not that one.
    //
    // Twice is a coincidence. Three times would be the method being wrong, so
    // the method changed: re-derive the population from the source here, and
    // fail if the hand-written constant has fallen behind it. A new not-found
    // page is now a red test rather than a silent hole.
    const found = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".tsx")) {
          for (const m of readFileSync(full, "utf8").matchAll(/>([A-Z][A-Z ]*NOT FOUND)</g)) {
            found.add(m[1].trim());
          }
        }
      }
    };
    walk(resolve(APP, "client/src"));

    expect(found.size, "the scanner found no not-found copy at all — it is broken").toBeGreaterThan(2);
    const missing = [...found].filter((s) => !SOFT_404_MARKERS.includes(s));
    expect(
      missing,
      `client/src renders not-found copy that SOFT_404_MARKERS does not cover:\n` +
        missing.map((m) => `  ${m}`).join("\n") +
        `\n\nAdd it to scripts/lib/prerenderText.mjs — otherwise a page rendering it ` +
        `ships at HTTP 200 and every gate reads green, which has now happened twice.`,
    ).toEqual([]);
  });

  it("BlogPost.tsx still renders the copy the markers are written against", () => {
    // The markers are literal strings matched against another file's output. If
    // that copy is reworded, the list silently stops matching and the gate goes
    // quiet — the exact way this defect shipped. Pin the coupling.
    const blogPost = readSource("client/src/pages/BlogPost.tsx");
    for (const marker of ["LOADING ARTICLE", "ARTICLE NOT FOUND"]) {
      expect(blogPost, `BlogPost.tsx no longer renders "${marker}" — update SOFT_404_MARKERS`).toContain(marker);
    }
  });
});

describe("the ratchet classifies correctly", () => {
  const empty = (rel: string) => ({ rel, chars: 102, markers: ["LOADING ARTICLE"] });

  it("an empty artifact NOT in the baseline is fresh — the fatal arm", () => {
    const { fresh } = classifyEmptyArtifacts([empty("blog/new-one/index.html")], []);
    expect(fresh.map((a) => a.rel)).toEqual(["blog/new-one/index.html"]);
  });

  it("a baseline row that now renders fine is stale — also fatal", () => {
    const { stale } = classifyEmptyArtifacts([], ["blog/fixed/index.html"]);
    expect(stale).toEqual(["blog/fixed/index.html"]);
  });

  it("a known-still-empty row is reported, not fatal", () => {
    const rel = "blog/known/index.html";
    const { fresh, stale, stillEmpty } = classifyEmptyArtifacts([empty(rel)], [rel]);
    expect(fresh).toEqual([]);
    expect(stale).toEqual([]);
    expect(stillEmpty.map((a) => a.rel)).toEqual([rel]);
  });
});

describe("the baseline is honest about the live tree", () => {
  const baseline = JSON.parse(readFileSync(resolve(APP, "config/thin-prerender-baseline.json"), "utf8"));
  const live = emptyArtifacts(resolve(APP, "prerendered"));

  it("names every empty artifact currently committed, and no others", () => {
    // Both directions. Missing a live one means the gate is red for everyone;
    // naming a fixed one is stale paperwork that teaches readers the list is
    // decorative.
    expect([...baseline.known].sort()).toEqual(live.map((a) => a.rel).sort());
  });

  it("cannot be used to launder a growing problem", () => {
    // Three is the whole known population. If this number climbs, someone is
    // adding rows instead of fixing pages — which is the failure mode a
    // ratchet exists to prevent.
    expect(baseline.known.length).toBeLessThanOrEqual(3);
  });
});

describe("a route that fails to render keeps yesterday's page", () => {
  // prerender.mjs now omits an empty render, and regen-prerender.mjs swaps the
  // tracked tree wholesale with renameSync. Without the backfill those two
  // combine into a DELETION — the same contentless page for crawlers, minus
  // any gate that can see it, because check-prerender.mjs only fails on a
  // missing SITEMAP route and these DB-dynamic posts are `extra`.
  function pair(label: string) {
    const prev = join(fixtures, label, "prev");
    const next = join(fixtures, label, "next");
    mkdirSync(prev, { recursive: true });
    mkdirSync(next, { recursive: true });
    return { prev, next };
  }
  function put(root: string, rel: string, body: string) {
    mkdirSync(join(root, rel.split("/").slice(0, -1).join("/")), { recursive: true });
    writeFileSync(join(root, rel), body);
  }

  it("carries forward an artifact the fresh run did not produce", () => {
    const { prev, next } = pair("carry");
    put(prev, "blog/failed-route/index.html", "<html>yesterday's real article</html>");
    put(next, "blog/ok-route/index.html", "<html>fresh</html>");

    expect(backfillMissingArtifacts(prev, next)).toEqual(["blog/failed-route/index.html"]);
    expect(readFileSync(join(next, "blog/failed-route/index.html"), "utf8")).toContain("yesterday");
  });

  it("never overwrites a page that DID render — the direction that would undo a regen", () => {
    // If this were reversed, every successful re-render would be silently
    // replaced by its stale predecessor and regen would become a no-op.
    const { prev, next } = pair("no-clobber");
    put(prev, "blog/post/index.html", "<html>STALE</html>");
    put(next, "blog/post/index.html", "<html>FRESH</html>");

    expect(backfillMissingArtifacts(prev, next)).toEqual([]);
    expect(readFileSync(join(next, "blog/post/index.html"), "utf8")).toContain("FRESH");
  });

  it("recurses into nested route directories", () => {
    const { prev, next } = pair("nested");
    put(prev, "a/b/c/index.html", "<html>deep</html>");
    expect(backfillMissingArtifacts(prev, next)).toEqual(["a/b/c/index.html"]);
  });
});

describe("the gates actually call this code", () => {
  it("check-prerender-semantic.mjs imports the shared scan, not a private copy", () => {
    const gate = readCode("scripts/check-prerender-semantic.mjs");
    expect(gate).toContain("./lib/prerenderText.mjs");
    expect(gate).toContain("classifyEmptyArtifacts(");
    // The literal list used to live here as well as in prerender.mjs, kept in
    // sync by a comment. Both copies were wrong in the same way.
    expect(gate).not.toContain('"ARTICLE NOT FOUND"');
  });

  it("prerender.mjs imports the shared list instead of redeclaring it", () => {
    const src = readCode("scripts/prerender.mjs");
    expect(src).toContain("./lib/prerenderText.mjs");
    expect(src).not.toContain("const SOFT_404_MARKERS = [");
  });

  it("prerender.mjs decides BEFORE it writes — the ordering that was inverted", () => {
    // The original checked content after writeFileSync and after success++, so
    // its verdict could not prevent anything. Comments are stripped here, so
    // this compares code positions rather than prose about them.
    const src = readCode("scripts/prerender.mjs");
    const decide = src.indexOf("const emptyReason");
    const write = src.indexOf("fs.writeFileSync(outPath");
    expect(decide, "emptyReason must be computed in prerender.mjs").toBeGreaterThan(-1);
    expect(write, "the artifact write must still exist").toBeGreaterThan(-1);
    expect(decide, "the empty check must run BEFORE the write, not after it").toBeLessThan(write);
  });

  it("regen-prerender.mjs backfills BEFORE it swaps the tracked tree", () => {
    // Order is the whole point: backfilling after renameSync would write into a
    // directory that is no longer the one being published.
    const src = readCode("scripts/regen-prerender.mjs");
    const fill = src.indexOf("backfillMissingArtifacts(");
    const swap = src.indexOf("fs.renameSync(PRERENDER_DIR_TMP, PRERENDER_DIR_FINAL)");
    expect(fill, "regen must call the shared backfill").toBeGreaterThan(-1);
    expect(swap, "the tracked-tree swap must still exist").toBeGreaterThan(-1);
    expect(fill, "backfill must run BEFORE the swap").toBeLessThan(swap);
  });

  it("prerender.mjs treats an empty render as a failure, not a glyph", () => {
    const src = readCode("scripts/prerender.mjs");
    expect(src).toContain("throw new Error(");
    // The byte-count check that a 32 KB shell passed.
    expect(src).not.toContain("html.length > 5000");
    // The verdict must no longer be spent on choosing a status character.
    expect(src).not.toContain('? "✓" : "⚠"');
  });
});
