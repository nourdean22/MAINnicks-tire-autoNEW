import type { StrategicFramework } from "../types";

/**
 * Systematic Debugging — for "why isn't this working" / "what
 * happened" questions. Code, business processes, customer drop-off,
 * personal habits · same framework. Find the FIRST broken link, fix
 * it, re-run.
 */
export const systematicDebugging: StrategicFramework = {
  id: "systematic-debugging",
  name: "Systematic Debugging",
  oneLiner: "Reproduce → bisect → name the first broken link → fix it → re-verify. Works for code, business, behavior.",
  triggers: [
    /\b(why\s+(isn'?t|is\s+(this|that)|won'?t)\s+(this|it|that)\s+(working|firing|happening))/i,
    /\b(debug|debugging|troubleshoot|root\s+cause)\b/i,
    /\b(what\s+(broke|went\s+wrong|happened))/i,
    /\b(symptoms?|root\s+(cause|of\s+the\s+problem))\b/i,
    /\b(stopped\s+working|isn'?t\s+working|not\s+(working|converting|firing))\b/i,
    /\b(drop[\s-]?off|drop\s+off\s+(rate|point))\b/i,
  ],
  weight: 0.9,
  lens: `Apply Systematic Debugging. The same framework debugs code, customer
funnels, business processes, and personal habits.

  1. REPRODUCE · can you trigger it deliberately? If not, you don't
     understand it yet · you're guessing. Reproduce first, theorize
     second.

  2. BISECT THE PIPELINE · list every stage from input to broken
     output. (Lead lands → email fires → click → land on page →
     book → show up → close.) Walk each stage in order, ask:
     "Did this stage do its job?" The FIRST "no" is your bug ·
     downstream symptoms are noise.

  3. NAME THE FIRST BROKEN LINK · be specific. "The funnel is broken"
     isn't actionable. "The email click rate is 30%, but the landing
     page bounce is 70%, so the page is the bug" is.

  4. FIX → VERIFY · don't fix multiple things at once · you'll lose
     attribution. Fix one, verify it improves the metric, then look
     at the next stage.

  5. WHEN STUCK · check your assumption. The bug is almost always in
     the place you assumed was working.

Apply to: customer drop-off ("why aren't they converting") · revenue
slumps · stuck habits · code bugs · operator overwhelm. Same
framework · different domain.`,
};
