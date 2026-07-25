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

      // Apr 19 · Tool telemetry. Walk steps → toolResults.
      // v10.0.156 · also collect into capturedToolCalls so the
      // explainability envelope (built later at recordTrace time)
      // can populate envelope.toolsCalled[] — closes the gap noted
      // in v10.0.151's "intentional next-slice gap" comment.
      const capturedToolCalls: Array<{ name: string; ok: boolean; durationMs: number; args?: Record<string, unknown> }> = [];
      if (Array.isArray(ev.steps)) {
        interface ToolCallShape {
          toolName?: string;
          name?: string;
          executionDurationMs?: number;
          durationMs?: number;
          error?: unknown;
          result?: unknown;
          args?: Record<string, unknown>;
        }
        interface StepShape {
          toolCalls?: ToolCallShape[];
          toolResults?: ToolCallShape[];
        }
        for (const step of ev.steps) {
          if (!step || typeof step !== "object") continue;
          const s = step as StepShape;
          const callList: ToolCallShape[] = Array.isArray(s.toolResults) && s.toolResults.length > 0
            ? s.toolResults
            : Array.isArray(s.toolCalls)
              ? s.toolCalls
              : [];
          for (const call of callList) {
            const toolName = call?.toolName || call?.name;
            if (!toolName) continue;
            // ─────────────────────────────────────────────────────────
            // v10.0.179 · TELEMETRY BLIND SPOT FIX
            //
            // Pre-fix only checked call.error — the AI SDK sets that
            // when execute() THROWS. But ~22 tools (all GitHub, all
            // Drive, getShopSnapshot, queryNickstire, syncDriveMemory,
            // toolHealth itself, etc.) use the soft-fail pattern:
            //
            //   execute() {
            //     if (!process.env.GITHUB_TOKEN) {
            //       return { error: "GITHUB_TOKEN not set" };
            //     }
            //     ...
            //   }
            //
            // Returning `{ error }` from execute() is a SUCCESSFUL
            // call to the SDK — call.error stays undefined — so
            // telemetry recorded success=true while the model
            // received an error payload every turn.
            //
            // Net effect: a revoked GITHUB_TOKEN, missing
            // NICKS_ADMIN_URL, or expired Drive credentials would
            // surface as 100% success on the dashboard while the
            // model silently got `{ error: "..." }` on every call.
            // The circuit breaker never tripped. Operators couldn't
            // see the failure until they manually opened a tool's
            // raw output.
            //
            // Fix: ALSO inspect the tool's return value for an
            // `error` field. If present, treat as fail. This makes
            // soft-fails visible to telemetry, the circuit breaker,
            // and the operator-facing envelope.
            // ─────────────────────────────────────────────────────────
            const sdkErrored = call?.error !== undefined && call?.error !== null;
            const result = call?.result;
            const softErrored =
              !sdkErrored &&
              !!result &&
              typeof result === "object" &&
              "error" in (result as Record<string, unknown>) &&
              (result as Record<string, unknown>).error !== undefined &&
              (result as Record<string, unknown>).error !== null;
            const errored = sdkErrored || softErrored;
            const durationMs =
              typeof call?.executionDurationMs === "number"
                ? call.executionDurationMs
                : typeof call?.durationMs === "number"
                  ? call.durationMs
                  : 0;
            const errorMessage = errored
              ? (() => {
                  const e = sdkErrored
                    ? call.error
                    : (result as Record<string, unknown>).error;
                  if (typeof e === "string") return e;
                  if (e && typeof e === "object" && "message" in e) {
                    return String((e as { message?: string }).message ?? "error");
                  }
                  return "error";
                })()
              : undefined;
            const toolArgs = call?.args as Record<string, unknown> | undefined;

            recordToolInvocation({
              toolName,
              success: !errored,
              durationMs,
              errorMessage,
              conversationId: convId,
            }).catch(() => {});
            // Mirror into the envelope buffer — same source, same data,
            // just persisted in two places (telemetry table + AgentTrace
            // metadata). The envelope view is operator-facing and joins
            // with policy id; the telemetry table feeds /system/tools.
            capturedToolCalls.push({
              name: toolName,
              ok: !errored,
              durationMs,
              args: toolArgs,
            });
          }
        }
      }
      // Hoisted out of the hasContent block so the fabrication-rewrite
      // block far below can patch the persisted assistant row. Stays
      // null when the response had no content (block never assigns it).
      let createdAssistantId: string | null = null;
      if (hasContent || hasToolCalls) {
        // v7.6 · Apr 29 · ChatMessage Batch A · C2 — assistant message persistence.
        const finishedAt = Date.now();
        const latencyMs = finishedAt - startedAt;
        const firstTokenLatencyMs =
          firstTokenRef.value !== null ? firstTokenRef.value - startedAt : null;
        const promptTokens = typeof usage?.inputTokens === "number" ? usage.inputTokens : null;
        const completionTokens = typeof usage?.outputTokens === "number" ? usage.outputTokens : null;

        // v7.6 · C8 · Apr 29 — Branching parent + branchId.
        const lastUserRow = await prisma.chatMessage
          .findFirst({
            where: { conversationId: convId!, role: "user" },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          })
          .catch(() => null);
        const parentMessageId = lastUserRow?.id ?? null;
        const branchId = parentMessageId;
        const costCents: number | null = null;

        // v10.0.337 · DEDUP GUARD · Phase 1 of glitch taxonomy hardening
        // (Cat 4 · concurrency races). The cmou6xugm chat had a double-
        // reply bug: turn 4 + turn 5 BOTH replied to the same user msg
        // (same parentMessageId + same branchId), 76 seconds apart. Two
        // streams completed and both onFinish handlers persisted.
        //
        // Check before insert · if an assistant message with this
        // (conversationId, parentMessageId, branchId) already exists,
        // skip the persist and log it. The first message wins.
        // 2026-07-11 · the DB unique constraint SHIPPED (partial index
        // chat_messages_assistant_reply_uniq — prod dupes cleaned first,
        // 8 groups / 9 rows). This check is now the fast path; the index
        // + the P2002 catch on the create below are the race-proof
        // backstop. Sentinel guards the index (schema-sentinel.ts).
        if (parentMessageId) {
          const existingAssistant = await prisma.chatMessage
            .findFirst({
              where: {
                conversationId: convId!,
                role: "assistant",
                parentMessageId,
                branchId: branchId ?? undefined,
              },
              select: { id: true, createdAt: true },
            })
            .catch(() => null);
          if (existingAssistant) {
            log.warn("duplicate_assistant_persist_blocked", {
              existingId: existingAssistant.id,
              existingCreatedAt: existingAssistant.createdAt.toISOString(),
              parentMessageId,
              branchId,
              attemptedTextLength: cleanedText.length,
              deltaMs: Date.now() - existingAssistant.createdAt.getTime(),
            });
            // Skip the persist · the first reply already landed. Returning
            // here drops the rest of the onFinish flow (no double-write,
            // no double-trace, no double-cost-track). The stream itself
            // already showed the duplicate output to the user briefly,
            // but reload-from-history will see only the first reply.
            return;
          }
        }

        // Honesty Enforcement: SDK Tool Call Check
        const receipts = capturedToolCalls.map((t) => toReceipt({ toolName: t.name, ok: t.ok }));
        const verdict = canClaimDone(receipts);
        if (!verdict.ok) {
          // 2026-07-11 review · this site previously prepended
          // UNCONDITIONALLY (no idempotency guard) with a third
          // hand-duplicated copy of the banner — a turn tripping this
          // AND another enforcement layer got two stacked banners.
          // Shared builder + guard, matching the other two layers.
          if (!isVerifierRewritten(cleanedText)) {
            const verbs = [...new Set(verdict.offenders.map((o) => o.label || o.toolName))].slice(0, 3);
            const banner = buildVerifierBanner(
              `The response below claimed action(s) (${verbs.join(", ")}) but tool call(s) failed.`,
            );
            cleanedText = `${banner}${cleanedText}`;
          }

          // Log warning to brainMemory with key sdk-fail-${traceId}
          await prisma.brainMemory.create({
            data: {
              category: "chat_claim_warn",
              key: `sdk-fail-${traceId}`,
              content: `SDK tool call failed · expected tools: ${verdict.offenders.map((o) => o.toolName).join(", ")}`,
              confidence: 0.95,
              source: "action-receipt-verifier",
              metadata: {
                conversationId: convId,
                traceId,
                claims: verdict.offenders.map((o) => ({
                  verb: o.label || o.toolName,
                  snippet: o.errorSafeMessage || "",
                  expectedTool: o.toolName,
                })),
                offenders: verdict.offenders.map((o) => ({
                  toolName: o.toolName,
                  status: o.status,
                  label: o.label,
                  errorSafeMessage: o.errorSafeMessage,
                })),
                toolsActuallyFired: receipts.map((r) => r.toolName),
                textPreview: cleanedText.slice(0, 200),
              },
            } as Parameters<typeof prisma.brainMemory.create>[0]["data"],
          }).catch(() => undefined);
        }

        // truth-substrate (2026-07-22): promote HIGH-HARM known-truth flags
        // (evidence-free status / retired-infra-as-current, detected at ~1049
        // where they were TELEMETRY-ONLY) into a persisted-row correction banner —
        // the SAME reload mechanism as the action-receipt verifier above. Flag-
        // gated default-off (NICK_KNOWN_TRUTH_BANNER) while the false-positive rate
        // is measured on real traffic; skips when a banner already fired (the
        // action-receipt banner is more specific and takes precedence). Every
        // truthFlag is already sev>=55 by the guard's construction.
        if (truthFlags.length > 0 && !isVerifierRewritten(cleanedText)) {
          const { getFlag } = await import("@/lib/feature-flags");
          if (getFlag("NICK_KNOWN_TRUTH_BANNER")?.isOn) {
            const kinds = [...new Set(truthFlags.map((f) => f.kind))];
            cleanedText = `${buildKnownTruthBanner(kinds)}${cleanedText}`;
            log.info("known_truth_banner_applied", { kinds });
          }
        }

        const { partsArray, searchableContent } = await buildMessageParts(
          cleanedText,
          reasoningText,
        );

        const createdAssistant = await withErrorCapture(
          "chat:db-write",
          () =>
            prisma.chatMessage.create({
              data: {
                conversationId: convId!,
                role: "assistant",
                content: cleanedText,
                model: modelId,
                provider,
                latencyMs,
                firstTokenLatencyMs: firstTokenLatencyMs ?? undefined,
                promptTokens: promptTokens ?? undefined,
                completionTokens: completionTokens ?? undefined,
                costCents: costCents ?? undefined,
                streamingState:
                  finishReason === "stop" || finishReason === "tool-calls"
                    ? "complete"
                    : finishReason === "error"
                      ? "errored"
                      : finishReason === "length"
                        ? "truncated"
                        : "unknown",
                parts: partsArray
                  ? (partsArray as unknown as Parameters<typeof prisma.chatMessage.create>[0]["data"]["parts"])
                  : undefined,
                searchableContent: searchableContent ?? undefined,
                parentMessageId: parentMessageId ?? undefined,
                branchId: branchId ?? undefined,
                tokenUsage: {
                  // v10.0.515 · #7 reasoning-trace UI · link the
                  // assistant ChatMessage to its agent_traces rows
                  // so /api/system/agent-traces/by-message/[id] can
                  // fan out into the full provider/tool/brain chain
                  // without a schema migration. Cheap to add to the
                  // existing JSON blob.
                  traceId,
                  promptTokens: usage?.inputTokens,
                  completionTokens: usage?.outputTokens,
                  provider,
                  model: modelId,
                  deeperContext: deeperContextCount > 0
                    ? { count: deeperContextCount, types: deeperContextTypes }
                    : undefined,
                  contextBlocks: contextBlocksFired,
                  persona: personality,
                  turnSignal: {
                    complexity: turnSignal.complexity,
                    intent: turnSignal.intent,
                    shape: turnSignal.outputShape,
                    urgency: turnSignal.urgency,
                    temp: turnSignal.temperature,
                    cot: turnSignal.useChainOfThought,
                  },
                  critic: critic
                    ? (() => {
                        const cc = "contentOverall" in critic ? (critic as ContentCriticScore) : null;
                        return {
                          overall: cc ? cc.contentOverall : critic.overall,
                          specificity: critic.specificity,
                          cliche: critic.cliche,
                          antiNour: critic.antiNour,
                          length: critic.length,
                          wordCount: critic.wordCount,
                          shouldRegen: critic.shouldRegen,
                          reasons: critic.reasons,
                          offenders: critic.offenders,
                          ...(cc && {
                            contentMode: true,
                            brandElement: cc.brandElement,
                            cta: cc.cta,
                            hashtagQuality: cc.hashtagQuality,
                          }),
                        };
                      })()
                    : undefined,
                  citations: citations.length > 0
                    ? citations.map((c) => ({
                        raw: c.raw,
                        category: c.category,
                        detail: c.detail,
                        start: c.start,
                        end: c.end,
                      }))
                    : undefined,
                  gate: gate
                    ? {
                        severity: gate.severity,
                        shouldRegen: gate.shouldRegen,
                        reasons: gate.reasons,
                        signals: gate.signals,
                        // audit #16: contract-compliance signals when the
                        // contract-aware gate ran (telemetry only). Cast to a
                        // plain bool record so it satisfies Prisma InputJsonValue.
                        ...("contractSignals" in gate
                          ? { contractSignals: gate.contractSignals as Record<string, boolean> }
                          : {}),
                      }
                    : undefined,
                  factCheck: factClaims.length > 0
                    ? {
                        total: factClaims.length,
                        unverified: unverifiedCount,
                        claims: factClaims.map((c) => ({
                          raw: c.raw,
                          kind: c.kind,
                          value: c.value,
                          start: c.start,
                          end: c.end,
                          verified: c.verified,
                        })),
                      }
                    : undefined,
                  // audit #17: known-truth flags folded in for calibration
                  // (each = one offending sentence: retired-infra or evidence-free).
                  truth: truthFlags.length > 0
                    ? {
                        total: truthFlags.length,
                        flags: truthFlags.map((f) => ({
                          kind: f.kind,
                          rule: f.rule,
                          snippet: f.snippet,
                          severity: f.severity,
                        })),
                      }
                    : undefined,
                },
              },
            }).catch((err: unknown) => {
              // 2026-07-11 · DB backstop live (partial unique index
              // chat_messages_assistant_reply_uniq, hand-applied to prod).
              // A concurrent onFinish that loses the race now gets P2002
              // here instead of writing a duplicate row — same contract
              // as the app-level guard above: first reply wins, the
              // loser is dropped quietly.
              if ((err as { code?: string })?.code === "P2002") {
                log.warn("duplicate_assistant_persist_blocked_db", {
                  parentMessageId,
                  branchId,
                });
                return null;
              }
              throw err;
            }),
          { timeoutMs: 10_000, context: { conversationId: convId } }
        );
        createdAssistantId = createdAssistant?.id ?? null;
        // v7.6 · Apr 29 · Bump conversation activity for assistant turn.
        prisma.chatConversation
          .update({
            where: { id: convId! },
            data: { messageCount: { increment: 1 }, lastActiveAt: new Date() },
          })
          .catch(() => null);

        // v10.0.366 · LLM-as-judge real-time eval · fire-and-forget.
        // Scores the just-persisted reply on a 5-axis rubric (accuracy /
        // actionability / brevity / tone / evidence). Stores result as
        // brainMemory category=reply_judgment keyed by message ID.
        // No await · zero impact on user-perceived latency.
        // v10.0.448 · silent-failure-hunter · the prior `.catch(() => null)`
        // swallowed BOTH dynamic-import failures AND eval errors with no
        // breadcrumb. Now logs the error class + message so the daily
        // eval harness + observability dashboard can spot regressions
        // (e.g. dynamic-import miss after refactor · provider key rotation
        // · transient OpenAI 5xx storms).
        if (createdAssistant?.id && cleanedText && cleanedText.length >= 30) {
          import("@/lib/ai/judge-eval")
            .then(({ judgeReplyAsync }) =>
              judgeReplyAsync({
                messageId: createdAssistant.id,
                userQuery: userContent.slice(0, 1000),
                assistantReply: cleanedText,
              }),
            )
            .catch((err) => {
              log.warn("judge_eval_failed", {
                messageId: createdAssistant.id,
                error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
                errClass: err instanceof Error ? err.constructor.name : typeof err,
              });
              return null;
            });

          // v10.0.369 · adversarial critic · runs only on recommendation-
          // shape replies (the predicate inside criticizeAsync skips
          // non-recs). Surfaces the strongest objection · pairs with judge
          // to give Nick both a quality score AND a counter-view per turn.
          // AG-30 · spar turns (brainstorm contract or /spar prefix)
          // critique UNCONDITIONALLY — every brainstorm gets a stored
          // counter-view — and carry conversationId so the objection-
          // injector can re-surface unaddressed ones on later turns.
          import("@/lib/ai/adversarial-critic")
            .then(async ({ criticizeAsync }) => {
              const [{ buildResponseContract, detectExecuteFinalized }, { EARLY_SPAR }] = await Promise.all([
                import("@/lib/ai/response-contract"),
                import("@/lib/ai/chat/handlers/patterns"),
              ]);
              // 2026-07-22 · posture axis: an explicit UI posture ("spar" /
              // "execute") composes with the phrase-based detections. Explicit
              // spar/counsel override a phrase-detected finality (self-review #8/#9)
              // — only "auto"/absent falls back to the phrase.
              const isAutoPosture = !deps.posture || deps.posture === "auto";
              const sparTurn =
                buildResponseContract(userContent).answerMode === "brainstorm" ||
                EARLY_SPAR.test(userContent) ||
                deps.posture === "spar";
              const executeFinalized =
                deps.posture === "execute" ||
                (isAutoPosture && detectExecuteFinalized(userContent));
              // execute suppresses NEW objections — unless the user explicitly
              // asked to spar (that IS a request to be challenged). No stored
              // objection ⇒ nothing for the injector to re-raise.
              if (executeFinalized && !sparTurn) return;
              return criticizeAsync({
                messageId: createdAssistant.id,
                conversationId: convId ?? null,
                userQuery: userContent.slice(0, 1000),
                recommendation: cleanedText,
                force: sparTurn,
              });
            })
            .catch((err) => {
              log.warn("adversarial_critic_dispatch_failed", {
                messageId: createdAssistant.id,
                error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
                errClass: err instanceof Error ? err.constructor.name : typeof err,
              });
              return null;
            });
        }
      } else {
        log.warn("empty_response_skipping_create", { conversationId: convId });
      }

      // Nothing downstream should run when the response was empty.
      if (!hasContent && !hasToolCalls) return;

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
