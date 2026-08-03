/**
 * app/api/ai/chat/alternate-paths.ts — chat-route decomposition slice
 * (2026-07-25). The v-truth PRE-STREAM ALTERNATE PATHS block moved
 * VERBATIM from route.ts (flag-gated · DEFAULT OFF):
 *
 *   · NICK_MULTI_AGENT_AUTO — multi-part questions auto-decompose
 *   · NICK_DEEP_REASONING  — hard turns run the reasoning engine
 *     (with the 2026-07-05 mega→deep cost cap + live-data snapshot)
 *   · NICK_VERIFIED_REGEN  — critic-gated best-of-2
 *   · NICK_SELF_CONSISTENCY — 3-sample majority answer
 *
 * All generate the FULL reply up front, ship it as a simulated stream,
 * and persist via the SAME buildOnFinish pipeline (history/importance/
 * action-parse keep working). SAFETY semantics preserved exactly:
 *   - strict env+turnSignal gates, mutually exclusive, priority
 *     multi-agent > deep > regen > self-consistency;
 *   - action intents suppress ALL reasoning gates (v10.0.534 — the
 *     deep path cannot call tools, so actions must fall through to the
 *     tool-FORCING streamText path);
 *   - the entire block is try/caught — on ANY error it returns null
 *     and the route falls through to the untouched streamText path.
 *
 * Returns a Response when an alternate path handled the turn, or null
 * to fall through. Flag-off = zero change (single getFlag read each).
 */

import { stepCountIs } from "ai";
import { getFlag } from "@/lib/feature-flags";
import { buildOnFinish } from "@/lib/services/chat/persist-assistant-turn";
import type { getModel, ProviderName } from "@/lib/ai/provider";
import type { classifyTurn } from "@/lib/ai/turn-intelligence";
import type { detectActionIntent } from "@/lib/ai/chat/action-intent-detector";
import type { ChatMode } from "@/lib/ai/chat-mode";
import type { logger as rootLogger } from "@/lib/logger";

type Logger = ReturnType<typeof rootLogger.withSurface>;

/** The route's persistBase bundle — everything buildOnFinish needs
 *  except the per-call-site provider/modelId/model (+ onWorkComplete). */
export type PersistBase = Omit<
  Parameters<typeof buildOnFinish>[0],
  "provider" | "modelId" | "model" | "onWorkComplete"
>;

export async function runAlternatePaths(args: {
  persistBase: PersistBase;
  provider: ProviderName;
  modelId: string;
  model: ReturnType<typeof getModel>;
  sanitizedModelMessages: unknown;
  prunedTools: unknown;
  mode: ChatMode;
  maxOutputTokens: number;
  userContent: string;
  finalSystemPrompt: string;
  turnSignal: ReturnType<typeof classifyTurn>;
  actionIntent: ReturnType<typeof detectActionIntent> | null;
  convId: string | undefined;
  traceId: string;
  modeOverride: ChatMode | undefined;
  personality: Parameters<typeof import("@/lib/services/chat/response-shape").buildChatResponse>[0]["personality"];
  classification: Parameters<typeof import("@/lib/services/chat/response-shape").buildChatResponse>[0]["classification"];
  recalledHits: any[];
  detectedContradictions: any[];
  deeperContextCount: number;
  deeperContextTypes: string[];
  contextBlocksFired: Parameters<
    typeof import("@/lib/services/chat/response-shape").buildChatResponse
  >[0]["contextBlocksFired"];
  log: Logger;
}): Promise<Response | null> {
  const {
    persistBase,
    provider,
    modelId,
    model,
    sanitizedModelMessages,
    prunedTools,
    mode,
    maxOutputTokens,
    userContent,
    finalSystemPrompt,
    turnSignal,
    actionIntent,
    convId,
    traceId,
    modeOverride,
    personality,
    classification,
    recalledHits,
    detectedContradictions,
    deeperContextCount,
    deeperContextTypes,
    contextBlocksFired,
    log,
  } = args;

  const __deepReasonFlag = getFlag("NICK_DEEP_REASONING")?.isOn ?? false;
  const __verifiedRegenFlag = getFlag("NICK_VERIFIED_REGEN")?.isOn ?? false;
  const __selfConsistencyFlag = getFlag("NICK_SELF_CONSISTENCY")?.isOn ?? false;
  const __multiAgentAutoFlag = getFlag("NICK_MULTI_AGENT_AUTO")?.isOn ?? false;
  if (
    !(
      __deepReasonFlag ||
      __verifiedRegenFlag ||
      __selfConsistencyFlag ||
      __multiAgentAutoFlag
    )
  ) {
    return null;
  }

  try {
    const { shouldGateForIntent, maybePreStreamRegen } = await import(
      "@/lib/ai/chat/pre-stream-regen"
    );
    const { isMultiPartQuestion } = await import(
      "@/lib/ai/chat/multi-agent-detect"
    );
    // Mutually-exclusive gates · priority multi-agent > deep > regen > self-consistency.
    const multiAgentOn =
      __multiAgentAutoFlag && isMultiPartQuestion(userContent);
    const deepOn =
      !multiAgentOn &&
      __deepReasonFlag &&
      turnSignal.complexity === "complex" &&
      (turnSignal.intent === "decision" || turnSignal.intent === "analytical");
    const regenOn =
      !multiAgentOn &&
      !deepOn &&
      __verifiedRegenFlag &&
      shouldGateForIntent(
        turnSignal.intent as Parameters<typeof shouldGateForIntent>[0],
      );
    const selfConsistencyOn =
      !multiAgentOn &&
      !deepOn &&
      !regenOn &&
      __selfConsistencyFlag &&
      (turnSignal.intent === "factual" ||
        turnSignal.intent === "decision" ||
        turnSignal.intent === "analytical");

    // v10.0.534 · action requests must NEVER route to a reasoning path —
    // the deepOn branch CANNOT call tools (it pre-fetches a snapshot and
    // reasons over it), so an action like "sync my calendar" got NARRATED
    // ("Calendar sync complete") instead of actually calling syncCalendar.
    // A live agent_traces test (2026-07-06) proved it: the sync turn ran
    // deep → tool_calls=0, toolsCalled=[]. When detectActionIntent fires
    // (incl. python-execute), suppress ALL reasoning gates so the turn
    // falls through to the normal tool-FORCING streamText path, where
    // toolChoice:"required" makes the model call the real tool.
    if (!actionIntent && (deepOn || regenOn || selfConsistencyOn || multiAgentOn)) {
      let winner = "";
      // Shared generateText config for the regen + self-consistency
      // branches (identical shape) — hoisted so a new field is added
      // once, not in two places that could silently disagree.
      const genBase = {
        model,
        messages: sanitizedModelMessages as never,
        tools: prunedTools as never,
        stopWhen: stepCountIs(mode === "deep" ? 5 : 3),
        ...(maxOutputTokens ? { maxOutputTokens } : {}),
      };

      if (multiAgentOn) {
        const { runAutoDecompose } = await import(
          "@/lib/ai/chat/multi-agent-detect"
        );
        winner = await runAutoDecompose(
          userContent,
          finalSystemPrompt.slice(0, 8000),
        );
        log.info("multi_agent_auto_path", { intent: turnSignal.intent });
      } else if (deepOn) {
        // v-truth · LIVE-DATA ACCESS for deep reasoning. The reasoning
        // engine can't call tools, so it would otherwise reason blind to
        // current numbers. Pre-fetch a compact real-business snapshot and
        // prepend it to the reasoning context so it works from real data,
        // not invented figures. Best-effort: skip on failure.
        let liveSnapshot = "";
        try {
          const { getDashboardSummary } = await import(
            "@/lib/services/business-intel"
          );
          const snap = await getDashboardSummary();
          liveSnapshot =
            `## LIVE DATA SNAPSHOT (real, as of this turn — reason from THESE numbers; do NOT invent figures)\n` +
            `${JSON.stringify(snap)}\n(snapshot captured ${new Date().toISOString()} — most figures are live. ` +
            // The old wording said review counts were "cron-cached" and told the
            // model to call getReviewStats "before quoting an exact number",
            // which reads as "that tool is the authority". It is not: the only
            // writer, fetchAndStoreReviews, has ZERO callers, so the tool serves
            // a frozen cache. getReviewStats now returns `stale`/`ageDays`/
            // `freshnessNote`; the model must relay that rather than treat the
            // number as current.
            `REVIEW COUNTS ARE NOT LIVE — no cron currently writes them. If asked about reviews, ` +
            `call getReviewStats and quote its freshnessNote alongside any number, or say the data is unavailable. ` +
            `Never present a review count as current.)\n\n`;
        } catch {
          /* snapshot is best-effort — proceed without it */
        }

        const __altPersist = buildOnFinish({
          ...persistBase,
          provider,
          modelId,
          model,
        });

        // 2026-07-05 audit HIGH · cost-safety cap. The chat deep path passed
        // the reasoning engine NO explicit tier, so its internal classifier
        // could land on 'mega' (~$0.20, fire-all-5) on natural phrasing — with
        // none of the confirmExpensive + reserveBudget gates that /reason
        // (reason/stream/route.ts) and the nick tRPC router enforce for mega.
        // The chat surface is interactive iOS-PWA (no window.confirm), so we
        // cap the auto-classified tier to 'deep' when the base classifier
        // returns 'mega' instead of forcing a confirm round-trip. The engine's
        // tuner only DEMOTES (never promotes), so a non-mega base can never
        // escalate to mega — leaving request.tier undefined for those turns
        // preserves the normal internal classify + tune behavior exactly.
        let deepTier: "deep" | undefined;
        try {
          const { classifyReasoning } = await import(
            "@/lib/ai/reasoning/classifier"
          );
          if (classifyReasoning(userContent).tier === "mega") {
            deepTier = "deep";
            log.info("deep_reasoning_mega_capped", { intent: turnSignal.intent });
          }
        } catch {
          /* classifier best-effort — fall through to engine auto-classify */
        }

        const { simulateReasoningStream } = await import(
          "@/lib/ai/chat/simulate-stream-from-text"
        );
        const { buildChatResponse } = await import(
          "@/lib/services/chat/response-shape"
        );

        const streamResponse = simulateReasoningStream({
          request: {
            question: userContent,
            brainContext: (liveSnapshot + finalSystemPrompt).slice(0, 24000),
            tier: deepTier,
          },
          chunkSize: 24,
          chunkDelayMs: 8,
          onComplete: (finalWinner) => {
            log.info("deep_reasoning_path_completed", { intent: turnSignal.intent, hadSnapshot: liveSnapshot.length > 0 });
            return __altPersist({ text: finalWinner, finishReason: "stop" });
          }
        });

        return buildChatResponse({
          streamResponse,
          convId: convId!,
          traceId,
          mode,
          modeOverride,
          personality,
          turnSignal,
          deeperContextCount,
          deeperContextTypes,
          contextBlocksFired,
          classification,
          recalledMemories: recalledHits,
          contradictions: detectedContradictions,
          onFinishPromise: Promise.resolve(),
        });
      } else if (regenOn) {
        const { generateText } = await import("ai");
        const genOnce = async (sys: string, temp: number): Promise<string> => {
          const r = await generateText({
            ...genBase,
            system: sys,
            temperature: temp,
          } as Parameters<typeof generateText>[0]);
          return r.text;
        };
        const regen = await maybePreStreamRegen({
          intent: turnSignal.intent as Parameters<
            typeof maybePreStreamRegen
          >[0]["intent"],
          shape: turnSignal.outputShape,
          generateOnce: () => genOnce(finalSystemPrompt, turnSignal.temperature),
          regenOnce: ({ suggestedSystemPrefix }) =>
            genOnce(
              `${suggestedSystemPrefix}\n\n${finalSystemPrompt}`,
              Math.min(0.9, turnSignal.temperature + 0.1),
            ),
        });
        winner = regen.text;
        log.info("verified_regen_path", {
          regenFired: regen.regenFired,
          intent: turnSignal.intent,
        });
      } else if (selfConsistencyOn) {
        const { generateText } = await import("ai");
        const { selfConsistentAnswer } = await import(
          "@/lib/ai/chat/self-consistency"
        );
        const sc = await selfConsistentAnswer({
          samples: 3,
          generate: async () => {
            const r = await generateText({
              ...genBase,
              system: finalSystemPrompt,
              temperature: Math.min(0.9, turnSignal.temperature + 0.15),
            } as Parameters<typeof generateText>[0]);
            return r.text;
          },
        });
        winner = sc.answer;
        log.info("self_consistency_path", {
          agreed: sc.agreed,
          samples: sc.samples,
          intent: turnSignal.intent,
        });
      }

      if (winner && winner.trim().length > 0) {
        // Reuse the EXACT persist pipeline streamText would have run.
        const __altPersist = buildOnFinish({
          ...persistBase,
          provider,
          modelId,
          model,
        });
        const { simulateStreamFromText } = await import(
          "@/lib/ai/chat/simulate-stream-from-text"
        );
        const { buildChatResponse } = await import(
          "@/lib/services/chat/response-shape"
        );
        const streamResponse = simulateStreamFromText({
          text: winner,
          chunkSize: 24,
          chunkDelayMs: 8,
          onComplete: () =>
            __altPersist({ text: winner, finishReason: "stop" }),
        });
        return buildChatResponse({
          streamResponse,
          convId: convId!,
          traceId,
          mode,
          modeOverride,
          personality,
          turnSignal,
          deeperContextCount,
          deeperContextTypes,
          contextBlocksFired,
          classification,
          recalledMemories: recalledHits,
          contradictions: detectedContradictions,
          onFinishPromise: Promise.resolve(),
        });
      }
      // empty winner → fall through to the normal streamText path
    }
  } catch (altErr) {
    log.warn("prestream_alt_path_fallthrough", {
      error:
        altErr instanceof Error
          ? altErr.message.slice(0, 200)
          : String(altErr),
    });
    // fall through to the normal streamText path — the turn still works
  }

  return null;
}
