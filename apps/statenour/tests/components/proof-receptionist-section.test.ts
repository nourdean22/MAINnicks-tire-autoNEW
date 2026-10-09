/**
 * /proof "Receptionist experiments" section (2026-10-09): rendered through the
 * REAL page and the REAL ledger reads, with only Prisma and the client page
 * shell mocked. `renderToStaticMarkup` in Node, the house pattern.
 *
 * Pins the three states (rows / measured empty / unavailable), that a payload
 * missing its optional gates renders instead of crashing, that every gate the
 * run reached prints ITS OWN verdict under its own label (distinct values in
 * every slot, so a swap cannot pass), that a veto or regression turns rose,
 * and that the section is read-only in every state: approval stays the
 * operator's Push Config in Nick's admin, so the page carries no control.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { receptionistFindMany } = vi.hoisted(() => ({ receptionistFindMany: vi.fn() }));

// Only the receptionist query is steered; every other /proof read (summary,
// timeline) succeeds empty, so a state change below is this section's alone.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    evidenceClaim: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []) },
    realityEvent: {
      findMany: vi.fn(async (args?: { where?: { eventType?: unknown } }) =>
        args?.where?.eventType === "receptionist.prompt_experiment" ? receptionistFindMany(args) : [],
      ),
    },
    tasteJudgment: { findMany: vi.fn(async () => []) },
    workItem: { findMany: vi.fn(async () => []) },
  },
}));

// StandardPage is a client shell (usePathname); the subject here is the body.
vi.mock("@/components/layout/standard-page", async () => {
  const { createElement } = await import("react");
  return { StandardPage: ({ children }: { children?: unknown }) => createElement("main", null, children as never) };
});

import ProofPage from "@/app/(mastery)/proof/page";

async function renderProof(): Promise<string> {
  return renderToStaticMarkup(await ProofPage());
}

/** The receptionist section only, so assertions cannot match another section's copy. */
function section(html: string): string {
  const start = html.indexOf('aria-labelledby="receptionist"');
  expect(start, "receptionist section missing").toBeGreaterThan(-1);
  const end = html.indexOf("</section>", start);
  return html.slice(start, end);
}

/** A producer-shaped gate (nickstire promptEvolutionReceipt.ts gateOf). */
const gate = (reason: string, n: { p: number; c: number; up: number; down: number }) => ({
  reason,
  pValue: n.p,
  bestPossibleP: 0.001,
  comparable: n.c,
  improved: n.up,
  worsened: n.down,
  tied: n.c - n.up - n.down,
});

const receipt = {
  id: "evt_1",
  occurredAt: new Date("2026-10-12T13:33:00.000Z"),
  observedAt: new Date("2026-10-12T13:33:02.000Z"),
  objects: [{ type: "experiment", id: "prompt-evolution:9f2c4e1ab07d3e55" }],
  payload: {
    outcome: "rejected-holdout",
    promotionStage: "none",
    lanes: { parity: false, differences: ["model", "temperature"] },
    // distinct in every slot: printing train (14) as the holdout cohort fails
    cohorts: { train: 14, holdout: 12, confirm: 6, success: 10 },
    gates: {
      holdout: gate("not-significant", { p: 0.344, c: 11, up: 3, down: 1 }),
      success: null,
      confirmation: null,
    },
    previousProposal: { status: "applied" },
  },
};

/** The same receipt with different gates. */
const withGates = (gates: Record<string, unknown>) => ({ ...receipt, id: "evt_g", payload: { ...receipt.payload, gates } });

beforeEach(() => {
  receptionistFindMany.mockReset();
});

describe("/proof receptionist experiments section", () => {
  it("positive control: a receipt renders date, outcome, stage, holdout p + seeds, gates, lane flag, previous proposal", async () => {
    receptionistFindMany.mockResolvedValueOnce([receipt]);
    const s = section(await renderProof());
    expect(s).toContain('data-experiments-state="rows"');
    expect(s).toContain("rejected-holdout");
    expect(s).toContain("stage: none");
    expect(s).toContain("holdout: not-significant p=0.344 · +3 -1 of 11 seeds (cohort 12)");
    expect(s).toContain("success cohort: not run");
    expect(s).toContain("confirmation: not run");
    // exact markup: a lane mismatch is rose (a replay that did not run the live config proves nothing)
    expect(s).toContain('<span class="text-rose-300">lanes: MISMATCH (model, temperature)</span>');
    expect(s).toContain("previous proposal: applied");
    expect(s).toContain("Oct 12"); // 13:33Z is 9:33 AM ET on Oct 12
    expect(s).not.toContain("No receptionist experiments recorded yet");
  });

  it("gates that RAN print their own verdicts under their own labels (success vs confirmation cannot swap)", async () => {
    receptionistFindMany.mockResolvedValueOnce([
      withGates({
        holdout: gate("improved", { p: 0.031, c: 11, up: 6, down: 0 }),
        success: gate("success-regressed-seed", { p: 0.5, c: 9, up: 0, down: 1 }),
        confirmation: gate("improved", { p: 0.062, c: 5, up: 4, down: 0 }),
      }),
    ]);
    const s = section(await renderProof());
    expect(s).toContain("holdout: improved p=0.031 · +6 -0 of 11 seeds (cohort 12)");
    expect(s).toContain("success cohort: success-regressed-seed");
    expect(s).toContain("confirmation: improved");
    expect(s).not.toContain("success cohort: improved");
    expect(s).not.toContain("confirmation: success-regressed-seed");
  });

  it("a success-cohort veto turns rose; a passing confirmation and an improved holdout stay grey", async () => {
    receptionistFindMany.mockResolvedValueOnce([
      withGates({
        holdout: gate("improved", { p: 0.031, c: 11, up: 6, down: 0 }),
        success: gate("success-regressed-seed", { p: 0.5, c: 9, up: 0, down: 1 }),
        confirmation: gate("improved", { p: 0.062, c: 5, up: 4, down: 0 }),
      }),
    ]);
    const s = section(await renderProof());
    expect(s).toContain('<span class="text-rose-300">success cohort: success-regressed-seed</span>');
    expect(s).toContain("<span>confirmation: improved</span>");
    expect(s).toMatch(/<span class="font-mono text-xs text-fg-secondary">holdout: improved /);
  });

  it("a regressed seed turns the holdout and the confirmation rose; a preserved success cohort stays grey", async () => {
    receptionistFindMany.mockResolvedValueOnce([
      withGates({
        holdout: gate("regressed-seed", { p: 0.4, c: 11, up: 4, down: 2 }),
        success: gate("preserved", { p: 0.75, c: 9, up: 1, down: 0 }),
        confirmation: gate("regressed-seed", { p: 0.5, c: 5, up: 1, down: 2 }),
      }),
    ]);
    const s = section(await renderProof());
    expect(s).toMatch(/<span class="font-mono text-xs text-rose-300">holdout: regressed-seed p=0\.400/);
    expect(s).toContain("<span>success cohort: preserved</span>");
    expect(s).toContain('<span class="text-rose-300">confirmation: regressed-seed</span>');
  });

  it("success-empty is a veto too (no evidence of harm from no evidence is not a pass), so it is rose", async () => {
    receptionistFindMany.mockResolvedValueOnce([
      withGates({ holdout: gate("improved", { p: 0.031, c: 11, up: 6, down: 0 }), success: gate("success-empty", { p: 1, c: 0, up: 0, down: 0 }), confirmation: null }),
    ]);
    const s = section(await renderProof());
    expect(s).toContain('<span class="text-rose-300">success cohort: success-empty</span>');
    expect(s).toContain("<span>confirmation: not run</span>");
  });

  it("a gate that ran with no readable reason renders 'unknown' with its p, never a pass, and stays grey", async () => {
    receptionistFindMany.mockResolvedValueOnce([withGates({ holdout: { pValue: 0.2 }, success: { tied: 3 }, confirmation: null })]);
    const s = section(await renderProof());
    expect(s).toMatch(/<span class="font-mono text-xs text-fg-secondary">holdout: unknown p=0\.200 \(cohort 12\)<\/span>/);
    expect(s).toContain("<span>success cohort: unknown</span>");
  });

  it("lane parity stays grey: a confirmed match, and an unreadable parity (unknown is not a mismatch claim)", async () => {
    receptionistFindMany.mockResolvedValueOnce([
      { ...receipt, id: "evt_match", payload: { ...receipt.payload, lanes: { parity: true, differences: [] } } },
      { ...receipt, id: "evt_unknown", payload: { ...receipt.payload, lanes: {} } },
    ]);
    const s = section(await renderProof());
    expect(s).toContain("<span>lanes: parity</span>");
    expect(s).toContain("<span>lanes: parity unknown</span>");
    expect(s).not.toContain("MISMATCH");
  });

  it("an empty ledger says so (a measured empty), not unavailable", async () => {
    receptionistFindMany.mockResolvedValueOnce([]);
    const s = section(await renderProof());
    expect(s).toContain('data-experiments-state="empty"');
    expect(s).toContain("No receptionist experiments recorded yet");
  });

  it("a failed read renders UNAVAILABLE, never the empty copy, and the rest of /proof still renders", async () => {
    receptionistFindMany.mockRejectedValueOnce(new Error("connection reset"));
    const html = await renderProof();
    const s = section(html);
    expect(s).toContain('data-experiments-state="unavailable"');
    expect(s).toContain("the ledger read failed. State unknown, not empty.");
    expect(s).not.toContain("No receptionist experiments recorded yet");
    expect(html).toContain('aria-labelledby="proposals"');
  });

  it("a missing table renders the not-migrated variant of unavailable", async () => {
    receptionistFindMany.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "P2021" }));
    const s = section(await renderProof());
    expect(s).toContain('data-experiments-state="unavailable"');
    expect(s).toContain("the ledger is not migrated here");
  });

  it("a payload missing every optional key renders without crashing", async () => {
    receptionistFindMany.mockResolvedValueOnce([{ ...receipt, id: "evt_2", payload: { outcome: "no-candidate" } }]);
    const s = section(await renderProof());
    expect(s).toContain("no-candidate");
    expect(s).toContain("stage: unknown");
    expect(s).toContain("holdout: not run");
    expect(s).toContain("success cohort: not run");
    expect(s).toContain("confirmation: not run");
    expect(s).toContain("lanes: parity unknown");
    expect(s).toContain("previous proposal: not reported");
  });

  it("is read-only in EVERY state: no button, form, link or input in rows, empty or unavailable", async () => {
    const states: Array<[string, () => void]> = [
      ["rows", () => receptionistFindMany.mockResolvedValueOnce([receipt])],
      ["empty", () => receptionistFindMany.mockResolvedValueOnce([])],
      ["unavailable", () => receptionistFindMany.mockRejectedValueOnce(new Error("connection reset"))],
    ];
    for (const [state, arrange] of states) {
      arrange();
      const s = section(await renderProof());
      expect(s, state).toContain(`data-experiments-state="${state}"`);
      expect(s, state).not.toMatch(/<(button|form|a|input|select|textarea)\b/);
    }
  });
});
