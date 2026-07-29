/**
 * lib/services/chat/persist-assistant-message.ts — persist-turn
 * decomposition slice (2026-07-25). The CRITICAL-PATH persist block
 * moved VERBATIM from buildOnFinish: dedup guard (app-level check +
 * P2002 DB backstop), SDK-receipt honesty banner, flag-gated
 * known-truth banner, buildMessageParts, the chatMessage.create with
 * the full tokenUsage blob, conversation activity bump, and the
 * judge-eval + adversarial-critic fire-and-forget dispatches.
 *
 * Result is discriminated so the caller preserves the ORIGINAL control
 * flow exactly: "duplicate-skip" and "empty-skip" abort the rest of
 * onFinish (the two original bare `return;` sites); "done" carries the
 * (possibly banner-prefixed) cleanedText + createdAssistantId forward.
 */

import { prisma } from "@/lib/prisma";
import { withErrorCapture } from "@/lib/errors/record-error";
import { buildVerifierBanner, isVerifierRewritten, buildKnownTruthBanner } from "@/lib/ai/chat/fabrication-rewriter";
import { canClaimDone, toReceipt } from "@/lib/ai/receipts/action-receipt";
import { buildMessageParts } from "./message-parts";
import type { CapturedToolCall } from "./tool-telemetry-walk";
import type { ProviderName } from "@/lib/ai/provider";
import type { TurnSignal } from "@/lib/ai/turn-intelligence";
import type { runReplyGate, runReplyGateWithContract } from "@/lib/ai/reply-gate";
import type { ContextBlocksFired } from "./brain-context";
import type { critiqueOutput, ContentCriticScore } from "@/lib/ai/output-critic";

interface ChatLogger {
  info(event: string, ctx?: Record<string, unknown>): void;
  warn(event: string, ctx?: Record<string, unknown>): void;
}

export type PersistOutcome =
  | { kind: "duplicate-skip" }
  | { kind: "empty-skip" }
  | { kind: "done"; createdAssistantId: string | null; cleanedText: string };

export async function persistAssistantMessage(a: {
  hasContent: boolean;
  hasToolCalls: boolean;
  cleanedText: string;
  reasoningText: string;
  finishReason: string | undefined;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
  convId: string | undefined;
  traceId: string;
  provider: ProviderName;
  modelId: string;
  startedAt: number;
  firstTokenRef: { value: number | null };
  capturedToolCalls: CapturedToolCall[];
  truthFlags: Array<{ kind: string; rule: string; snippet: string; severity: number }>;
  critic: ReturnType<typeof critiqueOutput> | ContentCriticScore | null;
  citations: Array<{ raw: string; category: string; detail?: string | null; start: number; end: number }>;
  gate: ReturnType<typeof runReplyGate> | ReturnType<typeof runReplyGateWithContract> | null;
  factClaims: Array<{ raw: string; kind: string; value: string; start: number; end: number; verified: boolean }>;
  unverifiedCount: number;
  turnSignal: TurnSignal;
  contextBlocksFired: ContextBlocksFired;
  deeperContextCount: number;
  deeperContextTypes: string[];
  personality: string;
  userContent: string;
  posture: string | undefined;
  log: ChatLogger;
}): Promise<PersistOutcome> {
  const {
    hasContent, hasToolCalls, reasoningText, finishReason, usage, convId,
    traceId, provider, modelId, startedAt, firstTokenRef, capturedToolCalls,
    truthFlags, critic, citations, gate, factClaims, unverifiedCount,
    turnSignal, contextBlocksFired, deeperContextCount, deeperContextTypes,
    personality, userContent, posture, log,
  } = a;
  let cleanedText = a.cleanedText;
  void userContent;
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
        return { kind: "duplicate-skip" };
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
        // 2026-07-29 · say WHICH failure mode. An offender can now be a
        // failed call OR one we could not classify at all (fail-closed
        // unknown tool) — calling the latter "failed" would be its own
        // small fabrication inside the anti-fabrication banner.
        const anyFailed = verdict.offenders.some((o) => o.status === "failed");
        const anyUnverifiable = verdict.offenders.some((o) => o.verifiable === false);
        const cause = anyFailed
          ? "tool call(s) failed"
          : anyUnverifiable
            ? "the tool(s) could not be verified"
            : "tool call(s) did not confirm success";
        const banner = buildVerifierBanner(
          `The response below claimed action(s) (${verbs.join(", ")}) but ${cause}.`,
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
              // WP-11 (2026-07-29): the action-receipt verdict joins the same
              // JSON blob the quality/evidence surfaces read — before this it
              // lived ONLY in the BrainMemory chat_claim_warn row + content
              // banner, so the panel could not show WHY a reply was rewritten.
              receipt: receipts.length > 0 || !verdict.ok
                ? {
                    ok: verdict.ok,
                    toolsFired: receipts.map((r) => ({
                      toolName: r.toolName,
                      status: r.status,
                    })),
                    ...(verdict.ok
                      ? {}
                      : {
                          offenders: verdict.offenders.map((o) => ({
                            toolName: o.toolName,
                            status: o.status,
                            label: o.label,
                          })),
                        }),
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
          const isAutoPosture = !posture || posture === "auto";
          const sparTurn =
            buildResponseContract(userContent).answerMode === "brainstorm" ||
            EARLY_SPAR.test(userContent) ||
            posture === "spar";
          const executeFinalized =
            posture === "execute" ||
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
  if (!hasContent && !hasToolCalls) return { kind: "empty-skip" };
  return { kind: "done", createdAssistantId, cleanedText };
}
