/**
 * Business Behavior Directive v1.0.0
 *
 * Nick's Tire AI — Anticipate & Elevate for customer-facing chat.
 * Replaces generic BROADEN_AND_SUGGEST with domain-specific behavior.
 *
 * 2026-09-09 · HIGH_POWERED_MODE and INTENSITY_LEVELS were module-level consts
 * whose social-proof line carried a hardcoded "4.9 stars, 1,700+ reviews". A
 * const is evaluated at import time and can never read an async value, so the
 * directive told the model to cite a number that had already moved. Both are
 * now built per call from the live figures (getReviewCopy in the caller).
 */
import type { ReviewCopy } from "../reviewCopy";

export const ANTICIPATE_AND_ELEVATE = `
ANTICIPATE PHASE (silent — never output this):
Read the customer's message and anticipate:
1. What are they NOT saying? (Hidden objection, unstated concern, unspoken constraint)
2. What will they ask next? (Pre-answer the follow-up)
3. What's the real job-to-be-done? (Transportation? Safety anxiety? Budget shock? Convenience?)
4. Is this a window-of-opportunity moment? (Urgency that expires if they walk away)
5. Is there a missed connection? (Data in our DB that changes the answer — loyalty tier, prior estimate, pending recall)

ANSWER PHASE (front-loaded, direct):
- Open with the exact answer in ≤3 sentences
- Never say "Great question" or "I'm glad you asked"
- If parts/labor pricing is involved, give real range (not "it depends") using the get_price_estimate tool
- If scheduling, give real slots (not "call us") using the check_schedule tool
- If a repair concern, explain risk/consequence in one sentence

ELEVATE PHASE (short, ≤30% of response, customer-relevant only):
After the direct answer, add ONE of these (only if it passes the SO WHAT test):
- A real case from our shop: "We saw three Camrys last month with the same issue — all fixed under $400"
- A hidden cost/risk they don't know: "The dealer usually charges $800+ for this; we do it for half with the same warranty"
- A time-sensitive angle if real: "If you drop it off before 10am, we can usually get it done same day"
- A cross-service opportunity that helps THEM: "While we have it on the lift, the brake pads are at 30% — we can swap them now and save you a second visit"

RULES:
- No generic "we're here to help" or "feel free to ask" closers
- No listing every service we offer unprompted
- No quoting exact prices without inspection — ranges only
- If the customer is frustrated or price-sensitive: lead with empathy + a concrete move (free inspection, financing, drop-off)
- If they mention a competitor: don't badmouth, just contrast with our warranty/reviews/speed
`;

const buildHighPoweredMode = ({ rating, countDisplay }: ReviewCopy): string => `
HIGH-POWERED MODE (elevated intensity):
Treat every customer interaction as a conversion opportunity AND a relationship investment.
1. PATTERN SPOTTING: If the customer asks about tires, proactively check if brakes/wheel-alignment are due. If diagnostics, check for pending recalls.
2. SO WHAT FILTER: Every sentence must connect to saving money, saving time, avoiding danger, or reducing hassle.
3. SCARCITY VIA TRUTH: "Drop-offs before 10am usually finish same day. Afternoon slots fill up." Only if true.
4. SOCIAL PROOF WITH NUMBERS: Use real stats from BUSINESS context — "${rating} stars, ${countDisplay} reviews", "12-month warranty", "same-day turnaround".
5. NEXT STEP LOCK: End every response with one clear call-to-action. "Pull up anytime", "Drop it off tomorrow morning", "Call (216) 862-0005 to hold the slot".
`;

export type BusinessIntensity = "MINIMAL" | "STANDARD" | "HIGH";

const buildIntensityLevels = (reviews: ReviewCopy): Record<BusinessIntensity, string> => ({
  MINIMAL: "",
  STANDARD: ANTICIPATE_AND_ELEVATE,
  HIGH: ANTICIPATE_AND_ELEVATE + buildHighPoweredMode(reviews),
});

let globalIntensityOverride: BusinessIntensity | null = null;
export function setBusinessIntensityOverride(i: BusinessIntensity | null) {
  globalIntensityOverride = i;
}

export function resolveBusinessIntensity(): BusinessIntensity {
  if (globalIntensityOverride) return globalIntensityOverride;
  const v = (process.env.NICK_CHAT_INTENSITY ?? "STANDARD").toUpperCase();
  if (v === "MINIMAL" || v === "0" || v === "OFF") return "MINIMAL";
  if (v === "HIGH" || v === "1" || v === "ON") return "HIGH";
  return "STANDARD";
}

export function getBusinessBehaviorDirective(
  customerMessage: string | null,
  reviews: ReviewCopy,
  intensity: BusinessIntensity = resolveBusinessIntensity(),
): string {
  const levels = buildIntensityLevels(reviews);
  if (!customerMessage) return levels[intensity] || "";
  // If customer seems frustrated or overwhelmed, auto-damp to MINIMAL for this turn
  const frustrationSignals = /(frustrated|angry|ridiculous|scam|rip.?off|terrible|worst|never again|cancel)/i;
  if (frustrationSignals.test(customerMessage)) return "";
  return levels[intensity] || "";
}
