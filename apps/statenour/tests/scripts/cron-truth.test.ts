/**
 * Canaries for the cron manifest-vs-reality classifier.
 *
 * Every case below is a mistake this audit ACTUALLY MADE against production on
 * 2026-09-17 before the classifier existed. They are pinned here because each
 * one reads as a plausible finding right up until you check it.
 */
import { describe, it, expect } from "vitest";
import {
  classifyCron,
  isFailureStatus,
  tallyObserved,
  auditKillSwitch,
  bySeverity,
} from "../../scripts/lib/cron-truth.mjs";

const ran = (total = 14) => ({ total, last: new Date("2026-09-17T03:00:00Z") });

describe("classifyCron · the kill-switch contradiction", () => {
  // ── CANARY ──────────────────────────────────────────────────────────
  // The measured defect: data-cleanup, mode "active" in the manifest, switched
  // OFF in production since 2026-09-08. Nothing reconciled the two.
  it("CANARY — active in the manifest + disabled by a kill switch is an ALERT", () => {
    const r = classifyCron({ name: "data-cleanup", mode: "active" }, { disabled: true });
    expect(r.verdict).toBe("declared-active-but-disabled");
    expect(r.severity).toBe("alert");
  });

  it("a NON-active cron being disabled is merely consistent", () => {
    const r = classifyCron({ name: "x", mode: "dormant" }, { disabled: true });
    expect(r.severity).toBe("info");
  });
});

describe("classifyCron · not-observed is not not-running", () => {
  // ── CANARY ──────────────────────────────────────────────────────────
  // THE BIG ONE. Only 5 of 27 Inngest functions log their runs, so ~17 active
  // crons have zero rows while running fine — intelligence-daily-brief's
  // Langfuse traces land daily at 10:15 against its `15 10 * * *` schedule.
  // A first draft listed all 17 as "NOT observed", which reads as dead and
  // would have sent someone hunting 17 outages that do not exist.
  it("CANARY — a cron that does not LOG is UNOBSERVABLE, never 'dead'", () => {
    const r = classifyCron(
      { name: "intelligence-daily-brief", mode: "active", inngest: true, schedule: "15 10 * * *" },
      { observed: null, logsItsRuns: false },
    );
    expect(r.verdict).toBe("unobservable");
    expect(r.severity).toBe("warn");
    expect(r.detail).toMatch(/absence proves nothing/);
  });

  // The contrast case — this is what a REAL dead schedule looks like, and it
  // must stay distinguishable from the one above.
  it("a cron that DOES log and produced nothing is a genuinely dead schedule", () => {
    const r = classifyCron(
      { name: "some-route-cron", mode: "active", inngest: false },
      { observed: null, logsItsRuns: true },
    );
    expect(r.verdict).toBe("active-but-silent");
    expect(r.severity).toBe("alert");
  });
});

describe("classifyCron · modes that only LOOK wrong", () => {
  // `folded` means "no standalone schedule, runs inside another cron". An early
  // draft flagged all 19 folded-and-running crons as ghosts contradicting the
  // manifest. They were behaving exactly as declared.
  it("CANARY — a FOLDED cron that runs is correct, not a ghost", () => {
    const r = classifyCron({ name: "consolidate", mode: "folded" }, { observed: ran() });
    expect(r.verdict).toBe("folded-running");
    expect(r.severity).toBe("ok");
  });

  // `dormant` means "not SCHEDULED to fire", not "cannot fire". The operator
  // surface can trigger any cron by hand, which produces exactly one run on one
  // day — which is precisely what the two dormant crons showed.
  it("a DORMANT cron that ran once is a manual trigger, not a contradiction", () => {
    const r = classifyCron({ name: "agent-followups", mode: "dormant" }, { observed: { total: 1, last: new Date() } });
    expect(r.verdict).toBe("dormant-but-ran");
    expect(r.severity).toBe("info");
  });

  it("but a RETIRED cron that still runs IS an alert", () => {
    const r = classifyCron({ name: "old", mode: "retired" }, { observed: ran() });
    expect(r.severity).toBe("alert");
  });
});

describe("isFailureStatus · partial is not a failure", () => {
  // ── CANARY ──────────────────────────────────────────────────────────
  // The schema says so in a comment, because it has bitten before: `partial`
  // is LIVE (2,535 rows measured 2026-08-22). Filtering `!== "success"`
  // reclassifies every partial run as broken. An earlier pass of this audit
  // used exactly that and only escaped because the window held zero partials —
  // the right answer for the wrong reason.
  it("CANARY — `partial` must NOT count as a failure", () => {
    expect(isFailureStatus("partial")).toBe(false);
    expect(isFailureStatus("success")).toBe(false);
    expect(isFailureStatus("failed")).toBe(true);
    // …and the naive form that would have got it wrong:
    expect("partial" !== "success").toBe(true);
  });
});

describe("tallyObserved · a duplicate row is not a run and not a failure", () => {
  // ── CANARY ──────────────────────────────────────────────────────────
  // Measured 2026-10-18 (30d, prod cron_job_logs): mega-fanout-evening read
  // "20/50 failed" and mega-fanout-morning "19/48". Every one of those 39 rows was
  // status "duplicate" (cron-lifecycle.ts: the same run knocking twice, relabelled by the
  // reconcile sweep); the runs themselves were 30/30 and 29/29 success.
  const rows = (job: string, success: number, duplicate: number) => [
    { jobName: job, status: "success", _count: { _all: success }, _max: { createdAt: new Date("2026-10-18T03:00:20Z") } },
    { jobName: job, status: "duplicate", _count: { _all: duplicate }, _max: { createdAt: new Date("2026-09-22T03:01:24Z") } },
  ];

  it("CANARY — 30 success + 20 duplicate is 30 runs, 0 failures", () => {
    const o = tallyObserved(rows("mega-fanout-evening", 30, 20)).get("mega-fanout-evening");
    expect(o).toEqual({ total: 30, failures: 0, last: new Date("2026-10-18T03:00:20Z") });
  });

  it("a duplicate-only job was never observed running", () => {
    expect(tallyObserved(rows("ghost", 0, 5).slice(1)).has("ghost")).toBe(false);
  });

  it("positive control — real failures still count, partial still does not", () => {
    const g = [
      { jobName: "j", status: "success", _count: { _all: 7 }, _max: { createdAt: new Date("2026-10-01T00:00:00Z") } },
      { jobName: "j", status: "partial", _count: { _all: 2 }, _max: { createdAt: new Date("2026-10-02T00:00:00Z") } },
      { jobName: "j", status: "failed", _count: { _all: 1 }, _max: { createdAt: new Date("2026-10-03T00:00:00Z") } },
      { jobName: "j", status: "interrupted", _count: { _all: 1 }, _max: { createdAt: new Date("2026-10-04T00:00:00Z") } },
    ];
    expect(tallyObserved(g).get("j")).toEqual({ total: 11, failures: 2, last: new Date("2026-10-04T00:00:00Z") });
  });
});

describe("auditKillSwitch", () => {
  it("flags a disable with no note and no expiry — the data-cleanup shape", () => {
    const p = auditKillSwitch({ enabled: false, note: null, expiresAt: null });
    expect(p).toHaveLength(2);
    expect(p.join(" ")).toMatch(/NO note/);
    expect(p.join(" ")).toMatch(/NO expiry/);
  });

  it("says nothing about an ENABLED switch", () => {
    expect(auditKillSwitch({ enabled: true, note: null, expiresAt: null })).toEqual([]);
  });

  it("a documented, time-boxed disable is clean", () => {
    expect(auditKillSwitch({ enabled: false, note: "deleting too much, see #123", expiresAt: new Date() })).toEqual([]);
  });
});

describe("bySeverity", () => {
  // Alerts must not sort under the 40-odd healthy rows, or the one finding that
  // matters is invisible in the output.
  it("ranks alerts above everything else", () => {
    const sorted = [{ severity: "ok" }, { severity: "info" }, { severity: "alert" }, { severity: "warn" }].sort(bySeverity);
    expect(sorted.map((s) => s.severity)).toEqual(["alert", "warn", "info", "ok"]);
  });
});
