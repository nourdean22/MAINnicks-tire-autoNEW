/**
 * app/api/ai/chat/prepare-tools.ts — chat-route decomposition slice
 * (2026-07-25). The tool-pruning + token-budget block moved VERBATIM
 * from route.ts:
 *
 *   1. conversation-tail assembly (2026-07-15 · follow-up turns keep
 *      the tool families the CONVERSATION needed)
 *   2. pruneTools (mode + keyword/semantic ranking)
 *   3. aiConfig disabledTools blocklist (#13)
 *   4. aiConfig alwaysOnTools forcing
 *   5. action-intent expected-tool coherence forcing (2026-07-06)
 *   6. web-search coherence forcing (2026-07-15)
 *   7. maxOutputTokens derivation (mode default + query shape)
 *
 * Order preserved exactly — the blocklist applies BEFORE the always-on
 * and coherence forces, and the coherence forces respect the blocklist
 * (never re-add a tool the operator deliberately disabled).
 */

import { pruneTools, describeMode, type ChatMode } from "@/lib/ai/chat-mode";
import { markInvokeToolFired, markSearchToolsFired } from "@/lib/ai/tool-selection-telemetry";
import { buildCapabilityPlan, type CapabilityPlan } from "@/lib/ai/chat/turn-control-plane";
import { nourTools } from "@/lib/ai/tools";
import type { detectQueryShape } from "@/lib/ai/query-shape";
import type { getAiConfig } from "@/lib/settings/ai-config";
import type { detectActionIntent } from "@/lib/ai/chat/action-intent-detector";
import type { logger as rootLogger } from "@/lib/logger";

type Logger = ReturnType<typeof rootLogger.withSurface>;

type ExecutableTool = {
  execute?: (input: unknown, ...rest: unknown[]) => unknown;
};

/**
 * Recovery tools are deliberately always available, but their execution is the
 * proof that the pruner missed a capability. Clone only this turn's tool
 * objects; never mutate the shared catalog used by concurrent requests.
 */
function instrumentRecoveryTools(
  tools: typeof nourTools,
  traceId?: string,
): typeof nourTools {
  if (!traceId) return tools;

  const instrumented = { ...tools } as Record<string, unknown>;
  const wrap = (
    name: "searchTools" | "invokeTool",
    record: (input: Record<string, unknown>) => void,
  ) => {
    const source = instrumented[name] as ExecutableTool | undefined;
    if (!source?.execute) return;
    const execute = source.execute;
    instrumented[name] = {
      ...source,
      execute: async (input: unknown, ...rest: unknown[]) => {
        record((input ?? {}) as Record<string, unknown>);
        return execute(input, ...rest);
      },
    };
  };

  wrap("searchTools", (input) => {
    const query = typeof input.query === "string" ? input.query : "";
    if (query) void markSearchToolsFired(traceId, query);
  });
  wrap("invokeTool", (input) => {
    const name = typeof input.name === "string" ? input.name : "";
    if (name) void markInvokeToolFired(traceId, name);
  });

  return instrumented as typeof nourTools;
}

export async function prepareTools(args: {
  mode: ChatMode;
  messages: Array<{
    role?: string;
    parts?: Array<{ type?: string; text?: string } | null | undefined>;
  }>;
  userContent: string;
  userEmbedding: number[];
  aiConfig: Awaited<ReturnType<typeof getAiConfig>> | null;
  actionIntent: ReturnType<typeof detectActionIntent> | null;
  webSearchIntent: boolean;
  queryShape: ReturnType<typeof detectQueryShape>;
  finalSystemPromptLength: number;
  /** WP-14 · read-mode hard enforcement strips mutating tools LAST. */
  actionPermission?: string;
  /** Current turn identity for selection and recovery telemetry. */
  traceId?: string;
  conversationId?: string;
  log: Logger;
}): Promise<{ prunedTools: typeof nourTools; maxOutputTokens: number; capabilityPlan: CapabilityPlan }> {
  const {
    mode,
    messages,
    userContent,
    userEmbedding,
    aiConfig,
    actionIntent,
    webSearchIntent,
    queryShape,
    finalSystemPromptLength,
    actionPermission,
    traceId,
    conversationId,
    log,
  } = args;

  const conversationTail = messages
    .filter((m) => m.role === "user")
    .slice(-4, -1)
    .map((m) =>
      (m.parts ?? [])
        .filter((p) => p?.type === "text" && typeof p.text === "string")
        .map((p) => p!.text)
        .join(" "),
    )
    .filter(Boolean)
    .join("\n")
    .slice(-1500);

  let prunedTools = (await pruneTools(
    mode,
    nourTools as unknown as Record<string, unknown>,
    userContent,
    userEmbedding,
    { conversationTail, turnId: traceId, conversationId },
  )) as typeof nourTools;
  const initiallySelected = Object.keys(prunedTools);
  const forced: Record<string, string[]> = {};
  let stripped: string[] = [];

  if (aiConfig?.disabledTools && aiConfig.disabledTools.length > 0) {
    const filtered = { ...prunedTools } as Record<string, unknown>;
    for (const blocked of aiConfig.disabledTools) delete filtered[blocked];
    prunedTools = filtered as unknown as typeof nourTools;
  }

  if (aiConfig?.alwaysOnTools && aiConfig.alwaysOnTools.length > 0) {
    const selected = { ...prunedTools } as Record<string, unknown>;
    const all = nourTools as unknown as Record<string, unknown>;
    for (const name of aiConfig.alwaysOnTools) {
      if (all[name] && !selected[name]) {
        selected[name] = all[name];
        (forced.always_on ??= []).push(name);
      }
    }
    prunedTools = selected as unknown as typeof nourTools;
  }

  {
    const all = nourTools as unknown as Record<string, unknown>;
    const disabled = new Set(aiConfig?.disabledTools ?? []);
    const selected = { ...prunedTools } as Record<string, unknown>;
    for (const name of ["searchTools", "invokeTool"]) {
      if (all[name] && !selected[name] && !disabled.has(name)) {
        selected[name] = all[name];
        (forced.recovery ??= []).push(name);
      }
    }
    prunedTools = selected as unknown as typeof nourTools;
  }

  if (actionIntent?.expectedTool) {
    const all = nourTools as unknown as Record<string, unknown>;
    const disabled = new Set(aiConfig?.disabledTools ?? []);
    const selected = { ...prunedTools } as Record<string, unknown>;
    for (const raw of actionIntent.expectedTool.split("|")) {
      const name = raw.trim();
      if (all[name] && !selected[name] && !disabled.has(name)) {
        selected[name] = all[name];
        (forced.action_intent ??= []).push(name);
      }
    }
    prunedTools = selected as unknown as typeof nourTools;
  }

  if (webSearchIntent) {
    const all = nourTools as unknown as Record<string, unknown>;
    const disabled = new Set(aiConfig?.disabledTools ?? []);
    const selected = { ...prunedTools } as Record<string, unknown>;
    for (const name of ["arsenalWebSearch", "searchWebVerified"]) {
      if (all[name] && !selected[name] && !disabled.has(name)) {
        selected[name] = all[name];
        (forced.web_search ??= []).push(name);
      }
    }
    prunedTools = selected as unknown as typeof nourTools;
  }

  if (actionPermission === "read") {
    const { stripMutatingTools } = await import("@/lib/ai/capability-registry");
    const result = stripMutatingTools(prunedTools as Record<string, unknown>);
    prunedTools = result.tools as unknown as typeof nourTools;
    stripped = result.stripped;
    if (result.stripped.length > 0) {
      log.info("read_mode_stripped_tools", {
        count: result.stripped.length,
        stripped: result.stripped.slice(0, 30),
      });
    }
  }

  prunedTools = instrumentRecoveryTools(prunedTools, traceId);

  const capabilityPlan = buildCapabilityPlan({
    traceId,
    mode,
    registered: Object.keys(nourTools),
    initiallySelected,
    surfaced: Object.keys(prunedTools),
    disabled: aiConfig?.disabledTools ?? [],
    alwaysOn: aiConfig?.alwaysOnTools ?? [],
    forced,
    stripped,
    semanticReady: userEmbedding.length > 0,
  });

  const toolCountAll = capabilityPlan.counts.registered;
  const toolCountPruned = capabilityPlan.counts.surfaced;
  log.info("mode_description", {
    description: describeMode(mode, toolCountAll, toolCountPruned),
    promptChars: finalSystemPromptLength,
  });
  log.info("capability_plan", {
    traceId: capabilityPlan.traceId,
    counts: capabilityPlan.counts,
    semanticReady: capabilityPlan.semanticReady,
    recoveryLaneAvailable: capabilityPlan.recoveryLaneAvailable,
    forced: capabilityPlan.forced,
    stripped: capabilityPlan.stripped.slice(0, 30),
  });

  {
    const surfacedNames = capabilityPlan.surfaced;
    void import("@/lib/services/metrics")
      .then(({ recordMetric }) =>
        recordMetric("tool.surfaced", surfacedNames.length, {
          unit: "count",
          tags: { tools: surfacedNames, mode, traceId: traceId ?? null },
          source: "chat",
        }),
      )
      .catch(() => {});
  }

  const modeDefaultTokens = mode === "deep" ? 10000 : 6000;
  const maxOutputTokens = queryShape.tokenBudget > 0
    ? queryShape.tokenBudget
    : modeDefaultTokens;
  log.info("query_shape", {
    shape: queryShape.shape,
    maxOutputTokens,
    modeDefaultTokens,
    toolFirst: queryShape.needsTool ? queryShape.factualHints : null,
  });

  return { prunedTools, maxOutputTokens, capabilityPlan };
}
