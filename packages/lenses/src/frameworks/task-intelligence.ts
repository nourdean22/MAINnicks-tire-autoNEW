import type { StrategicFramework } from "../types";

/**
 * Task Intelligence — smart prioritization for the operator's todo
 * list. Eisenhower + ICE + reversibility · forces a real ranking
 * instead of "P1 / P2 / P3 by gut feel."
 */
export const taskIntelligence: StrategicFramework = {
  id: "task-intelligence",
  name: "Task Intelligence (Smart Prioritization)",
  oneLiner: "Score by impact × confidence × ease ÷ effort. Reversibility decides the speed. Eisenhower decides what to delegate.",
  triggers: [
    /\b(prioritiz|priority|priorities)\b/i,
    /\b(P1|P2|P3|p1|p2|p3)\b/i,
    /\b(should\s+(i|we)\s+(do|focus|work\s+on)\s+(this|that|first|next))/i,
    /\b(what\s+to\s+(do|tackle|focus\s+on)\s+(first|next))/i,
    /\b(eisenhower|ICE\s+score|RICE\s+score|impact\s+\/\s+effort)\b/i,
    /\b(urgent\s+vs\s+important|high[\s-]?leverage)\b/i,
    /\b(my\s+(todo|to[\s-]?do|task)\s+list)\b/i,
  ],
  weight: 1.0,
  lens: `Apply the Task Intelligence framework. Most todo lists fail because
they treat all tasks as equally claimable on attention.

  1. ICE SCORE PER TASK · 1-10 each:
       · Impact     · how much does it move the needle?
       · Confidence · how sure are we it'll work?
       · Ease       · how straightforward is execution?
     Multiply · top 3-5 are the real list. Below that line is fog.

  2. EISENHOWER MATRIX · cross-reference urgency vs importance:
       · Urgent + Important       · DO TODAY
       · Important, not urgent    · SCHEDULE (this is the leverage zone)
       · Urgent, not important    · DELEGATE / batch / kill
       · Neither                  · DELETE
     Most operators live in the "Urgent + Not-important" quadrant ·
     it feels productive but it's not where the business gets built.

  3. REVERSIBILITY GATE · before starting an irreversible task,
     pause. Reversible tasks · move fast, learn from doing. Irrev ·
     slow down, gather information, consider the bear case.

The output: 3 specific tasks ranked, with the score for each + the
quadrant + the reversibility flag. "Work on the urgent stuff" is
not a plan.`,
};
