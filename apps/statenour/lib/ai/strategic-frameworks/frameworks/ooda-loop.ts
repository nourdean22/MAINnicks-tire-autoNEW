import type { StrategicFramework } from "../types";

/**
 * OODA Loop (Col. John Boyd) · Observe → Orient → Decide → Act.
 * Originally for fighter pilots · the side that completes the loop
 * faster wins because they reset the other side's plan before it
 * can execute. Generalizes to any fast-changing environment ·
 * markets, competition, ops, sales conversations.
 */
export const oodaLoop: StrategicFramework = {
  id: "ooda-loop",
  name: "OODA Loop (Boyd · decision-cycle speed)",
  oneLiner: "Observe → Orient → Decide → Act · faster than the other side. Speed of cycle beats accuracy of single decisions in fast-changing environments.",
  triggers: [
    /\booda\s+loop|john\s+boyd|colonel\s+boyd\b/i,
    /\b(observe.*orient.*decide.*act)/i,
    /\b(decision[\s-]?cycle|cycle\s+time\s+(of|on)\s+decisions?)/i,
    /\b(react\s+(faster|quicker)\s+than|move\s+faster\s+than)/i,
    /\b(fast[\s-]changing\s+(environment|market|conditions?))/i,
    /\b(speed\s+of\s+iteration|rapid\s+iteration\s+cycle)/i,
    /\b(operational\s+tempo|tempo\s+(of|on)\s+(operations?|execution))/i,
    /\b(get\s+inside\s+(their|the\s+enemy['s]?)\s+(decision\s+)?(loop|cycle))/i,
  ],
  weight: 0.95,
  lens: `Apply the OODA Loop. Boyd's discovery as a fighter pilot ·
in a dogfight, the side that completes the OODA loop FASTER wins
even with a slower aircraft. Faster cycle time forces the
opponent to constantly react to a stale picture · their plan is
always one step behind.

The 4 stages · all 4 must be completed for one cycle ·

  1. OBSERVE · gather raw data from the situation. What's
     happening · what's changed · what signals are coming in?
     Most operators stay here too long ("I just need more data").
  2. ORIENT · interpret the data through your mental models +
     experience + culture. This is the hardest step · two
     observers see the same data and orient to opposite
     conclusions. Boyd called this stage the "big O" · most
     important.
  3. DECIDE · pick a course of action. Doesn't have to be the
     optimal action · just an ACTION. "Decision paralysis" is
     a failure mode here · stuck cycling 1-2 forever.
  4. ACT · execute. Then immediately go back to OBSERVE to see
     what changed because of your action.

Two strategic moves ·

  · TIGHTEN YOUR LOOP · cut decision-cycle time in half. Even
    if individual decisions are 80% as accurate as the slower
    process, you make twice as many · the cumulative position
    advantage compounds.

  · WIDEN THEIR LOOP · introduce noise / ambiguity into the
    competitor's observe-orient stages. Confused competitors
    can't decide quickly. Common move · ship faster than they
    can react, change pricing/offerings before they can copy.

Common failure modes ·
  · Stuck in OBSERVE · "we need more data" while the opportunity
    closes
  · Stuck in ORIENT · arguing about interpretation while
    the world moves on
  · Long DECIDE · committee paralysis · stretches a 5-min call
    into a 6-week process
  · ACT without re-observing · execute the original plan even
    when conditions changed

For Nick · the tire shop's OODA loop is operational tempo · how
fast can you · respond to a customer review · adjust pricing to
match a competitor · pivot a marketing campaign · reassign a
tech to a different bay. Faster loops mean customers feel attended
to AND competitors can't predict your moves.

Surface · the current loop length (how long observe-decide-act
takes today) · which stage is the bottleneck · the move that
tightens it most · whether the situation calls for fast/sloppy
or slow/precise.`,
};
