/**
 * Voice call state tracker · 2026-05-18 PM · Phase 4 (orchestration).
 *
 * Why this exists · per the ai-agent-development workflow audit, the
 * VAPI shop Nick had no explicit state machine — every call was an
 * opaque LLM session and the only post-hoc observability was the
 * end-of-call transcript. This made it impossible to assert "agent
 * reached `confirming` before firing the booking webhook" or to know
 * how many calls were stuck in `intent_captured` at any moment.
 *
 * Design choice · reuse the existing `voice_latency_events` table
 * (already has callId + assistantId + stage + metadata + created_at
 * with the right indexes) by namespacing the stage column as
 * `state_<name>`. Zero schema migrations, drift-proof against the
 * existing voice_latency_events dashboard.
 *
 * State machine
 * -------------
 *   greeted          ← `status-update` / `call-start` webhook fires
 *   intent_captured  ← agent calls a READ / hand-off tool (shopInfo,
 *                       capacityCheck, getCurrentWaitTime, quoteRange,
 *                       tireSizeFromVehicle, lookupCustomer,
 *                       getDeclinedEstimate, checkTireStock)
 *   tool_called      ← agent calls a WRITE tool — one that durably persists a
 *                       row (bookSlot, tireInquiry, scheduleCallback, escalate)
 *   confirmed        ← agent calls sendConfirmationSms (the success
 *                       acknowledgment to the customer)
 *   ended            ← `end-of-call-report` webhook fires (metadata
 *                       carries the endedReason)
 *
 * States are append-only (multiple `intent_captured` entries per call
 * are fine and useful · the trail tells you the agent re-engaged after
 * a tool call). Latest-state-per-call is the live "where is this
 * customer now" view.
 *
 * Fail-open · all writes are fire-and-forget · a telemetry bug NEVER
 * breaks a live call's webhook response.
 */

import { createLogger } from "../lib/logger";

const log = createLogger("services:voice-call-state");

export type CallState =
  | "greeted"
  | "intent_captured"
  | "tool_called"
  | "confirmed"
  | "ended";

const STATE_STAGE_PREFIX = "state_";

// Classification source-of-truth · keep in sync with the tool dispatcher
// in `server/routes/webhooks/vapi.ts`. New tools default to NO state
// transition (returning null) so adding a tool is safe by default.
const READ_TOOLS = new Set([
  "shopInfo",
  "capacityCheck",
  "getCurrentWaitTime",
  "quoteRange",
  "tireSizeFromVehicle",
  "lookupCustomer",
  "getDeclinedEstimate",
  // 2026-07-20 · checkTireStock MOVED here from WRITE_TOOLS. It used to write a
  // leads row; it now hands the caller to a person and captures nothing, which
  // makes it a read/hand-off tool exactly like getCurrentWaitTime above.
  // Leaving it in WRITE_TOOLS recorded `tool_called` → trailReachedTool() true
  // → vapi_call_logs.convertedToLead = 1, so every caller who merely asked "do
  // you have my size?" counted as a converted lead with no lead behind it.
  "checkTireStock",
]);
/**
 * Tools that DURABLY PERSIST something a human can act on later — the basis of
 * the conversion signal. A tool belongs here only if a row survives the call.
 */
const WRITE_TOOLS = new Set([
  "bookSlot",
  "tireInquiry",
  "scheduleCallback",
  "escalate",
]);
const CONFIRM_TOOLS = new Set(["sendConfirmationSms"]);

/**
 * Classify a tool-call name into the state it transitions the call to.
 * Returns null for unrecognized tools (no transition) — safe default
 * for new tools added to the dispatcher.
 */
export function classifyToolToState(toolName: string): CallState | null {
  if (READ_TOOLS.has(toolName)) return "intent_captured";
  if (WRITE_TOOLS.has(toolName)) return "tool_called";
  if (CONFIRM_TOOLS.has(toolName)) return "confirmed";
  return null;
}

/**
 * Record a state transition for a call. Fire-and-forget — never throws,
 * never blocks. Reuses voice_latency_events (stage column namespaced
 * with `state_` prefix · metadata column carries call-specific context).
 *
 * latencyMs is unused for state events (set to 0) · the table's column
 * is NOT NULL so we must provide a value.
 */
export async function recordCallState(args: {
  callId: string;
  assistantId?: string | null;
  state: CallState;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const { voiceLatencyEvents } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) return;

    await db.insert(voiceLatencyEvents).values({
      callId: args.callId,
      assistantId: args.assistantId || "unknown",
      stage: `${STATE_STAGE_PREFIX}${args.state}`,
      latencyMs: 0,
      metadata: args.metadata ?? null,
    });
  } catch (err) {
    // Swallow · telemetry failure must NEVER break a live call.
    log.warn("recordCallState failed", {
      callId: args.callId,
      state: args.state,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface ActiveCallSnapshot {
  callId: string;
  assistantId: string;
  latestState: CallState;
  enteredAt: Date;
  stateAgeSeconds: number;
}

/**
 * Return the latest state per call within the lookback window. Default
 * 10 minutes covers a typical 3-minute call plus 7 minutes for "just
 * ended". Calls in `ended` state are excluded · they're done.
 */
export async function getActiveCallStates(opts?: {
  maxAgeMinutes?: number;
}): Promise<ActiveCallSnapshot[]> {
  const maxAge = opts?.maxAgeMinutes ?? 10;
  try {
    const { getDb } = await import("../db");
    const { voiceLatencyEvents } = await import("../../drizzle/schema");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return [];

    const since = new Date(Date.now() - maxAge * 60 * 1000);

    // Pull every state event in window · group in JS by callId · take
    // the most recent state per call. Small data volume (typically <100
    // events in 10 min) so in-memory rollup is fine.
    const rows = (await db
      .select({
        callId: voiceLatencyEvents.callId,
        assistantId: voiceLatencyEvents.assistantId,
        stage: voiceLatencyEvents.stage,
        createdAt: voiceLatencyEvents.createdAt,
      })
      .from(voiceLatencyEvents)
      .where(sql`${voiceLatencyEvents.stage} LIKE 'state_%' AND ${voiceLatencyEvents.createdAt} >= ${since}`)
      .orderBy(sql`${voiceLatencyEvents.createdAt} DESC`)) as Array<{
      callId: string;
      assistantId: string;
      stage: string;
      createdAt: Date;
    }>;

    const seen = new Map<string, ActiveCallSnapshot>();
    const now = Date.now();
    for (const row of rows) {
      if (seen.has(row.callId)) continue;
      const state = row.stage.replace(STATE_STAGE_PREFIX, "") as CallState;
      if (state === "ended") {
        // Mark as seen-but-skip · prevents this row's `ended` from being
        // overwritten by an earlier `intent_captured` in the same window.
        seen.set(row.callId, {
          callId: row.callId,
          assistantId: row.assistantId,
          latestState: "ended",
          enteredAt: row.createdAt,
          stateAgeSeconds: Math.floor((now - row.createdAt.getTime()) / 1000),
        });
        continue;
      }
      seen.set(row.callId, {
        callId: row.callId,
        assistantId: row.assistantId,
        latestState: state,
        enteredAt: row.createdAt,
        stateAgeSeconds: Math.floor((now - row.createdAt.getTime()) / 1000),
      });
    }
    // Return only active (non-ended) calls.
    return Array.from(seen.values()).filter((s) => s.latestState !== "ended");
  } catch (err) {
    log.warn("getActiveCallStates failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export interface CallStateHistoryEntry {
  state: CallState;
  at: Date;
  metadata: Record<string, unknown> | null;
}

/**
 * Full state trail for a single call · ordered oldest → newest. Used
 * by the admin "drill in to one call" view and by post-hoc audits
 * (e.g. "why did this call end without confirmation?").
 */
export async function getCallStateHistory(
  callId: string,
): Promise<CallStateHistoryEntry[]> {
  try {
    const { getDb } = await import("../db");
    const { voiceLatencyEvents } = await import("../../drizzle/schema");
    const { eq, and, sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return [];

    const rows = (await db
      .select({
        stage: voiceLatencyEvents.stage,
        metadata: voiceLatencyEvents.metadata,
        createdAt: voiceLatencyEvents.createdAt,
      })
      .from(voiceLatencyEvents)
      .where(and(
        eq(voiceLatencyEvents.callId, callId),
        sql`${voiceLatencyEvents.stage} LIKE 'state_%'`,
      ))
      .orderBy(voiceLatencyEvents.createdAt)) as Array<{
      stage: string;
      metadata: Record<string, unknown> | null;
      createdAt: Date;
    }>;

    return rows.map((r) => ({
      state: r.stage.replace(STATE_STAGE_PREFIX, "") as CallState,
      at: r.createdAt,
      metadata: r.metadata,
    }));
  } catch (err) {
    log.warn("getCallStateHistory failed", {
      callId,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
