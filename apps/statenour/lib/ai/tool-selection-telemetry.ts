/**
 * Tool SELECTION telemetry — the counterpart to tool-telemetry.ts.
 *
 * `tool-telemetry.ts` records what happened when a tool RAN. Nothing
 * recorded which tools were ever *offered* to the model. That asymmetry
 * is why the pruner in `chat-mode.ts` could drop a tool the model needed
 * and leave no trace, and why its ~40 keyword regexes could only be
 * maintained reactively — one anecdote at a time, after a capability
 * was already reported missing.
 *
 * The highest-signal event recorded here is `searchToolsFired`: that is
 * the model explicitly reporting the pruner missed. Joining that query
 * to the tool it eventually reached for is the training set for
 * replacing tier 4 with retrieval.
 *
 * ── Fail-soft, but never silent ──
 * The backing tables do not exist until
 * `prisma/migrations-pending/20260903120000_tool_selection_telemetry`
 * is applied, so every write is wrapped. But a swallowed write that
 * reports nothing is exactly the "failed read rendering as a confident
 * zero" defect this module exists to prevent — so failures increment an
 * in-process counter that `getSelectionTelemetryHealth()` exposes, and
 * the panel reads that to distinguish "no pruner misses" from "the
 * recorder is broken".
 */

import { logError } from "@/lib/utils/error-log";

export type GateVerdict =
  | "ALLOWED"
  | "BUDGETED_OUT"
  | "NOT_FOUND"
  | "BLOCKED_BREAKER";

/** Which tier of pruneTools()'s cascade supplied a candidate. */
export const SELECTION_TIER = {
  CORE: 1,
  ACTION_CORE: 2,
  EXACT_MENTION: 3,
  KEYWORD_FAMILY: 4,
  SEMANTIC: 5,
  DEFAULT_EXTRAS: 6,
  /** U7 (2026-09-08) · attached by an intent playbook (lib/ai/tools/playbooks.ts). */
  PLAYBOOK: 7,
} as const;

export interface GateDecision {
  toolName: string;
  verdict: GateVerdict;
  tier?: number;
  rank?: number;
  score?: number;
  reason?: string;
}

export interface SelectionTurn {
  turnId: string;
  conversationId?: string;
  mode: string;
  candidateCount: number;
  selectedCount: number;
  budget: number;
  budgetTruncated: boolean;
  /** Whether the semantic tier was eligible and actually evaluated. */
  semanticTierAttempted: boolean;
  embeddingCacheWarm: boolean;
  decisions: GateDecision[];
}

// ── Health counters ──────────────────────────────────────────────
// Module-level, lambda-instance scoped. Deliberately NOT persisted:
// their only job is to make a persistently-failing writer visible on
// the dashboard instead of looking like an empty table.
let writesAttempted = 0;
let writesFailed = 0;
let lastWriteError: string | null = null;
let lastWriteErrorAt: number | null = null;

export function getSelectionTelemetryHealth(): {
  writesAttempted: number;
  writesFailed: number;
  lastWriteError: string | null;
  lastWriteErrorAt: number | null;
  /** True when every attempted write in this instance has failed —
   *  i.e. an empty table means "broken", not "nothing to report". */
  looksBroken: boolean;
} {
  return {
    writesAttempted,
    writesFailed,
    lastWriteError,
    lastWriteErrorAt,
    looksBroken: writesAttempted > 0 && writesFailed === writesAttempted,
  };
}

/** Test seam — reset counters between cases. */
export function __resetSelectionTelemetryHealth(): void {
  writesAttempted = 0;
  writesFailed = 0;
  lastWriteError = null;
  lastWriteErrorAt = null;
}

/**
 * Persist one turn's selection decision. Fire-and-forget: the caller
 * must not await this on the request path.
 */
export async function recordToolSelection(turn: SelectionTurn): Promise<void> {
  writesAttempted += 1;
  try {
    const { prisma } = await import("@/lib/prisma");

    const selection = {
      conversationId: turn.conversationId ?? null,
      mode: turn.mode.slice(0, 24),
      candidateCount: turn.candidateCount,
      selectedCount: turn.selectedCount,
      budget: turn.budget,
      budgetTruncated: turn.budgetTruncated,
      semanticTierAttempted: turn.semanticTierAttempted,
      embeddingCacheWarm: turn.embeddingCacheWarm,
    };
    // A recovery tool can execute immediately after preparation while this
    // fire-and-forget write is still in flight. Upsert preserves that early
    // miss signal instead of letting either path lose a unique-row race.
    await prisma.toolSelectionTurn.upsert({
      where: { turnId: turn.turnId },
      update: selection,
      create: { turnId: turn.turnId, ...selection },
    });

    if (turn.decisions.length > 0) {
      await prisma.toolGateDecision.createMany({
        data: turn.decisions.map((d) => ({
          turnId: turn.turnId,
          toolName: d.toolName.slice(0, 120),
          verdict: d.verdict,
          tier: d.tier ?? null,
          rank: d.rank ?? null,
          score: d.score ?? null,
          reason: d.reason ? d.reason.slice(0, 200) : null,
        })),
      });
    }
  } catch (err) {
    writesFailed += 1;
    lastWriteError = err instanceof Error ? err.message : String(err);
    lastWriteErrorAt = Date.now();
    void logError("ai.tool-selection-telemetry", err, {
      fn: "recordToolSelection",
      turnId: turn.turnId,
    });
  }
}

/**
 * Mark that the model reached past its attached toolset. This is the
 * pruner's miss signal, so it is recorded as an update to the turn
 * rather than folded into the initial write (searchTools fires later,
 * during generation).
 */
export async function markSearchToolsFired(
  turnId: string,
  query: string
): Promise<void> {
  writesAttempted += 1;
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.toolSelectionTurn.upsert({
      where: { turnId },
      update: {
        searchToolsFired: true,
        searchToolsQuery: query.slice(0, 500),
      },
      create: {
        turnId,
        mode: "unknown",
        candidateCount: 0,
        selectedCount: 0,
        budget: 0,
        budgetTruncated: false,
        semanticTierAttempted: null,
        embeddingCacheWarm: false,
        searchToolsFired: true,
        searchToolsQuery: query.slice(0, 500),
      },
    });
  } catch (err) {
    writesFailed += 1;
    lastWriteError = err instanceof Error ? err.message : String(err);
    lastWriteErrorAt = Date.now();
    void logError("ai.tool-selection-telemetry", err, {
      fn: "markSearchToolsFired",
      turnId,
    });
  }
}

/**
 * Record whether a toolChoice force was actually honored.
 *
 * `build-stream-config.ts` runs a toolChoice ladder: a step-0 force for
 * action intents, a `runPython` pin, an `arsenalWebSearch` pin, and a
 * last-step clamp to `toolChoice: "none"`. Whether the provider honors
 * any of that is a PROVIDER CAPABILITY, and nothing checked it.
 *
 * Ollama Cloud (prod primary) does not list `tool_choice` in its
 * OpenAI-compat surface and omits it from the native `/api/chat` schema.
 * The repo's own receipt — "deepseek-v4-pro honors strict tool_choice
 * via Ollama's OpenAI-compat endpoint (probed live)",
 * build-stream-config.ts:273 — was taken 2026-07-15 on a model since
 * RETIRED upstream, and was never re-probed against the current pin.
 *
 * So this does not assume the force works OR that it is broken. It
 * records the outcome: `forcedToolHonored=false` on a run of turns is
 * the smoking gun; an empty run is the all-clear. That is the same
 * discipline as the rest of this module - make the silent thing visible
 * rather than argue about it.
 */
export async function markForcedTool(
  turnId: string,
  forcedToolName: string,
  honored: boolean,
  provider?: string,
  modelId?: string
): Promise<void> {
  writesAttempted += 1;
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.toolSelectionTurn.update({
      where: { turnId },
      data: {
        forcedToolName: forcedToolName.slice(0, 120),
        forcedToolHonored: honored,
        provider: provider ? provider.slice(0, 32) : undefined,
        modelId: modelId ? modelId.slice(0, 120) : undefined,
      },
    });
  } catch (err) {
    writesFailed += 1;
    lastWriteError = err instanceof Error ? err.message : String(err);
    lastWriteErrorAt = Date.now();
    void logError("ai.tool-selection-telemetry", err, {
      fn: "markForcedTool",
      turnId,
    });
  }
}


// ── Forced-tool intent, held between decision time and persist time ──
// build-stream-config.ts decides the force; the captured tool calls are
// only known later, in persist-assistant-turn.ts. Rather than thread a
// new field through both signatures, the intent parks here keyed by
// traceId. Bounded FIFO so an abandoned turn cannot leak.
const MAX_PENDING = 500;
const pendingForce = new Map<
  string,
  { toolName: string; provider?: string; modelId?: string }
>();

/** Called at decision time, where the force is chosen. */
export function noteForcedTool(
  traceId: string,
  toolName: string,
  provider?: string,
  modelId?: string
): void {
  if (!traceId || !toolName) return;
  if (pendingForce.size >= MAX_PENDING) {
    const oldest = pendingForce.keys().next().value;
    if (oldest !== undefined) pendingForce.delete(oldest);
  }
  pendingForce.set(traceId, { toolName, provider, modelId });
}

/** Test seam. */
export function __pendingForceSize(): number {
  return pendingForce.size;
}

/**
 * Called at persist time with the tools that ACTUALLY fired this turn.
 * Resolves the parked intent into a row and clears it. No-ops when no
 * force was requested, so it is safe to call on every turn.
 *
 * Uses upsert, not update: the forced-tool signal must be recordable
 * even on turns where pruneTools did not emit a selection row, so the
 * two paths stay independent.
 */
export async function resolveForcedTool(
  traceId: string,
  calledToolNames: string[],
  ctx?: { mode?: string; budget?: number }
): Promise<void> {
  const intent = pendingForce.get(traceId);
  if (!intent) return;
  pendingForce.delete(traceId);

  const honored = calledToolNames.includes(intent.toolName);
  writesAttempted += 1;
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.toolSelectionTurn.upsert({
      where: { turnId: traceId },
      update: {
        forcedToolName: intent.toolName.slice(0, 120),
        forcedToolHonored: honored,
        provider: intent.provider ? intent.provider.slice(0, 32) : undefined,
        modelId: intent.modelId ? intent.modelId.slice(0, 120) : undefined,
      },
      create: {
        turnId: traceId,
        mode: (ctx?.mode ?? "unknown").slice(0, 24),
        candidateCount: 0,
        selectedCount: 0,
        budget: ctx?.budget ?? 0,
        budgetTruncated: false,
        embeddingCacheWarm: false,
        forcedToolName: intent.toolName.slice(0, 120),
        forcedToolHonored: honored,
        provider: intent.provider ? intent.provider.slice(0, 32) : null,
        modelId: intent.modelId ? intent.modelId.slice(0, 120) : null,
      },
    });
  } catch (err) {
    writesFailed += 1;
    lastWriteError = err instanceof Error ? err.message : String(err);
    lastWriteErrorAt = Date.now();
    void logError("ai.tool-selection-telemetry", err, {
      fn: "resolveForcedTool",
      turnId: traceId,
    });
  }
}

/** Mark that invokeTool actually ran a tool the pruner had dropped. */
export async function markInvokeToolFired(
  turnId: string,
  toolName: string
): Promise<void> {
  writesAttempted += 1;
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.toolSelectionTurn.upsert({
      where: { turnId },
      update: {
        invokeToolFired: true,
        invokedToolName: toolName.slice(0, 120),
      },
      create: {
        turnId,
        mode: "unknown",
        candidateCount: 0,
        selectedCount: 0,
        budget: 0,
        budgetTruncated: false,
        semanticTierAttempted: null,
        embeddingCacheWarm: false,
        invokeToolFired: true,
        invokedToolName: toolName.slice(0, 120),
      },
    });
  } catch (err) {
    writesFailed += 1;
    lastWriteError = err instanceof Error ? err.message : String(err);
    lastWriteErrorAt = Date.now();
    void logError("ai.tool-selection-telemetry", err, {
      fn: "markInvokeToolFired",
      turnId,
    });
  }
}
