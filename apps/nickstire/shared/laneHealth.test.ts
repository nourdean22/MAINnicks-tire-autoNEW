/**
 * Q-23 phase 11 · the lane-health rules. Each "unknown" case is paired with the
 * measured case it must not be confused with: a failed read is never a zero,
 * never "not run", never "no holdout".
 */
import { describe, expect, it } from "vitest";
import {
  CUSTOMER_LANES,
  buildLaneHealthRows,
  type CustomerLaneSpec,
  type LaneHealthPayload,
  type LaneRunRow,
} from "./laneHealth";

const NOW = new Date("2026-10-01T15:00:00Z");
const lane = (key: string) => CUSTOMER_LANES.find((l) => l.key === key)!;
/** The row for one lane, through the only exported builder. */
const buildLaneHealthRow = (spec: CustomerLaneSpec, p: LaneHealthPayload, now: Date) =>
  buildLaneHealthRows(p, now).find((r) => r.key === spec.key)!;

function run(status: string, ageMinutes: number, extra: Partial<LaneRunRow> = {}): LaneRunRow {
  return {
    status,
    startedAt: new Date(NOW.getTime() - ageMinutes * 60_000).toISOString(),
    recordsProcessed: 4,
    details: null,
    ageMinutes,
    ...extra,
  };
}

function payload(over: Partial<LaneHealthPayload> = {}): LaneHealthPayload {
  return {
    windowDays: 30,
    cron: { readable: true, runs: {} },
    sms: { readable: true, byVariant: [] },
    holdout: { state: "read", byLane: [] },
    holdoutArmed: {},
    ...over,
  };
}

const obs = (laneKey: string, tM: number, cM: number, tCents: number, cCents: number) => ({
  laneKey,
  experimentId: `contact:${laneKey}:v1`,
  treatmentAssigned: tM,
  controlAssigned: cM,
  treatmentMatured: tM,
  controlMatured: cM,
  treatmentPaidInvoices: 1,
  controlPaidInvoices: 1,
  treatmentRevenueCents: tCents,
  controlRevenueCents: cCents,
});

describe("last run", () => {
  it("a recent completed run is running and MEASURED, with what it processed", () => {
    const r = buildLaneHealthRow(lane("winback"), payload({
      cron: { readable: true, runs: { "winback-auto-process": { latest: run("completed", 90), latestCompleted: run("completed", 90) } } },
    }), NOW);
    expect(r.state).toBe("running");
    expect(r.lastRun.text).toBe("1h ago · processed 4");
    expect(r.lastRun.provenance).toBe("MEASURED");
    expect(r.blockedReason).toBeNull();
  });

  it("an unreadable run log is unknown and UNMEASURED, not 'no run'", () => {
    const r = buildLaneHealthRow(lane("winback"), payload({ cron: { readable: false, runs: {} } }), NOW);
    expect(r.state).toBe("unknown");
    expect(r.lastRun).toEqual({ text: "unknown", provenance: "UNMEASURED" });
    expect(r.blockedReason).toMatch(/could not be read/);
  });

  it("control: a readable log with no row is a measured 'no run in 7d'", () => {
    const r = buildLaneHealthRow(lane("winback"), payload(), NOW);
    expect(r.state).toBe("stale");
    expect(r.lastRun).toEqual({ text: "no run in 7d", provenance: "MEASURED" });
  });

  it("a flag skip is blocked and says which flag and why", () => {
    const r = buildLaneHealthRow(lane("weather"), payload({
      cron: { readable: true, runs: { "weather-intel": { latest: run("skipped", 30, { details: "requiresFlag:FEATURE_X (not set)" }), latestCompleted: null } } },
    }), NOW);
    expect(r.state).toBe("blocked");
    expect(r.blockedReason).toBe("flag FEATURE_X off (not set)");
  });

  it("a failed run is failing, and the reason masks digit runs (bound phone params)", () => {
    const r = buildLaneHealthRow(lane("retention"), payload({
      cron: { readable: true, runs: { "retention-all": { latest: run("failed", 10, { details: "Failed query: select ... params: 2165550188\nstack" }), latestCompleted: null } } },
    }), NOW);
    expect(r.state).toBe("failing");
    expect(r.blockedReason).toMatch(/^last run failed: Failed query/);
    expect(r.blockedReason).not.toMatch(/2165550188|stack/);
  });

  it("a lock skip defers to the last completed run instead of reading blocked", () => {
    const r = buildLaneHealthRow(lane("winback"), payload({
      cron: { readable: true, runs: { "winback-auto-process": {
        latest: run("skipped", 5, { details: "cross-dyno lock held by another process" }),
        latestCompleted: run("completed", 65),
      } } },
    }), NOW);
    expect(r.state).toBe("running");
    expect(r.lastRun.text).toBe("1h ago · processed 4");
  });

  it("a completed run older than 72h is stale", () => {
    const r = buildLaneHealthRow(lane("winback"), payload({
      cron: { readable: true, runs: { "winback-auto-process": { latest: run("completed", 4 * 24 * 60), latestCompleted: run("completed", 4 * 24 * 60) } } },
    }), NOW);
    expect(r.state).toBe("stale");
    expect(r.blockedReason).toBe("no run since 4d ago");
  });

  it("prefers the SQL age over startedAt (TiDB times come back shifted)", () => {
    const shifted = run("completed", 30, { startedAt: new Date(NOW.getTime() - 4 * 3_600_000 - 30 * 60_000).toISOString() });
    const r = buildLaneHealthRow(lane("winback"), payload({
      cron: { readable: true, runs: { "winback-auto-process": { latest: shifted, latestCompleted: shifted } } },
    }), NOW);
    expect(r.lastRun.text).toBe("30m ago · processed 4");
  });
});

describe("sent", () => {
  it("sums the lane's variant keys, A/B and tier suffixes included", () => {
    const r = buildLaneHealthRow(lane("retention"), payload({
      sms: { readable: true, byVariant: [
        { variantKey: "retention_d7", attempted: 5, sent: 5 },
        { variantKey: "retention_d90_v2", attempted: 3, sent: 2 },
        { variantKey: "winback", attempted: 9, sent: 9 },
      ] },
    }), NOW);
    expect(r.sent).toEqual({ text: "7 in 30d · 1 not delivered", provenance: "MEASURED" });
  });

  it("an unreadable send log is unknown, not 0", () => {
    const r = buildLaneHealthRow(lane("retention"), payload({ sms: { readable: false, byVariant: [] } }), NOW);
    expect(r.sent).toEqual({ text: "unknown", provenance: "UNMEASURED" });
  });

  it("control: a readable log with no sends is a measured 0", () => {
    const r = buildLaneHealthRow(lane("retention"), payload(), NOW);
    expect(r.sent).toEqual({ text: "0 in 30d", provenance: "MEASURED" });
  });

  it("a lane that runs but delivers nothing is blocked", () => {
    const r = buildLaneHealthRow(lane("winback"), payload({
      cron: { readable: true, runs: { "winback-auto-process": { latest: run("completed", 20), latestCompleted: run("completed", 20) } } },
      sms: { readable: true, byVariant: [{ variantKey: "winback", attempted: 6, sent: 0 }] },
    }), NOW);
    expect(r.state).toBe("blocked");
    expect(r.blockedReason).toBe("0 of 6 texts delivered in 30d");
  });

  it("the drafts lane says its sent count is approved drafts", () => {
    const r = buildLaneHealthRow(lane("review_reminder"), payload(), NOW);
    expect(r.sent.text).toBe("0 in 30d (approved drafts)");
  });
});

describe("outcome", () => {
  it("a matured holdout shows the gross lift as an inferred figure", () => {
    const r = buildLaneHealthRow(lane("winback"), payload({
      holdout: { state: "read", byLane: [obs("winback", 40, 30, 400_000, 150_000)] },
    }), NOW);
    // (4000/40 - 1500/30) = 50 dollars per treated customer x 40 = +$2,000
    expect(r.outcome).toEqual({ text: "+$2,000 gross vs holdout (40 vs 30 matured)", provenance: "ESTIMATE" });
  });

  it("pools the lane's experiments (one per retention tier), and only its own", () => {
    // Each tier alone has 15 matured controls (collecting); pooled they reach 30.
    const r = buildLaneHealthRow(lane("retention"), payload({
      holdout: { state: "read", byLane: [
        obs("retention_d7", 20, 15, 200_000, 30_000),
        obs("retention_d90", 20, 15, 200_000, 30_000),
        obs("winback", 99, 99, 9_900_000, 0),
      ] },
    }), NOW);
    // (4000/40 - 600/30) = 80 dollars per treated customer x 40 = +$3,200
    expect(r.outcome).toEqual({ text: "+$3,200 gross vs holdout (40 vs 30 matured)", provenance: "ESTIMATE" });
  });

  it("too few matured per arm is collecting, not a number", () => {
    const r = buildLaneHealthRow(lane("winback"), payload({ holdout: { state: "read", byLane: [obs("winback", 40, 12, 9, 9)] } }), NOW);
    expect(r.outcome).toEqual({ text: "collecting · 12 matured per arm, 30 needed", provenance: "UNMEASURED" });
  });

  it("a failed holdout read is unknown, not 'not armed'", () => {
    const r = buildLaneHealthRow(lane("winback"), payload({ holdout: { state: "error", byLane: [] }, holdoutArmed: { winback: false } }), NOW);
    expect(r.outcome.text).toMatch(/^unknown/);
  });

  it("control: a readable, empty holdout with the flag off is 'not armed'", () => {
    const r = buildLaneHealthRow(lane("winback"), payload({ holdoutArmed: { winback: false } }), NOW);
    expect(r.outcome).toEqual({ text: "holdout not armed", provenance: "UNMEASURED" });
  });

  it("an unapplied 0136 says so", () => {
    const r = buildLaneHealthRow(lane("winback"), payload({ holdout: { state: "pending", byLane: [] } }), NOW);
    expect(r.outcome.text).toMatch(/migration 0136/);
  });

  it("a lane with no Q-21 holdout says why", () => {
    const r = buildLaneHealthRow(lane("declined_recovery"), payload(), NOW);
    expect(r.outcome).toEqual({ text: "own holdout design, see Recovered revenue", provenance: "UNMEASURED" });
  });
});

describe("helpers", () => {
  const skipped = (details: string | null) =>
    buildLaneHealthRow(lane("winback"), payload({
      cron: { readable: true, runs: { "winback-auto-process": { latest: run("skipped", 5, { details }), latestCompleted: null } } },
    }), NOW).blockedReason;
  const failed = (details: string) =>
    buildLaneHealthRow(lane("winback"), payload({
      cron: { readable: true, runs: { "winback-auto-process": { latest: run("failed", 5, { details }), latestCompleted: null } } },
    }), NOW).blockedReason;

  it("names env, dependency and unknown skips", () => {
    expect(skipped("requiresEnv:A|B (no env var set)")).toBe("env A or B not set");
    expect(skipped("requiresSuccessfulJobs:estimate-invoice-match (dependency did not complete successfully this pass)"))
      .toBe("waiting on estimate-invoice-match (did not succeed that pass)");
    expect(skipped(null)).toBe("skipped: no reason logged");
  });

  it("masks formatted phones and emails, keeps short numbers", () => {
    expect(failed("Failed query: params: (216) 555-0188, a.b@example.com, 42, 2026-10-01"))
      .toBe("last run failed: Failed query: params: •••, •••, 42, 2026-10-01");
    expect(failed("params: 5550188")).toBe("last run failed: params: •••");
  });

  it("cuts a failure to one short line", () => {
    expect(failed("x".repeat(200))).toBe(`last run failed: ${"x".repeat(89)}…`);
    expect(failed("")).toBe("last run failed");
  });

  it("builds one row per lane, in registry order", () => {
    expect(buildLaneHealthRows(payload(), NOW).map((r) => r.key)).toEqual(CUSTOMER_LANES.map((l) => l.key));
  });
});

describe("completed runs that did nothing on purpose", () => {
  const completed = (details: string) =>
    payload({ cron: { readable: true, runs: { "alg-declined-work-recovery": { latest: run("completed", 20, { details }), latestCompleted: run("completed", 20, { details }) } } } });

  it("declined recovery's dry run is blocked, even behind its long match note", () => {
    const details =
      "match (dry run) would clear 3 of 40 first, and the count below still includes them · DRY RUN: 37 eligible, $12,400 recoverable — flip FEATURE_DECLINED_RECOVERY=1";
    const r = buildLaneHealthRow(lane("declined_recovery"), completed(details), NOW);
    expect(r.state).toBe("blocked");
    expect(r.blockedReason).toMatch(/^DRY RUN: 37 eligible/);
    expect(r.lastNote).toBeNull();
  });

  it("matches past the display cut: a dry run behind a 150-character prefix is still blocked", () => {
    const r = buildLaneHealthRow(lane("declined_recovery"), completed(`${"m".repeat(150)} · DRY RUN: 1 eligible`), NOW);
    expect(r.state).toBe("blocked");
    expect(r.blockedReason).toBe("DRY RUN: 1 eligible");
  });

  it("a failed match that sent nothing is blocked", () => {
    const r = buildLaneHealthRow(lane("declined_recovery"), completed("estimate-invoice match failed, so nothing was sent (timeout)"), NOW);
    expect(r.state).toBe("blocked");
  });

  it("control: a real send summary is running, and kept as the last-run note", () => {
    const r = buildLaneHealthRow(lane("declined_recovery"), completed("matched 3 of 40 estimates to invoices first · Sent 2/3d + 1/7d"), NOW);
    expect(r.state).toBe("running");
    expect(r.blockedReason).toBeNull();
    expect(r.lastNote).toMatch(/^matched 3 of 40/);
  });
});
