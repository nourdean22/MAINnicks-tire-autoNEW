/**
 * Negotiation patterns · 2026-06-20
 *
 * Encodes Chris Voss's core patterns from "Never Split the Difference"
 * as a structured lookup. Used by the VAPI voice agent prompt to guide
 * conversation flow during customer calls.
 *
 * Each pattern has:
 *   · trigger  — the situation that activates the pattern
 *   · response — the specific technique to apply
 *   · example  — a concrete script snippet
 */

export interface VossPattern {
  key: string;
  name: string;
  trigger: string;
  response: string;
  example: string;
}

export const VOSS_PATTERNS: Record<string, VossPattern> = {
  mirroring: {
    key: "mirroring",
    name: "Mirroring",
    trigger: "Customer states a problem, objection, or concern",
    response: "Repeat the last 1-3 words of what they said as a question, then go silent.",
    example: 'Customer: "The price is too high." → You: "Too high?" → [silence]',
  },
  labeling: {
    key: "labeling",
    name: "Labeling",
    trigger: "Customer shows emotion (frustration, worry, hesitation)",
    response: "Name the emotion using 'It sounds like...' or 'It seems like...' — never 'You are...'",
    example: `Customer: "I'm not sure about these tires." → You: "It sounds like you're concerned about the quality." → [silence]`,
  },
  calibrated_question: {
    key: "calibrated_question",
    name: "Calibrated Questions",
    trigger: "Customer resists, says no, or pushes back",
    response: "Ask 'How' or 'What' questions — never 'why'. Shift the burden to them.",
    example: `Customer: "That's too expensive." → You: "How am I supposed to do that price?" or "What about this works for you?"`,
  },
  no_oriented: {
    key: "no_oriented",
    name: "No-Oriented Questions",
    trigger: "Customer hesitates, ghosts, or stalls",
    response: "Frame your ask so 'no' is the safe answer that moves things forward.",
    example: 'Customer: [hesitating] → You: "Is it a bad idea to come in for a free tire inspection?"',
  },
  accusation_audit: {
    key: "accusation_audit",
    name: "Accusation Audit",
    trigger: "Price objection or skepticism anticipated",
    response: "Pre-empt the worst thought they could have before they think it.",
    example: `Before quoting: "You're probably going to think this is expensive, and you might think we're just trying to upsell you..."`,
  },
  strategic_silence: {
    key: "strategic_silence",
    name: "Strategic Silence",
    trigger: "After making an offer or stating a price",
    response: "Go completely silent. Count to 7. Let them fill the space.",
    example: `You: "That'll be $47 per tire installed." → [silence — 7 seconds] → Customer usually responds first.`,
  },
  future_pacing: {
    key: "future_pacing",
    name: "Future Pacing",
    trigger: "Customer is close to committing but needs a push",
    response: "Describe the end state where they've already said yes — not the process.",
    example: `"So once we get you scheduled, you'll have new tires on your car by Friday and you won't have to think about it again."`,
  },
};

/** All patterns as an array (for prompt injection). */
export const ALL_VOSS_PATTERNS: VossPattern[] = Object.values(VOSS_PATTERNS);

/**
 * Render a compact prompt section for the VAPI assistant system prompt.
 * Instructs the voice agent to use Voss patterns during calls.
 */
export function renderVossPromptSection(): string {
  const lines: string[] = [
    "## NEGOTIATION TACTICS · Never Split the Difference (Voss)",
    "",
    "Use these patterns naturally during customer calls. Don't announce them — weave them in.",
    "",
  ];
  for (const p of ALL_VOSS_PATTERNS) {
    lines.push(`### ${p.name}`);
    lines.push(`- When: ${p.trigger}`);
    lines.push(`- Do: ${p.response}`);
    lines.push(`- Example: ${p.example}`);
    lines.push("");
  }
  lines.push("Remember: silence is a tool. After mirroring, labeling, or stating a price — pause and let the customer speak first.");
  return lines.join("\n");
}
