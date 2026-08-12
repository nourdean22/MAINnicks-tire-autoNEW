/**
 * BDN-102 · the scoreboard must reflect the REAL gate, including its
 * safety walls — a scoreboard that says "ready" for a type the gate
 * would never pass is worse than no scoreboard.
 *
 * The flag is asserted OFF (the default) so `wouldAutoExecute` is false
 * everywhere here; `meetsBar` is the flag-independent reading the panel
 * uses to answer "what would the flip actually enable?".
 */
import { describe, it, expect } from "vitest";
import { summarizeTrustTallies } from "@/lib/ai/trust-ladder";
import { SAFE_AUTO_ALLOWLIST } from "@/lib/ai/confidence-tier";

describe("summarizeTrustTallies", () => {
  it("shows every allowlisted type even with zero verdicts (the whole ladder, not just graded rungs)", () => {
    const rows = summarizeTrustTallies([]);
    for (const t of SAFE_AUTO_ALLOWLIST) {
      const row = rows.find((r) => r.actionType === t);
      expect(row).toBeDefined();
      expect(row?.decided).toBe(0);
      expect(row?.acceptanceRate).toBeNull();
      expect(row?.meetsBar).toBe(false); // no record ⇒ never ready
    }
  });

  it("computes the rate and clears the bar at a strong record", () => {
    const rows = summarizeTrustTallies([
      { actionType: "archive_mission", approval: "approved", count: 9 },
      { actionType: "archive_mission", approval: "rejected", count: 1 },
    ]);
    const row = rows.find((r) => r.actionType === "archive_mission");
    expect(row?.decided).toBe(10);
    expect(row?.acceptanceRate).toBeCloseTo(0.9);
    expect(row?.meetsBar).toBe(true);
    // Flag is off by default ⇒ nothing actually auto-executes.
    expect(row?.wouldAutoExecute).toBe(false);
  });

  it("does NOT call a thin record ready, however perfect", () => {
    const rows = summarizeTrustTallies([
      { actionType: "nudge_task", approval: "approved", count: 3 },
    ]);
    const row = rows.find((r) => r.actionType === "nudge_task");
    expect(row?.acceptanceRate).toBe(1);
    expect(row?.meetsBar).toBe(false); // under the sample floor
  });

  it("does NOT call a low-acceptance type ready", () => {
    const rows = summarizeTrustTallies([
      { actionType: "reassign_task", approval: "approved", count: 5 },
      { actionType: "reassign_task", approval: "rejected", count: 10 },
    ]);
    const row = rows.find((r) => r.actionType === "reassign_task");
    expect(row?.meetsBar).toBe(false);
  });

  it("NEVER marks a messaging/money type ready — even at a perfect, deep record", () => {
    const rows = summarizeTrustTallies([
      { actionType: "send_sms_outreach", approval: "approved", count: 500 },
      { actionType: "confirm_spend", approval: "approved", count: 500 },
    ]);
    for (const t of ["send_sms_outreach", "confirm_spend"]) {
      const row = rows.find((r) => r.actionType === t);
      expect(row?.acceptanceRate).toBe(1);
      expect(row?.allowlisted).toBe(false);
      expect(row?.meetsBar).toBe(false);
      expect(row?.wouldAutoExecute).toBe(false);
    }
  });

  it("surfaces non-allowlisted types that HAVE verdicts, flagged as not allowlisted", () => {
    const rows = summarizeTrustTallies([
      { actionType: "send_telegram", approval: "approved", count: 12 },
    ]);
    const row = rows.find((r) => r.actionType === "send_telegram");
    expect(row?.decided).toBe(12);
    expect(row?.allowlisted).toBe(false);
    expect(row?.meetsBar).toBe(false);
  });

  it("orders by verdict volume so the graded rungs read first", () => {
    const rows = summarizeTrustTallies([
      { actionType: "commit_journal", approval: "approved", count: 4 },
      { actionType: "archive_mission", approval: "approved", count: 20 },
    ]);
    expect(rows[0].actionType).toBe("archive_mission");
  });
});
