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

// Every dollar figure the SSOT actually states for conversational channels,
// harvested from BUSINESS at module load so a price change there flows here
// automatically. NickGPT may not text any amount outside this set.
const APPROVED_AMOUNTS: Set<number> = (() => {
  const amounts = new Set<number>();
  const scan = (v: unknown) => {
    if (typeof v === "string") {
      for (const m of v.matchAll(/\$(\d+)/g)) amounts.add(Number(m[1]));
    } else if (v && typeof v === "object") {
      for (const inner of Object.values(v as Record<string, unknown>)) scan(inner);
    }
  };
  scan(BUSINESS.oilChange);
  scan(BUSINESS.usedTires);
  scan((BUSINESS as Record<string, unknown>).newTires);
  scan((BUSINESS as Record<string, unknown>).financing);
  return amounts;
})();

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

  // Rule 4: Legal / lawsuit / fraud language (High) — ROS-058 split: "warranty"
  // used to sit in this list, so a CORRECT, fact-grounded warranty answer (the
  // drafter is HANDED the invoice warranty facts precisely so it can answer)
  // was blocked merely for containing the topic the customer asked about.
  // Disputes/refunds/legal threats stay hard-blocked; a bare warranty mention
  // downgrades to human review — never auto-blocked, never auto-sent unreviewed.
  const legalRegex = /\b(refund|lawsuit|legal|fraud|police|threat|sue|suing)\b/i;
  const legalMatch = candidateBody.match(legalRegex);
  if (legalMatch) {
    findings.push({ code: "prohibited_legal_language", message: "Found high-risk legal/fraud/refund language.", matchedText: legalMatch[0] });
    severity = severity === "critical" ? "critical" : "high";
  } else if (/\bwarranty\b/i.test(candidateBody) && sourceType === "nickgpt") {
    findings.push({ code: "warranty_mention_review", message: "Warranty statement requires operator review (facts allowed, disputes are not)." });
    if (severity !== "critical" && severity !== "high") severity = "medium";
  }

  // Rule 5: Dollar amounts must be APPROVED amounts (High) — ROS-058: the old
  // rule accepted any figure that sat near a qualifier word, so "about $899"
  // passed while being pure invention. A NickGPT-sourced amount must now match
  // a price that actually exists in the BUSINESS SSOT (oil $49/$80, used-tire
  // floor $25, band $40-$80, typical $60). Anything else blocks regardless of
  // how it is hedged.
  const dollarRegex = /\$(\d+)(\.\d{2})?/g;
  const dollars = [...candidateBody.matchAll(dollarRegex)];
  if (dollars.length && sourceType === "nickgpt") {
    for (const m of dollars) {
      const amount = Number(m[1]);
      if (!APPROVED_AMOUNTS.has(amount)) {
        findings.push({ code: "unapproved_dollar_amount", message: "Dollar amount is not an approved shop price.", matchedText: m[0] });
        severity = severity === "critical" ? "critical" : "high";
        break;
      }
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

  // Rule 10: Length (ROS-058) — three limits used to disagree: the persona says
  // under 320 chars, the model budget was 320 TOKENS (~4x more text), and this
  // guard only warned past 500. Now aligned to the persona contract: a NickGPT
  // reply past 320 chars goes to human review; past 480 (past 3 GSM segments
  // for most bodies) it blocks. Templates keep the soft 500 warning.
  if (sourceType === "nickgpt" && candidateBody.length > 480) {
    findings.push({ code: "length_blocked", message: `NickGPT reply far exceeds the SMS contract (${candidateBody.length} chars > 480).` });
    severity = severity === "critical" ? "critical" : "high";
  } else if (sourceType === "nickgpt" && candidateBody.length > 320) {
    findings.push({ code: "length_review", message: `NickGPT reply exceeds the 320-char persona contract (${candidateBody.length} chars).` });
    if (severity !== "critical" && severity !== "high") severity = "medium";
  } else if (candidateBody.length > 500) {
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
