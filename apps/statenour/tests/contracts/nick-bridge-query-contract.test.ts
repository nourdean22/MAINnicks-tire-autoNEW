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
  // `revenue_top_services` and `customer_stats` sat here from 2026-10-08 (found by the first
  // multi-line run) until the same day's follow-up: `customer_stats` became a nickstire
  // handler, and getTopServices was retired, so nothing calls `revenue_top_services`.
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
  // Direct forms:  queryNick("x")  ·  fetchBridge<T>("x")  ·  queryNick<Record<string, unknown>>("x")
  // The type argument may nest generics up to three deep. Until 2026-10-08 it stopped at the
  // first `>`, so `queryNick<Record<string, unknown>>("x")` was invisible: a typo in such a
  // call passed this guard (`draft_opportunity_sms` and `lot_brief` were both unguarded).
  //
  // The scan runs over the WHOLE comment-stripped file, not line by line, so a call written
  // across lines is seen: `\s` and `[^<>]` both match a newline. Until 2026-10-08 the scan was
  // per line, and every call that put its query name on the line after `queryNick(` (or split
  // its type argument over several lines) was invisible: 18 calls in lib/ and app/, among them
  // send_opportunity_sms in app/api/telegram/webhook, the one customer-texting action.
  // Known limitation: a query name held in a variable (`const q = "x"; queryNick(q)`) is still
  // not caught.
  const direct = /(?:queryNick|fetchBridge)\s*(?:<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*>)?\(\s*["']([a-z0-9_]+)["']/g;
  // Batch form:  queryNickBatch([{ query: "x" }, ...]) — only trust `query:`
  // literals in files that actually use the batch helper, so we don't pick up
  // unrelated `query:` object properties.
  const batch = /\bquery:\s*["']([a-z0-9_]+)["']/g;
  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    const usesBatch = raw.includes("queryNickBatch");
    // Blank out /* block comments */ (keep newlines so line numbers stay
    // accurate) so historical notes that quote an old query name don't count.
    // Then strip // line comments: `// was queryNick("old_name")` and
    // commented-out examples are NOT live callsites. `[^:]` leaves :// alone.
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .split("\n")
      .map((ln) => ln.replace(/(^|[^:])\/\/.*$/, "$1"))
      .join("\n");
    // Report the line of the query literal itself (the last token of the match).
    const lineOf = (m: RegExpMatchArray) => {
      const at = (m.index ?? 0) + m[0].length - m[1].length - 1;
      return src.slice(0, at).split("\n").length;
    };
    for (const m of src.matchAll(direct)) hits.push({ query: m[1], file, line: lineOf(m) });
    if (usesBatch) {
      for (const m of src.matchAll(batch)) hits.push({ query: m[1], file, line: lineOf(m) });
    }
  }
  return hits;
}

/**
 * The contract doc lives in BOTH apps, and each copy says it mirrors the other.
 * Until 2026-10-08 nothing checked that, and they had drifted: four §7 rows and
 * all of §8 existed only in statenour's copy, `team_performance` only in
 * nickstire's, and thirteen live handlers had no row in either.
 */
const CONTRACT_DOCS = [
  resolve(STATENOUR_ROOT, "docs/NICKSTIRE-QUERY-CONTRACT.md"),
  resolve(STATENOUR_ROOT, "../nickstire/docs/NICKSTIRE-QUERY-CONTRACT.md"),
] as const;

interface ContractRow {
  action: string;
  cells: number;
  line: number;
}

/** The action rows of §7 (between the `## 7.` and `## 8.` headings). */
function contractRows(doc: string): ContractRow[] {
  const start = doc.search(/^## 7\. /m);
  const end = doc.search(/^## 8\. /m);
  if (start < 0 || end < start) {
    throw new Error("NICKSTIRE-QUERY-CONTRACT.md: could not find the ## 7. and ## 8. headings");
  }
  const firstLine = doc.slice(0, start).split("\n").length;
  return doc
    .slice(start, end)
    .split("\n")
    .flatMap((text, i) => {
      const m = /^\| `([a-z0-9_]+)` \|/.exec(text);
      if (!m) return [];
      // A pipe inside a cell must be escaped (`\|`), even inside a code span,
      // or GitHub splits the cell: a 3-column row has exactly 4 unescaped pipes.
      const pipes = text.match(/(?<!\\)\|/g)?.length ?? 0;
      return [{ action: m[1], cells: pipes - 1, line: firstLine + i }];
    });
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

  it("the two copies of NICKSTIRE-QUERY-CONTRACT.md are byte-identical", () => {
    for (const p of CONTRACT_DOCS) {
      if (!existsSync(p)) throw new Error(`contract doc not found at ${p}: if it moved, update CONTRACT_DOCS.`);
    }
    const [own, nick] = CONTRACT_DOCS.map((p) => readFileSync(p));
    if (own.equals(nick)) return;
    const a = own.toString("utf8").split("\n");
    const b = nick.toString("utf8").split("\n");
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    expect.fail(
      `The contract copies differ, first at line ${i + 1}:\n` +
        `  statenour: ${JSON.stringify(a[i] ?? "<end of file>").slice(0, 160)}\n` +
        `  nickstire: ${JSON.stringify(b[i] ?? "<end of file>").slice(0, 160)}\n` +
        `Edit one copy, then copy it over the other:\n` +
        `  apps/statenour/docs/NICKSTIRE-QUERY-CONTRACT.md\n` +
        `  apps/nickstire/docs/NICKSTIRE-QUERY-CONTRACT.md`,
    );
  });

  it("§7 has one well-formed row per live handler, in order, and no row for anything else", () => {
    const live = liveHandlers();
    expect(live.size).toBeGreaterThan(10);
    const rows = contractRows(readFileSync(CONTRACT_DOCS[0], "utf8"));
    const named = rows.map((r) => r.action);

    const missing = [...live].filter((h) => !named.includes(h)).sort();
    const extra = named.filter((a) => !live.has(a)).sort();
    const duplicated = named.filter((a, i) => named.indexOf(a) !== i);
    const malformed = rows
      .filter((r) => r.cells !== 3)
      .map((r) => `${r.action} (line ${r.line}: ${r.cells} cells; escape a pipe in a cell as \\|)`);
    // The table's heading says "alphabetical"; hold it to that.
    const outOfOrder = rows
      .filter((r, i) => i > 0 && rows[i - 1].action > r.action)
      .map((r) => `${r.action} (line ${r.line}) sorts before the row above it`);

    expect(
      { missing, extra, duplicated, malformed, outOfOrder },
      `§7 of docs/NICKSTIRE-QUERY-CONTRACT.md must list every QUERY_HANDLERS key in ` +
        `apps/nickstire/server/routes/nour-os-query.ts exactly once, alphabetically, as a 3-cell row.`,
    ).toEqual({ missing: [], extra: [], duplicated: [], malformed: [], outOfOrder: [] });
  });
});
