/**
 * Target keyword ranks from the shop's own Search Console rows (2026-10-25).
 *
 * The Local Growth "Search visibility" panel said "no measured ranks yet" for four months while
 * search_performance held daily query rows. This read turns those rows into, per tracked keyword:
 * the 28-day impression-weighted position vs the 28 days before, and one action.
 *
 * It drives the REAL drizzle MySQL builder over a fake mysql2 client that records the SQL and params
 * it is sent (customerIntelligenceGroupBy.test.ts precedent), so the window bounds, the lowercase
 * match and the GROUP BY shape TiDB's ONLY_FULL_GROUP_BY sees are all asserted on rendered SQL,
 * not on a stub that hands back whatever the test chose.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("drizzle-orm/mysql2");
vi.unmock("drizzle-orm");
vi.unmock("../../drizzle/schema");

import { drizzle } from "drizzle-orm/mysql2";

type Win = { impressions: number; clicks: number; positionX100: number };
const h = vi.hoisted(() => ({
  sent: [] as { sql: string; params: unknown[] }[],
  latest: "2026-10-23" as string | null,
  current: {} as Record<string, Win>,
  previous: {} as Record<string, Win>,
  seen: [] as string[],
  totals: [57361, 5897] as [number, number],
  fail: null as Error | null,
  noDb: false,
}));

/** Rows come back positional (rowsAsArray), in the select's field order, as mysql2 returns DECIMAL sums: strings. */
const fakeClient = {
  query: async (q: { sql: string } | string, params: unknown[] = []) => {
    const text = typeof q === "string" ? q : q.sql;
    h.sent.push({ sql: text, params });
    if (h.fail) throw h.fail;
    if (/max\(/i.test(text)) return [[[h.latest]], []];
    if (/count\(distinct/i.test(text)) return [[[String(h.totals[0]), h.totals[1]]], []];
    if (!/sum\(/i.test(text)) return [h.seen.map((q2) => [q2]), []];
    // Window query: which window is decided by the lower date bound it was sent.
    const win = params.includes("2026-09-26") ? h.current : params.includes("2026-08-29") ? h.previous : {};
    return [Object.entries(win).map(([k, w]) => [k, String(w.impressions), String(w.clicks), String(w.positionX100)]), []];
  },
};
const realDrizzle = drizzle(fakeClient as never);

vi.mock("../lib/db-helper", () => ({
  dbTyped: async () => (h.noDb ? null : realDrizzle),
}));

import { getTargetKeywordRanks } from "./targetKeywordRanks";
import { RANK_KEYWORDS } from "@shared/localRankKeywords";

const NOW = new Date("2026-10-25T16:00:00Z"); // 12:00 in Cleveland, shop date 2026-10-25

const savedKey = process.env.GOOGLE_SEARCH_CONSOLE_KEY;
beforeEach(() => {
  h.sent.length = 0;
  h.latest = "2026-10-23";
  h.fail = null;
  h.noDb = false;
  h.totals = [57361, 5897];
  process.env.GOOGLE_SEARCH_CONSOLE_KEY = "configured";
  h.current = {
    "used tires cleveland": { impressions: 135, clicks: 0, positionX100: 650 },
    "oil change cleveland": { impressions: 37, clicks: 0, positionX100: 2390 },
    "tire shop cleveland": { impressions: 110, clicks: 0, positionX100: 890 },
    "auto repair euclid": { impressions: 7, clicks: 0, positionX100: 900 },
    "tires euclid ave": { impressions: 12, clicks: 0, positionX100: 400 },
    "auto repair near me": { impressions: 179, clicks: 3, positionX100: 1120 },
  };
  h.previous = {
    "used tires cleveland": { impressions: 90, clicks: 1, positionX100: 910 },
    "oil change cleveland": { impressions: 40, clicks: 0, positionX100: 2050 },
    "tire shop cleveland": { impressions: 60, clicks: 0, positionX100: 550 },
    "auto repair euclid": { impressions: 12, clicks: 0, positionX100: 400 },
    "emissions repair cleveland": { impressions: 4, clicks: 0, positionX100: 1500 },
    "auto repair near me": { impressions: 150, clicks: 2, positionX100: 1100 },
  };
  h.seen = [...Object.keys(h.current), "emissions repair cleveland"];
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.GOOGLE_SEARCH_CONSOLE_KEY;
  else process.env.GOOGLE_SEARCH_CONSOLE_KEY = savedKey;
});

async function okResult() {
  const r = await getTargetKeywordRanks(NOW);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}: ${r.message}`);
  return r;
}
const row = (r: Awaited<ReturnType<typeof okResult>>, kw: string) => {
  const found = r.keywords.find((k) => k.keyword.toLowerCase() === kw);
  if (!found) throw new Error(`no row for ${kw}`);
  return found;
};

describe("the tracked keyword list", () => {
  it("holds the 15 curated keywords plus the 8 service queries the shop is already shown for, no duplicates after lowercasing", () => {
    const lower = RANK_KEYWORDS.map((k) => k.keyword.toLowerCase());
    expect(lower).toHaveLength(23);
    expect(new Set(lower).size).toBe(lower.length);
    for (const q of ["tires cleveland", "used tires near me", "tire shops near me", "tire shop near me", "tire shops cleveland"]) {
      expect(RANK_KEYWORDS.find((k) => k.keyword === q)?.group).toBe("tires");
    }
    for (const q of ["brakes near me", "brake repair near me", "brake shop near me"]) {
      expect(RANK_KEYWORDS.find((k) => k.keyword === q)?.group).toBe("brakes");
    }
  });
});

describe("getTargetKeywordRanks · windows and units", () => {
  it("reports both 28-day windows ending at the newest stored date, and how stale that date is", async () => {
    const r = await okResult();
    expect(r.latestDate).toBe("2026-10-23");
    expect(r.staleDays).toBe(2);
    expect(r.window).toEqual({ current: { from: "2026-09-26", to: "2026-10-23" }, previous: { from: "2026-08-29", to: "2026-09-25" } });
    expect(r.totals).toEqual({ impressions28d: 57361, distinctQueries28d: 5897 });
    expect(r.keywords).toHaveLength(RANK_KEYWORDS.length);
  });

  it("sends the window bounds as date strings, web rows only, every keyword lowercased once", async () => {
    await okResult();
    const windows = h.sent.filter((s) => /sum\(/i.test(s.sql) && !/count\(distinct/i.test(s.sql));
    expect(windows).toHaveLength(2);
    const cur = windows.find((s) => s.params.includes("2026-09-26"));
    const prev = windows.find((s) => s.params.includes("2026-08-29"));
    expect(cur?.params).toEqual(expect.arrayContaining(["web", "2026-09-26", "2026-10-23"]));
    expect(prev?.params).toEqual(expect.arrayContaining(["web", "2026-08-29", "2026-09-25"]));
    const totals = h.sent.find((s) => /count\(distinct/i.test(s.sql));
    expect(totals?.params).toEqual(expect.arrayContaining(["web", "2026-09-26", "2026-10-23"]));
    const presence = h.sent.find((s) => !/sum\(|max\(|count\(/i.test(s.sql));
    expect(presence?.params).toEqual(expect.arrayContaining(["web", "2026-07-26", "2026-10-23"]));
    expect(cur?.params).toEqual(expect.arrayContaining(["ohio e-check repair", "tires euclid ave"]));
    expect(cur?.params).not.toContain("Ohio E-Check repair");
  });

  it("groups on what it selects (ONLY_FULL_GROUP_BY), weighting position by impressions", async () => {
    await okResult();
    const grouped = h.sent.filter((s) => /group by/i.test(s.sql));
    expect(grouped).toHaveLength(3); // current, previous, 90-day presence
    for (const s of grouped) {
      expect(s.sql).toMatch(/^select lower\(`query`\)/i);
      expect(s.sql).toMatch(/group by 1$/i);
    }
    const w = grouped.find((s) => /sum\(/i.test(s.sql))!.sql;
    expect(w).toMatch(/sum\(`position` \* `impressions`\) \/ nullif\(sum\(`impressions`\), 0\)/i);
  });

  it("divides the stored x100 position once, to one decimal", async () => {
    const r = await okResult();
    expect(row(r, "used tires cleveland").current).toEqual({ impressions: 135, clicks: 0, position: 6.5 });
    expect(row(r, "used tires cleveland").previous).toEqual({ impressions: 90, clicks: 1, position: 9.1 });
    expect(row(r, "used tires cleveland").change).toBe(2.6);
  });
});

describe("getTargetKeywordRanks · one action per keyword, first rule that matches", () => {
  it("improved but zero clicks on page one with real volume: review_snippet", async () => {
    expect(row(await okResult(), "used tires cleveland").action).toBe("review_snippet");
  });

  it("dropped 2+ positions with 30+ impressions in both windows: compare_top_results", async () => {
    const r = await okResult();
    expect(row(r, "oil change cleveland").change).toBe(-3.4);
    expect(row(r, "oil change cleveland").action).toBe("compare_top_results");
  });

  it("a drop beats the snippet rule even on page one with zero clicks", async () => {
    const r = await okResult();
    expect(row(r, "tire shop cleveland").change).toBe(-3.4);
    expect(row(r, "tire shop cleveland").action).toBe("compare_top_results");
  });

  it("under 30 impressions in either window: no change is claimed", async () => {
    const r = await okResult();
    expect(row(r, "auto repair euclid").change).toBeNull();
    expect(row(r, "auto repair euclid").action).toBe("monitor");
  });

  it("nothing recorded in 90 days: verify_local, with no position at all (never 0, never 100)", async () => {
    const r = await okResult();
    const k = row(r, "ohio e-check repair");
    expect(k).toMatchObject({ current: null, previous: null, seenIn90Days: false, change: null, action: "verify_local" });
  });

  it("nothing this window but seen earlier: review_variants", async () => {
    const r = await okResult();
    expect(row(r, "emissions repair cleveland")).toMatchObject({ current: null, seenIn90Days: true, action: "review_variants" });
    expect(row(r, "emissions repair cleveland").previous).toEqual({ impressions: 4, clicks: 0, position: 15 });
  });

  it("recorded this window only: new", async () => {
    const r = await okResult();
    expect(row(r, "tires euclid ave")).toMatchObject({ previous: null, action: "new" });
    expect(row(r, "tires euclid ave").current).toEqual({ impressions: 12, clicks: 0, position: 4 });
  });

  it("clicks on page one and steady: monitor", async () => {
    expect(row(await okResult(), "auto repair near me").action).toBe("monitor");
  });

  it("no row anywhere carries a position the table did not record", async () => {
    const r = await okResult();
    const recorded = new Set([...Object.keys(h.current), ...Object.keys(h.previous)]);
    for (const k of r.keywords) {
      const kw = k.keyword.toLowerCase();
      if (!(kw in h.current)) expect(k.current, kw).toBeNull();
      if (!(kw in h.previous)) expect(k.previous, kw).toBeNull();
      if (!recorded.has(kw)) expect(k.change, kw).toBeNull();
      for (const w of [k.current, k.previous]) if (w) expect(w.position, kw).toBeGreaterThanOrEqual(1);
    }
  });

  it("data older than 7 days: every keyword says check_sync", async () => {
    h.latest = "2026-10-15";
    const r = await okResult();
    expect(r.staleDays).toBe(10);
    expect(new Set(r.keywords.map((k) => k.action))).toEqual(new Set(["check_sync"]));
  });

  it("exactly 7 days old is not yet stale (control for the limit)", async () => {
    h.latest = "2026-10-18";
    const r = await okResult();
    expect(r.staleDays).toBe(7);
    expect(r.keywords.some((k) => k.action !== "check_sync")).toBe(true);
  });
});

describe("getTargetKeywordRanks · honest empty and failed states", () => {
  it("no web rows with Search Console configured: unmeasured, not an empty list", async () => {
    h.latest = null;
    const r = await getTargetKeywordRanks(NOW);
    expect(r).toMatchObject({ ok: false, reason: "unmeasured" });
  });

  it("no web rows and no Search Console credentials: unconfigured", async () => {
    h.latest = null;
    delete process.env.GOOGLE_SEARCH_CONSOLE_KEY;
    expect(await getTargetKeywordRanks(NOW)).toMatchObject({ ok: false, reason: "unconfigured" });
  });

  it("rows present and credentials absent still reports the rows (credentials gate only the empty case)", async () => {
    delete process.env.GOOGLE_SEARCH_CONSOLE_KEY;
    expect((await getTargetKeywordRanks(NOW)).ok).toBe(true);
  });

  it("a thrown read: error with the message, never zeros", async () => {
    h.fail = Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });
    const r = await getTargetKeywordRanks(NOW);
    expect(r).toEqual({ ok: false, reason: "error", message: expect.stringContaining("ETIMEDOUT") });
    // drizzle wraps the driver error; its own message is the SQL and params, never shown.
    if (!r.ok) expect(r.message).not.toMatch(/Failed query|select /i);
  });

  it("no database handle: error, not unmeasured", async () => {
    h.noDb = true;
    expect(await getTargetKeywordRanks(NOW)).toMatchObject({ ok: false, reason: "error" });
  });
});
