import type { StrategicFramework } from "../types";

/**
 * 5 Whys (Toyota) — root-cause analysis by asking "why?" five times.
 * Surface symptoms get fixed at the root, not patched. Pairs with
 * systematic-debugging but is sharper for human/operational issues.
 */
export const fiveWhys: StrategicFramework = {
  id: "five-whys",
  name: "5 Whys (Toyota Production System)",
  oneLiner: "Ask 'why?' 5 times to drill from symptom to root cause. Surface fixes are patches · root fixes are durable.",
  triggers: [
    /\bfive\s+whys|5\s+whys\b/i,
    /\b(root\s+cause(\s+analysis)?|rca)\b/i,
    /\b(toyota\s+production\s+system|tps)\b/i,
    /\b(why\s+(is|are|do|does)\s+this\s+(keep\s+happening|recurring))/i,
    /\b(symptom\s+vs\s+(cause|root))\b/i,
    /\b(actually\s+causing|real\s+cause|underlying\s+cause)/i,
    /\b(stop[\s-]?gap|patch|band[\s-]?aid)\s+(fix|solution)/i,
  ],
  weight: 0.95,
  lens: `Apply 5 Whys. Surface problems are usually downstream of a root
cause that isn't obvious. Ask "why?" five times (sometimes 3,
sometimes 7 · five is the round-number heuristic) to drill until
you hit something you can change.

Example · the customer cancelled their oil change.
  Why? · They said the price was too high.
  Why? · They saw a coupon at the dealership for /less.
  Why? · We stopped sending out coupons in March.
  Why? · We thought our reviews would carry the price gap.
  Why? · We never actually tested what the gap could be before
        the customer left.

Root · we don't have a price-elasticity test · not "the dealership
has cheaper coupons." If we patch only the surface (match the
coupon), we leave the root cause in place and it shows up
elsewhere.

CRITICAL caveat · 5 Whys is often misused as a blame ladder ·
"why did Joe miss the deadline" → "because Joe is unreliable."
That's not a root cause · that's just blaming a person. The valid
question is "why did the SYSTEM allow this?" · was there no
deadline check · was the timeline unrealistic · was Joe overloaded
· was the spec ambiguous? Fix the system, not the person.

Apply to · recurring complaints · process failures · customer
churn · missed deadlines · quality defects.

Surface · the 5-deep cause chain · the SYSTEMIC fix at the root ·
not just the surface-level patch.`,
};
