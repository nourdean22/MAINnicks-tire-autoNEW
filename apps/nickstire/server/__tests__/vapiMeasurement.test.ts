import { describe, expect, it } from "vitest";
import {
  buildVapiMeasurementRecord,
  deriveVapiFacts,
  hasVerifiedDemandCapture,
  scoreVapiQuality,
} from "../services/vapiMeasurement";

describe("VAPI measurement facts", () => {
  it("keeps tool engagement separate from verified lead creation", () => {
    const facts = deriveVapiFacts({ reachedTool: true });
    expect(facts.toolEngaged).toBe(true);
    expect(facts.leadCreated).toBe(false);
    expect(facts.bookingCreated).toBe(false);
    expect(hasVerifiedDemandCapture(facts)).toBe(false);
  });

  it("counts persisted lead, callback, and booking identifiers as verified capture", () => {
    expect(hasVerifiedDemandCapture(deriveVapiFacts({ leadId: 12 }))).toBe(true);
    expect(hasVerifiedDemandCapture(deriveVapiFacts({ callbackId: 14 }))).toBe(true);
    expect(hasVerifiedDemandCapture(deriveVapiFacts({ bookingId: 16 }))).toBe(true);
  });

  it("does not turn walk-in direction into arrival or paid revenue", () => {
    const facts = deriveVapiFacts({ inferredWalkIn: true });
    expect(facts.walkInDirected).toBe(true);
    expect(facts.arrivalVerified).toBe(false);
    expect(facts.paidInvoiceVerified).toBe(false);
  });
});

describe("VAPI quality independence", () => {
  const processEvidence = {
    isCustomerConversation: true,
    greeted: true,
    intentIdentified: true,
    usefulNextStep: true,
    successEvaluation: "pass",
    sentiment: "neutral",
    durationSeconds: 75,
  } as const;

  it("produces the same quality score regardless of commercial result", () => {
    const noLeadQuality = scoreVapiQuality(processEvidence);
    const leadQuality = scoreVapiQuality(processEvidence);
    const noLead = buildVapiMeasurementRecord({
      facts: deriveVapiFacts({ reachedTool: true }),
      quality: noLeadQuality,
    });
    const lead = buildVapiMeasurementRecord({
      facts: deriveVapiFacts({ reachedTool: true, leadId: 22 }),
      quality: leadQuality,
    });

    expect(noLead.quality.score).toBe(lead.quality.score);
    expect(noLead.facts.leadCreated).toBe(false);
    expect(lead.facts.leadCreated).toBe(true);
  });

  it("keeps technical failures visible but does not invent a quality score", () => {
    const result = scoreVapiQuality({
      isCustomerConversation: true,
      technicalFailure: true,
      durationSeconds: 12,
    });
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe("technical_failure");
    expect(result.evidence).toContain("technical_failure");
  });
});