/**
 * Audit 2026-10-10 · 06-F2 + F5. `recordShownBounded` answers null after 400 ms
 * while the write completes behind it; Home lead, Missions deck and chat chips
 * returned early on a null id, so the operator's act was lost. Now a null-id
 * tap sends the summary the row was ledgered under, and the server decides by
 * content. A "different move" stores its reason (`dismiss:alternative`) so
 * CORRECTION_WHERE does not count it as a correction.
 *
 * Client shells are "use client" tRPC components that cannot render in node
 * (no jsdom here), so the wiring is pinned source-side, the
 * recommendation-decision-wiring.test.ts pattern; the client-built summaries
 * are pinned against the server's own summary functions.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/outcome-ledger", () => ({ recordShownBounded: vi.fn(async () => null) }));

import { leadLedgerSummary } from "@/lib/home/operator-brief";
import { nextMoveLedgerSummary } from "@/lib/missions/deck";

const APP = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(APP, p), "utf8");

describe("Home lead · a null ledger id still decides", () => {
  const lead = read("components/home/brief-lead.tsx");

  it("no early return on a missing id; the summary is the server's leadLedgerSummary shape", () => {
    expect(lead).not.toContain("if (!lead?.ledgerId) return;");
    expect(lead).toContain("summary: `${lead.headline}: ${lead.cta.label}`");
    expect(leadLedgerSummary({ headline: "Finish what's in motion", cta: { label: "Open task", href: "/x" } })).toBe(
      "Finish what's in motion: Open task",
    );
  });

  it("an alternative is a dismissal with the reason `alternative`", () => {
    expect(lead).toContain('recordDecision("dismissed", "dismiss:alternative")');
  });
});

describe("Missions deck · a null ledger id still decides", () => {
  const page = read("app/(mastery)/missions/page.tsx");

  it("no early return on a missing id; the summary is the server's nextMoveLedgerSummary shape", () => {
    expect(page).not.toContain("if (!ledgerId) return;");
    expect(page).toContain('summary: `${nextMove.kind === "resume" ? "resume" : "next move"}: ${nextMove.task.title}`');
    expect(nextMoveLedgerSummary({ kind: "resume", task: { title: "Brakes" } })).toBe("resume: Brakes");
    expect(nextMoveLedgerSummary({ kind: "start", task: { title: "Brakes" } })).toBe("next move: Brakes");
  });

  it("pick-different dismisses with the reason `alternative`, never a task ref", () => {
    expect(page).toContain('recordDeckDecision("dismissed", "dismiss:alternative");');
    expect(page).toContain('recordDeckDecision("accepted", `task:${taskId}`);');
  });
});

describe("chat chips · a null ledger id still decides", () => {
  it("the tap and the dismiss send the ledger summary when there is no id", () => {
    const chips = read("components/chat/nick-suggestions.tsx");
    expect(chips.match(/\.\.\.\(meta\.ledgerId \? \{ ledgerId: meta\.ledgerId \} : meta\.ledgerSummary \? \{ ledgerSummary: meta\.ledgerSummary \} : \{\}\)/g)?.length).toBe(2);
    expect(chips).toContain("ledgerSummary: s.ledgerSummary");
  });
});
