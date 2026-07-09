/**
 * Nexus Audit Sampler
 */

import { createHash } from "crypto";
import { PreflightResult } from "./nickgptPreflightGuard";

export type NexusAuditSampleReason =
  | "preflight_flag"
  | "low_confidence"
  | "human_review"
  | "risky_autosent"
  | "operator_feedback"
  | "generation_failed"
  | "complaint_after_autosend"
  | "baseline_sample"
  | "autosent_sample"
  | "template_sample"
  | "manual"
  | "skipped";

export type NexusAuditSamplingDecision = {
  shouldAudit: boolean;
  sampleReason: NexusAuditSampleReason;
  priority: number;
  reasonCode: string;
};

export type NexusAuditSamplingInput = {
  phoneLast4?: string;
  eventType: string;
  body: string;
  variantKey: string;
  sourceType: "deterministic_template" | "nickgpt" | "manual" | "legacy";
  confidence?: number;
  requiresHumanApproval?: boolean;
  autoSent?: boolean;
  preflight?: PreflightResult;
  status?: string;
  isTestNumber?: boolean;
  isReplayDryRun?: boolean;
  idempotencyKey?: string;
  correlationId?: string;
  orchestrationId?: string | number;
  nickgptDraftId?: string | number;
  sampleRates?: {
    baseline: number;
    autosent: number;
    template: number;
  };
  hashToUnitInterval?: (seed: string) => number;
};

/**
 * Deterministic hash-based sampling
 * Returns a value between 0 and 1
 */
function defaultHashToUnitInterval(seed: string): number {
  const hash = createHash("md5").update(seed).digest("hex");
  // Take first 8 chars (32 bits) and divide by max 32-bit int
  return parseInt(hash.slice(0, 8), 16) / 0xffffffff;
}

export function shouldAuditMessage(input: NexusAuditSamplingInput): NexusAuditSamplingDecision {
  const {
    phoneLast4 = "0000",
    variantKey,
    sourceType,
    confidence = 1.0,
    requiresHumanApproval = false,
    preflight,
    status,
    isTestNumber = false,
    isReplayDryRun = false,
    idempotencyKey,
    orchestrationId,
    nickgptDraftId,
    sampleRates = { baseline: 0.10, autosent: 0.50, template: 0.05 },
    hashToUnitInterval = defaultHashToUnitInterval,
  } = input;

  // 1. Skip Rules
  if (isTestNumber) {
    return { shouldAudit: false, sampleReason: "skipped", priority: 0, reasonCode: "test_number" };
  }
  if (isReplayDryRun && !preflight?.shouldEnqueueNexusAudit) {
    return { shouldAudit: false, sampleReason: "skipped", priority: 0, reasonCode: "replay_dry_run" };
  }
  if (!input.body || input.body.trim() === "") {
    return { shouldAudit: false, sampleReason: "skipped", priority: 0, reasonCode: "empty_body" };
  }
  const isStop = /^(stop|unsubscribe|cancel)$/i.test(input.body.trim());
  if (isStop) {
    return { shouldAudit: false, sampleReason: "skipped", priority: 0, reasonCode: "stop_message" };
  }
  if ((status === "blocked" || status === "skipped" || status === "drafted") && !preflight?.shouldEnqueueNexusAudit) {
    return { shouldAudit: false, sampleReason: "skipped", priority: 0, reasonCode: "not_sent_and_not_flagged" };
  }

  // 2. Always Audit Rules (100%)
  if (preflight && preflight.shouldEnqueueNexusAudit) {
    const priority = preflight.severity === "critical" || preflight.severity === "high" ? 1 : 2;
    return { shouldAudit: true, sampleReason: "preflight_flag", priority, reasonCode: preflight.reasonCode };
  }
  if (requiresHumanApproval) {
    return { shouldAudit: true, sampleReason: "human_review", priority: 2, reasonCode: "requires_approval" };
  }
  if (confidence < 0.85 && sourceType === "nickgpt") {
    return { shouldAudit: true, sampleReason: "low_confidence", priority: 1, reasonCode: "low_model_confidence" };
  }
  if (status === "failed" && sourceType === "nickgpt") {
    return { shouldAudit: true, sampleReason: "generation_failed", priority: 1, reasonCode: "failed_generation_or_send" };
  }

  const complaintRegex = /\b(lawyer|sue|police|fraud|scam|attorney|report|refund)\b/i;
  if (complaintRegex.test(input.body)) {
    return { shouldAudit: true, sampleReason: "complaint_after_autosend", priority: 1, reasonCode: "complaint_regex_match" };
  }

  // 3. Deterministic Sampling
  // Construct a stable seed for hashing so repeated evaluations of the same event yield the same result
  const seedParts = [
    orchestrationId || "no_orch",
    nickgptDraftId || "no_draft",
    idempotencyKey || "no_idemp",
    variantKey,
    phoneLast4
  ];
  const seed = seedParts.join(":");
  const rand = hashToUnitInterval(seed);

  // NickGPT auto-sent
  if (sourceType === "nickgpt") {
    if (rand < sampleRates.autosent) {
      return { shouldAudit: true, sampleReason: "autosent_sample", priority: 3, reasonCode: "random_nickgpt_sample" };
    }
  } else if (sourceType === "deterministic_template") {
    if (rand < sampleRates.template) {
      return { shouldAudit: true, sampleReason: "template_sample", priority: 4, reasonCode: "random_template_sample" };
    }
  } else {
    // Legacy / Manual
    if (rand < sampleRates.baseline) {
      return { shouldAudit: true, sampleReason: "baseline_sample", priority: 4, reasonCode: "random_baseline_sample" };
    }
  }

  return { shouldAudit: false, sampleReason: "skipped", priority: 0, reasonCode: "passed_without_audit" };
}
