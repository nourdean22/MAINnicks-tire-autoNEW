/**
 * buildOnFinish · May 02 · chat-route extract chunk 5 (the big one)
 *
 * Lifted verbatim from app/api/ai/chat/route.ts (the streamText
 * `onFinish` callback at lines 935-1913 · 977 lines). Factory pattern
 * — returns the async callback configured with deps. Behavior preserved
 * exactly. No sub-splitting in this commit; that's a future pass.
 *
 * Owns the post-stream lifecycle:
 *   1. Event-text salvage (rawText → reasoningText → content → steps →
 *      reasoning array, with stripThink + cascading fallback)
 *   2. Empty response guard + recordError when nothing salvageable
 *   3. Sanitizer + image-hallucination ghost stripping
 *   4. Output critic (4-axis or 7-axis content) + always-on scorecard
 *   5. Citations parse, reply gate, fact-check, opt-in hallucination guard
 *   6. Tool telemetry walk over event.steps[].toolResults
 *   7. Persist assistant ChatMessage with full v7.6 field set + parts
 *      tree + branching parent + tokenUsage blob
 *   8. Conversation activity bump (fire-and-forget)
 *   9. Track generation + agent-trace finalize
 *  10. Low-quality reply log, memory recordInteraction
 *  11. Content feedback capture, hallucination post-stream, friction,
 *      outcome predictions, flow processing, conversation pattern,
 *      journal ingest, conversation memory summary, auto-rename,
 *      people intelligence, agent action execution, suggestion cache warm
 *
 * Closure vars required by the lifted body — passed via the deps object.
 * Mutable refs (__partialRef, __firstTokenRef) shared with onChunk.
 */

import { prisma } from "@/lib/prisma";
import { sanitizeResponse } from "@/lib/ai/output-sanitizer";
import {
  critiqueOutput,
  critiqueContent,
  formatCriticSummary,
  type ContentCriticScore,
} from "@/lib/ai/output-critic";
import { parseCitations } from "@/lib/ai/memory-citations";
import { recordToolInvocation } from "@/lib/ai/tool-telemetry";
import { runReplyGate, runReplyGateWithContract, formatGateSummary } from "@/lib/ai/reply-gate";
import type { ResponseContract } from "@/lib/ai/response-contract";
import {
  factCheck,
  countUnverified,
  formatFactCheckSummary,
} from "@/lib/ai/fact-check";
import { checkKnownTruth, formatTruthSummary } from "@/lib/ai/known-truth-guard";
import { trackGeneration } from "@/lib/ai/track";
import { recordInteraction } from "@/lib/ai/memory";
import { buildVerifierBanner, isVerifierRewritten, buildKnownTruthBanner } from "@/lib/ai/chat/fabrication-rewriter";
import { canClaimDone, toReceipt } from "@/lib/ai/receipts/action-receipt";
import { withErrorCapture, recordError } from "@/lib/errors/record-error";
import type { ProviderName } from "@/lib/ai/provider";
import type { TraceStartInput, TraceFinishInput } from "@/lib/ai/agent-trace";
import type { TurnSignal } from "@/lib/ai/turn-intelligence";
import type { ContextBlocksFired } from "./brain-context";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { buildMessageParts } from "./message-parts";
import { runDeferredBackgroundWork } from "./deferred-background-work";

interface ChatLogger {
  info(event: string, ctx?: Record<string, unknown>): void;
  warn(event: string, ctx?: Record<string, unknown>): void;
}

/** Mutable refs shared with onChunk — onChunk writes, onFinish reads. */
export interface FirstTokenRef {
  value: number | null;
}

export interface BuildOnFinishInput {
  log: ChatLogger;
  // ─── authority kernel (2026-07-22) ────────────────────────────
  /** Private Lab: the returned callback persists NOTHING (no assistant row,
   *  no BrainMemory, no embeddings, no critic/judge/objection writes). */
  privateMode?: boolean;
  /** execute = no new adversarial objections · spar = critique unconditionally. */
  posture?: string;
  // ─── identity / convo ─────────────────────────────────────────
  convId: string | null | undefined;
  conversationId: string | null | undefined;
  // ─── model / provider ─────────────────────────────────────────
  provider: ProviderName;
  modelId: string;
  model: unknown;
  // ─── mode + persona ───────────────────────────────────────────
  mode: string;
  modeOverride?: string | null;
  personality: string;
  contentMode: boolean;
  // ─── prompt context ───────────────────────────────────────────
  finalSystemPrompt: string;
  systemPrompt: string;
  finalTaskType: string;
  userContent: string;
  // truth-substrate audit P1 (#16): the per-turn ResponseContract (built in
  // route.ts). When present, the finalize gate runs the contract-aware variant
  // to EMIT richer telemetry (contract-compliance signals). NOTE: on the default
  // streaming path this is TELEMETRY-ONLY — the reply is already flushed +
  // persisted before the gate runs, so it does not (and cannot) change the reply.
  responseContract?: ResponseContract;
  turnSignal: TurnSignal;
  contextBlocksFired: ContextBlocksFired;
  deeperContextCount: number;
  deeperContextTypes: string[];
  // ─── timing refs ──────────────────────────────────────────────
  startedAt: number;
  firstTokenRef: FirstTokenRef;
  // ─── trace ────────────────────────────────────────────────────
  traceId: string;
  recordTrace: (
    start: TraceStartInput,
    finalize: TraceFinishInput,
  ) => Promise<void> | void;
  // ─── context for memory ───────────────────────────────────────
  messages: ReadonlyArray<unknown>;
  topicTier: string;
  onWorkComplete?: () => void;
}

// (buildMessageParts + runDeferredBackgroundWork moved VERBATIM to
// ./message-parts.ts and ./deferred-background-work.ts, 2026-07-25 —
// persist-turn decomposition slice 1.)

/**
 * Returns the streamText `onFinish` callback. Body is the literal
 * post-stream block lifted from the route — no behavior changes.
 */
export function buildOnFinish(deps: BuildOnFinishInput) {
  const {
    log,
    conversationId,
    provider,
    modelId,
    model,
    mode,
    personality,
    contentMode,
    finalSystemPrompt,
    systemPrompt,
    finalTaskType,
    userContent,
    turnSignal,
    responseContract,
    contextBlocksFired,
    deeperContextCount,
    deeperContextTypes,
    startedAt,
    firstTokenRef,
    traceId,
    recordTrace,
    messages,
    topicTier,
  } = deps;
  // modeOverride is part of the deps interface for completeness/future
  // header use; the lifted onFinish body doesn't reference it directly.
  void deps.modeOverride;
  // Normalize convId to `string | undefined` once. The original route
  // body has callsites that pass convId into helpers expecting non-null
  // strings; collapsing null → undefined here matches their expectations
  // without touching every callsite.
  const convId: string | undefined = deps.convId ?? undefined;

  return async (event: { text?: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } } & Record<string, unknown>) => {
      // ─── PRIVATE LAB (2026-07-22) ─────────────────────────────────
      // The ENTIRE post-stream pipeline below is writes: assistant row,
      // conversation touch, embeddings, BrainMemory, critic objections,
      // judge scores, telemetry blobs. One structural gate here keeps a
      // private turn at ZERO persistence — the reply streamed and is gone.
      if (deps.privateMode) {
        deps.log.info("private_mode_zero_persist", { skipped: "assistant-turn pipeline" });
        // CRITICAL (self-review blocker #2): resolve the work-complete promise
        // the SSE stream awaits before controller.close() — the normal path
        // does this at the tail (:onWorkComplete below). Skipping it hangs the
        // stream until maxDuration and never emits message.completed.
        deps.onWorkComplete?.();
        return;
      }
      // persist-turn decomposition slice 2 (2026-07-25) · the event-text
      // salvage stack (cascading fallback, hasToolCalls detection, empty
      // guard + graceful fallback) moved VERBATIM to
      // ./salvage-event-text.ts. `ev` stays for the tool-telemetry walk
      // below (same cast as before).
      const { salvageEventText } = await import("./salvage-event-text");
      const __salvaged = salvageEventText({
        event,
        provider,
        modelId,
        mode,
        promptChars: finalSystemPrompt.length,
        log,
      });
      let text = __salvaged.text;
      const { reasoningText, hasToolCalls, finishReason, usage } = __salvaged;
      const ev = event as unknown as { steps?: unknown };

      // ═══ CRITICAL PATH — must succeed for chat to work ═══
      // Save assistant message (cleaned). Bounded to 10s — if Neon
      // is hung, we'd rather lose the log than tie up the function.
      //
      // EMPTY GUARD: if salvage failed and we have no content, we
      // deliberately skip the save. Saving empty content polluted
      // conversation history with blank "Nick is stuck" turns that
      // the client rendered as failures.
      //
      // SANITIZER: before saving we strip generic-LLM filler via
      // lib/ai/output-sanitizer.ts. The USER sees the raw stream (we
      // don't want to rewrite live tokens), but the stored history is
      // clean — so future prompts don't carry filler forward, and the
      // /journal feed reads like Nick's actual voice.
      const sanitizeResult = sanitizeResponse(text);
      let cleanedText = sanitizeResult.cleaned;
      if (sanitizeResult.trimmed > 0) {
        log.info("sanitizer_trimmed", { chars: sanitizeResult.trimmed });
      }

      // Apr 27 · IMAGE-HALLUCINATION GUARD (post-stream)
      // venice-uncensored has no function calling — when the user asks
      // for an image and the chat-pipeline interceptor doesn't catch
      // it, the model fabricates `![](/api/images/<bogus_id>)` markdown
      // that 404s. Validator checks every /api/images/<id> reference
      // against audit_events and replaces ghost markdown with an
      // explicit error block so:
      //   · the persisted history reads honestly
      //   · future turns don't pattern-match on broken markdown and
      //     compound the hallucination
      //   · the user sees what actually happened
      try {
        const { validateImageReferences } = await import(
          "@/lib/ai/image-ref-validator"
        );
        const validation = await validateImageReferences(cleanedText);
        if (validation.ghosts > 0) {
          log.warn("image_validator_stripped_ghosts", {
            ghosts: validation.ghosts,
            found: validation.found,
            sampleGhostIds: validation.ghostIds.slice(0, 3),
            totalGhosts: validation.ghostIds.length,
          });
          cleanedText = validation.cleaned;
        }
      } catch (vErr) {
        log.warn("image_validator_threw_persisting_raw", {
          err: vErr instanceof Error ? vErr.message : String(vErr),
        });
      }
      const hasContent = cleanedText.trim().length > 0;

      // v-truth · Chain-of-Verification (NICK_COVE) · verify factual
      // answers in ISOLATION before the row persists, so the stored
      // reply + next-turn context carry the verified text. Runs
      // post-stream (the user already saw the streamed draft), so it
      // never affects perceived latency. Flag OFF by default -> skipped
      // entirely; graceful on any failure (never breaks the turn).
      if (hasContent) {
        try {
          const { getFlag } = await import("@/lib/feature-flags");
          const FACTUAL_INTENTS = new Set([
            "factual",
            "analytical",
            "procedural",
            "instructional",
          ]);
          if (getFlag("NICK_COVE")?.isOn && FACTUAL_INTENTS.has(turnSignal.intent)) {
            const { verifyAndRevise } = await import(
              "@/lib/ai/chat/chain-of-verification"
            );
            const cove = await verifyAndRevise(cleanedText, userContent);
            if (cove.changed) {
              log.info("cove_revised", {
                conversationId: convId,
                questions: cove.questions.length,
              });
              cleanedText = cove.revised;
            }
          }
        } catch (err) {
          log.warn("cove_skipped", {
            error: err instanceof Error ? err.message.slice(0, 160) : String(err),
          });
        }
      }

      // ═══ Apr 19 · Output critic ═══
      const critic = hasContent
        ? contentMode
          ? critiqueContent(cleanedText, turnSignal.outputShape)
          : critiqueOutput(cleanedText, turnSignal.outputShape)
        : null;
      if (critic) {
        log.info("critic_applied", { summary: formatCriticSummary(critic) });
      }

      // v11.0 W12.1 · always-on scorecard log.
      if (critic) {
        const scoreKey = `nick_quality_${convId}_${Date.now()}`;
        const contentCritic = "contentOverall" in critic ? (critic as ContentCriticScore) : null;
        const overallScore = contentCritic ? contentCritic.contentOverall : critic.overall;
        withErrorCapture(
          "chat:post-process",
          () =>
            prisma.brainMemory.create({
              data: {
                category: BRAIN_CATEGORIES.NICK_QUALITY,
                key: scoreKey,
                source: "output_critic",
                content: contentCritic
                  ? `${overallScore}/100 · spec=${critic.specificity} cliche=${critic.cliche} antiNour=${critic.antiNour} length=${critic.length} brand=${contentCritic.brandElement} cta=${contentCritic.cta} tags=${contentCritic.hashtagQuality}`
                  : `${critic.overall}/100 · spec=${critic.specificity} cliche=${critic.cliche} antiNour=${critic.antiNour} length=${critic.length}`,
                confidence: 0.9,
                metadata: {
                  conversationId: convId,
                  overall: overallScore,
                  specificity: critic.specificity,
                  cliche: critic.cliche,
                  antiNour: critic.antiNour,
                  length: critic.length,
                  shouldRegen: critic.shouldRegen,
                  wordCount: critic.wordCount,
                  turnIntent: turnSignal.intent,
                  turnShape: turnSignal.outputShape,
                  persona: personality,
                  ...(contentCritic && {
                    contentMode: true,
                    brandElement: contentCritic.brandElement,
                    cta: contentCritic.cta,
                    hashtagQuality: contentCritic.hashtagQuality,
                  }),
                },
              },
            }),
          { timeoutMs: 3_000, silentTimeout: true }
        );
      }

      // Apr 19 · Parse [brain:X] citations the model emitted.
      const citations = hasContent ? parseCitations(cleanedText) : [];
      if (citations.length > 0) {
        log.info("citations_emitted", {
          count: citations.length,
          refs: citations.map((c) => c.raw),
        });
      }

      // Apr 19 · Reply gate — layers on top of the critic.
      // truth-substrate audit P1 (#16): when the per-turn ResponseContract is
      // available, run the contract-aware variant for richer telemetry
      // (contract-compliance signals). This is TELEMETRY-ONLY on the streaming
      // path — the reply is already flushed + persisted; the gate never mutates it.
      const gate = hasContent
        ? responseContract
          ? runReplyGateWithContract(cleanedText, userContent, critic, turnSignal, responseContract)
          : runReplyGate(cleanedText, userContent, critic, turnSignal)
        : null;
      if (gate) {
        log.info("reply_gate_applied", { summary: formatGateSummary(gate) });
      }

      // Apr 19 · Fact-check numeric/named claims.
      const factClaims = hasContent
        ? factCheck(cleanedText, systemPrompt)
        : [];
      if (factClaims.length > 0) {
        log.info("fact_check_applied", { summary: formatFactCheckSummary(factClaims) });
      }
      const unverifiedCount = countUnverified(factClaims);

      // truth-substrate audit P1 (#17): known-truth guard — was pure dead code
      // (only tests/evals called it). Detects retired-infra claims asserted as
      // current (statenour->Vercel, codex/ollama-local=prod, ...) and evidence-
      // free status claims ("deployed", "tests passed", "build is green") with no
      // in-sentence evidence. TELEMETRY-ONLY here: logged + folded into tokenUsage
      // so false "done" claims are observable; the stored reply is NOT altered.
      // (The block/banner tier that would rewrite persisted text is deferred to a
      // flag-gated step once the false-positive rate is known on real traffic.)
      const truthFlags = hasContent ? checkKnownTruth(cleanedText) : [];
      if (truthFlags.length > 0) {
        log.info("known_truth_flags", { summary: formatTruthSummary(truthFlags) });
      }

      // v9.1.13 · Heavier hallucination guard — env-gated.
      // NOTE: checkClaims() runs once, in the DEFERRED post-processing
      // block further below (search "BATCH 1C — Hallucination guard"),
      // which both logs the off/way_off count AND persists a
      // hallucination_flag BrainMemory. A second inline call here only
      // duplicated the (expensive) LLM check to log a warning it then
      // discarded — removed to avoid double-invoking checkClaims per turn.

      // persist-turn decomposition slice 3 (2026-07-25) · the tool-
      // telemetry walk (soft-fail detection + recordToolInvocation +
      // capturedToolCalls buffer) moved VERBATIM to
      // ./tool-telemetry-walk.ts.
      const { walkToolTelemetry } = await import("./tool-telemetry-walk");
      const capturedToolCalls = walkToolTelemetry({ ev, convId });
      // persist-turn decomposition slice 4 (2026-07-25) · the critical-
      // path persist block (dedup guard + P2002 backstop, honesty
      // banners, chatMessage.create w/ tokenUsage blob, conversation
      // bump, judge + adversarial dispatch) moved VERBATIM to
      // ./persist-assistant-message.ts. The discriminated outcome
      // preserves the original control flow: both skip kinds abort the
      // rest of onFinish exactly like the original bare returns.
      const { persistAssistantMessage } = await import("./persist-assistant-message");
      const __persisted = await persistAssistantMessage({
        hasContent,
        hasToolCalls,
        cleanedText,
        reasoningText,
        finishReason,
        usage,
        convId,
        traceId,
        provider,
        modelId,
        startedAt,
        firstTokenRef,
        capturedToolCalls,
        truthFlags,
        critic: critic as Parameters<typeof persistAssistantMessage>[0]["critic"],
        citations,
        gate: gate as Parameters<typeof persistAssistantMessage>[0]["gate"],
        factClaims,
        unverifiedCount,
        turnSignal,
        contextBlocksFired,
        deeperContextCount,
        deeperContextTypes,
        personality,
        userContent,
        posture: deps.posture,
        log,
      });
      if (__persisted.kind !== "done") return;
      const createdAssistantId: string | null = __persisted.createdAssistantId;
      cleanedText = __persisted.cleanedText;

      // Track generation stats — 5s cap. Always runs.
      // v10.0.529.106 · Wave 59 · pass conversationId so cost-slo
      // topConversationsByCost() can do proper per-conversation
      // attribution instead of falling back to feature-name grouping.
      withErrorCapture(
        "chat:post-process",
        () =>
          trackGeneration({
            feature: "chat",
            model: modelId,
            promptTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
            durationMs: Date.now() - startedAt,
            conversationId: convId,
          }),
        { timeoutMs: 5_000, silentTimeout: true }
      );

      // v10 E.5 · agent-trace finalize.
      // v10.0.151 · build the explainability envelope from signals
      // already in scope so /system/agent-traces/[id] can answer
      // "why did Nick respond this way?" — turn intent + output shape
      // become the operator-readable facts + reason.
      // v10.0.156 · toolsCalled[] now populated from capturedToolCalls
      // (collected during the step-walk above). Each tool call carries
      // its name + ok + durationMs so the envelope view shows what
      // tools fired and how long each took.
      const { EnvelopeBuilder } = await import("@/lib/automation/envelope");
      const envelope = new EnvelopeBuilder()
        .setReason(
          `Turn shaped as ${turnSignal.outputShape} for ${turnSignal.intent} intent in ${mode} mode (${personality} persona).`,
        )
        .addFact(`mode: ${mode}`)
        .addFact(`persona: ${personality}`)
        .addFact(`turn intent: ${turnSignal.intent}`)
        .addFact(`output shape: ${turnSignal.outputShape}`)
        .addFact(`task type: ${finalTaskType}`);
      // Context blocks + deeper context surfaces are operator-meaningful
      // facts about which retrieval paths fed this turn. Tag each fired
      // block as a fact so the envelope shows what context Nick was
      // working from without dumping the raw injected memories.
      for (const [block, fired] of Object.entries(contextBlocksFired)) {
        if (fired) envelope.addFact(`context block fired: ${block}`);
      }
      for (const ctxType of deeperContextTypes) {
        envelope.addFact(`deeper context: ${ctxType}`);
      }
      // Tool calls — mirrored from capturedToolCalls so the envelope
      // shows what tools actually fired during the turn.
      for (const t of capturedToolCalls) {
        envelope.recordToolCall(t.name, t.ok, t.durationMs);
      }
      // Tag the policy id of the FIRST tool fired (if any) — that's
      // the governance rule the operator most likely needs to inspect
      // to understand "why did Nick run this tool?". Multiple tools
      // in one turn are rare; when they happen, the secondary ones
      // still surface in toolsCalled[].
      if (capturedToolCalls.length > 0) {
        envelope.setPolicyId(`tool.${capturedToolCalls[0].name}`);
      }

      // v10.0.160 · action-claim verifier (poka-yoke for fabrication).
      // Diagnosed live via envelope: the Bay 5 Revive turn said "Yes,
      // added the suggested tasks · Total tasks now: 15" but called
      // ZERO tools. The user opened Bay 5, found 0 tasks, lost trust.
      //
      // Detector scans the assistant text for past-tense action verbs
      // ("added", "sent", "scheduled", "marked done"). If any verb
      // implies a tool that DIDN'T fire, we flag the response as a
      // fabricated claim. Hedged phrases ("I can add if you want",
      // "I'll add next time") suppress the warning.
      //
      // Output: BrainMemory category="chat_claim_warn" so the chat
      // surface can render an inline correction chip below the bubble
      // and the operator can verify before trusting the claim.
      const { detectActionClaimsWithoutTools, calculateToolVerbRatio } = await import(
        "@/lib/ai/chat/action-claim-detector"
      );
      const fabricatedClaims = detectActionClaimsWithoutTools(
        cleanedText,
        capturedToolCalls,
      );

      // Slice 1: Tool-to-Verb Ratio Telemetry
      // v10.0.197 → v10.0.529.106 Wave 53 · Phase 3 cutover ·
      // BrainMemory(category=telemetry_tool_verb) dual-write removed.
      // The brain insights route already filters this category as
      // NOISE_CATEGORIES, and no other surfaces query the
      // BrainMemory rows · the typed ToolVerbRatio table is the
      // only authoritative store. Surfaces failures via
      // console.warn so a future schema-drift doesn't silently
      // drop telemetry without an operator signal.
      const ratioTelemetry = calculateToolVerbRatio(cleanedText, capturedToolCalls);
      if (convId) {
        void prisma.toolVerbRatio.create({
          data: {
            conversationId: convId,
            traceId,
            ratio: ratioTelemetry.ratio,
            toolsCount: ratioTelemetry.toolsCount,
            claimsCount: ratioTelemetry.claimsCount,
            hedged: ratioTelemetry.hedged,
          },
        }).catch((e: unknown) => {
          const err = e as { code?: string; message?: string; meta?: unknown };
          console.warn("[telemetry_tool_verb] typed write failed", {
            traceId,
            code: err?.code,
            message: err?.message?.slice(0, 200),
            meta: err?.meta,
          });
        });
      }

      // Slice 1: Temporal Consistency Telemetry
      const { checkTemporalConsistency } = await import("@/lib/ai/chat/timing");
      for (const call of capturedToolCalls) {
        const temporal = checkTemporalConsistency(call.name, call.durationMs, call.args);
        if (!temporal.consistent) {
          log.warn("temporal_inconsistency_detected", {
            conversationId: convId,
            toolName: call.name,
            durationMs: call.durationMs,
            expectedMinMs: temporal.expectedMinMs,
            reason: temporal.reason
          });
          envelope.addFact(`⚠ Temporal inconsistency: ${call.name} completed in ${call.durationMs}ms (expected ≥${temporal.expectedMinMs}ms)`);
          
          if (convId) {
            void prisma.brainMemory.create({
              data: {
                category: "telemetry_temporal_warn",
                key: `temporal-warn-${traceId}-${call.name}`,
                content: temporal.reason || "Temporal inconsistency",
                confidence: 0.9,
                source: "temporal-consistency-checker",
                metadata: {
                  conversationId: convId,
                  traceId,
                  toolName: call.name,
                  durationMs: call.durationMs,
                  expectedMinMs: temporal.expectedMinMs
                }
              } as Parameters<typeof prisma.brainMemory.create>[0]["data"],
            }).catch(() => undefined);
          }
        }
      }

      // Slice 2: Enforcement · Environment State Verifier
      const { verifyEnvironmentState } = await import("@/lib/ai/chat/environment-verifier");
      const envVerification = await verifyEnvironmentState(capturedToolCalls);
      for (const check of envVerification) {
        if (!check.verified) {
          log.warn("environment_verification_failed", {
            conversationId: convId,
            toolName: check.toolName,
            reason: check.reason,
          });
          envelope.addFact(`⚠ Environment verification failed for ${check.toolName}: ${check.reason}`);
          
          // Treat environmental failure as a fabricated claim so it gets the L2 hedge rewrite
          fabricatedClaims.push({
            verb: check.toolName,
            snippet: `[Tool reported success, but verification failed: ${check.reason}]`,
            expectedTool: check.toolName,
          });
        }
      }



      if (fabricatedClaims.length > 0) {
        log.warn("action_claim_without_tools", {
          conversationId: convId,
          claims: fabricatedClaims.length,
          firstClaim: fabricatedClaims[0]?.snippet,
          textPreview: cleanedText.slice(0, 120),
        });
        envelope.addFact(
          `⚠ ${fabricatedClaims.length} action claim${fabricatedClaims.length === 1 ? "" : "s"} without matching tool call(s) · likely fabricated`,
        );

        // v10.0.162 · L2 PRE-PERSIST HEDGE REWRITE.
        // Rewrite cleanedText IN PLACE to prepend the verifier banner.
        // This is what's persisted to ChatMessage AND what's sent to
        // the next turn's context. The action-claim-warning chip
        // (v10.0.160) still surfaces the diagnostic visually; the
        // banner is the durable record.
        const { rewriteForFabrication } = await import(
          "@/lib/ai/chat/fabrication-rewriter"
        );
        const rewrite = rewriteForFabrication(cleanedText, fabricatedClaims);
        if (rewrite.rewrote) {
          log.warn("fabrication_rewrite_applied", {
            conversationId: convId,
            bannerLength: rewrite.bannerLength,
            originalLength: cleanedText.length,
            newLength: rewrite.text.length,
          });
          // Cascade the correction to in-memory consumers — history
          // sync and next-turn context read this variable directly.
          cleanedText = rewrite.text;
          envelope.addFact(`verifier rewrote response with hedged banner`);

          // The ChatMessage row was already persisted ABOVE with the
          // pre-rewrite text. Patch it so reload-from-history (and the
          // DB-backed conversation summarizer) show the hedge banner,
          // not the original fabricated claim. Best-effort — a failed
          // patch leaves the in-memory cascade intact, never tanks onFinish.
          if (createdAssistantId) {
            const msgId = createdAssistantId;
            const { partsArray: patchedParts, searchableContent: patchedSearchable } =
              await buildMessageParts(cleanedText, reasoningText, true);
            await prisma.chatMessage
              .update({
                where: { id: msgId },
                data: {
                  content: cleanedText,
                  parts: patchedParts
                    ? (patchedParts as unknown as Parameters<
                        typeof prisma.chatMessage.update
                      >[0]["data"]["parts"])
                    : undefined,
                  searchableContent: patchedSearchable ?? undefined,
                },
              })
              .catch((err) => {
                log.warn("fabrication_rewrite_persist_failed", {
                  conversationId: convId,
                  messageId: msgId,
                  error: err instanceof Error ? err.message : String(err),
                });
              });
          }
        }

        // Persist a structured warning the chat surface can read back
        // via /api/ai/chat/claim-warnings (simple lookup by message id).
        // Best-effort write — failure here doesn't break the chat path.
        if (convId) {
          void prisma.brainMemory
            .create({
              data: {
                category: "chat_claim_warn",
                key: `claim-warn-${traceId}`,
                content: `Fabricated action claim · ${fabricatedClaims.length} verb(s) detected · expected tools: ${fabricatedClaims.map((c) => c.expectedTool).join(", ")} · actually fired: ${capturedToolCalls.map((c) => c.name).join(", ") || "none"}`,
                confidence: 0.95,
                source: "action-claim-detector",
                metadata: {
                  conversationId: convId,
                  traceId,
                  claims: fabricatedClaims.map((c) => ({
                    verb: c.verb,
                    snippet: c.snippet,
                    expectedTool: c.expectedTool,
                  })),
                  toolsActuallyFired: capturedToolCalls.map((c) => c.name),
                  textPreview: cleanedText.slice(0, 200),
                },
              } as Parameters<typeof prisma.brainMemory.create>[0]["data"],
            })
            .catch(() => undefined);
        }
      }

      const builtEnvelope = envelope.build();

      void recordTrace(
        {
          traceId,
          source: "chat",
          label: "chat-turn",
          provider,
          model: modelId,
          inputChars: userContent.length,
          metadata: {
            mode,
            taskType: finalTaskType,
            persona: personality,
            firstTokenAt: firstTokenRef.value,
            ttftMs:
              firstTokenRef.value != null ? firstTokenRef.value - startedAt : null,
            turnIntent: turnSignal.intent,
            outputShape: turnSignal.outputShape,
            conversationId: convId,
            envelope: builtEnvelope,
          },
        },
        {
          durationMs: Date.now() - startedAt,
          outputChars: cleanedText.length,
          toolCalls: builtEnvelope.toolsCalled.length,
        },
      );

      // Apr 19 · Low-quality reply → brain_insight log.
      if (critic && critic.shouldRegen) {
        const logKey = `reply_quality_${convId}_${Date.now()}`;
        withErrorCapture(
          "chat:post-process",
          () =>
            prisma.brainMemory.create({
              data: {
                category: BRAIN_CATEGORIES.REPLY_QUALITY,
                key: logKey,
                source: "output_critic",
                content: `LOW-SCORE reply (${critic.overall}/100) · turn=${turnSignal.intent}/${turnSignal.outputShape} · reasons: ${critic.reasons.join(" · ")}`,
                confidence: 0.8,
                metadata: {
                  conversationId: convId,
                  turnIntent: turnSignal.intent,
                  turnShape: turnSignal.outputShape,
                  persona: personality,
                  critic: {
                    overall: critic.overall,
                    specificity: critic.specificity,
                    cliche: critic.cliche,
                    antiNour: critic.antiNour,
                    length: critic.length,
                    offenders: critic.offenders,
                  },
                  userPromptPreview: userContent.slice(0, 200),
                },
              },
            }),
          { timeoutMs: 3_000, silentTimeout: true }
        );
      }

      // ═══ DEFERRED BACKGROUND WORK ═══
      // Fire-and-forget analysis that runs AFTER the assistant ChatMessage
      // is persisted and does NOT feed back into the response or the row.
      // Extracted VERBATIM into runDeferredBackgroundWork — same phases,
      // same order, same error handling. Invoked at the SAME point. All
      // inputs are the frozen post-rewrite state (cleanedText/text are no
      // longer reassigned past this line).
      await runDeferredBackgroundWork({
        log,
        convId,
        traceId,
        provider,
        modelId,
        mode,
        personality,
        topicTier,
        startedAt,
        userContent,
        cleanedText,
        text,
        messages,
        createdAssistantId,
      });

      deps.onWorkComplete?.();
    };
}
