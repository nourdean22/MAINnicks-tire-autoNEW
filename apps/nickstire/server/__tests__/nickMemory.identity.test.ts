/**
 * One rolling row per report kind (2026-09-22)
 *
 * WHAT WAS WRONG. remember() keys a memory on a hash of its content, so a
 * report whose numbers change every run inserted a new row per run. The
 * eviction simulation measured 6.9 rows a day, 90 % of them analytics
 * summaries entering at 0.9–0.95, each insert evicting a four-month-old copy
 * of the same report at the 500-row cap — while the operator's own 0.7
 * statements went first.
 *
 * WHAT THIS PINS, through the real remember() over a db double that honours
 * the key it is asked for:
 *   · with `identity`, two different readings land in ONE row: latest text,
 *     uses 2, confidence exactly what the writer asserted (no +0.05);
 *   · POSITIVE CONTROL: without `identity` the same two readings are two rows
 *     and a repeated identical reading is a reinforcement (+0.05) — the old
 *     contract holds where nothing changed;
 *   · every analytics writer passes an identity (comment-stripped source);
 *   · event memories carry no phone number (PROTECTED-CORE rule 5), and the
 *     name still appears so "no phone" is not "no content".
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: number; key: string; value: string };
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const keyFor = (type: string, text: string) =>
  `nick_memory_${type}_${createHash("md5").update(text.toLowerCase().trim().replace(/\s+/g, " ")).digest("hex").slice(0, 12)}`;

/** Bound strings in a drizzle condition: eq() wraps them as Param, sql`` keeps primitives. */
const boundStrings = (node: unknown, out: string[] = []): string[] => {
  if (typeof node === "string") { out.push(node); return out; }
  if (!node || typeof node !== "object") return out;
  const n = node as { queryChunks?: unknown[]; value?: unknown; encoder?: unknown };
  if (Array.isArray(n.queryChunks)) for (const c of n.queryChunks) boundStrings(c, out);
  else if ("encoder" in n && typeof n.value === "string") out.push(n.value);
  return out;
};

function fakeDb() {
  const rows: Row[] = [];
  let nextId = 1;
  const db = {
    select: (projection?: unknown) => {
      let wantedKey: string | null = null;
      const chain = {
        from: () => chain,
        where: (w: unknown) => {
          const strs = boundStrings(w).filter((s) => s.startsWith("nick_memory_"));
          wantedKey = strs[0] ?? null;
          return chain;
        },
        orderBy: () => chain,
        limit: async () => (wantedKey ? rows.filter((r) => r.key === wantedKey) : [...rows]),
        then: (res: (v: unknown) => void) => res(projection ? [{ count: rows.length }] : [...rows]),
      };
      return chain;
    },
    insert: () => ({ values: async (v: { key: string; value: string }) => { rows.push({ id: nextId++, key: v.key, value: v.value }); } }),
    update: () => ({ set: (v: { value: string }) => ({ where: async (w: unknown) => { const k = boundStrings(w).find((s) => s.startsWith("nick_memory_")); const r = rows.find((x) => x.key === k); if (r) r.value = v.value; } }) }),
    delete: () => ({ where: async () => { rows.shift(); } }),
  };
  return { db, rows, parsed: () => rows.map((r) => ({ key: r.key, ...JSON.parse(r.value) })) };
}

describe("remember() · one rolling row per identity", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock("../lib/db-helper"));

  async function arm() {
    const rig = fakeDb();
    vi.doMock("../lib/db-helper", () => ({ db: async () => rig.db, dbTyped: async () => rig.db, requireDb: async () => rig.db }));
    const mod = await import("../services/nickMemory");
    return { rig, ...mod };
  }

  it("two readings of one report → one row: latest text, uses 2, confidence as asserted (no bump)", async () => {
    const { rig, remember } = await arm();
    await remember({ type: "pattern", content: "Day score: B (74/100). Revenue $1200", source: "daily_score", confidence: 0.95, identity: "daily_score" });
    await remember({ type: "pattern", content: "Day score: A (91/100). Revenue $2400", source: "daily_score", confidence: 0.95, identity: "daily_score" });
    const rows = rig.parsed();
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(keyFor("pattern", "daily_score"));
    expect(rows[0].content).toBe("Day score: A (91/100). Revenue $2400");
    expect(rows[0].identity).toBe("daily_score");
    expect(rows[0].uses).toBe(2);
    expect(rows[0].confidence).toBe(0.95); // not 1.0 — a re-issued report is not truer
    expect(rows[0].originalConfidence).toBe(0.95);
  });

  it("POSITIVE CONTROL: without identity the same two readings are two rows keyed on content", async () => {
    const { rig, remember } = await arm();
    await remember({ type: "pattern", content: "Day score: B (74/100). Revenue $1200", source: "daily_score", confidence: 0.95 });
    await remember({ type: "pattern", content: "Day score: A (91/100). Revenue $2400", source: "daily_score", confidence: 0.95 });
    expect(rig.rows).toHaveLength(2);
    expect(rig.rows[0].key).toBe(keyFor("pattern", "Day score: B (74/100). Revenue $1200"));
  });

  it("POSITIVE CONTROL: an identical reading without identity still REINFORCES (+0.05) — the old contract where nothing changed", async () => {
    const { rig, remember } = await arm();
    await remember({ type: "lesson", content: "Customers ask for the used-tire price first", source: "chat", confidence: 0.8 });
    await remember({ type: "lesson", content: "Customers ask for the used-tire price first", source: "chat", confidence: 0.8 });
    const rows = rig.parsed();
    expect(rows).toHaveLength(1);
    expect(rows[0].uses).toBe(2);
    expect(rows[0].confidence).toBe(0.85);
  });

  it("refreshRollingRow keeps the writer's confidence, moves lastReinforced, counts the re-issue", async () => {
    const { refreshRollingRow } = await arm();
    const out = refreshRollingRow(
      { content: "old", confidence: 0.95, originalConfidence: 0.95, uses: 3, lastReinforced: "2026-09-01T00:00:00.000Z" },
      { content: "new", confidence: 0.9, identity: "x" },
      "2026-09-22T12:00:00.000Z",
    );
    expect(out).toMatchObject({ content: "new", identity: "x", confidence: 0.9, originalConfidence: 0.9, uses: 4, lastReinforced: "2026-09-22T12:00:00.000Z" });
  });

  it("every analytics writer passes an identity (comment-stripped source)", () => {
    const expected: Array<[string, string]> = [
      ["server/services/nickIntelligence.ts", "daily_score"],
      ["server/services/nickIntelligence.ts", "service_mix_30d"],
      ["server/services/nickIntelligence.ts", "bay_utilization"],
      ["server/services/nickIntelligence.ts", "vip_customers_60d"],
      ["server/services/nickIntelligence.ts", "busiest_slowest_day"],
      ["server/services/dataPipelines.ts", "invoice_reconciliation_today"],
      ["server/services/dataPipelines.ts", "revenue_analytics_weekly"],
      ["server/cron/scheduler.ts", "revenue_reconciliation_latest"],
      ["server/cron/scheduler.ts", "daily_digest"],
      ["server/cron/scheduler.ts", "data_accuracy"],
    ];
    for (const [file, identity] of expected) {
      const src = stripComments(readFileSync(resolve(__dirname, "..", "..", file), "utf8"));
      expect(src, `${file} → ${identity}`).toContain(`identity: "${identity}"`);
    }
  });

  it("event memories carry no phone number — and still the name (positive control)", async () => {
    const { rig, learnFromEvent } = await arm();
    await learnFromEvent("lead_captured", { name: "Test Lead", phone: "2165550199", source: "website", urgencyScore: 4 });
    await learnFromEvent("callback_requested", { name: "Test Caller", phone: "2165550188", reason: "brakes" });
    const contents = rig.parsed().map((r) => r.content as string);
    expect(contents.length).toBeGreaterThanOrEqual(2);
    for (const c of contents) {
      expect(c).not.toMatch(/216555/);
      expect(c).not.toMatch(/Phone:/);
    }
    expect(contents.join("\n")).toContain("Test Lead");
    expect(contents.join("\n")).toContain("Test Caller");
  });
});
