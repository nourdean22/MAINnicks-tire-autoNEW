/**
 * Do the two transfer instruments agree — and if not, what does that mean?
 *
 * The provider verdict and the caller's redial behaviour measure related but
 * DIFFERENT things, which is why they were deliberately kept separate. What was
 * missing is that nothing computed the disagreement, so the contradiction the
 * separation exists to expose could never actually surface.
 *
 * The contradictions are the point of these tests. A module that only handled
 * the agreeing cases would be a formality.
 */
import { describe, expect, it } from "vitest";

import { compareTransferInstruments } from "../lib/transferInstrumentAgreement";
import type { ConnectRate } from "../lib/transferArtifact";
import type { TransferOutcomeEvidence } from "../lib/transferOutcomeEvidence";

// PROVIDER_HEALTHY_PCT and REDIAL_TROUBLE_PCT are module-private on purpose:
// no production module imports them, and the knip orphan gate correctly
// flagged exporting them as inventing a consumer. The literals below are the
// stronger pin anyway — the test now breaks if the threshold silently moves
// without this file (and the module's own header comment) being updated too.
const PROVIDER_HEALTHY_PCT = 67;
const REDIAL_TROUBLE_PCT = 33;

const provider = (connectRate: number | null, coveragePct: number | null = 80): ConnectRate => ({
  attempted: 100,
  connected: 70,
  notConnected: 10,
  unknown: 20,
  connectRate,
  coveragePct,
});

const behaviour = (
  redialRate: number | null,
  reliable = true,
): TransferOutcomeEvidence => ({
  windowMinutes: 15,
  attempted: 100,
  failedTransfers: 5,
  forwards: 95,
  classifiable: 90,
  tooRecent: 5,
  redialed: 30,
  quiet: 60,
  redialRate,
  reliable,
});

describe("the contradiction that changes where the money goes", () => {
  it("provider says CONNECTED while callers redial — a counter problem, not telephony", () => {
    const r = compareTransferInstruments(provider(90), behaviour(50));
    expect(r.verdict).toBe("contradicted");
    expect(r.implication).toContain("counter problem");
    // The load-bearing sentence: it tells the operator NOT to spend on the
    // telephony fixes the roadmap lists.
    expect(r.implication).toContain("wrong half of the call");
  });

  it("provider says FAILED while callers stay quiet — the callers gave up", () => {
    // Worse for the shop than the loud case, and invisible to a redial-only
    // instrument. It must not read as success.
    const r = compareTransferInstruments(provider(20), behaviour(5));
    expect(r.verdict).toBe("contradicted");
    expect(r.implication).toContain("giving up");
    expect(r.implication).toContain("Do not treat the quiet as success");
  });
});

describe("agreement is reported as agreement, not as a score", () => {
  it("both healthy corroborates", () => {
    const r = compareTransferInstruments(provider(90), behaviour(5));
    expect(r.verdict).toBe("corroborated");
    expect(r.detail).toContain("working");
    expect(r.implication).toBeNull();
  });

  it("both failing corroborates too — corroboration is not good news", () => {
    const r = compareTransferInstruments(provider(20), behaviour(60));
    expect(r.verdict).toBe("corroborated");
    expect(r.detail).toContain("failing");
  });

  it("NEITHER instrument is averaged into the other", () => {
    // Both raw readings survive on every verdict. A blended number would be the
    // deceptive KPI this repo's directive forbids.
    const r = compareTransferInstruments(provider(90, 55), behaviour(50));
    expect(r.providerConnectRate).toBe(90);
    expect(r.providerCoveragePct).toBe(55);
    expect(r.redialRate).toBe(50);
  });
});

describe("insufficient names WHICH half is missing", () => {
  it("no provider data says so, and says why it may never arrive", () => {
    const r = compareTransferInstruments(provider(null, 2), behaviour(40));
    expect(r.verdict).toBe("insufficient");
    expect(r.detail).toContain("gates transfer-outcome reporting per organisation");
    expect(r.implication).toBeNull();
  });

  it("no behaviour data says so", () => {
    const r = compareTransferInstruments(provider(90), behaviour(null, false));
    expect(r.verdict).toBe("insufficient");
    expect(r.detail).toContain("redial window");
  });

  it("an UNRELIABLE redial rate is treated as absent even when a number exists", () => {
    // `reliable: false` with a populated redialRate is the trap: a number that
    // looks readable but is not. It must not drive a verdict.
    const r = compareTransferInstruments(provider(90), behaviour(50, false));
    expect(r.verdict).toBe("insufficient");
    expect(r.redialRate).toBeNull();
  });

  it("neither readable says NEITHER — never a quiet pass", () => {
    const r = compareTransferInstruments(provider(null, null), behaviour(null, false));
    expect(r.verdict).toBe("insufficient");
    expect(r.detail).toContain("Neither instrument");
  });
});

describe("the thresholds are load-bearing and the boundaries are exact", () => {
  it("a provider rate exactly at the healthy floor counts as healthy", () => {
    const r = compareTransferInstruments(provider(PROVIDER_HEALTHY_PCT), behaviour(5));
    expect(r.verdict).toBe("corroborated");
  });

  it("one point below the floor flips it to failing", () => {
    const r = compareTransferInstruments(provider(PROVIDER_HEALTHY_PCT - 1), behaviour(5));
    expect(r.verdict).toBe("contradicted");
  });

  it("a redial rate exactly at the trouble floor counts as trouble", () => {
    const r = compareTransferInstruments(provider(90), behaviour(REDIAL_TROUBLE_PCT));
    expect(r.verdict).toBe("contradicted");
  });

  it("one point below it does not", () => {
    const r = compareTransferInstruments(provider(90), behaviour(REDIAL_TROUBLE_PCT - 1));
    expect(r.verdict).toBe("corroborated");
  });
});

describe("the contract", () => {
  it("POSITIVE CONTROL: all three verdicts are reachable", () => {
    // Without this, a function hardcoded to "insufficient" would satisfy every
    // fail-closed case above and look like a careful instrument.
    const seen = new Set([
      compareTransferInstruments(provider(90), behaviour(5)).verdict,
      compareTransferInstruments(provider(90), behaviour(50)).verdict,
      compareTransferInstruments(provider(null), behaviour(null, false)).verdict,
    ]);
    expect([...seen].sort()).toEqual(["contradicted", "corroborated", "insufficient"]);
  });

  it("detail is never blank, on any verdict", () => {
    const cases: Array<[number | null, number | null, boolean]> = [
      [90, 5, true], [90, 50, true], [20, 5, true], [20, 60, true],
      [null, 40, true], [90, null, false], [null, null, false],
    ];
    for (const [p, b, rel] of cases) {
      const r = compareTransferInstruments(provider(p), behaviour(b, rel));
      expect(r.detail.trim().length).toBeGreaterThan(40);
    }
  });

  it("implication exists ONLY on contradicted — never decoration", () => {
    expect(compareTransferInstruments(provider(90), behaviour(5)).implication).toBeNull();
    expect(compareTransferInstruments(provider(null), behaviour(40)).implication).toBeNull();
    expect(compareTransferInstruments(provider(90), behaviour(50)).implication).not.toBeNull();
  });
});
