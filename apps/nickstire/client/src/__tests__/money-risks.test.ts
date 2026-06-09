/**
 * Unit tests for deriveMoneyRisks — the pure cash-register-protection logic
 * behind the "Today's Money Risks" card. `now` is injected so thresholds are
 * deterministic.
 */
import { describe, it, expect } from "vitest";
import {
  deriveMoneyRisks,
  SLA_BREACH_MS,
  type RiskLead,
  type RiskCallback,
} from "../pages/admin/today/moneyRisks";

const NOW = 1_700_000_000_000;
const HOURS = 60 * 60 * 1000;
const at = (ageMs: number) => new Date(NOW - ageMs).toISOString();

const staleLead = (over: Partial<RiskLead> = {}): RiskLead => ({
  status: "new",
  createdAt: at(6 * HOURS),
  estimatedValueCents: null,
  ...over,
});

const waitingCallback = (over: Partial<RiskCallback> = {}): RiskCallback => ({
  status: "new",
  createdAt: at(5 * HOURS),
  ...over,
});

describe("deriveMoneyRisks", () => {
  it("returns an empty, hidden result for no data", () => {
    const r = deriveMoneyRisks([], [], NOW);
    expect(r.totalRisks).toBe(0);
    expect(r.atRiskCents).toBe(0);
    expect(r.topItem).toBeNull();
    expect(r.primary).toBeNull();
    expect(r.severity).toBe("low");
  });

  it("tolerates null/undefined inputs", () => {
    expect(deriveMoneyRisks(null, undefined, NOW).totalRisks).toBe(0);
  });

  it("ignores a new lead younger than the 4h SLA", () => {
    const r = deriveMoneyRisks([staleLead({ createdAt: at(SLA_BREACH_MS - 60_000) })], [], NOW);
    expect(r.staleLeadCount).toBe(0);
    expect(r.topItem).toBeNull();
  });

  it("counts a new lead past the 4h SLA and sums its estimate", () => {
    const r = deriveMoneyRisks([staleLead({ estimatedValueCents: 30_000, name: "Jane D." })], [], NOW);
    expect(r.staleLeadCount).toBe(1);
    expect(r.atRiskCents).toBe(30_000);
    expect(r.severity).toBe("medium"); // atRiskCents > 0
    expect(r.topItem).toMatchObject({ kind: "lead", name: "Jane D." });
    expect(r.primary).toBe("leads");
  });

  it("ignores leads that are no longer 'new' (already contacted)", () => {
    const r = deriveMoneyRisks([staleLead({ status: "contacted", createdAt: at(10 * HOURS) })], [], NOW);
    expect(r.staleLeadCount).toBe(0);
  });

  it("treats a stale lead with no estimate as low severity (count 1, $0)", () => {
    const r = deriveMoneyRisks([staleLead({ estimatedValueCents: null })], [], NOW);
    expect(r.staleLeadCount).toBe(1);
    expect(r.atRiskCents).toBe(0);
    expect(r.severity).toBe("low");
  });

  it("escalates to high severity when >= $500 is at risk", () => {
    const r = deriveMoneyRisks([staleLead({ estimatedValueCents: 60_000 })], [], NOW);
    expect(r.severity).toBe("high");
  });

  it("escalates to high severity when there are 4+ risks", () => {
    const r = deriveMoneyRisks(
      [staleLead(), staleLead(), staleLead(), staleLead()],
      [],
      NOW,
    );
    expect(r.totalRisks).toBe(4);
    expect(r.severity).toBe("high");
  });

  it("counts callbacks waiting past 4h and ignores fresh ones", () => {
    const r = deriveMoneyRisks(
      [],
      [waitingCallback({ name: "John S." }), waitingCallback({ createdAt: at(1 * HOURS) })],
      NOW,
    );
    expect(r.callbacksWaitingCount).toBe(1);
    expect(r.topItem).toMatchObject({ kind: "callback", name: "John S." });
    expect(r.primary).toBe("callbacks");
  });

  it("ignores callbacks that are no longer waiting", () => {
    const r = deriveMoneyRisks([], [waitingCallback({ status: "called" })], NOW);
    expect(r.callbacksWaitingCount).toBe(0);
  });

  it("picks the single oldest item across both sources as topItem", () => {
    const r = deriveMoneyRisks(
      [staleLead({ createdAt: at(5 * HOURS), name: "Lead5h" })],
      [waitingCallback({ createdAt: at(8 * HOURS), name: "Call8h" })],
      NOW,
    );
    expect(r.totalRisks).toBe(2);
    expect(r.topItem).toMatchObject({ kind: "callback", name: "Call8h" });
    expect(r.primary).toBe("callbacks");
    expect(r.severity).toBe("medium"); // totalRisks >= 2
  });
});
