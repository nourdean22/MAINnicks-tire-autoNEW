import type { UIMessage } from "ai";
import { messageMayHaveWritten } from "@/lib/ai/chat/message-side-effect";
import { isResumedMessage } from "@/hooks/chat/use-chat-transport";

/**
 * Did this assistant turn run (or may it have run) a side-effecting tool?
 * Regenerate replays the whole turn, tools included, so a yes means a replay
 * could send the SMS, quote or payment a second time. Anything the gate cannot
 * vouch for counts as yes.
 *
 * The judgement lives in lib/ai/chat/message-side-effect.ts so the server's turn
 * guard asks the same question. The one signal added here is the browser's: a
 * resumed bubble holds replayed text only, so it cannot show what ran and counts
 * as yes (P2-B6).
 */
export function turnHasSideEffect(message: UIMessage): boolean {
  if (isResumedMessage(message)) return true;
  return messageMayHaveWritten(message);
}
