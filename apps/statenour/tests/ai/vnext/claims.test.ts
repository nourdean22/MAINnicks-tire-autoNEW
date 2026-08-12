/**
 * Claim/Evidence ledger tests (lib/ai/vnext/truth/claims.ts — SHADOW).
 *
 * Pins the three mechanisms:
 *   · schemas validate the §18.1 answer shape and reject out-of-range
 *     materiality/volatility;
 *   · verification derivation — only TRUSTED evidence supports a claim,
 *     contradictions demote, untrusted content never mints support;
 *   · the blocking-verifier gate fires on material × uncertain ×
 *     irreversible turns and stays out of the way elsewhere.
 */

import { describe, it, expect } from "vitest";
import {
  MEMORY_EVIDENCE_CLASSES,
  EVIDENCE_STRENGTH,
  claimSchema,
  claimLedgerSchema,
  deriveVerification,
  requiresBlockingVerification,
  type EvidenceRef,
} from "@/lib/ai/vnext/truth/claims";

function ev(overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  return {
    id: "e1",
    evidenceClass: "system_receipt",
    sourceRef: "receipt:tool-exec:1",
    observedAt: "2026-08-11T00:00:00Z",
    trust: "TRUSTED",
    ...overrides,
  };
}

describe("evidence vocabulary", () => {
  it("mirrors the memory gateway ladder (8 classes, receipts above summaries)", () => {
    expect(MEMORY_EVIDENCE_CLASSES).toHaveLength(8);
    expect(MEMORY_EVIDENCE_CLASSES).toContain("system_receipt");
    expect(EVIDENCE_STRENGTH.operator_stated).toBeGreaterThan(EVIDENCE_STRENGTH.system_receipt);
    expect(EVIDENCE_STRENGTH.system_receipt).toBeGreaterThan(EVIDENCE_STRENGTH.generated_summary);
    expect(EVIDENCE_STRENGTH.weak_inference).toBe(0);
  });
});

describe("schemas", () => {
  const validClaim = {
    id: "c1",
    text: "You have $80K available",
    kind: "OBSERVED",
    materiality: 0.9,
    volatility: 0.2,
    confidence: "HIGH",
    evidence: [ev({ evidenceClass: "operator_stated", sourceRef: "user:turn:42" })],
    contradictionIds: [],
    verification: "SUPPORTED",
  };

  it("accepts a well-formed claim", () => {
    expect(claimSchema.safeParse(validClaim).success).toBe(true);
  });

  it("rejects out-of-range materiality", () => {
    expect(claimSchema.safeParse({ ...validClaim, materiality: 1.5 }).success).toBe(false);
  });

  it("rejects an unknown claim kind", () => {
    expect(claimSchema.safeParse({ ...validClaim, kind: "GUESSED" }).success).toBe(false);
  });

  it("validates a full ledger with turn meta (model/effort/fallback/refusal transparency)", () => {
    const parsed = claimLedgerSchema.safeParse({
      claims: [validClaim],
      meta: {
        model: "claude-fable-5",
        provider: "anthropic",
        effort: "high",
        fallbackFired: false,
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.meta.refusal).toBe(false); // defaulted
  });
});

describe("deriveVerification", () => {
  it("no evidence → UNKNOWN", () => {
    expect(deriveVerification([], false)).toBe("UNKNOWN");
  });

  it("a receipt supports a claim", () => {
    expect(deriveVerification([ev()], false)).toBe("SUPPORTED");
  });

  it("weak-inference-only evidence is PARTIAL, never SUPPORTED", () => {
    expect(deriveVerification([ev({ evidenceClass: "weak_inference" })], false)).toBe("PARTIAL");
  });

  it("UNTRUSTED evidence never supports — a Tier-D fact does not become Tier-A because a model read it", () => {
    expect(deriveVerification([ev({ trust: "UNTRUSTED" })], false)).toBe("UNKNOWN");
  });

  it("contradiction demotes strong support to PARTIAL", () => {
    expect(deriveVerification([ev()], true)).toBe("PARTIAL");
  });

  it("contradiction with weak-or-no support → CONTRADICTED", () => {
    expect(deriveVerification([ev({ evidenceClass: "weak_inference" })], true)).toBe("CONTRADICTED");
    expect(deriveVerification([], true)).toBe("CONTRADICTED");
  });
});

describe("requiresBlockingVerification", () => {
  it("fires on material, uncertain, irreversible turns", () => {
    expect(
      requiresBlockingVerification({ materiality: 0.9, confidence: "LOW", irreversible: true }),
    ).toBe(true);
  });

  it("stays out of the way on low-materiality turns", () => {
    expect(
      requiresBlockingVerification({ materiality: 0.1, confidence: "LOW", irreversible: true }),
    ).toBe(false);
  });

  it("high confidence keeps even material irreversible turns below the gate", () => {
    expect(
      requiresBlockingVerification({ materiality: 0.9, confidence: "HIGH", irreversible: true }),
    ).toBe(false);
  });

  it("reversibility discounts but does not erase risk", () => {
    // Ordinary reversible turns stay below the gate…
    expect(
      requiresBlockingVerification({ materiality: 0.8, confidence: "LOW", irreversible: false }),
    ).toBe(false);
    // …but a maximally material, low-confidence answer gates even when reversible.
    expect(
      requiresBlockingVerification({ materiality: 1, confidence: "LOW", irreversible: false }),
    ).toBe(true);
  });
});
