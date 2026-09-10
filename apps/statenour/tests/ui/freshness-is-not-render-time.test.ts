/**
 * tests/ui/freshness-is-not-render-time.test.ts · 2026-09-10
 *
 * ONE invariant: a freshness chip may never be fed the render clock.
 *
 * `<FreshnessChip lastFetchedAt={new Date().toISOString()} />` reads
 * "just now" on every paint, no matter how old the underlying fetch is —
 * and keeps reading "just now" while the query behind it is failing. It
 * is the same deception as rendering a failed read as an empty one, at a
 * different layer: the UI asserts a measurement it never took.
 *
 * Found on three pages at once (system/tools, system/inbox,
 * system/camera), all of which had a real timestamp available and unused:
 * tRPC's `dataUpdatedAt`. The correct idiom was already in this codebase
 * — components/brain/active-alerts-card.tsx:98 uses `dataUpdatedAt`, and
 * components/brain/brain-maturity-header.tsx:209 uses the source's own
 * `computed_at`, which is better still.
 *
 * WHY THIS GATE AND NOT A GENERAL ONE. An earlier attempt at a broad
 * static gate over the tool layer failed three times on its own parser
 * before being deleted. This one needs no parser: it is a literal string
 * search for one unambiguous anti-pattern, so it cannot mis-attribute a
 * body or match a comment as code. Narrow, exact, and it cannot cry wolf.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ROOTS = ["app", "components", "features"];

/** Every `.tsx` under the UI roots. */
function tsxFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, acc);
    else if (entry.endsWith(".tsx")) acc.push(full);
  }
  return acc;
}

const FILES = ROOTS.flatMap((r) => {
  try {
    return tsxFiles(join(APP_ROOT, r));
  } catch {
    return [];
  }
});

/**
 * The anti-pattern: a freshness prop fed from a clock read at render.
 * Deliberately literal — `Date.now()` and `new Date()` with no argument
 * are the only two ways to produce "now" here.
 */
const RENDER_CLOCK = /lastFetchedAt=\{\s*(new Date\(\s*\)|Date\.now\(\s*\))/;

describe("freshness never comes from the render clock", () => {
  // POSITIVE CONTROL. With no files scanned the suite passes vacuously.
  it("POSITIVE CONTROL · the scan sees the UI tree", () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  it("POSITIVE CONTROL · the pattern matches the shape it is meant to catch", () => {
    expect(RENDER_CLOCK.test("lastFetchedAt={new Date().toISOString()}")).toBe(true);
    expect(RENDER_CLOCK.test("lastFetchedAt={Date.now()}")).toBe(true);
    // ...and NOT the correct forms, or it would flag every fixed page.
    expect(RENDER_CLOCK.test("lastFetchedAt={new Date(dataUpdatedAt)}")).toBe(false);
    expect(RENDER_CLOCK.test("lastFetchedAt={data.computed_at}")).toBe(false);
    expect(RENDER_CLOCK.test("lastFetchedAt={loadedAt}")).toBe(false);
  });

  it("no UI file feeds a freshness chip the current time", () => {
    const offenders = FILES.filter((f) => RENDER_CLOCK.test(readFileSync(f, "utf8"))).map((f) =>
      f.slice(APP_ROOT.length + 1).replace(/\\/g, "/"),
    );
    expect(
      offenders,
      "A freshness chip fed `new Date()` shows the RENDER time, so it reads 'just now' " +
        "forever — including while the query behind it is failing. Use the real fetch " +
        "timestamp (tRPC's `dataUpdatedAt`, or better, the source's own computed_at), and " +
        "pass null when it has never loaded so the chip can say 'no data'.",
    ).toEqual([]);
  });
});
