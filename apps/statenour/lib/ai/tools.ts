/**
 * AI Agent Tools — re-export barrel.
 *
 * AUTHORITATIVE INDEX: lib/ai/tools/catalog.ts (TOOL_CATALOG · count is TOOL_CATALOG.length, never a prose number).
 * The contract test in tests/ai/tool-catalog.test.ts asserts 1:1 alignment
 * between nourTools (this file's only export) and TOOL_CATALOG, so the
 * catalog is the source of truth.
 *
 * v10.0.529.106 · Wave 82 · the previous 5,537-LOC monolith was split
 * into 7 domain files (brain · tasks · business · content · social ·
 * system · meta) under lib/ai/tools/. This file now does nothing but
 * compose them into the canonical nourTools object so all 150+ callers
 * (chat route · tool-families · tool-embeddings · stats route · etc.)
 * continue to work unchanged. Adding a new tool: pick the right domain
 * file, then add a catalog entry — no edits needed here.
 *
 * Used with AI SDK tool calling in the chat and command endpoints.
 */

import { brainTools } from "@/lib/ai/tools/brain";
import { sinkPolicyGate } from "@/lib/tools/sink-policy";
import { tasksTools } from "@/lib/ai/tools/tasks";
import { businessTools } from "@/lib/ai/tools/business";
import { contentTools } from "@/lib/ai/tools/content";
import { socialTools } from "@/lib/ai/tools/social";
import { systemTools } from "@/lib/ai/tools/system";
import { metaTools } from "@/lib/ai/tools/meta";

export const rawTools = {
  ...brainTools,
  ...tasksTools,
  ...businessTools,
  ...contentTools,
  ...socialTools,
  ...systemTools,
  ...metaTools,
};

/**
 * Per-tool execution budget (2026-09-02).
 *
 * THE DEFECT: nothing bounded a tool's execute(). The route's
 * `maxDuration = 120` is a Vercel construct and inert on Railway; the
 * provider timeout in lib/ai/provider.ts guards only the non-streaming
 * aiChat helper; and lib/tools/guardian.ts DOES offer a 30s bound with
 * retries but has zero call sites under lib/ai/tools/. So one slow DB or
 * HTTP tool consumed the entire turn, and the operator saw only "Nick is
 * stuck" from the 180s client-side abort -- with no indication of which
 * tool hung, because nothing server-side recorded a timeout at all.
 *
 * WHY AN EXPLICIT LIST AND NOT THE `cost` TIER: lib/ai/tool-families.ts
 * already grades every tool cheap/medium/expensive, and deriving the
 * budget from it was the obvious move. It is also wrong -- the metadata
 * is inaccurate for exactly the tools that matter. `moneyprinter` runs a
 * multi-minute ffmpeg render and is tagged "medium"; `last30days` shells
 * out with a 300_000ms execFile budget and `runPython` hits a remote
 * sandbox, and BOTH are tagged "cheap". A tier-derived timeout would
 * have killed the three longest-running tools in the catalog. Inferred
 * metadata beats a hand-list only when the metadata is true.
 *
 * Budgets are deliberately generous: this is a runaway guard, not a
 * latency SLO. Anything not listed gets DEFAULT_TOOL_TIMEOUT_MS.
 */
const TOOL_TIME_BUDGET_MS: Record<string, number> = {
  // Shells out to MoneyPrinterTurbo; in-flight-guarded, minutes-long.
  moneyprinter: 480_000,
  // execFile budget in lib/ai/tools/system.ts is 300_000; stay above it
  // so the inner limit reports first and we never mask its error.
  last30days: 330_000,
  // Remote sandbox round-trip.
  runPython: 180_000,
  // Stagehand/Browserbase session.
  browseAndDo: 180_000,
  // Multi-round agent fan-outs.
  arsenalDeepResearch: 240_000,
  arsenalMultiAgent: 240_000,
  arsenalPreTaskFanout: 240_000,
  arsenalBoardConsult: 240_000,
  arsenalResearch: 240_000,
  arsenalFindLeads: 240_000,
  // Whole-corpus ingests.
  syncDriveMemory: 240_000,
  syncCalendar: 240_000,
  syncGmail: 240_000,
  syncKnowledge: 240_000,
  // Generation + vision.
  generateImage: 180_000,
  analyzeImage: 180_000,
  // Network fetch + parse.
  scrapeWebPage: 120_000,
  ingestDocumentFromUrl: 120_000,
  fetchVideoTranscript: 120_000,
};

const DEFAULT_TOOL_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.NICK_TOOL_TIMEOUT_MS) || 60_000,
);

const TIMED_OUT = Symbol("tool-timeout");

/** Lazy so this module never imports the catalog at load time. */
let sideEffectingNames: Set<string> | null = null;
async function isSideEffecting(name: string): Promise<boolean> {
  if (!sideEffectingNames) {
    try {
      const { TOOL_CATALOG } = await import("@/lib/ai/tools/catalog");
      sideEffectingNames = new Set(
        TOOL_CATALOG.filter((t) => t.sideEffecting).map((t) => t.name),
      );
    } catch {
      // Unknown means "assume it wrote something" -- the safe direction.
      return true;
    }
  }
  return sideEffectingNames.has(name);
}

/**
 * Exported for tests/ai/tool-execution-timeout.test.ts: the timeout is a
 * runaway guard and the only honest way to prove a guard works is to
 * drive a hanging tool through it. Production use is the call at the
 * bottom of this file.
 */
export function wrapToolsWithEmptyHandling<T extends Record<string, any>>(tools: T): T {
  const wrapped: Record<string, any> = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (!tool.execute) {
      wrapped[name] = tool;
      continue;
    }
    const originalExecute = tool.execute;
    wrapped[name] = {
      ...tool,
      // 2026-08-13 · BDN-202 · (a) the second AI SDK arg (ToolCallOptions:
      // toolCallId, messages, abortSignal) is now passed through instead of
      // silently dropped; (b) a THROWN execute becomes a structured soft-fail
      // with a one-retry reflection hint. Error-only reflection is the
      // evidence-backed shape (ACL 2026 structured-reflection; blanket
      // self-critique measurably costs compute for ~zero gain) — the model
      // gets the violated constraint and a single-retry instruction, and
      // tool-telemetry still counts the failure via the `error` key.
      execute: async (args: any, options?: unknown) => {
        // U4 sink policy (review on #2198): in a turn tainted by external content an
        // external side effect is queued for a human here, at the boundary every
        // catalog tool crosses -- guardian-wrapped or not.
        const refused = await sinkPolicyGate(name, args);
        if (refused) return refused;
        let res: any;
        const budgetMs = TOOL_TIME_BUDGET_MS[name] ?? DEFAULT_TOOL_TIMEOUT_MS;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          res = await Promise.race([
            originalExecute(args, options),
            new Promise((resolve) => {
              timer = setTimeout(() => resolve(TIMED_OUT), budgetMs);
            }),
          ]);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return {
            error: message,
            reflection: {
              tool: name,
              guidance:
                "This call threw. Compare your arguments against the tool's input schema, fix the violated constraint, and retry ONCE with corrected arguments. If it fails again, report the failure honestly — never claim the action succeeded.",
            },
          };
        } finally {
          if (timer) clearTimeout(timer);
        }

        if (res === TIMED_OUT) {
          // The losing promise is ABANDONED, not cancelled -- JS gives us
          // no way to kill in-flight work the tool already started. So a
          // side-effecting tool may STILL complete after this returns,
          // and telling the model to retry would double-execute the
          // write. (lib/ai/tools/tool-idempotency.ts guards exactly this
          // and is wired to only 4 call sites, all in social.ts.) Read
          // tools are safe to retry; writes must be verified, never
          // repeated.
          const mutating = await isSideEffecting(name);
          return {
            error: `${name} exceeded its ${Math.round(budgetMs / 1000)}s budget and was abandoned.`,
            timedOut: true,
            reflection: {
              tool: name,
              guidance: mutating
                ? "This tool MUTATES state and timed out. It may still have completed in the background. Do NOT call it again — that risks doing the same thing twice. Tell Nour it timed out and that you cannot confirm whether it landed, and offer to check."
                : "This read timed out. You may retry ONCE with a narrower query (shorter range, smaller limit). If it times out again, say so plainly — never present an unanswered query as an empty result.",
            },
          };
        }

        const isQueryName = /^(get|find|list|search|locate|read|query|fetch)/i.test(name);
        const isEmptyArray = Array.isArray(res) && res.length === 0;
        const isEmptyDataObject =
          res &&
          typeof res === "object" &&
          "data" in res &&
          Array.isArray(res.data) &&
          res.data.length === 0;
        const isNullOrUndefined = res === null || res === undefined;

        /**
         * 2026-09-10 · AN ERROR IS NOT AN EMPTY RESULT.
         *
         * `isEmptyDataObject` matches `{ error: "db down", data: [] }` --
         * so a tool that correctly reported its own failure had that
         * failure DELETED and replaced with `success: true` plus the
         * words "Query completed successfully". The wrapper handles a
         * THROWN execute and a TIMEOUT honestly (both branches above);
         * the one path it mishandled was the tool that caught its own
         * error and said so in the return value -- which is the
         * convention this codebase actually uses (tools/brain.ts
         * getBlindSpots returns `{ error, blindSpots: [] }`).
         *
         * The effect was an amplifier: any swallowed failure anywhere in
         * a query tool's call tree arrived at the model as an affirmative
         * claim that the search ran and the corpus was empty. Nothing
         * downstream could recover the truth, because the error string
         * was gone by then.
         *
         * Checked BEFORE the empty-handling branch, so an error-bearing
         * result passes through untouched.
         */
        const carriesError =
          res && typeof res === "object" && "error" in res && (res as any).error;
        if (carriesError) return res;

        if (isQueryName && (isNullOrUndefined || isEmptyArray || isEmptyDataObject)) {
          return {
            success: true,
            count: 0,
            data: [],
            status: "no_data_found",
            message: "Query completed successfully, but zero matching records were found.",
          };
        }
        return res;
      },
    };
  }
  return wrapped as T;
}

export const nourTools = wrapToolsWithEmptyHandling(rawTools);
