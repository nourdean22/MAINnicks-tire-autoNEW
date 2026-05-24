import type { StrategicFramework } from "../types";

/**
 * Elon Musk — first-principles + physics-based reasoning lens.
 * Strip the problem to its physical fundamentals · ignore the way
 * things have always been done · 10x not 10% · the best part is no
 * part · question every requirement.
 */
export const elonMusk: StrategicFramework = {
  id: "elon-musk",
  name: "Elon Musk (First Principles + Physics)",
  oneLiner: "Reason from physical fundamentals · question every requirement · the best part is no part · 10x not 10%.",
  triggers: [
    /\bfirst\s+principles?\b/i,
    /\b(physics|physical)[\s-]?based\b/i,
    /\b(why\s+does\s+this\s+(have\s+to\s+|need\s+to\s+))?(cost|take|require|exist)/i,
    /\b(reduce\s+(cost|complexity|parts|steps)|simplify|strip\s+down)\b/i,
    /\b(10x|ten[\s-]?x|order\s+of\s+magnitude)\b/i,
    /\b(eliminate|delete|remove|cut)\s+(the\s+)?(part|step|feature|process|requirement)/i,
    /\b(rapid\s+iteration|fail\s+fast|ship\s+and\s+learn)\b/i,
    /\b(elon|musk|spacex|tesla|first[\s-]?principles\s+thinking)\b/i,
    /\b(why\s+is\s+this\s+(so\s+)?(expensive|slow|hard|complicated))/i,
    /\b(idiot\s+index|cost\s+of\s+materials)\b/i,
  ],
  antiTriggers: [
    // 10x as raw multiplier on a physical thing · NOT first-principles framing
    /\b(engine|car|gpu|cpu|battery|chip|cpu|device|motor|laptop|phone|monitor|drive)\s+is\s+\d+x\b/i,
    /\b\d+x\s+more\s+powerful\s+than\b/i,
    // SpaceX as the rocket-launch reference · NOT the elon-thinking lens
    /\bspacex\s+(launch|rocket|booster|capsule)\s+(is|was|tomorrow|today|next|this)\b/i,
  ],
  weight: 0.95,
  featured: true, // 2026-05-23 · Wave E · baseline lens shown in generic fallback
  lens: `Apply the Elon Musk lens · first principles + physics-based reasoning.
The unique thing about this lens is what it REJECTS:
   · It rejects "that's how it's always been done."
   · It rejects "industry standard" as a justification.
   · It rejects authority-based requirements without physics behind them.

Two engines drive the reasoning:

  1. FIRST PRINCIPLES · break the problem to atoms.
     · What are the inputs · time · energy · materials · capital?
     · What does PHYSICS / MATH say is the floor cost / time / size?
     · What is being charged / spent BEYOND that floor, and why?
     The gap between physics-floor and current-state is the
     opportunity. (Battery cells were "expensive" until SpaceX/Tesla
     priced the raw cobalt + nickel + electrolyte at the LME · the
     manufactured cost was ~10x the materials. That gap was the bet.)

  2. THE BEST PART IS NO PART · the 5-step engineering process:
     1. Question every requirement · who set it · is it real?
     2. Delete the part / step / process · don't optimize, eliminate
     3. Simplify what remains
     4. Accelerate cycle time
     5. Automate (LAST · don't automate before deleting)
     Most teams jump to step 5 (automate the existing process) and
     miss steps 1-4 where the leverage actually lives.

10x NOT 10% · "improve by 10%" forces working within current
constraints. "Improve by 10x" forces redesign. The 10% mindset
optimizes the cow-path · the 10x mindset asks why we built a path
across the cow pasture in the first place.

Apply to: pricing math (what's the materials cost · why is the
markup what it is), process redesign, build vs buy, why-is-this-so-
slow questions, capital allocation. Surface the physics-floor
explicitly · the gap between floor and current is where Nour can
go play.`,
};
