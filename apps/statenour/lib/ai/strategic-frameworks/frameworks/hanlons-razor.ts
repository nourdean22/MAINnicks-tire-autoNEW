import type { StrategicFramework } from "../types";

/**
 * Hanlon's Razor — never attribute to malice that which is adequately
 * explained by stupidity, oversight, or incompetence. Saves enormous
 * energy in interpreting customer complaints, employee mistakes,
 * vendor mishaps, partner behavior. Most "they're out to get me"
 * stories are actually "they're disorganized" stories.
 */
export const hanlonsRazor: StrategicFramework = {
  id: "hanlons-razor",
  name: "Hanlon's Razor",
  oneLiner: "Never attribute to malice what's adequately explained by stupidity, oversight, or incompetence. Most slights aren't slights · they're errors.",
  triggers: [
    /\bhanlon['s]?\s+razor\b/i,
    /\b(attribute\s+to\s+(malice|stupidity))/i,
    /\b(why\s+are\s+they\s+(doing|trying)\s+(this|that))\s+to\s+(me|us)/i,
    /\b(deliberately|on\s+purpose|intentionally)\s+(messing|screwing|hurting|sabotaging)\b/i,
    /\b(sabotage|sabotaging|sabotaged)\b/i,
    /\b(out\s+to\s+get\s+(me|us|the\s+business))/i,
    /\b(personal\s+attack|targeting\s+(us|me))\b/i,
    /\b(they\s+(must|probably)\s+(hate|dislike|envy)\s+(me|us))\b/i,
  ],
  weight: 0.95,
  lens: `Apply Hanlon's Razor. The original phrasing · "never attribute
to malice that which is adequately explained by stupidity." Updated
for charity · stupidity isn't always the right word · oversight,
overload, or incompetence usually is.

The decision-relevant move · before reacting to a perceived slight,
ask · what's the SIMPLEST explanation? Two columns ·

  MALICE EXPLANATION                  ADEQUATE-EXPLANATION
  · they're trying to hurt us         · they forgot
  · they're sabotaging                · they're overloaded
  · they want us to fail              · their process broke
  · they're punishing us              · they don't actually care that much
  · they're playing politics          · they have their own crisis

The MALICE explanation is almost always more emotionally
satisfying · it makes us the protagonist of a story. The
adequate-explanation is almost always closer to the truth and
leads to better action ·

  · If malice · escalate · confront · involve lawyers
  · If oversight · clarify · simplify the process · check in twice

The cost of getting this wrong · if you treat oversight as malice,
you damage relationships, escalate fights that didn't need to
happen, and create the malice you assumed. If you treat malice
as oversight, you let bad actors continue (rare but not zero).

Default to charity · BUT verify after a pattern (3+ instances or
high-stakes outcome). One missed deadline = oversight. Three
missed deadlines after explicit warnings = pattern worth confronting.

For Nick · vendor delays, employee no-shows, customer complaints,
partner ghosting · default to "they're disorganized / overloaded
/ confused" before "they're against me." Saves enormous energy
and preserves relationships that would otherwise calcify.

Surface · the malice story · the adequate-explanation story · which
is more probable given evidence · the action that fits the more-
probable story.`,
};
