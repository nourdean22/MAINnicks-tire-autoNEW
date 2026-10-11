/**
 * features/chat-v2/lib/turn-lifecycle.ts · the end of a chat turn, client side
 * (2026-10-10, audit 04-F2 / 04-F6 / 04-F8 / 09-F29).
 *
 * Pure, so the decisions are testable without a DOM.
 */

type Part = { type: string };
type Message = { id: string; role: string; parts?: Part[] };

/**
 * `message.persisted` names the DB row and the STORED text of the reply that
 * just streamed (banners and rewrites included). Bind the last bubble to it:
 * DB id, and one text part holding the stored text. Non-text parts stay.
 * A resumed turn's `resume-<conv>-<traceId>` id is replaced the same way.
 * When the last message is not an assistant reply there is no bubble for
 * this turn, and an older reply must never be rewritten.
 */
export function bindPersistedMessage<M extends Message>(
  messages: M[],
  persisted: { id: string; content: string },
): M[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return messages;

  const stored = { type: "text", text: persisted.content, state: "done" } as Part;
  const parts: Part[] = [];
  let placed = false;
  for (const part of last.parts ?? []) {
    if (part.type !== "text") parts.push(part);
    else if (!placed) {
      parts.push(stored);
      placed = true;
    }
  }
  if (!placed) parts.push(stored);

  return [...messages.slice(0, -1), { ...last, id: persisted.id, parts }];
}

export type StopOutcome = "pending" | "stopped" | "unconfirmed";

/** The turn the operator stopped: the last message on screen at the tap
 *  (the reply bubble, or the operator's message when no token had arrived). */
export type StoppedTurn = { messageId: string; outcome: StopOutcome };

/**
 * Operator Stop. The DELETE goes out first so the server can mark the turn
 * "aborted" instead of "complete"; the client stream is aborted right after,
 * without waiting, so the reply stops on the tap. A refused or failed DELETE
 * still stops locally: the outcome says the server was not told.
 */
export async function stopTurn({
  conversationId,
  abort,
  fetchImpl = fetch,
}: {
  conversationId: string | null | undefined;
  abort: () => void;
  fetchImpl?: typeof fetch;
}): Promise<Exclude<StopOutcome, "pending">> {
  const told = conversationId
    ? fetchImpl(`/api/ai/chat/${encodeURIComponent(conversationId)}/stream`, {
        method: "DELETE",
        credentials: "same-origin",
      }).then(
        (res) => res.ok,
        () => false,
      )
    : Promise.resolve(false);
  abort();
  return (await told) ? "stopped" : "unconfirmed";
}

/** The DELETE only records the stop; the model and its tools keep running
 *  server side (consumeStream), so no outcome may read as a halt. */
export function stoppedLabel(outcome: StopOutcome): string {
  const label = "Stopped here; Nick finishes in the background";
  return outcome === "unconfirmed" ? `${label}, stop not recorded` : label;
}
