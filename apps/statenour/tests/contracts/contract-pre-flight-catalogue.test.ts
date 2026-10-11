/**
 * The contract pre-flight's catalogue follows its own tier rules (2026-10-10).
 *
 * scripts/contract-pre-flight.ts probes the live bridge. Its tier decides how a probe is read:
 * "production" must answer, "newly-required" may answer 400 Unknown query (not shipped yet). A
 * shipped query left in newly-required hides a regression as "pending", and a production probe
 * whose filters the handler refuses reports a 200 { error } as an outage. Nothing checked either:
 * quotes_pending stayed newly-required after it shipped, and bookings_pending_stale (which needs
 * staleHours) was not probed at all. The script runs main() on import, so it is read as source.
 */
import { describe, it, expect } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const STATENOUR_ROOT = process.cwd(); // vitest runs from apps/statenour
const PRE_FLIGHT = resolve(STATENOUR_ROOT, "scripts/contract-pre-flight.ts");
const NICK_REGISTRY = resolve(STATENOUR_ROOT, "../nickstire/server/routes/nour-os-query.ts");

interface Entry {
  query: string;
  tier: string;
  filters: Record<string, unknown>;
}

/** The ACTIONS array, read from the script's syntax tree (literal filter values only). */
function catalogue(src = readFileSync(PRE_FLIGHT, "utf8")): Entry[] {
  const sf = ts.createSourceFile(PRE_FLIGHT, src, ts.ScriptTarget.Latest, true);
  let list: ts.ArrayLiteralExpression | undefined;
  (function find(n: ts.Node): void {
    if (ts.isVariableDeclaration(n) && n.name.getText(sf) === "ACTIONS" && n.initializer && ts.isArrayLiteralExpression(n.initializer)) {
      list = n.initializer;
    }
    ts.forEachChild(n, find);
  })(sf);
  if (!list) throw new Error("contract-pre-flight.ts: no `const ACTIONS = [...]` found; if it moved, update this test.");
  const prop = (o: ts.ObjectLiteralExpression, k: string) =>
    o.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(sf) === k)?.initializer;
  const literal = (e: ts.Expression | undefined): unknown =>
    !e ? undefined : ts.isStringLiteral(e) ? e.text : ts.isNumericLiteral(e) ? Number(e.text) : e.getText(sf);
  return list.elements.map((el) => {
    const o = el as ts.ObjectLiteralExpression;
    const f = prop(o, "filters");
    const filters: Record<string, unknown> = {};
    if (f && ts.isObjectLiteralExpression(f)) for (const p of f.properties) if (ts.isPropertyAssignment(p)) filters[p.name.getText(sf)] = literal(p.initializer);
    return { query: String(literal(prop(o, "query"))), tier: String(literal(prop(o, "tier"))), filters };
  });
}

/** nickstire's live QUERY_HANDLERS keys (same parse as nick-bridge-query-contract.test.ts). */
function liveHandlers(): Set<string> {
  const src = readFileSync(NICK_REGISTRY, "utf8");
  return new Set([...src.matchAll(/["']([a-z0-9_]+)["']\s*:\s*async/g)].map((m) => m[1]));
}

/** Entries that break a tier rule: a shipped query still pending, a production probe of no handler. */
function tierBreaks(entries: Entry[], live: Set<string>) {
  return {
    shippedButPending: entries.filter((e) => e.tier === "newly-required" && live.has(e.query)).map((e) => e.query),
    productionButDead: entries.filter((e) => e.tier === "production" && !live.has(e.query)).map((e) => e.query),
  };
}

describe("contract pre-flight catalogue", () => {
  it("reads the catalogue and the registry (the instrument fired)", () => {
    expect(catalogue().length).toBeGreaterThan(15);
    expect(liveHandlers().size).toBeGreaterThan(10);
  });

  it("canary: a planted catalogue that breaks both tier rules is caught", () => {
    const planted = catalogue(
      `const ACTIONS: ActionSpec[] = [\n` +
        `  { query: "cars_today", tier: "newly-required", consumer: "x" },\n` +
        `  { query: "no_such_handler", filters: { n: 1 }, tier: "production", consumer: "x" },\n` +
        `  { query: "revenue_today", tier: "production", consumer: "x" },\n];`,
    );
    expect(planted[1].filters).toEqual({ n: 1 });
    expect(tierBreaks(planted, new Set(["cars_today", "revenue_today"]))).toEqual({
      shippedButPending: ["cars_today"],
      productionButDead: ["no_such_handler"],
    });
  });

  it("newly-required lists no query nickstire has shipped (promote it to production)", () => {
    const { shippedButPending } = tierBreaks(catalogue(), liveHandlers());
    expect(shippedButPending, `shipped, still probed as newly-required: ${shippedButPending.join(", ")}`).toEqual([]);
  });

  it("production lists only queries nickstire has shipped", () => {
    const { productionButDead } = tierBreaks(catalogue(), liveHandlers());
    expect(productionButDead, `probed as production but not a live handler: ${productionButDead.join(", ")}`).toEqual([]);
  });

  it("probes quotes_pending and bookings_pending_stale as production, with filters their handlers accept", () => {
    const byQuery = new Map(catalogue().map((e) => [e.query, e]));
    expect(byQuery.get("quotes_pending")?.tier).toBe("production");
    const stale = byQuery.get("bookings_pending_stale");
    expect(stale?.tier).toBe("production");
    // The handler refuses a missing or out-of-range staleHours with a 200 { error }, which the
    // probe would report as an outage: whole hours, 1-167.
    const h = stale?.filters.staleHours;
    expect(typeof h === "number" && Number.isInteger(h) && h >= 1 && h <= 167, `staleHours ${String(h)}`).toBe(true);
  });
});
