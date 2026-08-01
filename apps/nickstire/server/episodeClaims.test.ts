import { describe, it, expect, vi, afterEach } from "vitest";
import { noteToHandle, buildClaimsFromBrief } from "./services/episodeClaims";
import { preflightEpisode, fromReelJobBrief } from "../shared/episodeContract";

/**
 * Joins reelBriefGen's factual spine (mechanicTruth + proof sourceNotes) to the
 * Episode Contract. The tests that matter are the ones about what it REFUSES to
 * do: invent a claim, invent a qualifier, or let a pain point ground a fact.
 */
afterEach(() => vi.resetModules());

describe("noteToHandle", () => {
  it("recovers a resolver handle from the DB provenance url", () => {
    // The generator's DB note carries a human label that is NOT a handle
    // ("Database Resolved Provenance: ID rev_9"). Using the label would make
    // the strongest evidence available — an actual shop record — resolve to
    // nothing, silently.
    expect(noteToHandle({
      label: "Database Resolved Provenance: ID rev_9",
      url: "provenance://reviews/rev_9",
      kind: "proof",
      supports: "x",
    })).toBe("review:rev_9");
  });

  it("maps work_orders to the handle prefix the resolver knows", () => {
    expect(noteToHandle({ label: "l", url: "provenance://work_orders/wo_3", kind: "proof", supports: "" }))
      .toBe("work_order:wo_3");
  });

  it("passes a public-family label straight through", () => {
    expect(noteToHandle({ label: "NHTSA tire pressure guidance", kind: "proof", supports: "" }))
      .toBe("NHTSA tire pressure guidance");
  });

  it("returns null for an empty label with no url", () => {
    expect(noteToHandle({ label: "   ", kind: "proof", supports: "" })).toBeNull();
  });
});

describe("what it refuses to do", () => {
  it("does not invent a claim when the brief asserts nothing", async () => {
    const r = await buildClaimsFromBrief({ mechanicTruth: "", sourceNotes: [] });
    expect(r.claims).toEqual([]);
    // Empty packet → preflight reports NO_CLAIMS, which is the honest outcome.
    const { contract } = fromReelJobBrief({ id: "1" }, { claims: r.claims, evidence: r.evidence });
    expect(preflightEpisode(contract).warnings).toContain("NO_CLAIMS");
  });

  it("ignores pain_point notes — a narrative device is not a citation", async () => {
    vi.doMock("./services/evidenceRecords", () => ({
      resolveEvidenceRecords: vi.fn(async (handles: string[]) => {
        expect(handles).toEqual(["NHTSA tire pressure guidance"]);
        return { records: [], rejected: [] };
      }),
    }));
    const { buildClaimsFromBrief: build } = await import("./services/episodeClaims");
    await build({
      mechanicTruth: "Underinflation shortens tire life.",
      sourceNotes: [
        { label: "Drivers say it feels fine", kind: "pain_point", supports: "" },
        { label: "NHTSA tire pressure guidance", kind: "proof", supports: "" },
      ],
    });
  });

  it("emits a claim with NO evidence rather than dropping it when nothing resolves", async () => {
    const r = await buildClaimsFromBrief({
      mechanicTruth: "Brake fluid absorbs moisture.",
      sourceNotes: [{ label: "   ", kind: "proof", supports: "" }],
    });
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0].evidenceIds).toEqual([]);
    // An uncited claim must be visible to the gate, not quietly discarded —
    // reported today (enforcing it stopped 11 of 12 real briefs), blocking
    // once the registry covers the sources the generator cites.
    const { contract } = fromReelJobBrief({ id: "1" }, { claims: r.claims, evidence: r.evidence });
    expect(preflightEpisode(contract).warnings).toContain("CLAIM_WITHOUT_EVIDENCE");
    expect(preflightEpisode(contract, new Date(), { requireClaimEvidence: true }).blocks)
      .toContain("CLAIM_WITHOUT_EVIDENCE");
  });

  it("never fabricates a qualifier for a partially-supported claim", async () => {
    vi.doMock("./services/evidenceRecords", () => ({
      resolveEvidenceRecords: vi.fn(async () => ({
        records: [{
          id: "evr_1", handle: "review:1", sourceType: "db_record",
          assertion: "Tires can wear faster when underinflated.",
          claim: "c", retrievedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          snapshotHash: null, snapshotStatus: "db_row",
          entailment: "partially_supported", confidence: 0.9, sensitivity: "internal",
        }],
        rejected: [],
      })),
    }));
    const { buildClaimsFromBrief: build } = await import("./services/episodeClaims");
    const r = await build({
      mechanicTruth: "Underinflation always destroys tires.",
      sourceNotes: [{ label: "x", url: "provenance://reviews/1", kind: "proof", supports: "" }],
    });

    // No qualifier is manufactured...
    expect(r.claims[0].requiredQualifiers).toEqual([]);
    // ...so the gate blocks, which is correct: nothing in the brief declared
    // how to hedge this, and inventing wording no author chose would be the
    // system satisfying its own gate.
    const { contract } = fromReelJobBrief({ id: "1" }, { claims: r.claims, evidence: r.evidence });
    expect(preflightEpisode(contract).blocks).toContain("QUALIFIER_DROPPED");
  });

  it("surfaces rejected handles instead of silently shrinking the citation list", async () => {
    vi.doMock("./services/evidenceRecords", () => ({
      resolveEvidenceRecords: vi.fn(async () => ({ records: [], rejected: ["made up source"] })),
    }));
    const { buildClaimsFromBrief: build } = await import("./services/episodeClaims");
    const r = await build({
      mechanicTruth: "A real claim.",
      sourceNotes: [{ label: "made up source", kind: "proof", supports: "" }],
    });
    expect(r.rejected).toContain("made up source");
  });
});

describe("a resolved public source flows through to the contract", () => {
  it("carries entailment onto the episode evidence", async () => {
    vi.doMock("./services/evidenceRecords", () => ({
      resolveEvidenceRecords: vi.fn(async () => ({
        records: [{
          id: "evr_pub", handle: "NHTSA tire pressure guidance", sourceType: "public_registry",
          assertion: "NHTSA Tire Safety (https://nhtsa.gov/tires)",
          claim: "c", retrievedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          snapshotHash: "abc", snapshotStatus: "fetched",
          entailment: "not_evaluated", confidence: 0.7, sensitivity: "public",
        }],
        rejected: [],
      })),
    }));
    const { buildClaimsFromBrief: build } = await import("./services/episodeClaims");
    const r = await build({
      mechanicTruth: "Check tire pressure monthly.",
      sourceNotes: [{ label: "NHTSA tire pressure guidance", kind: "proof", supports: "" }],
    });

    expect(r.evidence).toHaveLength(1);
    expect(r.evidence[0].entailment).toBe("not_evaluated");
    expect(r.claims[0].evidenceIds).toEqual(["evr_pub"]);

    // A public source resolves to a TITLE, so entailment stays unevaluated.
    // That is STAGED: reported as a warning, never a block, so wiring evidence
    // in cannot by itself stop production. (This bare contract still fails on
    // caption/CTA — it carries no script — which is why the assertion is about
    // where ENTAILMENT_MISSING lands, not about `allowed`.)
    const { contract } = fromReelJobBrief({ id: "1" }, { claims: r.claims, evidence: r.evidence });
    const pre = preflightEpisode(contract);
    expect(pre.warnings).toContain("ENTAILMENT_MISSING");
    expect(pre.blocks).not.toContain("ENTAILMENT_MISSING");

    // ...and with the flag on it becomes a hard block, same finding.
    const strict = preflightEpisode(contract, new Date(), { requireClaimEvidence: true });
    expect(strict.blocks).toContain("ENTAILMENT_MISSING");
  });
});
