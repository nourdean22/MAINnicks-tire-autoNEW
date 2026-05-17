/**
 * CONTEXT SHRINKER — auto-summarize chat history when getting long.
 *
 * v7 · BATCH 7 · Apr 28. When a conversation grows past a token threshold,
 * compress the OLDEST half into a structured summary preserving:
 *   · Decisions made
 *   · Customer/vehicle/service references
 *   · Open questions
 *   · Style preferences expressed
 *   · Anchor moments (Nour's "ship it" / "regen" reactions)
 *
 * Returns a single compressed summary message that replaces the older
 * messages in subsequent turns. The model sees fresh context + the
 * compressed history block (small but lossless on key facts).
 *
 * Trigger: when total chars across messages > 50K (rough proxy for
 * 12-15K tokens). Compression target: shrink older half by 80%.
 */

// v10.0.64 · AgentTrace coverage.
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
const aiChat = makeTracedAiChat("context-shrinker", "tool");

export interface ChatMsg {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ShrinkResult {
  shrunk: boolean;
  /** Replacement message that summarizes everything before keepFromIdx */
  summary?: ChatMsg;
  /** Original message count */
  before: number;
  /** Final message count after shrink */
  after: number;
  /** Token-cost-equivalent of the summary call */
  durationMs: number;
}

export async function shrinkContext(messages: ChatMsg[]): Promise<ShrinkResult> {
  // Total chars proxy — rough estimate
  const totalChars = messages.reduce((s, m) => s + m.content.length, 0);
  if (totalChars < 50_000) {
    return { shrunk: false, before: messages.length, after: messages.length, durationMs: 0 };
  }

  // Keep last 8 messages verbatim — those carry the active thread
  const keepLastN = 8;
  if (messages.length <= keepLastN) {
    return { shrunk: false, before: messages.length, after: messages.length, durationMs: 0 };
  }

  const toCompress = messages.slice(0, messages.length - keepLastN);
  const toKeep = messages.slice(messages.length - keepLastN);

  // Build the compression prompt
  const compressionPrompt = `Compress this chat history into a single structured summary preserving ONLY:

1. DECISIONS MADE — explicit "ship it" / "use this" / "go with X" choices
2. CUSTOMER/VEHICLE REFERENCES — anyone mentioned by name + their vehicle + service
3. OPEN QUESTIONS — anything Nour asked that wasn't fully answered
4. STYLE PREFERENCES — anything Nour said about tone/format ("hate corporate", "make shorter", "love alert format")
5. ANCHOR MOMENTS — Nour's strong reactions ("perfect" / "regen" / "wrong")

Drop everything else (small talk, repeated context, intermediate drafts).

Output as a structured block (max 1500 chars) starting with "## CONVERSATION CONTEXT" so the model parsing this knows it's compressed history.

Chat history to compress:
${toCompress.map((m) => `[${m.role.toUpperCase()}]: ${m.content.slice(0, 1500)}`).join("\n\n")}`;

  const t0 = Date.now();
  let summaryText = "";
  try {
    const result = await aiChat(
      [
        { role: "system", content: "You are a precision summarizer. Preserve only the load-bearing facts." },
        { role: "user", content: compressionPrompt },
      ],
      "summary",
    );
    summaryText = result.content;
  } catch (err) {
    console.warn("[context-shrinker] compression failed:", err instanceof Error ? err.message : err);
    return {
      shrunk: false,
      before: messages.length,
      after: messages.length,
      durationMs: Date.now() - t0,
    };
  }

  const summaryMsg: ChatMsg = {
    role: "system",
    content: `## CONVERSATION CONTEXT (auto-compressed from ${toCompress.length} earlier turns)\n\n${summaryText}`,
  };

  return {
    shrunk: true,
    summary: summaryMsg,
    before: messages.length,
    after: 1 + toKeep.length, // one summary + last N
    durationMs: Date.now() - t0,
  };
}
