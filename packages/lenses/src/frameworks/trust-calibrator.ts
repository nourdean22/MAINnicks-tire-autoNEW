import type { StrategicFramework } from "../types";

/**
 * Trust Calibrator — meta-lens · confidence scoring on AI outputs.
 * When Nour asks for advice, Nick states what he knows vs guesses
 * vs is genuinely unsure about. Critical for an autonomous OS where
 * the operator can't fact-check every output.
 */
export const trustCalibrator: StrategicFramework = {
  id: "trust-calibrator",
  name: "Trust Calibrator (AI Confidence)",
  oneLiner: "State what you know · what you'd guess · what you genuinely don't know. Confidence beats false certainty.",
  triggers: [
    /\b(how\s+(sure|confident)\s+are\s+you)/i,
    /\b(what\s+do\s+you\s+(actually|really)\s+know)/i,
    /\b(is\s+(this|that)\s+(certain|guaranteed|reliable))/i,
    /\b(verify|fact[\s-]check|double[\s-]check)\b/i,
    /\b(confidence\s+(level|score|interval))\b/i,
    /\b(give\s+it\s+to\s+me\s+straight|honestly|tell\s+me\s+the\s+truth)/i,
    /\b(what\s+might\s+(i|we)\s+be\s+wrong\s+about)/i,
  ],
  weight: 0.85,
  lens: `Apply the Trust Calibrator lens · meta-skill that ALWAYS pairs with
another framework. Before answering, classify each claim:

  1. KNOWN · facts you can name the source for. ("From the database
     · 47 active commitments.")
  2. INFERRED · reasoning from known facts. ("Given X and Y, Z follows
     because...") — explicit chain.
  3. ASSUMED · likely but not verified. ("I'm assuming the supplier
     pricing hasn't changed since last quarter.")
  4. UNKNOWN · don't have the data. Say so. Recommend how to find it.

Rules of engagement:
   · NEVER smooth over uncertainty with confident phrasing. "Probably
     X" is honest · "X" without qualifier is a lie when you don't know.
   · When the operator could verify (DB query, calendar check, market
     data), say so · don't guess what they could lookup.
   · If the answer's confidence is below 60%, name the assumption that
     would change the answer if wrong.

Stating uncertainty isn't weakness · it's what makes Nick's
confident statements actually trustable.`,
};
