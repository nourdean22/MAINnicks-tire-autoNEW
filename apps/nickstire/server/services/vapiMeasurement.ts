export const VAPI_FACTS_VERSION = "vapi-facts-v1";
export const VAPI_CLASSIFIER_VERSION = "vapi-outcome-v2";
export const VAPI_QUALITY_VERSION = "vapi-quality-v1";
export const VAPI_METRIC_DEFINITION_VERSION = "revenue-ops-v1";

export type EvidenceLevel = "observed" | "inferred" | "verified";

export interface VapiObservedFacts {
  toolEngaged: boolean;
  leadCreated: boolean;
  callbackCreated: boolean;
  bookingCreated: boolean;
  transferAttempted: boolean;
  walkInDirected: boolean;
  arrivalVerified: boolean;
  paidInvoiceVerified: boolean;
}

export interface VapiMeasurementInput {
  reachedTool?: boolean;
  leadId?: number | null;
  callbackId?: number | null;
  bookingId?: number | null;
  endedReason?: string | null;
  inferredWalkIn?: boolean;
  arrivalId?: string | number | null;
  paidInvoiceId?: string | number | null;
}

export function deriveVapiFacts(input: VapiMeasurementInput): VapiObservedFacts {
  return {
    toolEngaged: input.reachedTool === true,
    leadCreated: input.leadId != null,
    callbackCreated: input.callbackId != null,
    bookingCreated: input.bookingId != null,
    transferAttempted: /forward|transfer/i.test(input.endedReason ?? ""),
    walkInDirected: input.inferredWalkIn === true,
    arrivalVerified: input.arrivalId != null,
    paidInvoiceVerified: input.paidInvoiceId != null,
  };
}

export function hasVerifiedDemandCapture(facts: VapiObservedFacts): boolean {
  return facts.leadCreated || facts.callbackCreated || facts.bookingCreated;
}

export interface VapiQualityInput {
  isCustomerConversation: boolean;
  technicalFailure?: boolean;
  greeted?: boolean;
  intentIdentified?: boolean;
  usefulNextStep?: boolean;
  escalationAppropriate?: boolean;
  successEvaluation?: string | null;
  sentiment?: string | null;
  durationSeconds: number;
}

export interface VapiQualityResult {
  score: number | null;
  version: typeof VAPI_QUALITY_VERSION;
  evidence: string[];
  unavailableReason?: string;
}

/**
 * Conversation-execution quality. Commercial outcome is deliberately absent.
 * A call can score well without converting and poorly despite creating a row.
 */
export function scoreVapiQuality(input: VapiQualityInput): VapiQualityResult {
  if (!input.isCustomerConversation) {
    return {
      score: null,
      version: VAPI_QUALITY_VERSION,
      evidence: [],
      unavailableReason: "not_a_customer_conversation",
    };
  }
  if (input.technicalFailure) {
    return {
      score: null,
      version: VAPI_QUALITY_VERSION,
      evidence: ["technical_failure"],
      unavailableReason: "technical_failure",
    };
  }

  let score = 35;
  const evidence: string[] = ["customer_conversation"];

  if (input.greeted) {
    score += 10;
    evidence.push("greeting_observed");
  }
  if (input.intentIdentified) {
    score += 20;
    evidence.push("intent_identified");
  }
  if (input.usefulNextStep) {
    score += 20;
    evidence.push("useful_next_step");
  }
  if (input.escalationAppropriate) {
    score += 5;
    evidence.push("appropriate_escalation");
  }

  if (input.successEvaluation === "pass") {
    score += 5;
    evidence.push("provider_success_pass");
  } else if (input.successEvaluation === "fail") {
    score -= 15;
    evidence.push("provider_success_fail");
  }

  if (input.sentiment === "negative") {
    score -= 10;
    evidence.push("negative_sentiment");
  }

  if (input.durationSeconds >= 20 && input.durationSeconds <= 300) {
    score += 5;
    evidence.push("productive_duration");
  } else if (input.durationSeconds > 480) {
    score -= 5;
    evidence.push("excessive_duration");
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    version: VAPI_QUALITY_VERSION,
    evidence,
  };
}

export interface VapiMeasurementRecord {
  metricDefinitionVersion: typeof VAPI_METRIC_DEFINITION_VERSION;
  factsVersion: typeof VAPI_FACTS_VERSION;
  classifierVersion: typeof VAPI_CLASSIFIER_VERSION;
  qualityVersion: typeof VAPI_QUALITY_VERSION;
  evaluatedAt: string;
  facts: VapiObservedFacts;
  evidenceLevels: {
    toolEngagement: "observed";
    lead: "verified" | "observed";
    callback: "verified" | "observed";
    booking: "verified" | "observed";
    walkIn: EvidenceLevel;
    arrival: "verified" | "observed";
    paidInvoice: "verified" | "observed";
  };
  quality: VapiQualityResult;
}

export function buildVapiMeasurementRecord(args: {
  facts: VapiObservedFacts;
  quality: VapiQualityResult;
  walkInEvidence?: EvidenceLevel;
  evaluatedAt?: Date;
}): VapiMeasurementRecord {
  return {
    metricDefinitionVersion: VAPI_METRIC_DEFINITION_VERSION,
    factsVersion: VAPI_FACTS_VERSION,
    classifierVersion: VAPI_CLASSIFIER_VERSION,
    qualityVersion: VAPI_QUALITY_VERSION,
    evaluatedAt: (args.evaluatedAt ?? new Date()).toISOString(),
    facts: args.facts,
    evidenceLevels: {
      toolEngagement: "observed",
      lead: args.facts.leadCreated ? "verified" : "observed",
      callback: args.facts.callbackCreated ? "verified" : "observed",
      booking: args.facts.bookingCreated ? "verified" : "observed",
      walkIn: args.walkInEvidence ?? "inferred",
      arrival: args.facts.arrivalVerified ? "verified" : "observed",
      paidInvoice: args.facts.paidInvoiceVerified ? "verified" : "observed",
    },
    quality: args.quality,
  };
}