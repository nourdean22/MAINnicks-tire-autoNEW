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
