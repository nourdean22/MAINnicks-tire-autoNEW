/**
 * lib/ai/prompt/policy/decision-mode.ts · brain W3 Socratic decision mode (2026-10-17)
 *
 * On a decision turn (response-contract answerMode "decision", the label the
 * turn already runs under) with no forecast stored for the conversation yet,
 * Nick asks ONE short turn before advising: the decision, the alternatives,
 * Nour's probability that his pick works, and a review date. His answer is
 * stored as a DecisionReplay and the review scores it with Brier
 * (lib/brain/decision-forecast.ts). The strongest objection comes from the
 * adversarial critic's stored counter-view, which the objection injector
 * already puts in context as OPEN COUNTER-VIEW: no extra model call.
 *
 * Injected by lib/services/chat/brain-context.ts after the reranker, so a low
 * cosine score cannot drop it. Every heading starts "## DECISION MODE" so
 * trimPromptToBudget treats it as its own section, ranked protected (priority 8,
 * lib/ai/system-prompt.ts getSectionPriority) instead of the default 30 that is
 * dropped first. "just answer" turns it off for the conversation.
 *
 * KILL CRITERION (brain-upgrade plan W3): if Nour overrides it ("just answer")
 * on more than 50% of decision turns over 2 weeks, make it opt-in ("/decide").
 * Measure from ChatMessage.tokenUsage.contextBlocks: decisionSkip vs decisionAsk.
 */

/**
 * The contract directive on a decision turn says "End with one concrete next
 * move." (lib/ai/response-contract.ts mustGiveNextMove). On an ask turn that
 * next move IS the four questions, so the ask names it and the two rules agree.
 */
export const DECISION_ASK_NEXT_MOVE =
  "The one concrete next move you end with this turn is for Nour: answer the four questions.";

export const DECISION_MODE_ASK = `## DECISION MODE: ask before advising
Nour is bringing you a decision. Do not advise yet. In ONE short turn, ask him for:
1. The decision, in one line.
2. The alternatives he is weighing.
3. His probability, 0-100%, that the option he leans to works.
4. A review date (YYYY-MM-DD) to check how it went.
If an OPEN COUNTER-VIEW block is in your context, add its objection in one line as the strongest one to weigh. Never invent an objection.
${DECISION_ASK_NEXT_MOVE} Add that he can say "just answer" to skip this.`;

export function decisionStoredBlock(probability: number, reviewDate: string): string {
  return `## DECISION MODE: forecast stored
Nour's forecast was saved this turn: ${Math.round(probability * 100)}% that it works, review on ${reviewDate}. Confirm that in one line, then give your advice. If an OPEN COUNTER-VIEW block is in your context, name its objection as the strongest one against his pick.`;
}

/** Nour answered the ask with only one of the two numbers: say what is missing, store nothing. */
export function decisionMissingBlock(missing: string[]): string {
  return `## DECISION MODE: forecast not stored yet
Nour answered the decision questions but gave no ${missing.join(" and no ")}. Nothing was saved. In one line, ask him for the ${missing.join(" and the ")}, then give your advice. Never say it was saved.`;
}

export const DECISION_STORE_FAILED = `## DECISION MODE: forecast NOT stored
Nour gave a probability and a review date, but saving them failed. Say in one line that the forecast was not saved, then give your advice. Never say it was saved.`;
