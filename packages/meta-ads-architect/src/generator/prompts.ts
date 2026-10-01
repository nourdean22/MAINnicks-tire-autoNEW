import { CampaignInput } from "../schemas/input.js";

/**
 * Business facts are NEVER typed into this file. Three copies of a retired
 * warranty (a "12-month / 12k-mile" line) lived here, in the preset and in the
 * deterministic fallback until 2026-10-01, months after the shop's SSOT
 * corrected it to parts 1-year / labor 90-day with no mileage warranty — and
 * paid-ad copy was generated from the stale line. Facts arrive on the input:
 * `businessFacts.factsBlock` (compiled by the app from its SSOT) when present,
 * otherwise only the fact-bearing input fields the caller filled in.
 */
export function renderBusinessFacts(input: CampaignInput): string {
  if (input.businessFacts?.factsBlock) {
    return `BUSINESS FACTS (compiled ${input.businessFacts.compiledAt} from ${input.businessFacts.source} — use freely, accurately, never extend):\n${input.businessFacts.factsBlock}`;
  }
  const lines: string[] = [];
  const where = [input.constraints.businessAddress, input.offer.serviceArea].filter(Boolean).join(" · ");
  if (where) lines.push(`- Location / service area: ${where}`);
  if (input.constraints.phoneNumber) lines.push(`- Phone: ${input.constraints.phoneNumber}`);
  lines.push(input.offer.appointmentRequired === false
    ? "- Walk-ins welcome, no appointment needed, first come first serve."
    : "- Appointment policy: as stated by the caller; do not invent walk-in or same-day claims.");
  lines.push(`- Warranty / guarantee terms (verbatim, never extend): ${input.priceStack.guaranteeOrRefundTerms}`);
  if (input.priceStack.financingAvailable) {
    lines.push(`- Payment programs: ${input.priceStack.paymentMethods ?? "available — describe only as 'payment programs', never 'financing', never promise approval"}.`);
  }
  if (input.assetsAndProof.realReviewSources) lines.push(`- Review sources: ${input.assetsAndProof.realReviewSources}`);
  if (input.assetsAndProof.forbiddenProofClaims) lines.push(`- Forbidden proof claims: ${input.assetsAndProof.forbiddenProofClaims}`);
  return `BUSINESS FACTS (from the campaign input only — if a fact is not listed here, it does not exist):\n${lines.join("\n")}`;
}

export function buildCreativeSystemPrompt(input: CampaignInput): string {
  const forbidden = (input.constraints.forbiddenWords ?? []).map((w) => `"${w}"`).join(", ");
  return `You are a senior Meta Ads creative strategist and copywriter for an auto repair shop (${input.constraints.businessAddress ? "Nick's Tire & Auto, " + input.constraints.businessAddress : "Nick's Tire & Auto"}).
Your job is to generate the creative strategy and ad copy bundles for a specific campaign.
It will be BOOSTED with real ad spend, so every word must convert and every claim must be true.

${renderBusinessFacts(input)}
${forbidden ? `\nADDITIONAL FORBIDDEN WORDS (from the brief): ${forbidden}\n` : ""}
${input.organicEvidence ? `\n${input.organicEvidence.block}\nUSE IT AS: a validated customer tension and hook family to derive a DIRECT-RESPONSE variant from. Do not reuse organic captions; organic reach is not ad conversion.\n` : ""}
CAMPAIGN INPUT:
- Offer: ${input.offer.productOrServiceName} (${input.offer.primaryOutcome})
- Audience: ${input.audience.whoItIsFor} (${input.audience.painPoints})
- Core Price: ${input.priceStack.corePrice}

HARD CLAIM-SAFETY RULES:
- BANNED words: quality, premium, luxury, tier, trusted, best, perfect, guaranteed, #1, cheapest, lowest price.
- "free" only as a real free check ("free tire check", "free brake check", "free alignment check", "free quick check", "free safety check", "free battery check").
- No fake scarcity/urgency (e.g., "only 1 left", "ends in 5 minutes").
- No guaranteed outcomes: never promise a crash-free car or an E-Check result.
- No personal-attribute language ("your brakes are dangerous", "you are").
- Plain text only — never HTML entities (&amp;), use a literal &.

You are generating ONLY the creative-heavy sections:
- customerPsychologyMap
- adCopyFactory (5 bundles)
- creativeTestingLab
- creativePrompts
- landingPageSystem

Output ONLY one JSON object matching the requested schema. No prose, no markdown formatting blocks outside the JSON.`;
}

export function extractJsonObject(text: string): unknown {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("LLM returned empty or non-string response");
  }

  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();

  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    s = s.slice(first, last + 1);
  }

  return JSON.parse(s);
}
