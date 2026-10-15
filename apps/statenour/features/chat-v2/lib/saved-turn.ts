import type { UIMessage } from "ai";
import { turnHasSideEffect } from "./turn-side-effect";

/**
 * What the saved record of the latest turn says, for the one case a live bubble
 * cannot answer: a turn that ended in a stream error. ai@6 forwards an error part
 * and keeps going, so a tool-call plus finish(tool-calls) after it still runs the
 * tool on the server, while the client SDK rethrows on the error chunk and the
 * bubble never shows it. Retry in that state reads the saved rows and judges them
 * with the same gate as any reloaded row.
 */
export type SavedRow = { id?: unknown; role?: unknown; content?: unknown; parts?: unknown; streamingState?: unknown; tokenUsage?: unknown };
export type SavedTurnVerdict = "safe" | "ran" | "unconfirmed";

export const RETRY_HELD_RAN = "That reply already ran an action, so it can't be replayed. Send a new message instead.";
export const RETRY_HELD_UNCONFIRMED =
  "Nick can't confirm yet that reply didn't already do part of the work, so Retry is held. Wait a moment and tap Retry again, or send a new message.";

/** The assistant rows saved for the latest turn: everything after the last user message. */
export function latestTurnRows(messages: readonly SavedRow[]): SavedRow[] {
  let lastUser = -1;
  messages.forEach((m, i) => {
    if (m?.role === "user") lastUser = i;
  });
  return messages.slice(lastUser + 1).filter((m) => m?.role === "assistant");
}

function asGateMessage(row: SavedRow): UIMessage {
  const parts = Array.isArray(row.parts) && row.parts.length > 0 ? row.parts : [{ type: "text", text: typeof row.content === "string" ? row.content : "" }];
  return { id: String(row.id ?? ""), role: "assistant", parts, streamingState: row.streamingState, tokenUsage: row.tokenUsage } as unknown as UIMessage;
}

// Not settled: the writer said it cannot vouch yet (or ever), or the row carries no receipts array.
function unsettled(row: SavedRow): boolean {
  const usage = row.tokenUsage as { toolReceipts?: unknown; receiptsUnavailable?: unknown } | null | undefined;
  return usage?.receiptsUnavailable === true || !Array.isArray(usage?.toolReceipts);
}

/**
 * safe: every saved row says nothing a replay would repeat. ran: a settled row
 * records a write (or an action block). unconfirmed: nothing saved, nothing read,
 * or a row not settled yet. A known write is said plainly, ahead of "unconfirmed".
 */
export function savedTurnVerdict(rows: readonly SavedRow[] | null | undefined): SavedTurnVerdict {
  if (!rows || rows.length === 0) return "unconfirmed";
  const refused = rows.map((row) => turnHasSideEffect(asGateMessage(row)));
  if (rows.some((row, i) => refused[i] && !unsettled(row))) return "ran";
  if (rows.some((row, i) => refused[i] || unsettled(row))) return "unconfirmed";
  return "safe";
}
