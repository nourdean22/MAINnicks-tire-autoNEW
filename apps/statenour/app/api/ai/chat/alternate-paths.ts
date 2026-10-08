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

import { langfuseTelemetry } from "@/lib/observability/langfuse";
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
  /**
   * 2026-09-15 · will a tool fire this turn (action or web-search intent)?
   * Feeds assessTurnRisk: a lookup that WILL hit a tool gets a receipt, so
   * the pre-flush lane leaves it streaming. Defaults to `!!actionIntent`.
   */
  toolsExpected?: boolean;
  /**
   * 2026-09-15 · Codex #2335 P2: the streaming path pins arsenalWebSearch on
   * step 0 for an explicit web-search ask (build-stream-config.ts). A buffered
   * lane that drops that pin lets the model skip the search, after which the
   * gate strips the very results the operator asked for. The pre-flush lane
   * mirrors the pin when this is true.
   */
  webSearchIntent?: boolean;
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
  /** Private Lab turns must not enter hidden multi-call alternate paths. */
  privateMode: boolean;
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
    privateMode,
    log,
  } = args;

  // Alternate paths make additional hidden model calls. Private Lab promises
  // that prompt and completion content stays in-process, so use the normal
  // single-call path whose telemetry gate is already private-mode aware.
  if (privateMode) return null;

  const __deepReasonFlag = getFlag("NICK_DEEP_REASONING")?.isOn ?? false;
  const __verifiedRegenFlag = getFlag("NICK_VERIFIED_REGEN")?.isOn ?? false;
  const __selfConsistencyFlag = getFlag("NICK_SELF_CONSISTENCY")?.isOn ?? false;
  const __multiAgentAutoFlag = getFlag("NICK_MULTI_AGENT_AUTO")?.isOn ?? false;
  // 2026-09-15 · SELECTIVE PRE-FLUSH EVIDENCE LANE. assessTurnRisk() has
  // returned `buffer: true` for the turns whose reply can ship a falsifiable
  // claim (named resources, health figures, lookups with no tool, number
  // asks) since 2026-09-10 — and nothing consumed it. This lane is that
  // consumer: generate the whole reply first so the enforcement block below
  // can be a gate, then ship it as a simulated stream. It only makes sense
  // when the gate can act, so it needs BOTH flags on.
  const __preflushFlag = getFlag("NICK_EVIDENCE_PREFLUSH")?.isOn ?? false;
  const __enforcementFlag = getFlag("NICK_EVIDENCE_ENFORCEMENT")?.isOn ?? false;
  const __preflushLane = __preflushFlag && __enforcementFlag;
  if (
    !(
      __deepReasonFlag ||
      __verifiedRegenFlag ||
      __selfConsistencyFlag ||
      __multiAgentAutoFlag ||
      __preflushLane
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
    // 2026-09-15 · Codex #2335 P2: the risk assessment is computed FIRST.
    // It is pure and deterministic (same inputs the E3 shadow stamp in
    // persist-assistant-turn.ts records), and once the operator has turned
    // the evidence gate on, a buffer-worthy turn must reach a lane the gate
    // can actually judge. The deep lane returns its reasoning stream BEFORE
    // the enforcement block (it cannot call tools, so it has nothing to
    // gate), and the regen / self-consistency lanes reach the block
    // receipt-BLIND (blind suppresses blocking). So a buffer-worthy turn
    // pre-empts those three and takes the receipted pre-flush lane.
    let preflushRisk: import("@/lib/ai/chat/turn-risk").TurnRiskAssessment | null = null;
    if (__preflushLane) {
      const { assessTurnRisk } = await import("@/lib/ai/chat/turn-risk");
      preflushRisk = assessTurnRisk(userContent, {
        toolsExpected: args.toolsExpected ?? Boolean(actionIntent),
        intent: turnSignal.intent,
      });
    }
    const mustGate = Boolean(preflushRisk?.buffer);

    // Mutually-exclusive gates · priority multi-agent > pre-flush (only when
    // the gate must act) > deep > regen > self-consistency. Multi-agent keeps
    // the top: a decomposition is a different product behaviour, and its
    // winner still passes through the (blind) enforcement block below.
    const multiAgentOn =
      __multiAgentAutoFlag && isMultiPartQuestion(userContent);
    const deepOn =
      !multiAgentOn &&
      !mustGate &&
      __deepReasonFlag &&
      turnSignal.complexity === "complex" &&
      (turnSignal.intent === "decision" || turnSignal.intent === "analytical");
    const regenOn =
      !multiAgentOn &&
      !mustGate &&
      !deepOn &&
      __verifiedRegenFlag &&
      shouldGateForIntent(
        turnSignal.intent as Parameters<typeof shouldGateForIntent>[0],
      );
    const selfConsistencyOn =
      !multiAgentOn &&
      !mustGate &&
      !deepOn &&
      !regenOn &&
      __selfConsistencyFlag &&
      (turnSignal.intent === "factual" ||
        turnSignal.intent === "decision" ||
        turnSignal.intent === "analytical");
    const preflushOn = mustGate && !multiAgentOn;

    // v10.0.534 · action requests must NEVER route to a reasoning path —
    // the deepOn branch CANNOT call tools (it pre-fetches a snapshot and
    // reasons over it), so an action like "sync my calendar" got NARRATED
    // ("Calendar sync complete") instead of actually calling syncCalendar.
    // A live agent_traces test (2026-07-06) proved it: the sync turn ran
    // deep → tool_calls=0, toolsCalled=[]. When detectActionIntent fires
    // (incl. python-execute), suppress ALL reasoning gates so the turn
    // falls through to the normal tool-FORCING streamText path, where
    // toolChoice:"required" makes the model call the real tool.
    if (!actionIntent && (deepOn || regenOn || selfConsistencyOn || multiAgentOn || preflushOn)) {
      let winner = "";
      // 2026-09-15 · tool receipts captured by a buffered lane. The
      // enforcement block below was receipt-BLIND on every lane (it had no
      // way to see what generateText called), which limited it to length and
      // tag repair. The pre-flush lane fills these in, so a named resource
      // with no receipt can actually be judged there.
      let laneToolCalls: Array<{ name: string }> = [];
      let laneEvidenceText = "";
      let laneReceiptsAvailable = false;

      /**
       * 2026-09-17 · regen and self-consistency DO pass `tools` (they spread
       * `genBase`), so they can invoke tools — but they discarded
       * `r.toolCalls` and returned only `r.text`. Both therefore declared
       * themselves BLIND, and `tool.chosen` under-reported every turn they
       * handled. Only the pre-flush lane captured receipts.
       *
       * ⚠ ATTRIBUTION IS NOT A UNION. Regen generates up to twice and
       * self-consistency samples three times; exactly ONE generation becomes
       * the reply. Recording every sample's calls would over-report tools that
       * never reached the operator — the mirror of the measured-zero problem.
       * So each generation is remembered with its text, and after the lane
       * picks a winner the calls are taken from the generation whose text IS
       * the winner. No match (e.g. a synthesised answer) means the lane stays
       * BLIND rather than guessing.
       */
      const laneSamples: Array<{ text: string; calls: string[] }> = [];
      const rememberLaneSample = (r: { text?: string; toolCalls?: unknown }) => {
        const calls = ((r.toolCalls ?? []) as Array<{ toolName?: string }>)
          .map((c) => String(c.toolName ?? ""))
          .filter(Boolean);
        laneSamples.push({ text: String(r.text ?? ""), calls });
      };
      /**
       * TELEMETRY receipts, deliberately SEPARATE from `laneReceiptsAvailable`.
       *
       * ⚠ Those two flags feed different consumers and must not be conflated.
       * `laneReceiptsAvailable` is the ENFORCEMENT channel: per the comment at
       * the enforcement block below, blind SUPPRESSES BLOCKING, and flipping it
       * true makes a named resource judgeable on this lane. Setting it from
       * attribution — while `laneEvidenceText` stays empty, because these lanes
       * capture names but not tool RESULTS — would strip the support that
       * `checkNamedSources` looks for and could block a genuinely tool-backed
       * answer. That is a live behaviour change, not measurement.
       *
       * So attribution feeds ONLY the `tool.chosen` lane. Enforcement keeps
       * exactly the blindness it had before this change.
       */
      let laneTelemetryObserved = false;
      /** Identity of the lane that handled this turn, stamped on `tool.chosen`. */
      let laneName = "unknown";
      /** Attribute the winning generation's calls; blind when it cannot be identified. */
      const applyLaneAttribution = async (winningText: string) => {
        const { attributeWinningSample } = await import(
          "@/lib/services/chat/lane-sample-attribution"
        );
        const a = attributeWinningSample({
          samples: laneSamples,
          winningText,
          alreadyAvailable: laneReceiptsAvailable,
        });
        if (!a) return; // honest blind — never attribute a sample that did not win
        laneToolCalls = a.toolNames.map((name) => ({ name }));
        laneTelemetryObserved = true;
      };
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
        laneName = "multi-agent";
        const { runAutoDecompose } = await import(
          "@/lib/ai/chat/multi-agent-detect"
        );
        winner = await runAutoDecompose(
          userContent,
          finalSystemPrompt.slice(0, 8000),
        );
        log.info("multi_agent_auto_path", { intent: turnSignal.intent });
      } else if (deepOn) {
        laneName = "deep";
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
          // Redacted like the getDashboardSummary tool: a section whose bridge
          // read failed is null with a reason, never its zero defaults. Unredacted,
          // `customer_stats` (no nickstire handler, ever) put `customers: { total: 0 }`
          // under the "real ... reason from THESE numbers" header on every deep turn.
          const { redactUnreadableSections } = await import(
            "@/lib/ai/tools/bridge-honesty"
          );
          const snap = redactUnreadableSections(await getDashboardSummary());
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
            // laneToolNames/laneReceiptsAvailable: this callback hands the walk
            // NO `ev.steps`, so without these it would record a confident
            // `tool.chosen = 0` for a turn that may well have invoked tools.
            // This lane does not surface its calls, so it declares itself BLIND
            // rather than being counted as a measured zero.
            return __altPersist({
              text: finalWinner,
              finishReason: "stop",
              laneToolNames: laneToolCalls.map((c) => c.name),
              laneReceiptsAvailable: laneTelemetryObserved,
              laneName,
            });
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
        laneName = "regen";
        const { generateText } = await import("ai");
        const genOnce = async (sys: string, temp: number): Promise<string> => {
          const r = await generateText({
            ...genBase,
            experimental_telemetry: langfuseTelemetry({ functionId: "chat-alternate-path", privateMode }),
            system: sys,
            temperature: temp,
          } as Parameters<typeof generateText>[0]);
          rememberLaneSample(r);
          return r.text;
        };
        const regen = await maybePreStreamRegen({
          intent: turnSignal.intent as Parameters<
            typeof maybePreStreamRegen
          >[0]["intent"],
          shape: turnSignal.outputShape,
          userPrompt: userContent,
          turnSignal,
          responseContract: persistBase.responseContract ?? null,
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
          regenAttempted: regen.regenScore !== null,
          regenWasBetter: regen.regenWasBetter,
          selectionReason: regen.selectionReason,
          firstOverall: regen.firstScore.overall,
          firstSeverity: regen.firstAssessment.severity,
          regenOverall: regen.regenScore?.overall ?? null,
          regenSeverity: regen.regenAssessment?.severity ?? null,
          intent: turnSignal.intent,
        });

        // Persist one best-effort row per eligible regen turn so the operator can
        // answer whether repair fires, wins, costs latency, or should be retired.
        // Telemetry must NEVER become load-bearing for a valid chat response.
        try {
          const { formatRegenTelemetry } = await import(
            "@/lib/ai/chat/pre-stream-regen"
          );
          const regenMetric = formatRegenTelemetry(
            regen,
            turnSignal.intent as Parameters<typeof formatRegenTelemetry>[1],
            turnSignal.outputShape,
          );
          const { recordMetric } = await import("@/lib/services/metrics");
          await recordMetric(regenMetric.metric, regenMetric.value, {
            unit: regenMetric.unit,
            tags: { ...regenMetric.tags, traceId },
            source: regenMetric.source,
          });
        } catch (err) {
          log.warn("verified_regen_telemetry_failed", {
            error: err instanceof Error ? err.name : "Error",
          });
        }
      } else if (selfConsistencyOn) {
        laneName = "self-consistency";
        const { generateText } = await import("ai");
        const { selfConsistentAnswer } = await import(
          "@/lib/ai/chat/self-consistency"
        );
        const sc = await selfConsistentAnswer({
          samples: 3,
          generate: async () => {
            const r = await generateText({
              ...genBase,
              experimental_telemetry: langfuseTelemetry({ functionId: "chat-regenerate", privateMode }),
              system: finalSystemPrompt,
              temperature: Math.min(0.9, turnSignal.temperature + 0.15),
            } as Parameters<typeof generateText>[0]);
            rememberLaneSample(r);
            return r.text;
          },
        });
        winner = sc.answer;
        log.info("self_consistency_path", {
          agreed: sc.agreed,
          samples: sc.samples,
          intent: turnSignal.intent,
        });
      } else if (preflushOn && preflushRisk) {
        laneName = "preflush";
        // ONE full generation, no regen, no sampling: the point of this lane
        // is not a better draft, it is a draft that exists BEFORE the flush so
        // the enforcement block below can strip an unearned claim.
        const { generateText } = await import("ai");
        // Mirror build-stream-config.ts's prepareStep ladder for the one
        // force this lane can meet: an explicit web-search ask pins
        // arsenalWebSearch on step 0 (Codex #2335 P2 — without the pin the
        // model may skip the search, and the gate then strips the very
        // results the operator asked for). The last allowed step is
        // text-only so the buffered reply always ends in prose.
        const lastStep = (mode === "deep" ? 5 : 3) - 1;
        const webSearchPinned = Boolean(args.webSearchIntent);
        const r = await generateText({
          ...genBase,
          experimental_telemetry: langfuseTelemetry({ functionId: "chat-evidence-preflush", privateMode }),
          system: finalSystemPrompt,
          temperature: turnSignal.temperature,
          prepareStep: ({ stepNumber }: { stepNumber: number }) =>
            stepNumber === 0 && webSearchPinned
              ? { toolChoice: { type: "tool" as const, toolName: "arsenalWebSearch" as const } }
              : stepNumber >= lastStep
                ? { toolChoice: "none" as const }
                : { toolChoice: "auto" as const },
        } as Parameters<typeof generateText>[0]);
        winner = r.text;
        // Receipts for the gate: what fired and a digest of what came back.
        // Empty toolCalls here is a FINDING ("no tool fired"), not blindness —
        // this lane can see everything generateText did.
        const calls = (r.toolCalls ?? []) as Array<{ toolName?: string }>;
        laneToolCalls = calls.map((c) => ({ name: String(c.toolName ?? "") })).filter((c) => c.name);
        laneEvidenceText = ((r.toolResults ?? []) as Array<{ output?: unknown; result?: unknown }>)
          .map((t) => {
            try {
              return JSON.stringify(t.output ?? t.result ?? "").slice(0, 2000);
            } catch {
              return "";
            }
          })
          .filter(Boolean)
          .join(" | ");
        laneReceiptsAvailable = true;
        laneTelemetryObserved = true;
        log.info("evidence_preflush_path", {
          intent: turnSignal.intent,
          register: preflushRisk.register,
          reasons: preflushRisk.reasons,
          toolCalls: laneToolCalls.length,
          webSearchPinned,
        });
      }

      // Runs for every lane. The pre-flush lane already set
      // `laneReceiptsAvailable` from its own generateText result and is left
      // untouched; regen and self-consistency are attributed here from the
      // generation whose text actually won. A lane that recorded no samples
      // (multi-agent, deep) is unaffected and stays honestly blind.
      await applyLaneAttribution(winner);

      if (winner && winner.trim().length > 0) {
        // ── EVIDENCE ENFORCEMENT — 2026-09-10 ───────────────────────
        //
        // THE only point in a live turn where a complete reply exists
        // and has NOT been written to the socket. Everything in
        // onFinish runs post-flush by construction, so this is where a
        // gate can be a gate rather than a log line.
        //
        // Flag-gated and default-OFF, deliberately, and this is NOT the
        // dark-wire pattern criticised elsewhere in this codebase: the
        // difference is an explicit activation criterion. The shadow run
        // (evidence_gate_shadow) measures the named-source
        // false-positive rate on real traffic; when that number is
        // tolerable, this flips. Before this existed there was no lever
        // at all, which is the actual defect -- an operator who decided
        // the rate was fine had no way to act on it.
        //
        // Only the BUFFERED path. Action turns deliberately never reach
        // here (see the actionIntent suppression above): tool-forcing
        // needs real streamText.
        try {
          const enforcementOn = getFlag("NICK_EVIDENCE_ENFORCEMENT")?.isOn ?? false;
          if (enforcementOn) {
            const [{ enforceGate }, { checkNamedSources }, { shapeCeiling }] = await Promise.all([
              import("@/lib/ai/chat/gate-enforcement"),
              import("@/lib/ai/chat/named-source-claims"),
              import("@/lib/ai/chat/output-guardian"),
            ]);
            // The regen/self-consistency/multi-agent lanes reach ENFORCEMENT
            // blind -- not "no tool fired". That distinction is load-bearing:
            // blind suppresses blocking, so enforcement there can only repair
            // length and strip unearned tags. The pre-flush lane DOES surface
            // its receipts (laneReceiptsAvailable), so a named resource with
            // no receipt can be judged on that lane.
            //
            // ⚠ 2026-09-17 · regen and self-consistency now attribute their
            // winning generation's tool NAMES for `tool.chosen`, but that goes
            // to `laneTelemetryObserved`, NOT here. They capture names without
            // tool RESULTS, so `laneEvidenceText` stays empty; flipping
            // `receiptsAvailable` true would end blind-suppression while giving
            // `checkNamedSources` no evidence to find support in, and a
            // genuinely tool-backed answer could be blocked or stripped.
            // Measurement must not silently become enforcement.
            const receipts = {
              toolCalls: laneToolCalls,
              evidenceText: laneEvidenceText,
              receiptsAvailable: laneReceiptsAvailable,
              userText: userContent,
            };
            const named = checkNamedSources(winner, receipts);
            const ceiling = shapeCeiling(turnSignal.outputShape);
            const outcome = enforceGate({
              draft: winner,
              userText: userContent,
              critic: null,
              turnSignal,
              contract: null,
              evidence: {
                unverifiedFactCount: 0,
                totalFactCount: 0,
                wordCount: winner.trim().split(/\s+/).filter(Boolean).length,
                lengthCeiling: ceiling,
                namedSources: named,
              },
              namedSources: named,
              ceilingWords: ceiling,
              reassess: (repaired) => {
                const r = checkNamedSources(repaired, receipts);
                return {
                  evidence: {
                    unverifiedFactCount: 0,
                    totalFactCount: 0,
                    wordCount: repaired.trim().split(/\s+/).filter(Boolean).length,
                    lengthCeiling: ceiling,
                    namedSources: r,
                  },
                  namedSources: r,
                };
              },
            });
            if (outcome.text !== winner) {
              log.info("evidence_enforced", {
                verdict: outcome.verdict,
                usedFallback: outcome.usedFallback,
                actions: outcome.actions.slice(0, 4),
              });
              winner = outcome.text;
            }
          }
        } catch (err) {
          // Enforcement must never cost a turn. Failing open here means
          // today's behaviour, which is the same as the flag being off.
          log.info("evidence_enforcement_failed", {
            err: err instanceof Error ? err.message : String(err),
          });
        }

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
            __altPersist({
              text: winner,
              finishReason: "stop",
              // Same reason as the deep-reasoning lane above: no `ev.steps`
              // reaches the walk, so the receipt state must be stated
              // explicitly instead of inferred as zero.
              laneToolNames: laneToolCalls.map((c) => c.name),
              laneReceiptsAvailable: laneTelemetryObserved,
              laneName,
            }),
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
