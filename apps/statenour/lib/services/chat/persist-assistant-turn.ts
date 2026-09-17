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
import { runReplyGate, runReplyGateWithContract, formatGateSummary } from "@/lib/ai/reply-gate";
import { shapeCeiling } from "@/lib/ai/chat/output-guardian";
import type { ResponseContract } from "@/lib/ai/response-contract";
import {
  factCheck,
  countUnverified,
  formatFactCheckSummary,
} from "@/lib/ai/fact-check";
import { checkKnownTruth, formatTruthSummary } from "@/lib/ai/known-truth-guard";
import { withErrorCapture } from "@/lib/errors/record-error";
import type { ProviderName } from "@/lib/ai/provider";
import type { TraceStartInput, TraceFinishInput } from "@/lib/ai/agent-trace";
import type { TurnSignal } from "@/lib/ai/turn-intelligence";
import type { ContextBlocksFired } from "./brain-context";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { runDeferredBackgroundWork } from "./deferred-background-work";
import { reconcileStreamText } from "./reconcile-stream-text";

interface ChatLogger {
  info(event: string, ctx?: Record<string, unknown>): void;
  warn(event: string, ctx?: Record<string, unknown>): void;
}

/** Mutable refs shared with onChunk — onChunk writes, onFinish reads. */
export interface FirstTokenRef {
  value: number | null;
}

/**
 * 2026-08-19 · memory-loop wave · one recall hit as a persisted RECEIPT.
 * A snippet, not full content — tokenUsage is a metadata bag, and the
 * live row is one findMany away via `id` when a reader wants the rest.
 */
export interface RecallReceipt {
  id: string;
  category: string;
  key?: string;
  similarity: number;
  seenCount?: number;
  snippet: string;
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
  // 2026-08-19 · memory-loop wave · MEMORY RECEIPTS. The recall hits that
  // actually fired on THIS turn, persisted into tokenUsage so "why did
  // Nick say this?" reads the receipt instead of re-running recall at
  // read time (brain-provenance's reconstruction). Optional: alternate
  // paths that skip recall pass nothing and persist nothing.
  recallReceipts?: RecallReceipt[];
  // ─── timing refs ──────────────────────────────────────────────
  startedAt: number;
  firstTokenRef: FirstTokenRef;
  /** Full visible text collected from text-delta callbacks, when available. */
  partialRef?: { text: string };
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
    recallReceipts,
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
      const streamReconciliation = deps.partialRef?.text
        ? reconcileStreamText(event.text ?? "", deps.partialRef.text)
        : null;
      const eventForSalvage =
        streamReconciliation && streamReconciliation.relation !== "exact"
          ? { ...event, text: streamReconciliation.text }
          : event;
      const __salvaged = salvageEventText({
        event: eventForSalvage,
        provider,
        modelId,
        mode,
        promptChars: finalSystemPrompt.length,
        log,
      });
      const text = __salvaged.text;
      if (streamReconciliation && streamReconciliation.relation !== "exact") {
        log.info("stream_text_reconciled", {
          relation: streamReconciliation.relation,
          finalChars: event.text?.length ?? 0,
          accumulatedChars: deps.partialRef?.text.length ?? 0,
          recoveredChars: streamReconciliation.recoveredChars,
          salvagedChars: text.length,
        });
      }
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
      // 2026-08-18 · pass the operator's prompt so operator-constrained
      // brevity ("reply with just OK") waives the spec/length axes —
      // obedient terse replies were wearing red REGEN chips (witnessed
      // at overall 62 and 86 on prod).
      const critic = hasContent
        ? contentMode
          ? critiqueContent(cleanedText, turnSignal.outputShape)
          : critiqueOutput(cleanedText, turnSignal.outputShape, { userPrompt: userContent })
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
      // traceId is threaded through so the `tool.chosen` lane the walk records
      // can be JOINED to `tool.surfaced` from prepare-tools.ts. Both stamp the
      // same route-minted id; without it the pair is two unrelated counts.
      //
      // `laneToolNames` / `laneReceiptsAvailable` ride on the event because the
      // alternate paths (NICK_VERIFIED_REGEN, NICK_SELF_CONSISTENCY, pre-flush
      // evidence) call this callback with `{ text, finishReason }` and NO
      // `steps`. Without them the walk saw nothing and recorded a confident
      // `tool.chosen = 0` for turns that had actually invoked tools. The
      // pre-flush lane DOES buffer its calls, so it is measured; the others
      // declare themselves blind rather than being counted as zero.
      const capturedToolCalls = walkToolTelemetry({
        ev,
        convId,
        traceId,
        laneToolNames: (ev as { laneToolNames?: ReadonlyArray<string> }).laneToolNames,
        laneReceiptsAvailable: (ev as { laneReceiptsAvailable?: boolean }).laneReceiptsAvailable,
      });


      // ── EVIDENCE GATE (SHADOW) — 2026-09-10 ─────────────────────────
      // Runs here, after the tool walk, because it is the first point in
      // the turn where the RECEIPT LEDGER exists: which tools fired and
      // what they returned (resultDigest, added 2026-09-10 -- the walk
      // was already reading call.result to spot soft errors and then
      // discarding it).
      //
      // SHADOW, deliberately. This path is post-flush by construction
      // (streamText's onFinish cannot run until the last token is on the
      // wire, build-stream-config.ts:340), so it CANNOT block here and
      // pretending otherwise would be theatre. What it does is produce
      // the two measurements that decide whether blocking is safe to
      // turn on at all:
      //   E4 - the false-positive rate of the named-source check on real
      //        traffic, before it is ever allowed to remove text;
      //   E2 - how often a turn names resources with no receipt at all.
      // Enforcement (lib/ai/chat/gate-enforcement.ts) is unit-tested and
      // ready; it goes live on the BUFFERED path once these numbers say
      // the FP rate is tolerable. Shipping the blocker first, unmeasured,
      // is how you get a gate that either mangles good replies or gets
      // switched off for good.
      let evidenceGate: unknown = null;
      if (hasContent) {
        try {
          const [{ checkNamedSources }, { runEvidenceGate }] = await Promise.all([
            import("@/lib/ai/chat/named-source-claims"),
            import("@/lib/ai/reply-gate"),
          ]);
          const digests = capturedToolCalls
            .map((c) => (c as { resultDigest?: string }).resultDigest ?? "")
            .filter(Boolean);
          // EMPTY vs ERROR: "no tool fired" is a finding; "tools fired
          // but we could not read any result" is a blind instrument and
          // must abstain, not convict.
          const receiptsAvailable =
            capturedToolCalls.length === 0 || digests.length > 0;
          const named = checkNamedSources(cleanedText, {
            toolCalls: capturedToolCalls.map((c) => ({ name: c.name })),
            evidenceText: digests.join(" | "),
            receiptsAvailable,
            userText: userContent,
            contextText: systemPrompt,
          });
          const decision = runEvidenceGate(
            cleanedText,
            userContent,
            critic,
            turnSignal,
            responseContract ?? null,
            {
              unverifiedFactCount: unverifiedCount,
              totalFactCount: factClaims.length,
              wordCount: cleanedText.trim().split(/\s+/).filter(Boolean).length,
              // Shape-aware, not hardcoded: the ceiling is 40 for sms,
              // 120 for summary, 400 for code. Assuming prose would
              // corrupt the E4 false-positive measurement in BOTH
              // directions on every non-prose turn.
              lengthCeiling: shapeCeiling(turnSignal.outputShape),
              namedSources: named,
            },
          );
          // 2026-09-15 · E3 shadow: would the pre-flush lane have buffered
          // this turn? Same pure classifier the lane uses (assessTurnRisk),
          // fed what actually happened (tools fired or not), so a week of
          // rows answers "what share of turns would stop streaming" before
          // NICK_EVIDENCE_PREFLUSH is turned on.
          let turnRisk: unknown = null;
          try {
            const { assessTurnRisk } = await import("@/lib/ai/chat/turn-risk");
            const risk = assessTurnRisk(userContent, {
              toolsExpected: capturedToolCalls.length > 0,
              intent: turnSignal.intent,
            });
            turnRisk = { buffer: risk.buffer, risk: risk.risk, register: risk.register, reasons: risk.reasons, toolsFired: capturedToolCalls.length };
          } catch {
            /* measurement only */
          }
          evidenceGate = {
            verdict: decision.verdict,
            severity: decision.severity,
            blockingReasons: decision.blockingReasons,
            signals: decision.evidenceSignals,
            namedClaims: named.claims.length,
            unreceipted: named.unreceipted.map((c) => c.name),
            shadowOnly: true,
            turnRisk,
          };
          log.info("evidence_gate_shadow", {
            verdict: decision.verdict,
            severity: decision.severity,
            unreceipted: named.unreceipted.length,
            namedClaims: named.claims.length,
            blind: named.blind,
          });
        } catch (err) {
          log.warn("evidence_gate_failed", {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
      // 2026-09-03 · resolve any toolChoice force parked at decision time
      // (build-stream-config.ts) against what ACTUALLY fired. No-ops when
      // no force was requested, so it is safe on every turn. Fire-and-
      // forget: telemetry must never affect the persist path.
      void import("@/lib/ai/tool-selection-telemetry")
        .then(({ resolveForcedTool }) =>
          resolveForcedTool(
            traceId,
            capturedToolCalls.map((c) => c.name)
          )
        )
        .catch(() => {
          /* never affect the turn */
        });
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
        evidenceGate,
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
        recallReceipts,
        personality,
        userContent,
        posture: deps.posture,
        log,
      });
      if (__persisted.kind !== "done") {
        // 2026-07-25 fix (pre-existing quirk flagged in PR #1064): both
        // skip paths previously returned WITHOUT resolving onWorkComplete.
        // The SSE stream awaits that promise before emitting
        // message.completed + controller.close(), so a duplicate-reply or
        // empty turn held its stream open until maxDuration (120s).
        // Resolve exactly as the privateMode gate and the normal tail do.
        deps.onWorkComplete?.();
        return;
      }
      const createdAssistantId: string | null = __persisted.createdAssistantId;
      cleanedText = __persisted.cleanedText;

      // persist-turn decomposition slice 5 (2026-07-25) · the post-
      // persist verification + telemetry stack (trackGeneration,
      // envelope, claim verifier + ratio/temporal/env checks, L2
      // fabrication rewrite + row patch, recordTrace, low-quality log)
      // moved VERBATIM to ./post-persist-verification.ts; cleanedText
      // returns possibly-rewritten, same frozen state the deferred
      // work always read.
      const { runPostPersistVerification } = await import("./post-persist-verification");
      const __postVerify = await runPostPersistVerification({
        cleanedText,
        reasoningText,
        createdAssistantId,
        capturedToolCalls,
        usage,
        convId,
        traceId,
        provider,
        modelId,
        mode,
        personality,
        finalTaskType,
        userContent,
        turnSignal,
        contextBlocksFired,
        deeperContextCount,
        deeperContextTypes,
        startedAt,
        firstTokenRef,
        critic: critic as Parameters<typeof runPostPersistVerification>[0]["critic"],
        recordTrace,
        log,
      });
      cleanedText = __postVerify.cleanedText;
      // ═══ DEFERRED BACKGROUND WORK ═══
      // Fire-and-forget analysis that runs AFTER the assistant ChatMessage
      // is persisted and does NOT feed back into the response or the row.
      // Extracted VERBATIM into runDeferredBackgroundWork — same phases,
      // same order, same error handling. Invoked at the SAME point. All
      // inputs are the frozen post-rewrite state (cleanedText/text are no
      // longer reassigned past this line).
      // 2026-07-25 durable outbox (audit P1): enqueue the frozen ctx
      // BEFORE running inline, mark done after — a crash mid-work now
      // strands a pending row the nightly outbox-drain replays instead
      // of silently losing memory writes / receipts / journal ingest.
      // Both outbox writes are best-effort and never affect the turn.
      const __deferredCtx = {
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
      };
      const { enqueuePostTurnWork, completePostTurnWork } = await import(
        "./post-turn-outbox"
      );
      const __outboxId = await enqueuePostTurnWork(__deferredCtx);
      await runDeferredBackgroundWork({ log, ...__deferredCtx });
      await completePostTurnWork(__outboxId);

      deps.onWorkComplete?.();
    };
}
