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
import { nourTools } from "@/lib/ai/tools";
import type { detectQueryShape } from "@/lib/ai/query-shape";
import type { getAiConfig } from "@/lib/settings/ai-config";
import type { detectActionIntent } from "@/lib/ai/chat/action-intent-detector";
import type { logger as rootLogger } from "@/lib/logger";

type Logger = ReturnType<typeof rootLogger.withSurface>;

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
  log: Logger;
}): Promise<{ prunedTools: typeof nourTools; maxOutputTokens: number }> {
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
    log,
  } = args;

  // ═══ PERF: Prune tools by mode ═══
  // Quick mode → zero tools. Standard → ~15-30 relevant. Deep → all 159.
  // Cuts Venice first-token latency from 10-30s → 2-5s for conversational
  // messages without removing any capability from data-heavy queries.
  // 2026-07-15 · conversation-aware pruning. The pruner keyed ONLY on
  // the current message, so follow-up turns ("try again", "?", "u
  // sure?") lost the tool families the CONVERSATION needed — telemetry
  // showed the model calling arsenalWebSearch and getting "unavailable
  // tool · Available tools: <core-only list>" on exactly such turns,
  // then honestly telling the operator "web search still unavailable".
  // Feed the last few user messages as a matching tail so families
  // persist across the follow-ups that reference them.
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
    { conversationTail }
  )) as typeof nourTools;

  // Apply the AI config's tool blocklist (#13). Tools in
  // ai_config.disabledTools are NEVER loaded regardless of mode —
  // used for disabling broken or unused tools without editing
  // nourTools.
  if (aiConfig?.disabledTools && aiConfig.disabledTools.length > 0) {
    const filtered = { ...prunedTools } as Record<string, unknown>;
    for (const blocked of aiConfig.disabledTools) {
      delete filtered[blocked];
    }
    prunedTools = filtered as unknown as typeof nourTools;
  }
  // Force the always-on tools to be included even when pruning would
  // have dropped them (quick mode, for example).
  if (aiConfig?.alwaysOnTools && aiConfig.alwaysOnTools.length > 0) {
    const forced = { ...prunedTools } as Record<string, unknown>;
    const all = nourTools as unknown as Record<string, unknown>;
    for (const name of aiConfig.alwaysOnTools) {
      if (all[name] && !forced[name]) forced[name] = all[name];
    }
    prunedTools = forced as unknown as typeof nourTools;
  }
  // 2026-07-06 bug fix · force the ACTION-INTENT's expected tool into the
  // pruned set. pruneTools attaches read-only CORE_TOOLS + keyword/semantic
  // families, but a keyword-less action turn ("add it", "do it") with a cold
  // embedding cache drops the write tool (e.g. createTask). The
  // toolChoice:"required" force then makes the model act with ONLY read-only
  // tools — so it fabricates "done" or admits the tool is unavailable.
  // Guarantee the expected tool is present so the force is coherent.
  // Respects the disabledTools blocklist above (never re-add a tool the
  // operator deliberately disabled). expectedTool may be a "toolA|toolB"
  // alternation (action-claim-detector), so split on "|".
  if (actionIntent?.expectedTool) {
    const all = nourTools as unknown as Record<string, unknown>;
    const disabled = new Set(aiConfig?.disabledTools ?? []);
    const forced = { ...prunedTools } as Record<string, unknown>;
    for (const raw of actionIntent.expectedTool.split("|")) {
      const name = raw.trim();
      if (all[name] && !forced[name] && !disabled.has(name)) forced[name] = all[name];
    }
    prunedTools = forced as unknown as typeof nourTools;
  }
  // 2026-07-15 · same coherence guarantee for the web-search force: the
  // step-0 toolChoice can only fire if the tool is in the set.
  if (webSearchIntent) {
    const all = nourTools as unknown as Record<string, unknown>;
    const disabled = new Set(aiConfig?.disabledTools ?? []);
    const forced = { ...prunedTools } as Record<string, unknown>;
    for (const name of ["arsenalWebSearch", "searchWebVerified"]) {
      if (all[name] && !forced[name] && !disabled.has(name)) forced[name] = all[name];
    }
    prunedTools = forced as unknown as typeof nourTools;
  }

  const toolCountAll = Object.keys(nourTools).length;
  const toolCountPruned = Object.keys(prunedTools).length;
  log.info("mode_description", {
    description: describeMode(mode, toolCountAll, toolCountPruned),
    promptChars: finalSystemPromptLength,
  });

  // maxOutputTokens derived from mode default + query shape. Standard
  // mode uses 2000 default; query-shape drops it to 80-150 for yes/no +
  // casual, 700 for explain, 1600 for plan — making it feel as fast as
  // the old quick mode when the query calls for brevity.
  // 2026-07-12 · raised standard default 1200 → 2000 (operator: replies read
  // too short). Shape-specific budgets (query-shape.ts) still tighten yes/no +
  // casual turns; this only lifts the ceiling for substantive "default" turns.
  const modeDefaultTokens = mode === "deep" ? 4500 : 2000;
  const maxOutputTokens = queryShape.tokenBudget > 0
    ? queryShape.tokenBudget
    : modeDefaultTokens;
  log.info("query_shape", {
    shape: queryShape.shape,
    maxOutputTokens,
    modeDefaultTokens,
    toolFirst: queryShape.needsTool ? queryShape.factualHints : null,
  });

  return { prunedTools, maxOutputTokens };
}
