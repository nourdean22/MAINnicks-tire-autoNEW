/**
 * Bridge query contract guard · 2026-05-30
 *
 * WHY THIS EXISTS — the dead-query class. statenour talks to nickstire over a
 * stringly-typed HTTP bridge: `queryNick("revenue_today")` / `fetchBridge(...)`
 * / `queryNickBatch([{ query: "..." }])`. Nothing — not the compiler, not the
 * existing tests — checks that a query string actually corresponds to a live
 * nickstire handler. So typos and renamed handlers degrade silently to "no
 * data" instead of failing loudly:
 *   · `jobs_today`              → should have been `revenue_today`
 *   · `pending_callbacks_count` → should have been `callbacks_pending`
 *   · `stale_leads_count`       → should have been `leads_urgent`
 * Each one zeroed an operator-facing number ($0 revenue, 0 callbacks, false
 * "ZERO REVENUE" alarm) for an unknown length of time.
 *
 * This test is the static guard: it reads nickstire's REAL handler registry
 * and asserts every statenour bridge callsite targets either (a) a live
 * handler, or (b) a query explicitly catalogued as `newly-required` (shipped
 * on the statenour side, awaiting a nickstire-side handler — these degrade
 * gracefully BY DESIGN, see lib/nickstire/query.ts `warnUnknownQueryOnce`).
 *
 * A new typo'd query, or a handler removed nickstire-side, now fails CI
 * instead of silently lying on a dashboard.
 *
 * Source of truth for the catalogue: scripts/contract-pre-flight.ts ACTIONS
 * + docs/NICKSTIRE-QUERY-CONTRACT.md. The runtime pre-flight PROBES the live
 * bridge; this test enforces the same contract statically, with no network.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const STATENOUR_ROOT = process.cwd(); // vitest runs from apps/statenour
const NICK_REGISTRY = resolve(
  STATENOUR_ROOT,
  "../nickstire/server/routes/nour-os-query.ts",
);

/**
 * Queries nickstire has NOT shipped a handler for yet, but that statenour
 * intentionally calls (they 400 "Unknown query" and degrade to empty — see
 * the `newly-required` / `primary-metric` tiers in contract-pre-flight.ts).
 * When nickstire ships one it becomes a live handler and the second test
 * below will tell you to delete it from this list.
 */
const KNOWN_PENDING = new Set<string>([
  "quotes_pending",
  "quotes_booked_week",
  "quotes_stale",
  "leads_open",
  "leads_overdue_count",
  "leads_today_count",
  "leads_week_count",
  "cars_today",
  "estimates_conversion",
  "estimates_aging",
  "drop_off_ratio",
]);

/** Parse the live handler keys out of nickstire's QUERY_HANDLERS registry. */
function liveHandlers(): Set<string> {
  if (!existsSync(NICK_REGISTRY)) {
    throw new Error(
      `nickstire registry not found at ${NICK_REGISTRY} — if the file moved, ` +
        `update NICK_REGISTRY in this test.`,
    );
  }
  const src = readFileSync(NICK_REGISTRY, "utf8");
  const out = new Set<string>();
  // handlers look like:  "revenue_today": async () => {
  for (const m of src.matchAll(/["']([a-z0-9_]+)["']\s*:\s*async/g)) {
    out.add(m[1]);
  }
  return out;
}

/** Recursively collect .ts/.tsx source files (skip tests + build output). */
function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (["node_modules", ".next", ".next-prod", "dist"].includes(entry)) continue;
      walk(p, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec|d)\.tsx?$/.test(entry)) {
      acc.push(p);
    }
  }
  return acc;
}

interface Callsite {
  query: string;
  file: string;
  line: number;
}

/**
 * Scan production source (lib/ app/ src/ — NOT scripts/, which intentionally
 * enumerates every contract action) for bridge query strings.
 */
function scanCallsites(): Callsite[] {
  const files = ["lib", "app", "src"].flatMap((d) => walk(join(STATENOUR_ROOT, d)));
  const hits: Callsite[] = [];
  // Direct forms:  queryNick("x")  ·  fetchBridge<T>("x")
  // Known limitation: only a literal first-arg is scanned. A query name held
  // in a variable first (`const q = "x"; queryNick(q)`) is NOT caught — every
  // current callsite passes a literal, so this is a structural gap, not a miss.
  const direct = /(?:queryNick|fetchBridge)\s*(?:<[^>]*>)?\(\s*["']([a-z0-9_]+)["']/g;
  // Batch form:  queryNickBatch([{ query: "x" }, ...]) — only trust `query:`
  // literals in files that actually use the batch helper, so we don't pick up
  // unrelated `query:` object properties.
  const batch = /\bquery:\s*["']([a-z0-9_]+)["']/g;
  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    const usesBatch = raw.includes("queryNickBatch");
    // Blank out /* block comments */ (keep newlines so line numbers stay
    // accurate) so historical notes that quote an old query name don't count.
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
    src.split("\n").forEach((rawLine, i) => {
      // Strip // line comments too — `// was queryNick("old_name")` and
      // commented-out examples are NOT live callsites. `[^:]` leaves :// alone.
      const ln = rawLine.replace(/(^|[^:])\/\/.*$/, "$1");
      for (const m of ln.matchAll(direct)) hits.push({ query: m[1], file, line: i + 1 });
      if (usesBatch) {
        for (const m of ln.matchAll(batch)) hits.push({ query: m[1], file, line: i + 1 });
      }
    });
  }
  return hits;
}

describe("nickstire bridge query contract", () => {
  it("every bridge callsite targets a live handler or a catalogued newly-required query", () => {
    const valid = liveHandlers();
    // Sanity: confirm we actually parsed the registry (not an empty match).
    expect(valid.size).toBeGreaterThan(10);

    const offenders = scanCallsites().filter(
      (c) => !valid.has(c.query) && !KNOWN_PENDING.has(c.query),
    );
    const report = offenders
      .map((o) => `  ✗ "${o.query}"  @ ${o.file.replace(STATENOUR_ROOT, ".")}:${o.line}`)
      .join("\n");

    expect(
      offenders,
      `Uncatalogued bridge queries found — each is a typo or a handler that no ` +
        `longer exists nickstire-side (it will silently return no data):\n${report}\n\n` +
        `Fix: point the callsite at a real handler, OR (if nickstire genuinely ` +
        `owes a new handler) add the query to KNOWN_PENDING here + contract-pre-flight.ts.`,
    ).toEqual([]);
  }, 60000);

  it("KNOWN_PENDING only lists queries nickstire has NOT shipped (promote when shipped)", () => {
    const valid = liveHandlers();
    const shipped = [...KNOWN_PENDING].filter((q) => valid.has(q));
    expect(
      shipped,
      `These KNOWN_PENDING queries are now LIVE nickstire handlers — remove them ` +
        `from KNOWN_PENDING (and the newly-required tier in contract-pre-flight.ts):\n  ${shipped.join(", ")}`,
    ).toEqual([]);
  });
});
