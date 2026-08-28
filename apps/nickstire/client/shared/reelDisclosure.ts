/**
 * Disclosure gate for reel packs.
 *
 * TWO RULES, both hard failures. A pack that trips either one must not publish.
 *
 * RULE 1 - GENERATED FOOTAGE MAY NOT BE FRAMED AS REAL EVIDENCE.
 * AI-generated video presented as a real customer incident, a repair we
 * performed, a test we ran, or a before/after is a fabricated claim about the
 * shop's own work. It is the automotive equivalent of inventing a receipt, it
 * is made under the shop's name, and no engagement number justifies it.
 *
 * RULE 2 - GENERATED PHOTOREALISTIC VIDEO MUST CARRY AN AI DISCLOSURE.
 * Verified against Meta's own policy 2026-08-28: Meta "requires people to use a
 * disclosure and label tool when they post organic content with a photorealistic
 * video or realistic-sounding audio that was digitally created or altered, and
 * may apply penalties if they fail to do so." So an undisclosed generated reel
 * is a platform-policy violation as well as an honesty one.
 *
 * Pure and exported so the canary drives real behaviour with fixtures, including
 * a positive control - a gate that fails everything is worth nothing.
 */

/** Video providers whose output is synthetic. */
export const GENERATIVE_PROVIDERS = [
  "higgsfield",
  "veo",
  "seedance",
  "kling",
  "wan",
  "sora",
  "gemini",
  "hailuo",
  "minimax",
  "runway",
  "pika",
];

/**
 * Framings that assert the footage documents something real that happened at,
 * or was performed by, the shop. Deliberately matched on the CLAIM, not on
 * topic words - "how to check tread depth" is educational and fine; "this
 * customer's tread was down to the wear bars" is a claim about a real event.
 */
const REAL_EVIDENCE_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "real-customer", re: /\b(this|a|our|the)\s+(customer|client|driver|car|truck|vehicle)\s+(came|brought|pulled|rolled|drove)\b/i },
  { id: "customer-possessive", re: /\b(this|a)\s+(customer|client)('s|s')\b/i },
  { id: "we-performed-repair", re: /\b(we|our tech|our techs|the tech)\s+(fixed|repaired|replaced|swapped|rebuilt|installed)\b/i },
  { id: "we-tested", re: /\b(we|our team)\s+(tested|measured|ran a test|put .* to the test)\b/i },
  { id: "before-after", re: /\bbefore\s*(and|\/|\+|vs\.?|versus)\s*after\b/i },
  { id: "before-after-possessive", re: /\b(here'?s|this is)\s+the\s+(before|after)\b/i },
  { id: "came-into-shop", re: /\b(came|walked|rolled)\s+(in|into)\s+(the|our)\s+(shop|bay|store)\b/i },
  { id: "caught-on-camera", re: /\b(caught on (camera|video)|actual footage|real footage|security cam)\b/i },
  { id: "this-happened", re: /\b(this|it)\s+(happened|actually happened)\b/i },
  { id: "in-our-bay", re: /\b(in|from)\s+(our|the)\s+(bay|shop|lift|garage)\s+(today|yesterday|this week|last week)\b/i },
];

/** Tokens that count as an AI disclosure somewhere in the pack's copy. */
const DISCLOSURE_PATTERNS = [
  /\bAI[- ]generated\b/i,
  /\bgenerated with AI\b/i,
  /\bAI visuali[sz]ation\b/i,
  /\bAI illustration\b/i,
  /\bmade with AI\b/i,
  /\bsimulated\b/i,
  /\billustrative\b/i,
  /\bdramati[sz]ation\b/i,
];

export interface DisclosurePack {
  /** Pack identifier for the failure message. */
  id: string;
  /** Video provider, if any clip is model-generated. */
  videoProvider?: string | null;
  /** Explicit flag when the pack knows its footage is synthetic. */
  hasGeneratedVideo?: boolean;
  /** Caption, script, on-screen text - everything the viewer reads or hears. */
  copy: string;
  /** Set when the pack carries a machine-checked disclosure label. */
  disclosureLabel?: string | null;
}

/** True when any clip in the pack is model-generated. */
export function isGenerated(pack: DisclosurePack): boolean {
  if (pack.hasGeneratedVideo) return true;
  const p = (pack.videoProvider ?? "").toLowerCase().trim();
  if (!p) return false;
  return GENERATIVE_PROVIDERS.some((g) => p.includes(g));
}

/** True when the pack's copy or label discloses the footage is synthetic. */
export function hasDisclosure(pack: DisclosurePack): boolean {
  const hay = `${pack.copy ?? ""} ${pack.disclosureLabel ?? ""}`;
  return DISCLOSURE_PATTERNS.some((re) => re.test(hay));
}

/** Which real-evidence framings the copy asserts. Empty when it asserts none. */
export function realEvidenceClaims(copy: string): string[] {
  const text = copy ?? "";
  return REAL_EVIDENCE_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.id);
}

/**
 * The judge: null when the pack may publish, otherwise the operator-facing
 * reason it must not. A refusal is a VALUE, not a throw, so the pack can record
 * exactly why it is blocked instead of failing into UNKNOWN.
 */
export function disclosureViolation(pack: DisclosurePack): string | null {
  const generated = isGenerated(pack);
  if (!generated) return null;

  const claims = realEvidenceClaims(pack.copy);
  if (claims.length > 0) {
    return (
      `BLOCKED_AI_PRESENTED_AS_REAL: pack "${pack.id}" contains model-generated video ` +
      `(provider: ${pack.videoProvider ?? "flagged"}) while its copy claims real evidence [${claims.join(", ")}]. ` +
      "Generated footage may never be framed as a real customer, repair, test, or before/after. " +
      "Fix: either shoot the real footage, or rewrite the copy so it makes no claim about a real event."
    );
  }

  if (!hasDisclosure(pack)) {
    return (
      `BLOCKED_MISSING_AI_DISCLOSURE: pack "${pack.id}" contains model-generated video ` +
      "but carries no AI disclosure. Meta requires a disclosure on organic photorealistic " +
      "generated video or realistic audio and may penalise its absence. " +
      "Fix: add an explicit AI-generated label to the caption."
    );
  }

  return null;
}
