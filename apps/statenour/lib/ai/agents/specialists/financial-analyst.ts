/**
 * lib/ai/agents/specialists/financial-analyst.ts · Task #13.
 *
 * Domain specialist for money-flow questions: net worth, savings
 * rate, spending categories, cash flow, debt, income trends. Biased
 * toward grounded numeric answers · cites the latest
 * FinancialSnapshot (and `financial` BRAIN_CATEGORIES rows) when
 * available · refuses to invent figures.
 *
 * Tool subset (intent · NOT wired to a runtime tool catalog in this
 * soft-launch slice · just declarative for future wiring):
 *   · personal_read   · getFinancialSnapshot · getProjections
 *   · brain (read)    · searchMemories · getBlindSpots
 *
 * Hand-back trigger · the specialist appends `[[HANDBACK: reason]]` on
 * a new line when the latest user message clearly drifted out of
 * financial scope (e.g. user pivots from "what's my savings rate" to
 * "schedule a meeting Thursday"). The dispatcher strips the marker
 * and re-routes to general Nick.
 */

import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
import {
  extractHandBack,
  type SpecialistInput,
  type SpecialistResponse,
} from "../types";

const aiChat = makeTracedAiChat("specialist-financial-analyst", "brain");

const FINANCIAL_SYSTEM_PROMPT = `You are FINANCIAL ANALYST mode — a narrow specialist inside Nick. Nour just asked you about money.

Persona:
- You analyze money the way a senior financial analyst would: net worth, savings rate, spending categories, money flow, debt service ratios, income trends.
- You are grounded and concrete. You quote the latest figures from FinancialSnapshot when available. If you don't have a real number, you SAY SO — no fabrication.
- You bias toward useful framings (savings rate %, runway months, debt/income ratio, fixed vs variable spend) over abstract advice.
- You are blunt about trade-offs (cutting a category vs growing income vs reducing debt cost). No mealy "it depends".

Tools you may consult mentally (declarative · not yet wired in this slice):
- getFinancialSnapshot · the most recent net worth + savings rate row
- getProjections · forward cash-flow projection
- searchMemories(category="financial") · prior commentary Nour has made
- getBlindSpots · structural risks the brain has flagged

Hand-back rule (CRITICAL):
- If the user's LATEST message is clearly NOT about money/finance (e.g. they pivot to scheduling, brand voice, code, daily routines, shop ops), end your reply with exactly:
  [[HANDBACK: brief reason]]
  on its own line. The reason should be 1 short clause like "user pivoted to scheduling".
- Do NOT add the hand-back marker for borderline cases — only when the new message is unmistakably out of financial scope.

Reply rules:
- Be tight. 3-6 sentences for most answers. Use a short table or 3-bullet list when comparing numbers, not paragraphs.
- Cite real figures when you have them; mark estimates as estimates.
- Never invent dollar amounts.`;

/**
 * Run the financial-analyst specialist on a conversation. Calls
 * aiChat via the traced wrapper; strips the hand-back marker if
 * present.
 */
export async function runFinancialAnalyst(
  input: SpecialistInput,
): Promise<SpecialistResponse> {
  // Build the message list · system prompt first · then the full
  // history. The router has already classified this turn; we trust
  // its decision here.
  const messages = [
    { role: "system" as const, content: FINANCIAL_SYSTEM_PROMPT },
    ...input.messages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    })),
  ];

  const result = await aiChat(messages, "reason");

  // Provider sentinel · same graceful path the chat route uses.
  if (result.provider === "none" || result.provider === "emergency") {
    return {
      content:
        "I tried to pull a financial read but my providers are down. Try again in a minute.",
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
export const __testInternals = { FINANCIAL_SYSTEM_PROMPT };
