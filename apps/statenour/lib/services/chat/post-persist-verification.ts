/**
 * lib/services/chat/post-persist-verification.ts — persist-turn
 * decomposition slice (2026-07-25). The post-persist verification +
 * telemetry stack moved VERBATIM from buildOnFinish: trackGeneration,
 * the explainability envelope build, the action-claim verifier +
 * tool-verb ratio + temporal-consistency + environment-state checks,
 * the L2 fabrication hedge rewrite (with the persisted-row patch),
 * recordTrace finalize, and the low-quality reply log. cleanedText is
 * returned (possibly rewritten) so the deferred background work reads
 * the same frozen post-rewrite state as before.
 */

import { prisma } from "@/lib/prisma";
import { withErrorCapture } from "@/lib/errors/record-error";
import { trackGeneration } from "@/lib/ai/track";
import { buildMessageParts } from "./message-parts";
import type { CapturedToolCall } from "./tool-telemetry-walk";
import type { ProviderName } from "@/lib/ai/provider";
import type { TraceStartInput, TraceFinishInput } from "@/lib/ai/agent-trace";
import type { TurnSignal } from "@/lib/ai/turn-intelligence";
import type { ContextBlocksFired } from "./brain-context";
import type { critiqueOutput, ContentCriticScore } from "@/lib/ai/output-critic";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

interface ChatLogger {
  info(event: string, ctx?: Record<string, unknown>): void;
  warn(event: string, ctx?: Record<string, unknown>): void;
}

export async function runPostPersistVerification(a: {
  cleanedText: string;
  reasoningText: string;
  createdAssistantId: string | null;
  capturedToolCalls: CapturedToolCall[];
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
  convId: string | undefined;
  traceId: string;
  provider: ProviderName;
  modelId: string;
  mode: string;
  personality: string;
  finalTaskType: string;
  userContent: string;
  turnSignal: TurnSignal;
  contextBlocksFired: ContextBlocksFired;
  deeperContextCount: number;
  deeperContextTypes: string[];
  startedAt: number;
  firstTokenRef: { value: number | null };
  critic: ReturnType<typeof critiqueOutput> | ContentCriticScore | null;
  recordTrace: (start: TraceStartInput, finalize: TraceFinishInput) => Promise<void> | void;
  log: ChatLogger;
}): Promise<{ cleanedText: string }> {
  const {
    reasoningText, createdAssistantId, capturedToolCalls, usage, convId,
    traceId, provider, modelId, mode, personality, finalTaskType,
    userContent, turnSignal, contextBlocksFired, deeperContextCount,
    deeperContextTypes, startedAt, firstTokenRef, critic, recordTrace, log,
  } = a;
  let cleanedText = a.cleanedText;
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
  return { cleanedText };
}
