import type { StrategicFramework } from "../types";

/**
 * Survivorship Bias — when you only see the winners, you draw the
 * wrong conclusions about what creates winning. Abraham Wald's
 * WWII bombers · the holes you see are NOT where to add armor;
 * the planes that came back show where damage is survivable. The
 * planes that didn't come back have the lessons.
 */
export const survivorshipBias: StrategicFramework = {
  id: "survivorship-bias",
  name: "Survivorship Bias",
  oneLiner: "You only see the winners · the losers are invisible · their lessons are the most important. Look at the missing data, not the present data.",
  triggers: [
    /\bsurvivorship\s+bias|survivor\s+bias\b/i,
    /\b(abraham\s+wald|wald['s]?\s+bombers?)/i,
    /\b(all\s+(successful|winning|top)\s+(\w+\s+)?(did|do|use|have))\b/i,
    /\b(billionaire(s|'s)?\s+(routine|habits?|secrets?))/i,
    /\b(advice\s+from\s+(a\s+)?(billionaire|founder|ceo))/i,
    /\b(case\s+studies?\s+show)/i,
    /\b(what\s+do\s+(successful|winning|top)\s+\w+\s+(do|have|use))/i,
    /\b(lessons\s+from\s+the\s+winners)/i,
  ],
  weight: 0.95,
  lens: `Apply the Survivorship Bias lens. Wald's WWII story · the army
wanted to add armor where bombers came back with bullet holes.
Wald said NO · those are the survivable hits. The planes shot in
the OTHER places didn't come back. Add armor where the surviving
planes are NOT hit.

The general principle · we systematically over-learn from winners
and ignore losers because winners are visible and losers aren't.
Three traps this creates ·

  1. ROUTINES OF THE SUCCESSFUL · "all top founders wake up at 5am
     and read for an hour." Maybe · or maybe lots of failed founders
     also wake at 5am and read, and the data we don't see swamps
     the data we do. The 5am-reading correlation might be 51-49,
     not 95-5.

  2. PRACTICES OF SURVIVING COMPANIES · "Apple succeeded with no
     focus groups · so we don't need focus groups." Maybe · or
     maybe Apple succeeded DESPITE that, and the dead companies
     that also skipped focus groups would scream a different
     lesson if they could.

  3. ADVICE FROM WINNERS · the winner's advice is rarely the actual
     reason they won. They tend to attribute success to their
     character / habits / philosophy when it was often timing /
     luck / a key relationship · those are harder to package.

The decision-relevant move · ALWAYS ASK FOR THE LOSING DATA ·
  · "What about businesses that did the same thing and failed?"
  · "What's the base rate for everyone who tried this?"
  · "Who tried this exact playbook and didn't make it · and why?"
  · "Is this advice from a winner who can't replicate their win?"

If the failing-cohort data is hard to find (usually is) · be
skeptical of the recommended action · the data we have isn't
telling the whole story.

For Nick's tire shop · survivorship bias shows up in 'best practices
from successful shops' · 'what worked at the dealer' · 'the
millionaire's daily routine.' Each one is partial data · ask what
shops tried the same playbook and folded · then weight the advice.

Surface · the missing data · who tried this and failed · what's
the base rate · what's the survivorship-adjusted estimate.`,
};
