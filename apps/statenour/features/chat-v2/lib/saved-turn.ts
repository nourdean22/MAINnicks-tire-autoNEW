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

// The records are lower bounds: a tool-call chunk counts before the tool executes, and an
// action block in partial text may never have run. So "may", not "did".
export const RETRY_HELD_RAN = "That reply may already have run an action, so it can't be replayed. Send a new message instead.";
// A hold that can clear: the row is not written or settled yet, or the read failed or timed out.
export const RETRY_HELD_UNCONFIRMED =
  "Nick can't confirm yet that reply didn't already do part of the work, so Retry is held. Wait a moment and tap Retry again, or send a new message.";
// A hold that never clears: there is no saved record to read (Private Lab, no conversation).
export const RETRY_HELD_NO_RECORD =
  "Nothing was saved for that reply, so Nick can't check whether it already did part of the work. Send a new message instead.";

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

/** The trace id of the attempt that wrote this row (the errored row and the final row both carry it). */
function traceOf(row: SavedRow): string | undefined {
  const trace = (row.tokenUsage as { traceId?: unknown } | null | undefined)?.traceId;
  return typeof trace === "string" && trace.length > 0 ? trace : undefined;
}

/**
 * safe: every saved row says nothing a replay would repeat. ran: a settled row
 * records a write (or an action block). unconfirmed: nothing saved, nothing read,
 * a row not settled yet, or a row the gate cannot read (the gate throwing on a
 * malformed row fails closed, never to the caller). A known write is said plainly,
 * ahead of "unconfirmed".
 */
export function savedTurnVerdict(rows: readonly SavedRow[] | null | undefined): SavedTurnVerdict {
  try {
    if (!rows || rows.length === 0) return "unconfirmed";
    const refused = rows.map((row) => turnHasSideEffect(asGateMessage(row)));
    if (rows.some((row, i) => refused[i] && !unsettled(row))) return "ran";
    if (rows.some((row, i) => refused[i] || unsettled(row))) return "unconfirmed";
    return "safe";
  } catch {
    return "unconfirmed";
  }
}

/**
 * The verdict Retry acts on, for the attempt that failed (`attemptTraceId`, the trace
 * the server answered that attempt with).
 *
 * A regenerate resends the same user message and the server dedupes it, so an older
 * attempt's assistant row stays among the latest turn's rows. A clean row from attempt 1
 * says nothing about attempt 2, which may be mid-tool with no row of its own yet. So
 * "safe" needs every row clean AND a saved row that names the failed attempt; without
 * one the answer is "unconfirmed". Any throw is "unconfirmed" too.
 */
export function judgeSavedTurn(messages: readonly SavedRow[] | null | undefined, attemptTraceId: string | null | undefined): SavedTurnVerdict {
  try {
    if (!messages || typeof attemptTraceId !== "string" || attemptTraceId.length === 0) return "unconfirmed";
    const rows = latestTurnRows(messages);
    const verdict = savedTurnVerdict(rows);
    if (verdict !== "safe") return verdict;
    return rows.some((row) => traceOf(row) === attemptTraceId) ? "safe" : "unconfirmed";
  } catch {
    return "unconfirmed";
  }
}
