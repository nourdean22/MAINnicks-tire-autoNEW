import type { StrategicFramework } from "../types";

/**
 * Negotiation Frame (Chris Voss · Never Split the Difference) ·
 * tactical empathy + calibrated questions + "no" as the start of the
 * conversation. Most negotiations fail because both sides anchor on
 * positions instead of underlying interests.
 */
export const negotiation: StrategicFramework = {
  id: "negotiation",
  name: "Negotiation Frame (Chris Voss)",
  oneLiner: "Tactical empathy · mirror + label · 'no' as the door · calibrated questions · the goal isn't to win, it's to understand and shape.",
  triggers: [
    /\bnegotiat(e|ing|ion|or)\b/i,
    /\b(chris\s+voss|never\s+split\s+the\s+difference|tactical\s+empathy)/i,
    /\b(salary\s+negotiation|deal\s+(negotiation|terms))/i,
    /\b(closing\s+(the\s+)?(deal|sale)|getting\s+to\s+yes)/i,
    /\b(mirror\s+(what|them)|labeling\s+(emotions?|feelings?))/i,
    /\b(calibrated\s+questions?|how\s+am\s+i\s+supposed\s+to)\b/i,
    /\b(counter[\s-]offer|counter[\s-]offering)\b/i,
    /\b(walk\s+away\s+(point|price|number)|batna)\b/i,
    /\b(price\s+negotiation|haggle|haggling)/i,
  ],
  weight: 0.95,
  lens: `Apply the Negotiation Frame (Chris Voss). The premise · most
negotiations fail because both sides argue POSITIONS instead of
understanding INTERESTS. The skill is making the other side feel
heard so they reveal what they actually want.

Five tactical moves ·

  1. MIRROR · repeat the last 1-3 words the other side said as
     a question. Encourages them to elaborate. ".per
     month?" makes them explain why · which surfaces the real
     constraint behind the number.

  2. LABEL EMOTIONS · "It seems like..." · "It sounds like..."
     · "It looks like you're worried about..." Naming the emotion
     defuses it. Unnamed emotions drive the other side; labeled
     emotions get processed and let logic in.

  3. "NO" IS THE START, NOT THE END · most people fear "no" and
     try to avoid it. Voss's insight · "no" makes the other side
     feel safe and in control · it's the door to real conversation.
     Ask questions that invite "no" early ("is now a bad time?")
     rather than "yes" ("is now a good time?") · the latter
     triggers commitment-resistance.

  4. CALIBRATED "HOW" QUESTIONS · "How am I supposed to do that?"
     · "How can we make that work?" Forces the other side to solve
     the problem · they own the outcome and feel collaborative.
     Avoids confrontation · feels like you're working with them.

  5. THE BLACK SWAN · find the 1-2 unknown facts that change
     everything. Most deals have a hidden constraint the other
     side hasn't volunteered (bonus structure · partner pressure ·
     deadline · alternative offer). The black swan flips the
     entire frame.

Key calibration ·
  · Always know your BATNA (Best Alternative To a Negotiated
    Agreement). If the deal blows up, what do you do? Knowing
    this gives you genuine walk-away power.
  · Don't reveal urgency. Time pressure is the #1 negotiation
    weakness. If they sense it, they extract value.
  · "That's right" is gold · "you're right" is fool's gold. The
    former means they feel understood. The latter means they
    just want you to shut up.

For Nick · negotiation shows up everywhere · price discussions
with customers · supplier terms with tire distributors · hiring
conversations with techs · partnership conversations with shops.
The same playbook applies · empathize first, label the unsaid,
ask "how" not "why."

Surface · what's the real interest behind the position · what
emotion is unlabeled · what's the hidden constraint · what's
your BATNA · which calibrated question opens the door.`,
};
