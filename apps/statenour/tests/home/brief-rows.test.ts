/**
 * UI v3 W2 (2026-10-16): the finite brief. composeBriefRows turns the server brief into at most
 * BRIEF_ROW_CAP ruled rows (lead CTA first, judgment next, horizon fills the rest) after the
 * device-local Less filter. Pure, so the order, the cap and the filter are pinned without React.
 */
import { describe, expect, it } from "vitest";

import { BRIEF_ROW_CAP, composeBriefRows, type BriefRow } from "@/lib/home/brief-rows";
import { ATTENTION_CAP } from "@/lib/home/operator-brief";
import { HOME_BRIEF } from "../e2e/fixtures/home";

const kinds = (rows: BriefRow[]) => rows.map((r) => r.kind);

describe("composeBriefRows", () => {
  it("the cap is the attention budget", () => {
    expect(BRIEF_ROW_CAP).toBe(ATTENTION_CAP);
    expect(BRIEF_ROW_CAP).toBe(7);
  });

  it("DEMO brief: lead first, then judgment in brief order with approvals expanded, capped at 7 (horizon falls off)", () => {
    const rows = composeBriefRows(HOME_BRIEF, new Set());
    expect(rows).toHaveLength(7);
    expect(kinds(rows)).toEqual(["lead", "approval", "approval", "approval", "commitment", "followup", "contradiction"]);
    // two pending approvals in place, then one remainder row for what the brief did not carry
    const approvals = rows.filter((r) => r.kind === "approval");
    expect(approvals.slice(0, 2).every((r) => r.kind === "approval" && "item" in r)).toBe(true);
    expect(approvals[2]).toMatchObject({ kind: "approval", more: 2, expired: 1, href: "/system/actions?tab=approvals" });
    expect(new Set(rows.map((r) => r.key)).size, "row keys are unique").toBe(7);
  });

  it("Less on a kind removes every row of that kind, and the horizon fills the freed slots", () => {
    const rows = composeBriefRows(HOME_BRIEF, new Set(["approval"]));
    expect(kinds(rows)).toEqual(["lead", "commitment", "followup", "contradiction", "horizon", "horizon", "horizon"]);
    expect(rows.filter((r) => r.kind === "horizon").map((r) => (r.kind === "horizon" ? r.slot.scope : ""))).toEqual(["now", "today", "week"]);
  });

  it("a lead without a CTA has no action, so it is not a row; a missing brief section is skipped, never thrown on", () => {
    const noCta = { ...HOME_BRIEF, lead: { ...HOME_BRIEF.lead, cta: null } };
    expect(kinds(composeBriefRows(noCta, new Set()))[0]).not.toBe("lead");
    expect(composeBriefRows({ lead: null, judgment: null, horizon: null }, new Set())).toEqual([]);
  });

  it("approvals with nothing pending and nothing expired add no row; an all-expired queue is one Review row", () => {
    const none = { ...HOME_BRIEF, judgment: { ...HOME_BRIEF.judgment, items: [{ kind: "approvals" as const, count: 0, expired: 0, oldestAgeMin: null, href: "/x", pending: [] }] } };
    expect(kinds(composeBriefRows(none, new Set()))).not.toContain("approval");
    const expired = { ...HOME_BRIEF, judgment: { ...HOME_BRIEF.judgment, items: [{ kind: "approvals" as const, count: 0, expired: 2, oldestAgeMin: 900, href: "/x", pending: [] }] } };
    const rows = composeBriefRows(expired, new Set()).filter((r) => r.kind === "approval");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ more: 2, expired: 2 });
  });

  it("everything hidden by Less composes to no rows (the Done for today state)", () => {
    expect(composeBriefRows(HOME_BRIEF, new Set(["lead", "approval", "commitment", "followup", "contradiction", "horizon"]))).toEqual([]);
  });
});
