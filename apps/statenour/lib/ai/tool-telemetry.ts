/**
 * TOOL TELEMETRY — Apr 19.
 *
 * Nick has 149+ tools and the semantic tool pruner decides which to
 * ship to the model each turn. But we have NO feedback on which tools
 * are pulling weight. A tool that errors 40% of the time wastes context
 * budget AND produces bad downstream reasoning. A tool nobody calls
 * wastes embedding time.
 *
 * This module provides:
 *   1. `recordToolInvocation` — call once per tool call (success/fail +
 *      duration). UPSERTs the canonical `tool_telemetry` typed table.
 *   2. `getToolStats` — reads aggregate stats for the dashboard +
 *      problem-tools pruning heuristic.
 *
 * The chat route's onFinish walks the tool-call events emitted by
 * streamText and fires recordToolInvocation for each one. Fire-and-
 * forget, 3s cap.
 *
 * v10.0.529.106 · Wave 53 · Phase 3 cutover · the BrainMemory
 * `tool_telemetry` dual-write that ran from v10.0.194 (when the typed
 * table was added) until now has been deleted. ~70 lines of legacy
 * JSON-blob UPSERT removed · all writes now go to the typed table
 * (which has been stable in prod since May 5, 2026). Legacy rows
 * stay in BrainMemory until the category-ttl cron prunes them
 * (deprecated category TTL set to 7d in lib/brain/category-ttl.ts).
 */

import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";

export interface ToolInvocation {
  toolName: string;
  success: boolean;
  durationMs: number;
  /** Short error string when success=false. */
  errorMessage?: string;
  /** Optional conversation id for cross-reference. */
  conversationId?: string;
  /**
   * True when the failure is a MISSING-CONFIG refusal rather than a
   * malfunction. Recorded as a failure in the aggregate row (it must
   * stay visible) but withheld from the circuit breaker -- see
   * isConfigurationError below.
   */
  configError?: boolean;
}

/**
 * A tool that returns `{ error: "FIRECRAWL_API_KEY not set" }` is
 * MISCONFIGURED, not flaky. Before this gate those soft refusals fed
 * the breaker like any other failure, so 5 calls to an unconfigured
 * tool inside 10 minutes stripped it from the toolset for 30 minutes
 * (see FAIL_THRESHOLD / COOLDOWN_MS below, and the pre-prune filter in
 * lib/ai/chat-mode.ts). The operator experienced that as a capability
 * that "sometimes works" -- the tool vanished and came back on its own.
 *
 * The breaker exists to shed tools that MISBEHAVE. An unset env var is
 * not misbehaviour: retrying costs nothing, and hiding the tool only
 * hides the reason it is unavailable. So config errors still increment
 * fail_count and still land in lastErrors -- they just never trip.
 *
 * Deliberately narrow: a genuine fault ("request timed out", "database
 * connection lost") must NOT match, or a truly broken tool would stay
 * in the toolset forever. Asserted both ways in
 * tests/ai/tool-telemetry-config-error.test.ts.
 */
const CONFIG_ERROR_RE =
  /\b(?:not configured|not set|unconfigured|missing (?:the )?(?:api[ -]?)?(?:key|token|credential)s?)\b/i;

// Case-SENSITIVE on purpose: the signal is a SCREAMING_SNAKE env-var
// name ("requires E2B_API_KEY"), not the English word. Folding this
// into CONFIG_ERROR_RE would inherit its /i flag, and "[A-Z]" under /i
// also matches lowercase -- so "requires something" would have been
// read as a config refusal and silently spared the breaker.
const CONFIG_ENV_VAR_RE = /\brequires? [A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;

export function isConfigurationError(message?: string | null): boolean {
  if (!message) return false;
  return CONFIG_ERROR_RE.test(message) || CONFIG_ENV_VAR_RE.test(message);
}

/** Head kept: enough to identify the tool and the shape of the input. */
const ERROR_HEAD = 140;
/** Tail kept: where the REASON lives. Deliberately the larger half. */
const ERROR_TAIL = 300;

/**
 * Condense a tool error for storage WITHOUT discarding why it failed.
 *
 * THE DEFECT THIS REPLACES. This was `errorMessage.slice(0, 200)` — a head
 * truncation. AI SDK validation errors are shaped:
 *
 *   Invalid input for tool X: Type validation failed: Value: {…big json…}.
 *   Error message: <THE ACTUAL REASON>
 *
 * The reason is at the TAIL, and the value dump in front of it is routinely
 * longer than 200 characters. So the stored evidence was the input prefix and
 * never the cause. Measured on production 2026-09-16: all three
 * `createMissionPlan` failures were EXACTLY 200 chars, every one cut off
 * mid-payload — the tool was known to fail 75% of the time and no row said why.
 *
 * It compounds. `lib/ai/tool-description-rewrite.ts` feeds `lastErrors` to an
 * LLM as failure evidence, on the premise that "one LLM pass over a tool's
 * recent failures" fixes the description. Evidence containing no failure reason
 * cannot do that — the rewriter was reading input fragments and guessing.
 *
 * Keeping both ends is format-agnostic: it survives a reason at the tail (AI
 * SDK), a reason at the head (most thrown Errors), and gives up nothing when
 * the message is short enough to keep whole.
 */
export function condenseToolError(raw: string): string {
  const msg = raw.trim();
  if (msg.length <= ERROR_HEAD + ERROR_TAIL) return msg;
  return `${msg.slice(0, ERROR_HEAD)} … [${msg.length - ERROR_HEAD - ERROR_TAIL} chars elided] … ${msg.slice(-ERROR_TAIL)}`;
}

/**
 * Longest real catalog name is 26 chars (`getInstagramAutopostStatus`), and 181
 * of 181 are pure `[A-Za-z][A-Za-z0-9_]*`. 64 leaves generous headroom while
 * staying far below the column's VarChar(120) — the point is to reject payloads,
 * not to police naming.
 *
 * Dots are allowed because historical keys like `arsenal.webSearch` and
 * `memory.remember` exist in this table from an older namespacing scheme. They
 * are not in today's catalog, but they ARE real invocations and must not be
 * reclassified as junk by a guard added years later.
 */
const RECORDABLE_TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/;

/**
 * Is this a tool NAME, or a tool CALL that something mistook for a name?
 *
 * THE ROW THAT FORCED THIS. Production held a `tool_telemetry` row whose
 * `tool_name` was 101 characters of an entire tool-call payload — arguments,
 * newlines, and a stray `</arg_value>` closing tag:
 *
 *     searchColdMemory({
 *       query: "nicks tire instagram post",
 *       ...
 *     })</arg_value>
 *
 * Nothing in this repo emits that encoding — grepped `lib/` and `app/` for
 * `arg_value` and found nothing — so it came from the MODEL's output through a
 * provider/SDK parse that handed back the whole blob as `toolName`. We cannot
 * fix that parser from here, which is exactly why the boundary has to hold.
 *
 * The damage is not one junk row. `tool_name` is the UNIQUE key every reader
 * joins on: the usage census, the never-chosen analysis, and the
 * description-rewrite cron's `lastErrors` evidence. A real `searchColdMemory`
 * call was attributed to the garbage key, so that tool's `totalCalls` is short
 * by at least one and every derived rate inherits the error. A telemetry table
 * that accepts any string as a key cannot be trusted by anything that reads it.
 */
export function isRecordableToolName(name: unknown): name is string {
  return typeof name === "string" && RECORDABLE_TOOL_NAME.test(name);
}

/**
 * Describe a rejected tool name WITHOUT reproducing any of it.
 *
 * ⚠ THE FIRST CUT OF THIS GUARD LEAKED THE PAYLOAD IT REJECTED. It logged
 * `JSON.stringify(name.slice(0, 160))`, and `logError` persists its `message`
 * VERBATIM into `ErrorLog.message` and also `console.warn`s it — while
 * `redactSensitive` covers only the structured `extra` object, never the
 * message. So a malformed call carrying a customer phone number, message body,
 * search query or token would have moved that payload out of the rejected
 * telemetry key and INTO the database and the infrastructure logs. The
 * specimen that prompted this guard already contained real operator content
 * (`query: "nicks tire instagram post"`).
 *
 * A guard that keeps junk out of one table must not pipe it into another. So:
 * length, a stable non-reversible digest for correlating repeats, and a fixed
 * reason code. No substring of the value, ever.
 *
 * The digest is FNV-1a — deliberately not a crypto import on a hot path, and
 * its only job is "is this the same bad name as last time", not secrecy.
 */
export function describeRejectedToolName(name: unknown): {
  reason: string;
  length: number;
  digest: string;
  type: string;
} {
  const type = name === null ? "null" : typeof name;
  if (typeof name !== "string") {
    return { reason: "not-a-string", length: 0, digest: "-", type };
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const reason =
    name.length === 0
      ? "empty"
      : /[\n\r]/.test(name)
        ? "contains-newline"
        : /[(){}[\]<>]/.test(name)
          ? "contains-call-syntax"
          : name.length > 64
            ? "too-long"
            : !/^[A-Za-z]/.test(name)
              ? "bad-first-char"
              : "disallowed-characters";
  return { reason, length: name.length, digest: h.toString(16).padStart(8, "0"), type };
}

/**
 * Record a single tool invocation. Merges into an aggregate row per
 * tool (one row per tool, updated per call) so we can query recent
 * success rates without scanning a massive history.
 *
 * Graceful: never throws. Caller should fire-and-forget.
 */
export async function recordToolInvocation(inv: ToolInvocation): Promise<void> {
  // Refuse a malformed key rather than minting a row for it — but LOUDLY.
  // Dropping it silently would trade a corrupt row for a missing one, and this
  // module's own header is about exactly that trade being a bad one.
  //
  // ⚠ NOT UNDER `instrumentScope(...)`, AND THAT IS THE POINT. The first cut
  // logged this as `instrument.tool_invocation` purely because that name was
  // already in KNOWN_INSTRUMENTS — which is the wrong reason to pick a channel.
  // `buildInstrumentFailures()` defines EVERY `instrument.*` row as an
  // instrument that FAILED TO WRITE, and this path deliberately returns BEFORE
  // the write. So a healthy validation rejection would have rendered on /system
  // as a broken telemetry writer and inflated `totalFailures` — a guard working
  // correctly, reported as the thing it prevents.
  //
  // A refusal is not a write failure. It goes to this module's ordinary error
  // scope, the same one its other two logError calls use, where it is still
  // persisted and still console-visible — just not masquerading as an outage.
  if (!isRecordableToolName(inv.toolName)) {
    // METADATA ONLY — never a substring of the value. See
    // `describeRejectedToolName`: `logError` persists its message verbatim and
    // echoes it to the console, and redaction covers only `extra`.
    const d = describeRejectedToolName(inv.toolName);
    logError(
      "ai.tool-telemetry",
      new Error(
        `refused a non-identifier tool name [reason=${d.reason} type=${d.type} ` +
          `len=${d.length} digest=${d.digest}]`,
      ),
      { fn: "recordToolInvocation", rejected: true, conversationId: inv.conversationId ?? null },
      "warn",
    );
    return;
  }
  try {
    const successDelta = inv.success ? 1 : 0;
    const failDelta = inv.success ? 0 : 1;
    const errorMessage = !inv.success && inv.errorMessage
      ? condenseToolError(inv.errorMessage)
      : null;

    // v10.0.194 → v10.0.529.106 Wave 53 · canonical typed write.
    //
    // Same atomic-merge contract: ON CONFLICT increments counters,
    // appends the latest error to lastErrors[] (capped at 5),
    // recomputes failure_rate_pct on every write so the dashboard
    // sort doesn't need a derived view. Failures here are silent
    // (caught in the outer try/catch).
    const errPayload = errorMessage
      ? JSON.stringify([{ message: errorMessage, at: Date.now() }])
      : "[]";
    await prisma.$executeRaw`
      INSERT INTO tool_telemetry (
        id, tool_name, total_calls, success_count, fail_count,
        total_duration_ms, last_errors, last_call_at,
        failure_rate_pct, created_at, updated_at
      )
      VALUES (
        gen_random_uuid()::text,
        ${inv.toolName},
        1,
        ${successDelta}::int,
        ${failDelta}::int,
        ${inv.durationMs}::bigint,
        ${errPayload}::jsonb,
        NOW(),
        ${inv.success ? 0 : 100}::float,
        NOW(),
        NOW()
      )
      ON CONFLICT (tool_name) DO UPDATE SET
        total_calls = tool_telemetry.total_calls + 1,
        success_count = tool_telemetry.success_count + ${successDelta}::int,
        fail_count = tool_telemetry.fail_count + ${failDelta}::int,
        total_duration_ms = tool_telemetry.total_duration_ms + ${inv.durationMs}::bigint,
        last_errors = CASE
          WHEN ${errorMessage}::text IS NULL THEN tool_telemetry.last_errors
          ELSE (
            -- Append new error then keep last 5
            SELECT jsonb_agg(elem)
            FROM (
              SELECT elem
              FROM jsonb_array_elements(
                tool_telemetry.last_errors ||
                jsonb_build_array(jsonb_build_object('message', ${errorMessage}::text, 'at', extract(epoch from now()) * 1000))
              ) AS elem
              ORDER BY (elem->>'at')::float DESC
              LIMIT 5
            ) sub
          )
        END,
        last_call_at = NOW(),
        failure_rate_pct = CASE
          WHEN (tool_telemetry.total_calls + 1) >= 10
          THEN ((tool_telemetry.fail_count + ${failDelta}::int)::float
                / (tool_telemetry.total_calls + 1)::float) * 100
          ELSE NULL
        END,
        updated_at = NOW()
    `;

    // Update circuit breaker state — block tools that misbehave
    // before they cost more turns. See block at bottom of file for
    // the breaker semantics.
    // Classified HERE, not at the call site. The first version of this
    // trusted every caller to set `configError`, and invokeTool
    // (lib/ai/tools/meta.ts, the recovery lane) records proxied failures
    // without it -- so five recovery attempts against a tool returning
    // "FIRECRAWL_API_KEY not set" would still have opened the breaker and
    // hidden that tool for 30 minutes, reintroducing the exact defect
    // this gate removes, on the path newly advertised to the model.
    // The explicit flag still wins when a caller sets it.
    const isConfig = inv.configError ?? isConfigurationError(inv.errorMessage);
    if (inv.success) recordToolSuccess(inv.toolName);
    else if (!isConfig) recordToolFailure(inv.toolName);
  } catch (err) {
    // Telemetry failures must never break chat. Swallow silently; the
    // next invocation will attempt again.
    logError("ai.tool-telemetry", err, { fn: "recordToolInvocation" });
    console.warn(
      "[tool-telemetry] record failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

export interface ToolStat {
  toolName: string;
  totalCalls: number;
  successRate: number;        // 0-1
  avgDurationMs: number;
  failCount: number;
  lastCallAt?: number;
  lastErrors: Array<{ message: string; at: number }>;
}

/**
 * Fetch aggregate stats for all tools. Sorted by totalCalls descending
 * by default. Used by the brain dashboard + the future low-success
 * tool pruning hint.
 *
 * v10.0.529.106 · Wave 53 · reads the canonical ToolTelemetry typed
 * table directly · pre-Wave-53 this was a BrainMemory JSON-blob read
 * which required client-side parsing of metadata fields. Typed reads
 * are ~10x faster (no JSON parse, indexed sort key, BigInt converted
 * once here for the Number-API consumers).
 *
 * ── THROWS on a read failure (2026-09-02) ──
 * This used to `logError(...)` and `return []`. Every consumer is a
 * DASHBOARD, and every one of them then rebuilt its rows from
 * TOOL_CATALOG, so a dead database rendered all 185 tools GREEN with
 * `totalCalls: 0, successRate: 0` and an empty problem list — the exact
 * "confident zero" shape as brain-maturity's phantom 7. The tRPC
 * procedure at lib/trpc/routers/brain.ts:1060-1064 physically COULD NOT
 * error, so ToolTelemetryPanel had nothing to branch on.
 *
 * Letting it throw is the fix: React Query surfaces `isError`, the panel
 * says "unknown, not empty", and /api/brain/tools 500s instead of
 * serving a fabricated all-clear. The one caller that genuinely wants
 * degrade-to-empty (lib/services/system-pages-b.ts:303) already writes
 * its own `.catch(() => [])` at the call site — which is the difference
 * that matters: an opt-out you can read, not one hidden in the callee.
 * The error is still logged here so the trail survives whatever the
 * caller does with it.
 */
export async function getToolStats(limit = 50): Promise<ToolStat[]> {
  const rows = await prisma.toolTelemetry
    .findMany({
      orderBy: { totalCalls: "desc" },
      take: limit,
      select: {
        toolName: true,
        totalCalls: true,
        successCount: true,
        failCount: true,
        totalDurationMs: true,
        lastErrors: true,
        lastCallAt: true,
      },
    })
    .catch((err: unknown): never => {
      logError("ai.tool-telemetry", err, { fn: "getToolStats.findMany" });
      throw err;
    });

  return rows.map((row) => {
    // totalDurationMs is BigInt — convert once to Number for the
    // arithmetic. Safe because Number's 2^53 ceiling represents
    // ~285 thousand years of ms · we'll cap out elsewhere first.
    const durationMs = Number(row.totalDurationMs);
    const avgDurationMs =
      row.totalCalls > 0 ? Math.round(durationMs / row.totalCalls) : 0;
    const errors = (row.lastErrors as Array<{ message: string; at: number }> | null) ?? [];
    return {
      toolName: row.toolName,
      totalCalls: row.totalCalls,
      successRate: row.totalCalls > 0 ? row.successCount / row.totalCalls : 0,
      avgDurationMs,
      failCount: row.failCount,
      lastCallAt: row.lastCallAt ? row.lastCallAt.getTime() : undefined,
      lastErrors: errors,
    };
  });
}

/** A tool with ≥ this many lifetime calls is eligible for the rate lane. */
const LIFETIME_MIN_CALLS = 10;
/** Lifetime success rate below this trips the lane. */
const LIFETIME_RATE_FLOOR = 0.5;

/**
 * Tools currently worth an alarm. TWO lanes, because one of them cannot
 * fire for the tools whose failure costs most.
 *
 * ── LANE 1 · lifetime rate (the old, structurally-dead one) ──
 * `totalCalls >= 10 && successRate < 0.5` over the counters at :87-89,
 * which ONLY ever increment — no window, no decay, and no reset path
 * anywhere in this repo. Do the arithmetic: a tool with 1,000 lifetime
 * calls at a 95% historical rate needs more than 500 CONSECUTIVE failures
 * before its lifetime rate crosses 0.5. It is 100% broken today and this
 * lane stays silent for days. The lane is kept because it is the right
 * signal for a young tool that has never worked; it is not, and never
 * was, a signal about now.
 *
 * ── LANE 2 · the circuit breaker (recent behaviour) ──
 * The breaker below already measures exactly what lane 1 cannot: 5
 * failures inside a 10-minute rolling window, with `recordToolSuccess`
 * clearing the window on any success. Its state was tripped on every real
 * outage and surfaced NOWHERE on /brain. Unioning it in makes the alarm
 * fire on today's behaviour with zero new persistence and zero new
 * thresholds to tune — the repo already chose these.
 *
 * KNOWN LIMIT of lane 2: `breakerState` is an in-process Map, so it is
 * empty for the first 10 minutes after a deploy or restart, and a tool
 * that broke before the restart shows clean until it fails 5 more times.
 * Lane 1 is the (slow) durable backstop for that. A persisted recent-
 * failure window would close it properly; that is a schema change, and
 * deliberately not made here.
 */
export async function getProblemTools(): Promise<string[]> {
  const stats = await getToolStats(100);
  const lifetime = stats
    .filter(
      (s) =>
        s.totalCalls >= LIFETIME_MIN_CALLS &&
        s.successRate < LIFETIME_RATE_FLOOR,
    )
    .map((s) => s.toolName);
  const acute = getBlockedTools().map((b) => b.toolName);
  // Acute first — a tool that is broken RIGHT NOW is the one to look at.
  return [...new Set([...acute, ...lifetime])];
}

// ═══════════════════════════════════════════════════════════════
// CIRCUIT BREAKER
// ═══════════════════════════════════════════════════════════════
// Tools that fail ≥ 5 times within a 10-minute rolling window get
// removed from the toolset for COOLDOWN_MS. This prevents:
//   1. Repeated failed tool calls eating context budget every turn
//   2. Cascading slow turns when a tool is genuinely broken
//   3. Cost waste on retries against dead tools
//
// Listing is in-memory (per-lambda) — fine for serverless because a
// dead tool typically affects ALL parallel instances simultaneously
// (e.g. 3rd-party API down). Each lambda will trip the breaker on
// its own. Reset is automatic when COOLDOWN_MS elapses.

const FAIL_THRESHOLD = 5;
const FAIL_WINDOW_MS = 10 * 60_000; // 10 min
const COOLDOWN_MS = 30 * 60_000; // 30 min

interface BreakerEntry {
  /** Recent failure timestamps, trimmed to FAIL_WINDOW_MS. */
  failures: number[];
  /** When the breaker tripped open. Tool blocked until at + COOLDOWN_MS. */
  trippedAt?: number;
}

const breakerState = new Map<string, BreakerEntry>();

/**
 * Record a tool failure. Returns true if this failure tripped the
 * breaker (caller may want to log a louder warning).
 */
export function recordToolFailure(toolName: string): boolean {
  const now = Date.now();
  const cutoff = now - FAIL_WINDOW_MS;
  const entry = breakerState.get(toolName) ?? { failures: [] };
  entry.failures = entry.failures.filter((t) => t >= cutoff);
  entry.failures.push(now);
  if (entry.failures.length >= FAIL_THRESHOLD && !entry.trippedAt) {
    entry.trippedAt = now;
    breakerState.set(toolName, entry);
    console.warn(
      `[tool-breaker] OPEN: ${toolName} — ${FAIL_THRESHOLD}+ failures in ${FAIL_WINDOW_MS / 60_000}min. Blocking for ${COOLDOWN_MS / 60_000}min.`,
    );
    return true;
  }
  breakerState.set(toolName, entry);
  return false;
}

/** Record a successful call. Resets the failure window. */
export function recordToolSuccess(toolName: string): void {
  const entry = breakerState.get(toolName);
  if (!entry) return;
  // Don't auto-reset trippedAt — the cooldown stands. But a success
  // does clear the failure count to prevent immediate retrip after
  // half-cooldown semi-recovery scenarios.
  entry.failures = [];
  breakerState.set(toolName, entry);
}

/**
 * Check whether a tool is currently blocked by the breaker. Used by
 * the tool selector to filter blocked tools out of the per-turn set.
 */
export function isToolBlocked(toolName: string): boolean {
  const entry = breakerState.get(toolName);
  if (!entry?.trippedAt) return false;
  const now = Date.now();
  if (now - entry.trippedAt >= COOLDOWN_MS) {
    // Cooldown elapsed — half-open: clear trip + failures, allow retry.
    entry.trippedAt = undefined;
    entry.failures = [];
    breakerState.set(toolName, entry);
    console.info(`[tool-breaker] HALF-OPEN: ${toolName} — cooldown elapsed, allowing retry.`);
    return false;
  }
  return true;
}

/** List currently-blocked tools (for /system/chat-health visibility). */
export function getBlockedTools(): Array<{
  toolName: string;
  trippedAt: number;
  remainingMs: number;
}> {
  const now = Date.now();
  const out: Array<{ toolName: string; trippedAt: number; remainingMs: number }> = [];
  for (const [toolName, entry] of breakerState) {
    if (!entry.trippedAt) continue;
    const remaining = COOLDOWN_MS - (now - entry.trippedAt);
    if (remaining > 0) {
      out.push({ toolName, trippedAt: entry.trippedAt, remainingMs: remaining });
    }
  }
  return out;
}

/** Manual reset — used from /system/chat-health "reset breaker" button. */
export function resetToolBreaker(toolName: string): void {
  breakerState.delete(toolName);
}
