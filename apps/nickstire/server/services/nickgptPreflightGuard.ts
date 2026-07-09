/**
 * NickGPT Deterministic Preflight Guard
 */

import { BUSINESS } from "@shared/business";

export type PreflightSourceType =
  | "deterministic_template"
  | "nickgpt"
  | "manual"
  | "legacy";

export type PreflightSeverity =
  | "none" // We use none internally but the contract requires low/medium/high/critical. Actually, the user said "Do not use severity: none". So we won't use "none".
  | "low"
  | "medium"
  | "high"
  | "critical";

export type PreflightAction =
  | "allow"
  | "force_human_review"
  | "block_send"
  | "allow_and_async_audit";

export type PreflightFinding = {
  code: string;
  message: string;
  matchedText?: string;
};

export type PreflightParams = {
  eventType: string;
  candidateBody: string;
  inboundMessage?: string;
  detectedIntent?: string;
  confidence?: number;
  riskTier?: "low" | "medium" | "high";
  customerContext?: unknown;
  selectedTemplateKey?: string;
  selectedVariantKey?: string;
  provider?: string;
  sourceType: PreflightSourceType;
};

export type PreflightResult = {
  allowed: boolean;
  severity: PreflightSeverity;
  reasonCode: string;
  findings: PreflightFinding[];
  action: PreflightAction;
  shouldEnqueueNexusAudit: boolean;
};

// Extracted from common business constants (or fallback if missing)
const APPROVED_DOMAINS = ["nickstire.org", "bdnick.info"];
const APPROVED_PHONES = [BUSINESS.phone.raw, "2168620005", "216-862-0005", "(216) 862-0005"];

export function runNickgptPreflightGuard(params: PreflightParams): PreflightResult {
  const { candidateBody, sourceType } = params;
  
  const findings: PreflightFinding[] = [];
  let severity: PreflightSeverity | null = null;
  let action: PreflightAction = "allow";
  let shouldEnqueueNexusAudit = false;

  const lowerBody = candidateBody.toLowerCase();

  // Rule 1: Toxicity (Critical)
  const toxicRegex = /\b(fuck|shit|bitch|asshole|cunt|slut|whore|fag)\b/i;
  const toxicMatch = candidateBody.match(toxicRegex);
  if (toxicMatch) {
    findings.push({ code: "toxicity_detected", message: "Toxic or abusive language detected.", matchedText: toxicMatch[0] });
    severity = "critical";
  }

  // Rule 2: Unresolved template variables (Critical)
  const templateVarRegex = /(\{\w+\}|\$\{\w+\})/i;
  const templateVarMatch = candidateBody.match(templateVarRegex);
  if (templateVarMatch) {
    findings.push({ code: "unresolved_template_variables", message: "Message contains raw template variables.", matchedText: templateVarMatch[0] });
    severity = severity === "critical" ? "critical" : "high";
  }

  // Rule 3: Absolute language & promises (Medium/High)
  const absoluteRegex = /\b(guarantee|guaranteed|100%|always|never|definitely|for sure|cheapest|best price)\b/i;
  const absoluteMatch = candidateBody.match(absoluteRegex);
  if (absoluteMatch) {
    // "Always" and "never" can be benign ("we always recommend..."). But "guarantee" / "100%" are riskier.
    const word = absoluteMatch[0].toLowerCase();
    if (word === "guarantee" || word === "guaranteed" || word === "100%" || word === "cheapest" || word === "best price") {
      findings.push({ code: "prohibited_absolute_promise", message: "Found prohibited absolute promise.", matchedText: absoluteMatch[0] });
      severity = severity === "critical" ? "critical" : "high";
    } else {
      findings.push({ code: "flagged_absolute_language", message: "Found absolute language that requires review.", matchedText: absoluteMatch[0] });
      if (!severity) severity = "medium";
    }
  }

  // Rule 4: Legal / lawsuit / fraud language (High)
  const legalRegex = /\b(refund|warranty|legal|lawsuit|fraud|police|threat)\b/i;
  const legalMatch = candidateBody.match(legalRegex);
  if (legalMatch) {
    findings.push({ code: "prohibited_legal_language", message: "Found high-risk legal/fraud/refund language.", matchedText: legalMatch[0] });
    severity = severity === "critical" ? "critical" : "high";
  }

  // Rule 5: Unguaranteed dollar amounts (High)
  // If we see $\d+, ensure words like "estimate", "about", "starting", "starts", "quote" are nearby.
  const dollarRegex = /\$\d+(\.\d{2})?/g;
  const dollars = candidateBody.match(dollarRegex);
  if (dollars && sourceType === "nickgpt") {
    const mitigatingWords = /\b(estimate|about|starting|starts|quote|around|approximate|approximately)\b/i;
    if (!mitigatingWords.test(lowerBody)) {
      findings.push({ code: "unguaranteed_dollar_amount", message: "Exact dollar amount specified without estimate qualifier.", matchedText: dollars.join(", ") });
      severity = severity === "critical" ? "critical" : "high";
    }
  }

  // Rule 6: Diagnostic certainty (High)
  const diagnosticRegex = /\b(definitely your|is definitely|must be your|100% your)\b/i;
  const diagnosticMatch = candidateBody.match(diagnosticRegex);
  if (diagnosticMatch) {
    findings.push({ code: "unsupported_diagnostic_certainty", message: "Message diagnoses vehicle issues with absolute certainty.", matchedText: diagnosticMatch[0] });
    severity = severity === "critical" ? "critical" : "high";
  }

  // Rule 7: Unsupported Free Offers (High)
  // "free quick check" is our brand standard. But "free" paired with "tire", "oil", "service" is bad.
  const freeRegex = /\bfree\b/i;
  if (freeRegex.test(lowerBody)) {
    if (!lowerBody.includes("free quick check") && !lowerBody.includes("free check")) {
      findings.push({ code: "unsupported_free_offer", message: "Message offers free item not matching approved templates." });
      severity = severity === "critical" ? "critical" : "high";
    }
  }

  // Rule 8: Safety Certainty (High)
  const safetyRegex = /\b(completely safe|perfectly safe|safe to drive|no risk)\b/i;
  const safetyMatch = candidateBody.match(safetyRegex);
  if (safetyMatch) {
    findings.push({ code: "unsupported_safety_certainty", message: "Message provides unsupported vehicle safety assurances.", matchedText: safetyMatch[0] });
    severity = severity === "critical" ? "critical" : "high";
  }

  // Rule 9: Formatting Leakage (Medium)
  const markdownRegex = /(```|\*\*|__|# )/;
  const markdownMatch = candidateBody.match(markdownRegex);
  if (markdownMatch && sourceType === "nickgpt") {
    findings.push({ code: "formatting_leakage", message: "Raw markdown detected in SMS.", matchedText: markdownMatch[0] });
    if (!severity) severity = "medium";
  }

  // Rule 10: Length / Segment Overflow Risk (Low)
  if (candidateBody.length > 500) {
    findings.push({ code: "length_exceeded", message: `Message exceeds 500 chars (${candidateBody.length}).` });
    if (!severity) severity = "low";
  }

  // Rule 11: Hallucinated URLs or Phones (Medium)
  const urlRegex = /https?:\/\/[^\s]+/gi;
  const urls = candidateBody.match(urlRegex);
  if (urls) {
    for (const url of urls) {
      if (!APPROVED_DOMAINS.some(d => url.includes(d))) {
        findings.push({ code: "hallucinated_url", message: "Unapproved URL found.", matchedText: url });
        if (!severity) severity = "medium";
      }
    }
  }

  const phoneRegex = /\b\d{3}[-\.\s]?\d{3}[-\.\s]?\d{4}\b/g;
  const phones = candidateBody.match(phoneRegex);
  if (phones) {
    for (const p of phones) {
      const pNorm = p.replace(/\D/g, "");
      if (!APPROVED_PHONES.some(approved => approved.replace(/\D/g, "") === pNorm)) {
        findings.push({ code: "hallucinated_phone", message: "Unapproved phone number found.", matchedText: p });
        if (!severity) severity = "medium";
      }
    }
  }

  // Final Action Resolution
  let reasonCode = "passed_heuristics";
  
  if (severity === "critical" || severity === "high") {
    action = "block_send";
    shouldEnqueueNexusAudit = true;
    reasonCode = findings[0].code;
  } else if (severity === "medium") {
    action = "force_human_review";
    shouldEnqueueNexusAudit = true;
    reasonCode = findings[0].code;
  } else if (severity === "low") {
    action = "allow_and_async_audit";
    shouldEnqueueNexusAudit = true;
    reasonCode = "length_warning_or_low_risk";
  } else {
    // If no findings, it's allowed.
    severity = "low"; // fallback valid severity to fulfill contract
    action = "allow";
    shouldEnqueueNexusAudit = false;
  }

  return {
    allowed: action === "allow" || action === "allow_and_async_audit",
    severity,
    reasonCode,
    findings,
    action,
    shouldEnqueueNexusAudit
  };
}
