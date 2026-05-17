import type { StrategicFramework } from "../types";

/**
 * Verification Before Completion — meta-lens · before declaring
 * "done," walk back through the original ask and confirm each part
 * is satisfied. Prevents the "ship and pray" pattern.
 */
export const verificationBeforeCompletion: StrategicFramework = {
  id: "verification-before-completion",
  name: "Verification Before Completion",
  oneLiner: "Before saying 'done,' walk through the original ask. Each part satisfied? Each assumption checked? No surprises.",
  triggers: [
    /\b(ship\s+it|deploy\s+(it|now)|push\s+to\s+(prod|production))\b/i,
    /\b(is\s+this\s+(ready|done|complete))/i,
    /\b(before\s+(i|we)\s+(ship|deploy|publish|send))/i,
    /\b(checklist|qa\s+gate|pre[\s-]?ship)\b/i,
    /\b(verify|verification|verified)\b/i,
    /\b(missed\s+anything|forget\s+anything|left\s+out)/i,
  ],
  weight: 0.85,
  lens: `Apply the Verification Before Completion lens. The 60-second pause
that prevents the next regression.

Before declaring anything done, walk through:

  1. RESTATE THE ASK · in the operator's own words. If you can't,
     you don't know what done looks like.
  2. ENUMERATE EACH PART · the request usually has 2-5 sub-asks.
     Mark each one done / partial / not-done. "Mostly done" hides
     the partials.
  3. CHECK YOUR ASSUMPTIONS · which assumptions did you make? If
     any of them were wrong, what breaks? Now actually check the
     riskiest assumption · don't trust the model's guess.
  4. WHAT WOULD A REVIEWER CATCH? · steel-man the critique. The
     thing they'd flag in PR review is the thing you should fix
     before you say done.
  5. SURFACE WHAT WAS NOT DONE · explicit list. "Punted on X
     because Y" beats silent omission. The operator can pick up
     the punted items if they matter.

This lens is META — it pairs with whatever framework drove the
original answer. Apply at the END of any decision / plan / build /
deploy. Catches more bugs than testing does.`,
};
