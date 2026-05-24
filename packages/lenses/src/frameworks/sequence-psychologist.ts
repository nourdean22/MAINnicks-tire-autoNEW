import type { StrategicFramework } from "../types";

/**
 * Sequence Psychologist — the ORDER of things matters more than the
 * things themselves. Customer journeys, habit stacks, onboarding
 * flows. Pace the build · early wins beat eventual results.
 */
export const sequencePsychologist: StrategicFramework = {
  id: "sequence-psychologist",
  name: "Sequence Psychologist",
  oneLiner: "Order matters more than content. Early wins beat eventual results. Stack steps so each one earns the next.",
  triggers: [
    /\b(customer\s+journey|user\s+journey|onboarding\s+(flow|sequence))\b/i,
    /\b(habit\s+(stack|sequence|chain)|behavior\s+(sequence|chain))\b/i,
    /\b(email\s+sequence|drip\s+(campaign|sequence))\b/i,
    /\b(first\s+(touch|impression|moment|interaction))\b/i,
    /\b(activation\s+(sequence|flow|moment))\b/i,
    /\b(in\s+what\s+order|sequence\s+(matters|of))/i,
    /\b(step\s+by\s+step\s+(plan|sequence|flow))\b/i,
  ],
  antiTriggers: [
    // customer journey used in physical-travel sense (mirrors growth-engine)
    /\bcustomer\s+journey\s+(through|across|to|down)\s+(downtown|the\s+city|the\s+town|the\s+airport|the\s+park)/i,
  ],
  weight: 0.95,
  lens: `Apply the Sequence Psychologist lens. Most failures aren't bad
content · they're bad ORDER. Two principles:

  1. EARLY WINS COMPOUND · the first 3 touches set the trajectory.
     If the customer / user / habit doesn't experience a small win
     by step 3, retention drops off a cliff. Engineer the early win
     · don't hope for it. (For Nick's Tire · the first oil change
     should feel premium · the second visit converts the relationship.)

  2. EACH STEP EARNS THE NEXT · every action you ask for should be
     justified by what the previous step delivered. Don't ask for
     trust before earning it · don't ask for a sale before
     demonstrating value · don't ask for commitment before showing
     reliability.

The diagnostic question: at each step, what's the user FEELING + what
do they BELIEVE about the relationship? Map those, and the order
designs itself.

Apply to · email sequences · onboarding flows · sales conversations ·
habit-building · service-tier upgrades. Output: the 3-7 step
sequence + the wow-moment per step + the dropout risk per step.`,
};
