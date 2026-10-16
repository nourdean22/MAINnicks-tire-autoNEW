/**
 * UI v3 W2 (2026-10-16): the finite brief. composeBriefRows turns the server brief into at most
 * BRIEF_ROW_CAP ruled rows (lead CTA first, judgment next, horizon fills the rest) after the
 * device-local Less filter, and reports the total so the page can say "N more". Pure, so the order,
 * the cap, the filter and the pinned leads are pinned without React.
 */
import { describe, expect, it } from "vitest";

import { BRIEF_ROW_CAP, PINNED_LEAD_KINDS, composeBriefRows, type BriefRow } from "@/lib/home/brief-rows";
import { ATTENTION_CAP } from "@/lib/home/operator-brief";
import { HOME_BRIEF } from "../e2e/fixtures/home";

const kinds = (rows: BriefRow[]) => rows.map((r) => r.kind);
const NONE = new Set<string>();

describe("composeBriefRows", () => {
  it("the cap is the attention budget", () => {
    expect(BRIEF_ROW_CAP).toBe(ATTENTION_CAP);
    expect(BRIEF_ROW_CAP).toBe(7);
  });

  it("DEMO brief: lead first, then judgment in brief order with approvals expanded, capped at 7, and the total says what fell off", () => {
    const { rows, total } = composeBriefRows(HOME_BRIEF, NONE);
    expect(rows).toHaveLength(7);
    expect(total, "1 lead + 3 approval rows + commitment + follow-up + contradiction + 4 horizon").toBe(11);
    expect(kinds(rows)).toEqual(["lead", "approval", "approval", "approval", "commitment", "followup", "contradiction"]);
    // two pending approvals in place, then one remainder row for what the brief did not carry
    const approvals = rows.filter((r) => r.kind === "approval");
    expect(approvals.slice(0, 2).every((r) => r.kind === "approval" && "item" in r)).toBe(true);
    expect(approvals[2]).toMatchObject({ kind: "approval", more: 2, expired: 1, href: "/system/actions?tab=approvals" });
    expect(new Set(rows.map((r) => r.key)).size, "row keys are unique").toBe(7);
  });

  it("an infinite cap returns every row (the N more expansion)", () => {
    const { rows, total } = composeBriefRows(HOME_BRIEF, NONE, Number.POSITIVE_INFINITY);
    expect(rows).toHaveLength(total);
  });

  it("Less on a kind removes every row of that kind, and the horizon fills the freed slots", () => {
    const { rows } = composeBriefRows(HOME_BRIEF, new Set(["approval"]));
    expect(kinds(rows)).toEqual(["lead", "commitment", "followup", "contradiction", "horizon", "horizon", "horizon"]);
    expect(rows.filter((r) => r.kind === "horizon").map((r) => (r.kind === "horizon" ? r.slot.scope : ""))).toEqual(["now", "today", "week"]);
  });

  it("an error or decide lead is pinned: Less on the lead kind cannot hide it", () => {
    expect([...PINNED_LEAD_KINDS].sort()).toEqual(["decide", "error"]);
    for (const kind of ["error", "decide"] as const) {
      const brief = { ...HOME_BRIEF, lead: { ...HOME_BRIEF.lead, kind } };
      const { rows } = composeBriefRows(brief, new Set(["lead"]));
      expect(rows[0]).toMatchObject({ kind: "lead", pinned: true });
    }
    const routine = composeBriefRows(HOME_BRIEF, new Set(["lead"])).rows;
    expect(kinds(routine)[0]).not.toBe("lead");
    expect(composeBriefRows(HOME_BRIEF, NONE).rows[0]).toMatchObject({ kind: "lead", pinned: false });
  });

  it("a lead without a CTA has no action, so it is not a row; a missing brief section is skipped, never thrown on", () => {
    const noCta = { ...HOME_BRIEF, lead: { ...HOME_BRIEF.lead, cta: null } };
    expect(kinds(composeBriefRows(noCta, NONE).rows)[0]).not.toBe("lead");
    expect(composeBriefRows({ lead: null, judgment: null, horizon: null }, NONE)).toEqual({ rows: [], total: 0 });
  });

  it("approvals with nothing pending and nothing expired add no row; an all-expired queue is one Review row", () => {
    const none = { ...HOME_BRIEF, judgment: { ...HOME_BRIEF.judgment, items: [{ kind: "approvals" as const, count: 0, expired: 0, oldestAgeMin: null, href: "/x", pending: [] }] } };
    expect(kinds(composeBriefRows(none, NONE).rows)).not.toContain("approval");
    const expired = { ...HOME_BRIEF, judgment: { ...HOME_BRIEF.judgment, items: [{ kind: "approvals" as const, count: 0, expired: 2, oldestAgeMin: 900, href: "/x", pending: [] }] } };
    const rows = composeBriefRows(expired, NONE).rows.filter((r) => r.kind === "approval");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ more: 2, expired: 2 });
  });

  it("everything hidden by Less composes to no rows (the Nothing shown state)", () => {
    expect(composeBriefRows(HOME_BRIEF, new Set(["lead", "approval", "commitment", "followup", "contradiction", "horizon"]))).toEqual({ rows: [], total: 0 });
  });
});
