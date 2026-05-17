import type { StrategicFramework } from "../types";

/**
 * Inversion (Charlie Munger) — flip the question. Don't ask "how do
 * I succeed" · ask "what would guarantee failure" then avoid that.
 * Often produces sharper, less-romantic answers than direct framing.
 */
export const inversion: StrategicFramework = {
  id: "inversion",
  name: "Inversion (Charlie Munger)",
  oneLiner: "Flip the question · what guarantees failure · then avoid those things. Often clearer than reasoning forward.",
  triggers: [
    /\binversion|invert|inverted?\s+thinking/i,
    /\b(charlie\s+munger|munger['s]?\s+(law|principle))/i,
    /\b(how\s+(do|would)\s+(we|you)\s+(fail|screw\s+up|guarantee\s+failure))/i,
    /\b(avoid\s+(the\s+)?(disasters?|catastroph|stupidity))/i,
    /\b(what\s+would\s+kill\s+(this|the)\s+(business|deal|project))/i,
    /\b(reverse\s+engineer\s+(failure|the\s+downside))/i,
    /\b(pre[\s-]mortem)/i,
  ],
  weight: 1.0,
  lens: `Apply Inversion. Munger's claim · "all I want to know is where
I'm going to die so I'll never go there." Inversion turns the
question on its head ·

  · Instead of · "How do we make this business succeed?"
  · Ask · "What would GUARANTEE this business fails?"

The list of failure modes is often shorter, sharper, and easier
to act on than the list of success requirements. For example ·

  Forward · "How do we grow revenue?" → vague, romantic, hard.
  Inverted · "What would kill revenue?" → losing core customers,
            running out of cash, pissing off the audience, key
            person leaving, regulatory hit. Now you have a
            concrete list of risks to mitigate.

Pre-mortem · imagine the project fails 12 months from now. Write
the obituary · what went wrong · in what order. Then go fix the
top 2-3 BEFORE they happen. Most failures have warning signs that
were obvious in retrospect · inversion surfaces them in advance.

Apply to · risk assessment · go/no-go decisions · hiring (what
would make this hire a disaster?) · launches (what would make
customers hate this?) · pricing (what would make customers refuse
to pay?). The "avoid the catastrophe" question often dominates
the "find the upside" question for compounding decisions.

Surface · the 3 things that would guarantee failure · then the
cheapest action that prevents each.`,
};
