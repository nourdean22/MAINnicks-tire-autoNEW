import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  algDateDigits,
  BackfillError,
  CLASSES,
  TABLES,
  UsageError,
  assertReadOnlySql,
  backupIdsSql,
  backupTableName,
  backupValuesSql,
  buildPlan,
  canonicalJson,
  casUpdateSql,
  classifyRow,
  columnsSql,
  createBackupSql,
  currentValueSql,
  dayChanges,
  digitsToMs,
  diffBucket,
  insertBackupSql,
  isOtherAnomaly,
  msToDigits,
  parseClassifyConfig,
  parsePlan,
  scanSql,
  summarizeTable,
  TABLE_EXISTS_SQL,
  TZ_CHECK_SQL,
  TZ_PIN_SQL,
  TZ_REPORT_SQL,
  updatedAtMovedSql,
  type ClassifiedRow,
  type ClassifyConfig,
  type PlanRow,
  type RowClass,
  type ScanRow,
} from "../../scripts/backfills/shopClockBackfill";
import { shopWallClock } from "../lib/timezoneAssert";

// 03:05Z on Oct 15 is 23:05 EDT on Oct 14, the merge of the writer fix.
const RAW = { cutoff: "2026-10-15T03:05:00Z", snapBugStart: "2026-10-15T03:05:00Z", snapFixCutoff: "2026-10-15T16:00:00Z", tolMinutes: "15" };
const { cfg } = parseClassifyConfig(RAW);
// A cutoff after every DST case below, so those rows are "before the fix".
const late = parseClassifyConfig({ ...RAW, cutoff: "2027-06-01T00:00:00Z", snapBugStart: "2027-06-01T00:00:00Z", snapFixCutoff: "2027-06-02T00:00:00Z" }).cfg;

let nextId = 1;
const row = (created: string, stored: string, source = "manual", isSnap = false): ScanRow => ({ id: nextId++, created, stored, source, isSnap });
const run = (r: ScanRow, c: ClassifyConfig = cfg, table = "invoices") => classifyRow(table, r, c);

describe("digit parsing", () => {
  it("round-trips real timestamps", () => {
    expect(msToDigits(digitsToMs("2026-10-13 00:05:30"))).toBe("2026-10-13 00:05:30");
  });

  it.each([
    ["a Date object the driver should not have produced", new Date("2026-10-13T00:05:30Z")],
    ["the zero date", "0000-00-00 00:00:00"],
    ["a day that does not exist", "2026-02-30 10:00:00"],
    ["an ISO string", "2026-10-13T00:05:30Z"],
    ["a null", null],
  ])("refuses %s instead of guessing", (_why, value) => {
    expect(() => digitsToMs(value)).toThrow(BackfillError);
  });
});

describe("classification arguments", () => {
  it("normalises instants and defaults the source lists", () => {
    const { args } = parseClassifyConfig({ ...RAW, cutoff: "2026-10-14T23:05:00-04:00" });
    expect(args).toMatchObject({ cutoff: "2026-10-15T03:05:00.000Z", tolMinutes: 15, sources: ["manual", "stripe"], estimateSources: [] });
  });

  it.each([
    ["cutoff"],
    ["snapBugStart"],
    ["snapFixCutoff"],
    ["tolMinutes"],
  ])("requires %s with no default", (key) => {
    expect(() => parseClassifyConfig({ ...RAW, [key]: undefined })).toThrow(UsageError);
  });

  it.each([
    ["a date with no time", { cutoff: "2026-10-15" }],
    ["an instant with no zone", { cutoff: "2026-10-15T03:05:00" }],
    ["a day that does not exist", { cutoff: "2026-02-30T00:00:00Z" }],
    ["a zero tolerance", { tolMinutes: "0" }],
    ["a tolerance over an hour", { tolMinutes: "61" }],
    ["a non-numeric tolerance", { tolMinutes: "abc" }],
    ["snap window that ends before it starts", { snapFixCutoff: "2026-10-15T03:05:00Z" }],
    ["a feed-owned invoice source", { sources: "manual,shopdriver" }],
    ["a feed-owned estimate source", { estimateSources: "alg" }],
    ["a feed-owned invoice source in capitals", { sources: "manual,ShopDriver" }],
    ["a feed-owned estimate source in capitals", { estimateSources: "ALG" }],
    ["a feed-owned estimate source with mixed case", { estimateSources: "Wave-97-Recovery" }],
    ["an instant at hour 24", { cutoff: "2026-10-15T24:00:00Z" }],
    ["an instant at minute 60", { cutoff: "2026-10-15T23:60:00Z" }],
    ["an instant at second 60", { snapBugStart: "2026-10-15T23:59:60Z" }],
    ["an offset of 24 hours", { snapFixCutoff: "2026-10-15T20:00:00+24:00" }],
    ["an offset of 60 minutes", { cutoff: "2026-10-15T20:00:00-05:60" }],
    ["month 13", { cutoff: "2026-13-01T00:00:00Z" }],
    ["month 0", { cutoff: "2026-00-10T00:00:00Z" }],
    ["a leap day in a common year", { cutoff: "2026-02-29T00:00:00Z" }],
    ["April 31", { cutoff: "2026-04-31T00:00:00Z" }],
    ["a source name with punctuation", { sources: "manual;drop" }],
  ])("rejects %s", (_why, patch) => {
    expect(() => parseClassifyConfig({ ...RAW, ...patch })).toThrow(UsageError);
  });

  it.each([
    ["a leap day", "2028-02-29T00:00:00Z"],
    ["the last second of a day", "2026-10-15T23:59:59Z"],
    ["milliseconds", "2026-10-15T23:59:59.999Z"],
    ["no seconds", "2026-10-15T03:05Z"],
    ["a positive offset", "2026-10-15T08:00:00+05:00"],
    ["the widest real offset", "2026-10-15T17:00:00+14:00"],
  ])("accepts %s", (_why, cutoff) => {
    expect(() => parseClassifyConfig({ ...RAW, cutoff })).not.toThrow();
  });
});

describe("classifyRow: UTC-digit rows get the Cleveland wall clock, DST included", () => {
  // stored = createdAt (what an old `new Date()` writer left), expected = what shopWallClock must give.
  it.each([
    ["evening row crosses to the previous day", "2026-10-13 00:05:30", "2026-10-12 20:05:30"],
    ["midday EDT keeps the day", "2026-10-12 14:10:11", "2026-10-12 10:10:11"],
    ["winter EST offset is 5h", "2026-01-15 02:30:11", "2026-01-14 21:30:11"],
    ["just after UTC midnight", "2026-10-13 00:00:07", "2026-10-12 20:00:07"],
    ["just before UTC midnight", "2026-10-12 23:59:58", "2026-10-12 19:59:58"],
    ["leap day evening", "2024-02-29 03:00:09", "2024-02-28 22:00:09"],
    ["day after a leap day", "2024-03-01 04:30:09", "2024-02-29 23:30:09"],
    ["2025-03-09 last second of EST", "2025-03-09 06:59:59", "2025-03-09 01:59:59"],
    ["2025-03-09 first second of EDT", "2025-03-09 07:00:01", "2025-03-09 03:00:01"],
    ["2025-11-02 EDT side of the repeated hour", "2025-11-02 05:30:05", "2025-11-02 01:30:05"],
    ["2025-11-02 EST side of the repeated hour", "2025-11-02 06:30:05", "2025-11-02 01:30:05"],
    ["2026-03-08 last second of EST", "2026-03-08 06:59:59", "2026-03-08 01:59:59"],
    ["2026-03-08 first second of EDT", "2026-03-08 07:00:01", "2026-03-08 03:00:01"],
    ["2026-11-01 last EDT second before the change", "2026-11-01 05:59:59", "2026-11-01 01:59:59"],
    ["2026-11-01 first EST second", "2026-11-01 06:00:01", "2026-11-01 01:00:01"],
  ])("%s", (_why, created, to) => {
    expect(run(row(created, created), late)).toEqual({ class: "needs_correction", to });
  });

  it("matches within the tolerance, inclusive at exactly 15 minutes", () => {
    expect(run(row("2026-10-10 14:00:11", "2026-10-10 13:45:11")).class).toBe("needs_correction");
    expect(run(row("2026-10-10 14:00:11", "2026-10-10 14:15:11")).class).toBe("needs_correction");
    expect(run(row("2026-10-10 14:00:11", "2026-10-10 13:45:10")).class).toBe("other");
    expect(run(row("2026-10-10 14:00:11", "2026-10-10 14:15:12")).class).toBe("other");
  });

  it("calls a row already correct when it matches the wall clock, inclusive at 15 minutes", () => {
    expect(run(row("2026-10-10 14:00:11", "2026-10-10 10:00:11"))).toEqual({ class: "already_correct" });
    expect(run(row("2026-10-10 14:00:11", "2026-10-10 10:15:11")).class).toBe("already_correct");
    expect(run(row("2026-10-10 14:00:11", "2026-10-10 10:15:12")).class).toBe("other");
  });

  it("plans an app-written row whatever its seconds, whole minutes and midnight included", () => {
    expect(run(row("2026-10-12 23:41:00", "2026-10-12 23:41:00"))).toEqual({ class: "needs_correction", to: "2026-10-12 19:41:00" });
    expect(run(row("2026-10-13 00:00:00", "2026-10-13 00:00:00"))).toEqual({ class: "needs_correction", to: "2026-10-12 20:00:00" });
    expect(run(row("2026-10-12 14:10:30", "2026-10-12 14:10:00"))).toEqual({ class: "needs_correction", to: "2026-10-12 10:10:00" });
  });

  it("gives a feed row with whole-minute digits no target", () => {
    expect(run(row("2026-10-12 23:41:00", "2026-10-12 23:41:00", "shopdriver"))).toEqual({ class: "feed_owned_utc" });
    expect(run(row("2026-10-13 00:00:00", "2026-10-13 00:00:00", "shopdriver"))).toEqual({ class: "feed_owned_utc" });
  });

  it("treats createdAt exactly at the cutoff as after it", () => {
    expect(run(row("2026-10-15 03:05:00", "2026-10-15 03:05:00")).class).toBe("post_cutoff_utc_match");
    expect(run(row("2026-10-15 03:04:59", "2026-10-15 03:04:59")).class).toBe("needs_correction");
  });

  it("leaves a row on the wall clock after the cutoff alone", () => {
    expect(run(row("2026-10-15 15:00:10", "2026-10-15 11:00:10"))).toEqual({ class: "already_correct" });
  });

  it("leaves unrelated offsets alone", () => {
    expect(run(row("2026-10-12 14:10:11", "2026-10-12 00:00:00")).class).toBe("other");
    expect(run(row("2026-10-12 14:10:11", "2026-10-13 14:10:11")).class).toBe("other");
  });
});

describe("classifyRow: the target converts the stored digits, createdAt only proves the signature", () => {
  it.each([
    ["stored just before createdAt, across UTC midnight (the reviewer's example)", "2026-10-14 04:05:30", "2026-10-14 03:55:30", "2026-10-13 23:55:30"],
    ["stored just after createdAt, across UTC midnight", "2026-10-14 03:58:10", "2026-10-14 04:08:10", "2026-10-14 00:08:10"],
    ["2026-11-01 fall-back: stored in EDT, createdAt in EST", "2026-11-01 06:05:10", "2026-11-01 05:55:10", "2026-11-01 01:55:10"],
    ["2026-11-01 fall-back: stored in EST, createdAt in EDT", "2026-11-01 05:55:10", "2026-11-01 06:05:10", "2026-11-01 01:05:10"],
    ["2026-03-08 spring-forward: stored in EST, createdAt in EDT", "2026-03-08 07:05:10", "2026-03-08 06:55:10", "2026-03-08 01:55:10"],
    ["2026-03-08 spring-forward: stored in EDT, createdAt in EST", "2026-03-08 06:55:10", "2026-03-08 07:05:10", "2026-03-08 03:05:10"],
    ["2025-11-02 fall-back: stored in EDT, createdAt in EST", "2025-11-02 06:05:10", "2025-11-02 05:55:10", "2025-11-02 01:55:10"],
    ["2025-03-09 spring-forward: stored in EST, createdAt in EDT", "2025-03-09 07:05:10", "2025-03-09 06:55:10", "2025-03-09 01:55:10"],
  ])("%s", (_why, created, stored, to) => {
    expect(run(row(created, stored), late)).toEqual({ class: "needs_correction", to });
  });

  it("moves the reviewer's example to the PRIOR shop day, which a createdAt target would not", () => {
    const planned = run(row("2026-10-14 04:05:30", "2026-10-14 03:55:30"));
    expect(planned).toEqual({ class: "needs_correction", to: "2026-10-13 23:55:30" });
    expect(dayChanges([{ table: "invoices", id: 1, from: "2026-10-14 03:55:30", to: planned.to!, class: "needs_correction" }])).toEqual({ dayChange: 1, timeOnly: 0 });
  });
});

describe("classifyRow: Snap rows converted twice", () => {
  // created 05:10:20Z = 01:10:20 EDT; read as a UTC instant again that is 21:10:20 EDT the day before.
  const doubled = "2026-10-14 21:10:20";

  it("targets one conversion of createdAt, not zero and not two", () => {
    expect(run(row("2026-10-15 05:10:20", doubled, "manual", true))).toEqual({ class: "snap_double_converted", to: "2026-10-15 01:10:20" });
  });

  it("stays anchored on createdAt: the stored value was converted twice, so it is not a clean source", () => {
    // 10 minutes off the double-converted reading still matches; the target ignores stored.
    expect(run(row("2026-10-15 05:10:20", "2026-10-14 21:20:20", "manual", true))).toEqual({ class: "snap_double_converted", to: "2026-10-15 01:10:20" });
  });

  it("needs the SNAP- marker", () => {
    expect(run(row("2026-10-15 05:10:20", doubled, "manual", false)).class).toBe("other");
  });

  it("includes the window start and excludes its end", () => {
    expect(run(row("2026-10-15 03:05:00", "2026-10-14 19:05:00", "manual", true)).class).toBe("snap_double_converted");
    expect(run(row("2026-10-15 03:04:59", "2026-10-14 19:04:59", "manual", true)).class).toBe("other");
    expect(run(row("2026-10-15 16:00:00", "2026-10-15 08:00:00", "manual", true)).class).toBe("other");
  });
});

describe("classifyRow: only app-written rows are ever correctable", () => {
  const signature = ["2026-09-10 23:41:07", "2026-09-10 23:41:07"] as const;

  it("a manual row with a UTC signature is planned; a shopdriver row with the same signature is not", () => {
    expect(run(row(...signature, "manual")).class).toBe("needs_correction");
    expect(run(row(...signature, "shopdriver"))).toEqual({ class: "feed_owned_utc" });
  });

  it("a feed row is never counted as a post-cutoff anomaly", () => {
    expect(run(row("2026-10-15 15:00:10", "2026-10-15 15:00:10", "shopdriver")).class).toBe("feed_owned_utc");
    expect(run(row("2026-10-15 15:00:10", "2026-10-15 15:00:10", "manual")).class).toBe("post_cutoff_utc_match");
  });

  it("a feed row with whole-minute digits or a Snap lookalike is also feed_owned_utc", () => {
    expect(run(row("2026-10-13 00:00:00", "2026-10-13 00:00:00", "shopdriver")).class).toBe("feed_owned_utc");
    expect(run(row("2026-10-15 05:10:20", "2026-10-14 21:10:20", "shopdriver", true)).class).toBe("feed_owned_utc");
  });

  it("keeps a feed row that already reads the wall clock as already_correct", () => {
    expect(run(row("2026-10-10 14:00:11", "2026-10-10 10:00:11", "shopdriver")).class).toBe("already_correct");
  });

  it("owns no estimate source unless one is passed", () => {
    expect(run(row(...signature, "alg"), cfg, "alg_estimates").class).toBe("feed_owned_utc");
    expect(run(row(...signature, "manual"), cfg, "alg_estimates").class).toBe("feed_owned_utc");
    const withManual = parseClassifyConfig({ ...RAW, estimateSources: "manual" }).cfg;
    expect(run(row(...signature, "manual"), withManual, "alg_estimates").class).toBe("needs_correction");
    expect(run(row(...signature, "alg"), withManual, "alg_estimates").class).toBe("feed_owned_utc");
  });

  it("honours a narrower --sources list", () => {
    const stripeOnly = parseClassifyConfig({ ...RAW, sources: "stripe" }).cfg;
    expect(run(row(...signature, "manual"), stripeOnly).class).toBe("feed_owned_utc");
    expect(run(row(...signature, "stripe"), stripeOnly).class).toBe("needs_correction");
  });
});

describe("classifyRow: classes cannot overlap", () => {
  it("never throws across two years of instants and the stored values that can collide", () => {
    const hour = 3_600_000;
    const instants: number[] = [];
    for (let t = Date.UTC(2025, 0, 1); t < Date.UTC(2027, 0, 1); t += 3001 * 60_000) instants.push(t);
    // Every 2025-2026 clock change, probed every 15 minutes from 2h before to 2h after.
    for (const change of [Date.UTC(2025, 2, 9, 7), Date.UTC(2025, 10, 2, 6), Date.UTC(2026, 2, 8, 7), Date.UTC(2026, 10, 1, 6)]) {
      for (let t = change - 2 * hour; t <= change + 2 * hour; t += 15 * 60_000) instants.push(t);
    }
    const seen = new Set<string>();
    for (const instant of instants) {
      // Off the whole minute, for variety.
      const t = instant + 7_000;
      const created = msToDigits(t);
      const wall = shopWallClock(new Date(t)).getTime();
      const stored = [created, msToDigits(wall), msToDigits(shopWallClock(new Date(wall)).getTime()), msToDigits(t - 15 * 60_000)];
      for (const c of [cfg, late]) {
        for (const s of stored) seen.add(classifyRow("invoices", { id: 1, created, stored: s, source: "manual", isSnap: true }, c).class);
      }
    }
    expect(instants.length).toBeGreaterThan(400);
    expect([...seen].sort()).toEqual(expect.arrayContaining(["already_correct", "needs_correction", "other"]));
  });

  it("fails loudly if a wide tolerance ever lets two classes match", () => {
    const wide = { ...cfg, tolMs: 4.5 * 3_600_000 };
    expect(() => classifyRow("invoices", row("2026-10-12 12:00:00", "2026-10-12 10:00:30"), wide)).toThrow(/must not overlap/);
  });
});

describe("algDateDigits: ALG date text keeps its own digits whatever the machine zone", () => {
  it.each([
    ["a zone-less timestamp", "2025-03-14T15:20:00", "2025-03-14 15:20:00"],
    ["fractional seconds", "2025-03-14T15:20:00.123", "2025-03-14 15:20:00"],
    ["a date alone", "2025-03-14", "2025-03-14 00:00:00"],
    ["a Z timestamp (the shopWallClock fallback shape)", "2026-10-15T21:00:00.000Z", "2026-10-15 21:00:00"],
    ["an explicit offset", "2025-03-14T15:20:00-04:00", "2025-03-14 19:20:00"],
  ])("%s", (_why, raw, digits) => {
    expect(algDateDigits(raw)).toBe(digits);
  });

  it.each(["not a date", "", "2025-13-45T00:00:00"])("returns null for %j", (raw) => {
    expect(algDateDigits(raw)).toBeNull();
  });

  it("gives the same digits when the process runs in Eastern time", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      expect(algDateDigits("2025-03-14T15:20:00")).toBe("2025-03-14 15:20:00");
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe("isOtherAnomaly: the leftovers verify refuses to call clean", () => {
  const classified = (r: ScanRow, c: ClassifyConfig = cfg, table = "invoices"): ClassifiedRow => ({ ...r, ...classifyRow(table, r, c) });
  const anomaly = (r: ScanRow, c: ClassifyConfig = cfg, table = "invoices") => isOtherAnomaly(table, classified(r, c, table), c);

  it("flags an app-written row 8 or 10 hours behind createdAt that no class explains", () => {
    expect(anomaly(row("2026-10-14 15:00:10", "2026-10-14 07:00:10"))).toBe(true);
    expect(anomaly(row("2026-10-14 15:00:10", "2026-10-14 05:00:10"))).toBe(true);
  });

  it("leaves other offsets, feed rows, explained rows and unowned estimates alone", () => {
    expect(anomaly(row("2026-10-14 15:00:10", "2026-10-14 12:00:10"))).toBe(false);
    expect(anomaly(row("2026-10-14 15:00:10", "2026-10-14 07:00:10", "shopdriver"))).toBe(false);
    expect(anomaly(row("2026-10-14 15:00:10", "2026-10-14 11:00:10"))).toBe(false);
    expect(anomaly(row("2026-10-14 15:00:10", "2026-10-14 15:00:10"))).toBe(false);
    expect(anomaly(row("2026-10-14 15:00:10", "2026-10-14 07:00:10", "manual"), cfg, "alg_estimates")).toBe(false);
  });

  it("flags an owned estimate source too", () => {
    const withManual = parseClassifyConfig({ ...RAW, estimateSources: "manual" }).cfg;
    expect(anomaly(row("2026-10-14 15:00:10", "2026-10-14 07:00:10", "manual"), withManual, "alg_estimates")).toBe(true);
  });
});

describe("probe summary", () => {
  it("buckets stored - createdAt by whole-hour offsets", () => {
    const b = (stored: string) => diffBucket(stored, "2026-10-12 14:00:11", cfg.tolMs);
    expect(b("2026-10-12 14:00:11")).toBe("utc_match");
    expect(b("2026-10-12 10:00:11")).toBe("minus_4h");
    expect(b("2026-10-12 09:00:11")).toBe("minus_5h");
    expect(b("2026-10-12 06:00:11")).toBe("minus_8h");
    expect(b("2026-10-12 04:00:11")).toBe("minus_10h");
    expect(b("2026-10-12 12:00:11")).toBe("other");
  });

  it("counts classes, months, sources and the post-cutoff anchor", () => {
    const rows = [
      row("2026-09-10 23:41:07", "2026-09-10 23:41:07"),
      row("2026-09-11 23:41:07", "2026-09-11 23:41:07", "shopdriver"),
      row("2026-10-15 15:00:10", "2026-10-15 11:00:10"),
      row("2026-10-16 15:00:10", "2026-10-16 15:00:10"),
    ].map((r) => ({ ...r, ...run(r) }));
    const s = summarizeTable(rows, cfg);
    expect(s.scanned).toBe(4);
    expect(s.classes.needs_correction.count).toBe(1);
    expect(s.classes.feed_owned_utc.count).toBe(1);
    expect(s.feedBySource).toEqual({ shopdriver: 1 });
    expect(s.postCutoff).toEqual({ rows: 2, alreadyCorrect: 1 });
    expect(s.months["2026-09"].rows).toBe(2);
    expect(s.classes.needs_correction.sample.map((x) => x.id)).toEqual([rows[0].id]);
  });
});

describe("plan file", () => {
  const args = parseClassifyConfig(RAW).args;
  const planRows: PlanRow[] = [
    { table: "alg_estimates", id: 4, from: "2026-09-10 23:41:07", to: "2026-09-10 19:41:07", class: "needs_correction" },
    { table: "invoices", id: 9, from: "2026-10-13 00:05:30", to: "2026-10-12 20:05:30", class: "needs_correction" },
    { table: "invoices", id: 2, from: "2026-09-10 23:41:07", to: "2026-09-10 19:41:07", class: "snap_double_converted" },
  ];
  const make = (rows: PlanRow[]) => buildPlan({ args, host: "db.example", database: "shop", scannedRows: 42, rows });

  it("orders rows by table then id whatever the input order, and is deterministic", () => {
    const a = make(planRows);
    const b = make([...planRows].reverse());
    expect(a.rows.map((r) => `${r.table}#${r.id}`)).toEqual(["invoices#2", "invoices#9", "alg_estimates#4"]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toMatchObject({ tool: "shop-clock-backfill", host: "db.example", generatedFromRowCount: 42 });
  });

  it("survives a trip through pretty-printed text", () => {
    const text = `${JSON.stringify(make(planRows), null, 2)}\n`;
    expect(parsePlan(text).rows).toHaveLength(3);
  });

  it("rejects an edited row, an edited argument or a swapped hash", () => {
    const plan = make(planRows);
    const edit = (f: (p: ReturnType<typeof make>) => void) => {
      const copy = JSON.parse(JSON.stringify(plan));
      f(copy);
      return JSON.stringify(copy);
    };
    expect(() => parsePlan(edit((p) => (p.rows[0].to = "2026-10-12 20:05:31")))).toThrow(/hash/);
    expect(() => parsePlan(edit((p) => (p.args.tolMinutes = 60)))).toThrow(/hash/);
    expect(() => parsePlan(edit((p) => (p.sha256 = "0".repeat(64))))).toThrow(/hash/);
    expect(() => parsePlan("{not json")).toThrow(BackfillError);
    expect(() => parsePlan("{}")).toThrow(/not a shop-clock-backfill plan/);
  });

  it("refuses rows the tool never applies, even when the hash is right", () => {
    const sign = (rows: unknown[]) => {
      const body = { tool: "shop-clock-backfill", toolVersion: "1", args, host: "h", database: "d", generatedFromRowCount: 1, rows };
      return JSON.stringify({ ...body, sha256: createHash("sha256").update(canonicalJson(body)).digest("hex") });
    };
    const good = planRows[1];
    expect(parsePlan(sign([good])).rows).toHaveLength(1);
    expect(() => parsePlan(sign([{ ...good, class: "other" }]))).toThrow(/never applied/);
    expect(() => parsePlan(sign([{ ...good, to: good.from }]))).toThrow(/from equals to/);
    expect(() => parsePlan(sign([{ ...good, table: "customers" }]))).toThrow(/unknown table/);
    expect(() => parsePlan(sign([{ ...good, id: "1; DROP TABLE x" }]))).toThrow(/bad id/);
    expect(() => parsePlan(sign([{ ...good, from: "yesterday" }]))).toThrow(BackfillError);
  });

  it("counts planned rows that change the shop date versus only the time of day", () => {
    expect(dayChanges(make(planRows).rows)).toEqual({ dayChange: 1, timeOnly: 2 });
    expect(dayChanges([])).toEqual({ dayChange: 0, timeOnly: 0 });
  });
});

describe("read-only SQL guard", () => {
  const spec = TABLES[0];
  const readStatements = [
    TZ_REPORT_SQL,
    TZ_CHECK_SQL,
    TZ_PIN_SQL,
    "set   TIME_ZONE='+00:00'",
    scanSql(TABLES[0]),
    scanSql(TABLES[1]),
    columnsSql(spec).sql,
    TABLE_EXISTS_SQL,
    backupIdsSql(spec, "20261015"),
    backupValuesSql(spec, "20261015"),
    currentValueSql(spec),
    "SHOW TABLES",
  ];
  const writeStatements = [
    createBackupSql(spec, "20261015"),
    insertBackupSql(spec, "20261015", [1, 2]),
    casUpdateSql(spec, true),
    casUpdateSql(spec, false),
    "START TRANSACTION",
    "COMMIT",
    "ROLLBACK",
  ];

  it.each(readStatements)("allows %s", (sql) => {
    expect(() => assertReadOnlySql(sql)).not.toThrow();
  });

  it.each([
    ...writeStatements,
    "UPDATE invoices SET invoiceDate = NULL",
    "update invoices set invoiceDate = null",
    "INSERT INTO invoices SELECT * FROM invoices",
    "INSERT INTO t SELECT 1",
    "DELETE FROM invoices",
    "CREATE TABLE x (id INT)",
    "DROP TABLE invoices",
    "TRUNCATE TABLE invoices",
    "ALTER TABLE invoices ADD COLUMN x INT",
    "REPLACE INTO invoices VALUES (1)",
    "WITH doomed AS (SELECT 1) DELETE FROM invoices",
    "SELECT 1; DELETE FROM invoices",
    "SELECT 1;\nDELETE FROM invoices",
    "SELECT 1 ;",
    // One layer each: no write keyword in these, so only the separator, comment or allowlist rule can stop them.
    "SELECT 1; SELECT 2",
    "SELECT 1 /* note */",
    "SELECT 1 -- note",
    "SELECT 1 # note",
    "DESCRIBE invoices",
    "EXPLAIN SELECT 1",
    "WITH t AS (SELECT 1) SELECT * FROM t",
    "/* harmless */ UPDATE invoices SET invoiceDate = NULL",
    "/*!50000 UPDATE invoices SET invoiceDate = NULL */",
    "SELECT 1 -- UPDATE invoices",
    "SELECT 1 # UPDATE invoices",
    "SELECT * FROM invoices FOR UPDATE",
    "SELECT * FROM invoices LOCK IN SHARE MODE",
    "SELECT * FROM invoices FOR SHARE",
    "SELECT id INTO OUTFILE '/tmp/x' FROM invoices",
    "SET time_zone = '-04:00'",
    "SET time_zone = '+00:00'; DELETE FROM invoices",
    "SET SESSION TRANSACTION READ ONLY",
    "SET @@global.time_zone = '+00:00'",
    "CALL purge()",
    "   ",
    "",
  ])("refuses %j", (sql) => {
    expect(() => assertReadOnlySql(sql)).toThrow(/read-only guard/);
  });
});

describe("backup naming and SQL builders", () => {
  it("names the backup table from the table and stamp, and rejects a bad stamp", () => {
    expect(backupTableName("alg_estimates", "20261015")).toBe("_bak_alg_estimates_shopclock_20261015");
    expect(() => backupTableName("invoices", "2026-10-15")).toThrow(UsageError);
    expect(() => backupTableName("customers", "20261015")).toThrow(/unknown table/);
  });

  it("uses LIKE plus INSERT ... SELECT because TiDB rejects CREATE TABLE ... AS SELECT", () => {
    expect(createBackupSql(TABLES[0], "20261015")).toBe("CREATE TABLE `_bak_invoices_shopclock_20261015` LIKE `invoices`");
    expect(insertBackupSql(TABLES[0], "20261015", [3, 4])).toBe("INSERT INTO `_bak_invoices_shopclock_20261015` SELECT * FROM `invoices` WHERE `id` IN (3, 4)");
  });

  it("refuses to inline an id that is not a positive integer", () => {
    expect(() => insertBackupSql(TABLES[0], "20261015", [1, Number.NaN])).toThrow(BackfillError);
    expect(() => insertBackupSql(TABLES[0], "20261015", [0])).toThrow(BackfillError);
  });

  it("joins the live table to its backup by id to count a moved updatedAt", () => {
    expect(updatedAtMovedSql(TABLES[0], "20261015")).toBe(
      "SELECT COUNT(*) AS `moved` FROM `invoices` AS `l` JOIN `_bak_invoices_shopclock_20261015` AS `b` ON `b`.`id` = `l`.`id` WHERE NOT (`l`.`updatedAt` <=> `b`.`updatedAt`)",
    );
    expect(updatedAtMovedSql(TABLES[1], "20261015")).toContain("`l`.`updated_at` <=> `b`.`updated_at`");
  });

  it("self-assigns updatedAt only when asked to preserve it", () => {
    expect(casUpdateSql(TABLES[0], true)).toBe("UPDATE `invoices` SET `invoiceDate` = ?, `updatedAt` = `updatedAt` WHERE `id` = ? AND `invoiceDate` = ?");
    expect(casUpdateSql(TABLES[1], false)).toBe("UPDATE `alg_estimates` SET `estimate_date` = ? WHERE `id` = ? AND `estimate_date` = ?");
  });

  it("reads SNAP- from invoices only", () => {
    expect(scanSql(TABLES[0])).toContain("LIKE 'SNAP-%'");
    expect(scanSql(TABLES[1])).not.toContain("SNAP");
  });

  it("covers every class in the type", () => {
    const all: RowClass[] = ["already_correct", "needs_correction", "snap_double_converted", "post_cutoff_utc_match", "feed_owned_utc", "other"];
    expect([...CLASSES].sort()).toEqual([...all].sort());
  });
});

// ── SQL canary: every alias and identifier is backtick-quoted, so no keyword can break a statement ─────
//
// A live probe failed on TiDB with a syntax error at `AS stored`: STORED is reserved there (generated
// columns), and a fake database cannot see that. This reads each statement the tool can send and fails on
// any word outside quotes that is not SQL structure.

/** Reserved words from docs.pingcap.com/tidb/stable/keywords (R and R-Window), read 2026-10-15. */
const TIDB_RESERVED = new Set(
  (
    "ADD ALL ALTER ANALYZE AND ARRAY AS ASC BETWEEN BIGINT BINARY BLOB BOTH BY CALL CASCADE CASE CHANGE CHAR CHARACTER CHECK COLLATE COLUMN CONSTRAINT CONTINUE CONVERT CREATE CROSS " +
    "CURRENT_DATE CURRENT_ROLE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER CURSOR DATABASE DATABASES DAY_HOUR DAY_MICROSECOND DAY_MINUTE DAY_SECOND DECIMAL DEFAULT DELAYED DELETE DESC DESCRIBE " +
    "DISTINCT DISTINCTROW DIV DOUBLE DROP DUAL ELSE ELSEIF ENCLOSED ESCAPED EXCEPT EXISTS EXIT EXPLAIN FALSE FETCH FLOAT FLOAT4 FLOAT8 FOR FORCE FOREIGN FROM FULLTEXT GENERATED GRANT GROUP " +
    "HAVING HIGH_PRIORITY IF IGNORE ILIKE IN INDEX INFILE INNER INOUT INSERT INT INT1 INT2 INT3 INT4 INT8 INTEGER INTERSECT INTERVAL INTO IS ITERATE JOIN KEY KEYS KILL LATERAL LEADING LEAVE " +
    "LEFT LIKE LIMIT LINEAR LINES LOAD LOCALTIME LOCALTIMESTAMP LOCK LONG LONGBLOB LONGTEXT LOW_PRIORITY MATCH MAXVALUE MEDIUMBLOB MEDIUMINT MEDIUMTEXT MIDDLEINT MINUTE_MICROSECOND " +
    "MINUTE_SECOND MOD NATURAL NOT NO_WRITE_TO_BINLOG NULL NUMERIC OF ON OPTIMIZE OPTION OPTIONALLY OR ORDER OUT OUTER OUTFILE PARTITION PRECISION PRIMARY PROCEDURE RANGE READ REAL RECURSIVE " +
    "REFERENCES REGEXP RELEASE RENAME REPEAT REPLACE REQUIRE RESTRICT REVOKE RIGHT RLIKE ROW SECOND_MICROSECOND SELECT SET SHOW SMALLINT SPATIAL SQL SQL_BIG_RESULT SQL_CALC_FOUND_ROWS " +
    "SQL_SMALL_RESULT SQLEXCEPTION SQLSTATE SQLWARNING SSL STARTING STORED STRAIGHT_JOIN TABLE TABLESAMPLE TERMINATED THEN TIDB_CURRENT_TSO TINYBLOB TINYINT TINYTEXT TO TRAILING TRIGGER TRUE " +
    "UNION UNIQUE UNLOCK UNSIGNED UNTIL UPDATE USAGE USE USING UTC_DATE UTC_TIME UTC_TIMESTAMP VALUES VARBINARY VARCHAR VARCHARACTER VARYING VIRTUAL WHEN WHERE WHILE WITH WRITE XOR YEAR_MONTH ZEROFILL " +
    "RANK GROUPS LEAD LAG WINDOW"
  ).split(" "),
);

/** Words the statements use as syntax or as function names. Anything else outside quotes is an identifier or alias. */
const SQL_STRUCTURE = new Set(["SELECT", "FROM", "WHERE", "AND", "NOT", "IN", "AS", "ORDER", "BY", "JOIN", "ON", "UPDATE", "SET", "INSERT", "INTO", "CREATE", "TABLE", "LIKE", "CASE", "WHEN", "THEN", "ELSE", "END", "COUNT", "DATABASE"]);

const quotedNames = (sql: string): string[] => [...sql.replace(/'(?:[^'\\]|\\.)*'/g, " ").matchAll(/`((?:[^`]|``)*)`/g)].map((m) => m[1].replace(/``/g, "`"));

/** Words outside string literals, backticks and @@system variables that are not SQL structure. */
function unquotedIdentifiers(sql: string): string[] {
  const bare = sql
    .replace(/'(?:[^'\\]|\\.)*'/g, " ")
    .replace(/`(?:[^`]|``)*`/g, " ")
    .replace(/@@[\w.]+/g, " ");
  return (bare.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).filter((w) => !SQL_STRUCTURE.has(w.toUpperCase()));
}

/** Every statement the tool can send for a table, plus the fixed ones. */
function everyStatement(): Array<[string, string]> {
  const out: Array<[string, string]> = [
    ["TABLE_EXISTS_SQL", TABLE_EXISTS_SQL],
    ["TZ_REPORT_SQL", TZ_REPORT_SQL],
    ["TZ_CHECK_SQL", TZ_CHECK_SQL],
  ];
  for (const s of TABLES) {
    out.push(
      [`scanSql ${s.table}`, scanSql(s)],
      [`columnsSql ${s.table}`, columnsSql(s).sql],
      [`createBackupSql ${s.table}`, createBackupSql(s, "20261015")],
      [`insertBackupSql ${s.table}`, insertBackupSql(s, "20261015", [1, 22])],
      [`backupIdsSql ${s.table}`, backupIdsSql(s, "20261015")],
      [`backupValuesSql ${s.table}`, backupValuesSql(s, "20261015")],
      [`casUpdateSql keep ${s.table}`, casUpdateSql(s, true)],
      [`casUpdateSql move ${s.table}`, casUpdateSql(s, false)],
      [`updatedAtMovedSql ${s.table}`, updatedAtMovedSql(s, "20261015")],
      [`currentValueSql ${s.table}`, currentValueSql(s)],
    );
  }
  return out;
}

describe("SQL canary: no alias or identifier is left unquoted", () => {
  it.each(everyStatement())("%s", (label, sql) => {
    const bare = unquotedIdentifiers(sql);
    expect(bare, `${label} has unquoted words: ${bare.join(", ")} (reserved: ${bare.filter((w) => TIDB_RESERVED.has(w.toUpperCase())).join(", ") || "none"})`).toEqual([]);
  });

  it("flags the exact shape that failed in production, and every reserved word like it", () => {
    expect(unquotedIdentifiers("SELECT `invoiceDate` AS stored FROM `invoices`")).toEqual(["stored"]);
    for (const word of ["stored", "virtual", "source", "status", "key", "rank", "groups", "lead", "lag", "window", "row", "range", "generated", "usage", "ssl"]) {
      expect(unquotedIdentifiers(`SELECT \`a\` AS ${word} FROM \`t\``), word).toEqual([word]);
      expect(unquotedIdentifiers(`SELECT \`a\` AS \`${word}\` FROM \`t\``), `${word} quoted`).toEqual([]);
    }
  });

  it("does not mistake string literals, system variables or function calls for identifiers", () => {
    expect(unquotedIdentifiers("SELECT CASE WHEN `a` LIKE 'SNAP-%' THEN 1 ELSE 0 END AS `n`, @@session.time_zone AS `tz`, COUNT(*) AS `c` FROM `t` WHERE `s` = DATABASE()")).toEqual([]);
    expect(unquotedIdentifiers("SELECT COALESCE(`a`, 0) AS `n` FROM `t`")).toEqual(["COALESCE"]);
  });

  it("is load-bearing: the tool uses at least one reserved word as an alias, and only ever quoted", () => {
    const used = new Set(everyStatement().flatMap(([, sql]) => quotedNames(sql)));
    expect(TIDB_RESERVED.has("STORED") && used.has("stored")).toBe(true);
    expect([...used].filter((n) => TIDB_RESERVED.has(n.toUpperCase())).length).toBeGreaterThan(0);
  });
});

describe("scan query aliases are the fields the classifier reads", () => {
  const SCAN_ROW_KEYS: Record<keyof ScanRow, true> = { id: true, stored: true, created: true, source: true, isSnap: true };
  const aliasesOf = (sql: string) => [...sql.matchAll(/\bAS\s+`?(\w+)`?/g)].map((m) => m[1]);

  it.each(TABLES.map((s) => [s.table, s] as const))("%s: aliases are exactly id, stored, created, source, isSnap, in that order", (_table, spec) => {
    expect(aliasesOf(scanSql(spec))).toEqual(["id", "stored", "created", "source", "isSnap"]);
    expect(new Set(aliasesOf(scanSql(spec)))).toEqual(new Set(Object.keys(SCAN_ROW_KEYS)));
  });

  it("reads each column from the table spec, not a literal", () => {
    const sql = scanSql(TABLES[1]);
    expect(sql).toContain(`\`${TABLES[1].dateCol}\``);
    expect(sql).toContain(`\`${TABLES[1].createdCol}\``);
    expect(sql).toContain(`\`${TABLES[1].sourceCol}\``);
  });
});
