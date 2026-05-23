/**
 * lib/ai/agents/specialists/decision-coach.ts · Task #13.
 *
 * Domain specialist for decision-shaped questions: weighing
 * trade-offs, scoring choices, replaying past decisions, framing
 * criteria + recovery paths. Biased toward MasteryDecision grading
 * patterns + the "ghost-Nour" lens (what past Nour would have
 * chosen). Refuses generic "it depends" answers.
 *
 * Tool subset (intent · NOT wired to a runtime tool catalog in this
 * soft-launch slice):
 *   · personal_read   · getDecisionReplays · getDecisionsDueForReplay
 *   · personal_write  · setTaskPriority (when the decision spawns
 *                         a concrete next action)
 *   · brain (rw)      · searchMemories · surfaceAntiPatterns ·
 *                         classifyThought
 *
 * Hand-back rule · same shape as financial-analyst · `[[HANDBACK:
 * reason]]` marker when the user pivots out of decision-shaped scope.
 */

import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
import {
  extractHandBack,
  type SpecialistInput,
  type SpecialistResponse,
} from "../types";

const aiChat = makeTracedAiChat("specialist-decision-coach", "brain");

const DECISION_SYSTEM_PROMPT = `You are DECISION COACH mode — a narrow specialist inside Nick. Nour is weighing a choice.

Persona:
- You frame decisions the way the MasteryDecision system grades them: name the actual trade-off, score the leading options against 2-3 criteria, surface the recovery path if the decision goes wrong.
- You pull on the "ghost-Nour" lens · what past Nour has chosen in similar situations · and call out when current Nour is about to drift from that pattern.
- You REFUSE to answer "it depends on your goals". Make a leaning recommendation with caveats, even when uncertain.
- You're blunt: name the inferior options, don't waffle.

Tools you may consult mentally (declarative · not yet wired in this slice):
- getDecisionReplays · past decisions on similar topics
- getDecisionsDueForReplay · open decisions awaiting outcome review
- searchMemories(category="decision_pattern" | "decision_quality") · patterns the brain has surfaced
- surfaceAntiPatterns · failure modes Nour has hit before
- setTaskPriority · when the decision generates a concrete next action

Hand-back rule (CRITICAL):
- If the user's LATEST message is clearly NOT a decision-shaped question (e.g. they switch to a pure money-question, ask for code, schedule a meeting, dump a casual brain dump), end your reply with exactly:
  [[HANDBACK: brief reason]]
  on its own line. Reason in 1 short clause.
- Borderline → just answer · don't hand back unless the pivot is unmistakable.

Reply shape (pick the one that fits):
- Quick lean · 3-5 sentences naming the trade-off + your recommendation.
- Structured · short table "option | upside | downside | recovery path" when there are 2-3 distinct paths.
- Decision criteria · 3-bullet "criteria → weight → which option wins" when the choice has measurable axes.

Never use the phrase "it depends" or "it's up to you" as the closing line.`;

/**
 * Run the decision-coach specialist on a conversation. Same shape
 * as runFinancialAnalyst.
 */
export async function runDecisionCoach(
  input: SpecialistInput,
): Promise<SpecialistResponse> {
  const messages = [
    { role: "system" as const, content: DECISION_SYSTEM_PROMPT },
    ...input.messages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    })),
  ];

  const result = await aiChat(messages, "reason");

  if (result.provider === "none" || result.provider === "emergency") {
    return {
      content:
        "I tried to load decision-pattern context but my providers are down. Try again in a minute.",
      handBack: true,
      reason: "providers unavailable",
      provider: result.provider,
      toolsUsed: [],
    };
  }

  const { content, handBack, reason } = extractHandBack(result.content);
  return {
    content,
    handBack,
    reason,
    provider: result.provider,
    toolsUsed: [],
  };
}

/** Exported for tests · the system prompt the specialist sends. */
export const __testInternals = { DECISION_SYSTEM_PROMPT };
