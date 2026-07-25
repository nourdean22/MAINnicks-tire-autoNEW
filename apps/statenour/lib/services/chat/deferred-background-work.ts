/**
 * lib/services/chat/deferred-background-work.ts — persist-turn
 * decomposition slice (2026-07-25). runDeferredBackgroundWork + its
 * frozen-snapshot ctx moved VERBATIM from persist-assistant-turn.ts
 * (they were in-file helpers; same phases, same order, same error
 * handling — only the import boundary changed).
 */

import { prisma } from "@/lib/prisma";
import { recordInteraction } from "@/lib/ai/memory";
import { messageContentToText } from "@/lib/ai/chat/message-text";
import { buildVerifierBanner, isVerifierRewritten } from "@/lib/ai/chat/fabrication-rewriter";
import { parseActions, executeActions } from "@/lib/ai/nick-agent";
import { detectFailedActionClaims } from "@/lib/ai/chat/action-result-verifier";
import { canClaimDone, toReceipt } from "@/lib/ai/receipts/action-receipt";
import { processConversation } from "@/lib/brain/pipeline-controller";
import { summarizeAndStoreConversation } from "@/lib/brain/conversation-memory";
import { maybeAutoRename } from "@/lib/chat/auto-rename";
import { withErrorCapture } from "@/lib/errors/record-error";
import type { ProviderName } from "@/lib/ai/provider";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { looksLikeBrainDump } from "@/lib/ai/chat/brain-dump-detector";
import { buildMessageParts } from "./message-parts";

interface ChatLogger {
  info(event: string, ctx?: Record<string, unknown>): void;
  warn(event: string, ctx?: Record<string, unknown>): void;
}

/**
 * Explicit, frozen-state snapshot handed to {@link runDeferredBackgroundWork}.
 *
 * Every field is READ-ONLY by the time the deferred block runs: the core
 * persist path (text salvage → sanitize → image-ghost strip → critic →
 * persist ChatMessage → conversation bump → judge/adversarial dispatch →
 * envelope build → fabrication-rewrite + row-patch → recordTrace) has
 * already completed, and `cleanedText`/`text` will not be reassigned again.
 *
 * The helper must NOT reach back into the onFinish closure — it receives
 * everything it needs here. `isLightweight`/`isHeavy` are derived inside
 * the helper from `userContent`/`mode` (same threshold expressions as the
 * original call site), so they don't need to be threaded through the ctx.
 */
export interface DeferredBackgroundCtx {
  log: ChatLogger;
  convId: string | undefined;
  traceId: string;
  provider: ProviderName;
  modelId: string;
  mode: string;
  personality: string;
  topicTier: string;
  startedAt: number;
  userContent: string;
  /** Sanitized + (possibly) fabrication-rewritten assistant text — frozen. */
  cleanedText: string;
  /** Raw stripped model text (pre-sanitize) — used for action parsing + cache warm. */
  text: string;
  messages: ReadonlyArray<unknown>;
  createdAssistantId: string | null;
}

/**
 * Fire-and-forget background analysis that runs AFTER the assistant
 * ChatMessage is persisted and does NOT feed back into the response or
 * the persisted row. Lifted VERBATIM from the tail of the onFinish
 * callback (the post-recordTrace block) — same phases, same order, same
 * error handling. Reads only the frozen `ctx` snapshot.
 *
 * Phases (in order): memory recordInteraction · content-feedback capture ·
 * hallucination guard · friction tracker · outcome-prediction · flow
 * processing · conversation-pattern learning · journal ingest ·
 * conversation-memory summary · auto-rename · people-intelligence scan ·
 * agent-action execution · suggestion-cache warm.
 */
export async function runDeferredBackgroundWork(ctx: DeferredBackgroundCtx) {
  const {
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
    cleanedText: originalCleanedText,
    text,
    messages,
    createdAssistantId,
  } = ctx;
  let cleanedText = originalCleanedText;

  // Substance gates — derived here (was passed via ctx). Same threshold
  // expressions as the original onFinish call site.
  const isLightweight = userContent.length < 40;
  const isHeavy = mode === "deep" || userContent.length > 120;

      // Record to memory system — skip on quick.
      if (!isLightweight) {
        withErrorCapture(
          "chat:post-process",
          () =>
            recordInteraction({
              feature: "chat",
              prompt: userContent,
              response: cleanedText,
              provider,
              model: modelId,
              durationMs: Date.now() - startedAt,
              taskType: "reason",
            }),
          { timeoutMs: 5_000, silentTimeout: true }
        );
      }

      // v6 · Apr 28 · #6 — CONTENT FEEDBACK CAPTURE.
      withErrorCapture(
        "chat:post-process",
        async () => {
          const { detectContentFeedback, persistContentFeedback } = await import("@/lib/ai/content-feedback");
          const feedback = detectContentFeedback(userContent);
          if (!feedback) return;
          const priorAssistant = [...messages]
            .reverse()
            .find((m) => (m as { role?: string }).role === "assistant" && (m as { id?: unknown }).id !== undefined) as { content?: unknown } | undefined;
          // priorAssistant.content can be undefined (parts-only turns) — the
          // old `as unknown as string` cast produced undefined and the
          // .match() below threw (the recurring chat:post-process crash).
          // messageContentToText always returns a string.
          const priorText = priorAssistant ? messageContentToText(priorAssistant.content) : "";
          const priorHasHashtags = (priorText.match(/#\w+/g) || []).length >= 2;
          const priorHasMarker = /\b(caption|reel|carousel|headline|tagline)\b/i.test(priorText);
          if (!priorHasHashtags && !priorHasMarker) return;
          await persistContentFeedback({
            feedback,
            previousAssistantText: priorText,
            conversationId: convId,
          });
        },
        { timeoutMs: 3_000, silentTimeout: true }
      );

      // ═══ DEFERRED POST-PROCESSING — each task is timeout-bounded ═══
      // v7 · BATCH 1C — Hallucination guard.
      if (cleanedText && cleanedText.length > 50) {
        withErrorCapture(
          "chat:post-process",
          async () => {
            const { checkClaims } = await import("@/lib/ai/hallucination-guard");
            const flagged = await checkClaims(cleanedText);
            const offCount = flagged.filter((f) => f.verdict === "off" || f.verdict === "way_off").length;
            if (offCount > 0) {
              log.info("hallucination_guard_flagged", { offCount, total: flagged.length });
              await prisma.brainMemory.create({
                data: {
                  category: "hallucination_flag",
                  key: `halluc:${convId}-${Date.now()}`,
                  source: "post_stream",
                  content: `${offCount} factual claims off — ${flagged.map((f) => f.claim.label).join(", ")}`,
                  confidence: 0.9,
                  metadata: { conversationId: convId, flagged: flagged as unknown as Record<string, unknown>[] } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
                },
              }).catch(() => {});
            }
          },
          { timeoutMs: 5_000, silentTimeout: true }
        );
      }

      // v7 · BATCH 5 · Apr 28 — Friction tracker.
      withErrorCapture(
        "chat:post-process",
        async () => {
          const { detectFriction, persistFriction } = await import("@/lib/personal/friction-tracker");
          const f = detectFriction(userContent);
          if (f) {
            await persistFriction({ entry: f, conversationId: convId, pagePath: "/chat" });
          }
        },
        { timeoutMs: 2_000, silentTimeout: true }
      );

      // v7 · BATCH 1B — Outcome-prediction capture.
      if (cleanedText && cleanedText.length > 100) {
        withErrorCapture(
          "chat:post-process",
          async () => {
            const { extractPredictions, persistPrediction } = await import("@/lib/ai/outcome-calibration");
            const predictions = extractPredictions(cleanedText);
            if (predictions.length > 0) {
              log.info("outcome_calibration_captured", { predictionCount: predictions.length });
              await persistPrediction({
                predictions,
                captionText: cleanedText,
                conversationId: convId,
              });
            }
          },
          { timeoutMs: 3_000, silentTimeout: true }
        );
      }

      // Flow Processing — skip on quick.
      if (!isLightweight) {
        withErrorCapture(
          "chat:post-process",
          () => processConversation(userContent, cleanedText),
          { timeoutMs: 15_000, silentTimeout: true, context: { userContentLength: userContent.length } }
        );
      }

      // ── Conversation personality learning ──
      const msgCount = messages.length;
      if (!isLightweight && msgCount > 0 && msgCount % 10 === 0) {
        withErrorCapture(
          "chat:post-process",
          async () => {
            type UserMsgShape = { role?: unknown; content?: unknown };
            const userMsgs = (messages as UserMsgShape[]).filter(
              (m) => (m as { role?: string }).role === "user",
            ) as Array<{ content?: string }>;
            const avgLen = userMsgs.length > 0
              ? Math.round(userMsgs.reduce((s: number, m) => s + (m.content?.length || 0), 0) / userMsgs.length)
              : 0;
            const shortMsgs = userMsgs.filter((m) => (m.content?.length || 0) < 30).length;
            const longMsgs = userMsgs.filter((m) => (m.content?.length || 0) > 200).length;
            const content = `[Chat Pattern ${new Date().toISOString().slice(0, 10)}] Avg msg: ${avgLen} chars. ${shortMsgs}/${userMsgs.length} short (<30ch), ${longMsgs}/${userMsgs.length} long (>200ch). Topic tier: ${topicTier}. Personality: ${personality}. Mode: ${mode}.`;
            await prisma.brainMemory.upsert({
              where: { category_key: { category: BRAIN_CATEGORIES.CHAT_PATTERN, key: "latest_session" } },
              update: { content, confidence: 0.7, updatedAt: new Date() },
              create: { category: BRAIN_CATEGORIES.CHAT_PATTERN, key: "latest_session", content, confidence: 0.7, source: "chat" },
            });
          },
          { timeoutMs: 5_000, silentTimeout: true }
        );
      }

      // v10.0.231 · Deep flow processing — only when substantive AND
      // the message looks like a brain dump, NOT a question.
      //
      // Pre-fix · the gate was just `isHeavy && length > 200`. Any
      // heavy chat message (mode==deep OR length>120) over 200 chars
      // got fed through the full journal-ingest pipeline · which
      // extracted "action items" via AI and created INBOX tasks.
      // Result: every long question Nour asked Nick ended up as
      // 3-5 phantom tasks on the todo list.
      //
      // Post-fix · skip ingest when:
      //   1. The message is a question (starts with interrogative
      //      word OR ends with `?` after stripping the last 30 chars
      //      to ignore trailing emoji/url)
      //   2. The message starts with "can / could / would / how do
      //      / how to / what / who / when / where / why" — these are
      //      asks, not brain dumps
      //   3. The message is a command to Nick ("show me X", "find Y",
      //      "list Z", "look up", "check") — these are tool requests
      //
      // The journal-ingest pipeline ALSO has a defense-in-depth check
      // (v10.0.231 · only creates tasks when entryType is decision /
      // planning / commitment) so even if the gate misses, no phantom
      // tasks get written.
      if (isHeavy && userContent.length > 200 && looksLikeBrainDump(userContent)) {
        withErrorCapture(
          "chat:journal-ingest",
          async () => {
            const { ingestJournal } = await import("@/lib/brain/journal-ingest");
            // Audit 2026-07-15 · source was omitted and defaulted to
            // "telegram", so chat-origin dumps could fire Telegram
            // goal-link confirm pings (journal-brain notifyTelegram
            // gate keys on source === "telegram").
            return ingestJournal(userContent, "chat");
          },
          { timeoutMs: 20_000, silentTimeout: true }
        );
      }

      // Conversation memory — AI-digest after 4+ messages.
      if (!isLightweight && convId && convId !== "temp") {
        withErrorCapture(
          "chat:conversation-memory",
          () => summarizeAndStoreConversation(convId!),
          { timeoutMs: 30_000, silentTimeout: true, context: { conversationId: convId } }
        );

        // Auto-rename — fire once the convo has 4+ messages.
        withErrorCapture(
          "chat:post-process",
          () => maybeAutoRename(convId!),
          { timeoutMs: 15_000, silentTimeout: true, context: { conversationId: convId } }
        );
      }

      // People extraction — skip entirely on quick mode.
      if (!isLightweight) withErrorCapture(
        "chat:people-intel",
        async () => {
          const { runPeopleIntelligence } = await import("@/lib/brain/people-intelligence");
          const lastRun = await prisma.auditEvent.findFirst({
            where: {
              eventType: "people_intelligence_run",
              createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
            },
          });
          if (lastRun) return null;
          const result = await runPeopleIntelligence();
          if (result) {
            await prisma.auditEvent
              .create({
                data: {
                  actor: "people_intelligence",
                  eventType: "people_intelligence_run",
                  detail: `Updated ${result.profilesUpdated} profiles, ${result.alerts.length} alerts`,
                },
              })
              .catch(() => {});
          }
          return result;
        },
        { timeoutMs: 20_000, silentTimeout: true }
      );

      // Agent Layer — parse and execute any actions Nick embedded.
      const actions = parseActions(text);
      if (actions.length > 0) {
        withErrorCapture(
          "chat:actions",
          async () => {
            const results = await executeActions(actions);
            log.info("nick_agent_executed", {
              count: results.length,
              outcomes: results.map((r) => ({ action: r.action, ok: r.success, err: r.error })),
            });
            await prisma.auditEvent
              .create({
                data: {
                  actor: "nick_agent",
                  eventType: "agent_actions_executed",
                  detail: `${results.filter((r) => r.success).length}/${results.length} actions succeeded`,
                  payload: {
                    actions: JSON.parse(JSON.stringify(results)),
                    conversationId: convId,
                    messageLength: text.length,
                  },
                },
              })
              .catch(() => {});

            // Receipts (Wire 1) · normalize each SIDE-EFFECTING action-block
            // result into the ActionReceipt contract and persist it as an
            // `action_receipt` AuditEvent so the F4 receipt feed shows what Nick
            // actually DID in chat (failures included). Advisory + fire-and-
            // forget — never blocks the turn, never fabricates (status mirrors
            // the real result). Reads are skipped (not a "did").
            await Promise.allSettled(
              results
                .map((r) => toReceipt({ toolName: r.action, ok: r.success, error: r.error }))
                .filter((rcpt) => rcpt.sideEffecting)
                .map((rcpt) =>
                  prisma.auditEvent
                    .create({
                      data: {
                        actor: "nick_agent",
                        eventType: "action_receipt",
                        detail: rcpt.userVisibleSummary.slice(0, 200),
                        payload: JSON.parse(JSON.stringify(rcpt)),
                      },
                    })
                    .catch(() => {}),
                ),
            );

            // Action-write verifier receipts check
            const actionReceipts = results.map((r) => toReceipt({ toolName: r.action, ok: r.success, error: r.error }));
            const actionVerdict = canClaimDone(actionReceipts);
            if (!actionVerdict.ok) {
              // 2026-07-11 review · banner via the single shared builder
              // (fabrication-rewriter) — no more hand-duplicated wording.
              if (!isVerifierRewritten(cleanedText)) {
                const verbs = [...new Set(actionVerdict.offenders.map((o) => o.label || o.toolName))].slice(0, 3);
                const banner = buildVerifierBanner(
                  `The response below claimed action(s) (${verbs.join(", ")}) but tool call(s) failed.`,
                );
                cleanedText = `${banner}${cleanedText}`;
              }

              // Log to brainMemory with key action-done-fail-${traceId}
              await prisma.brainMemory.create({
                data: {
                  category: "chat_claim_warn",
                  key: `action-done-fail-${traceId}`,
                  content: `Action did not complete · expected tools: ${actionVerdict.offenders.map((o) => o.toolName).join(", ")}`,
                  confidence: 0.95,
                  source: "action-result-verifier",
                  metadata: {
                    conversationId: convId,
                    traceId,
                    claims: actionVerdict.offenders.map((o) => ({
                      verb: o.label || o.toolName,
                      snippet: o.errorSafeMessage || "",
                      expectedTool: o.toolName,
                    })),
                    offenders: actionVerdict.offenders.map((o) => ({
                      toolName: o.toolName,
                      status: o.status,
                      label: o.label,
                      errorSafeMessage: o.errorSafeMessage,
                    })),
                    toolsActuallyFired: results.map((r) => r.action),
                    textPreview: cleanedText.slice(0, 200),
                  },
                } as Parameters<typeof prisma.brainMemory.create>[0]["data"],
              }).catch(() => undefined);

              // If createdAssistantId is present, patch the database row
              if (createdAssistantId) {
                const existingMsg = await prisma.chatMessage.findUnique({
                  where: { id: createdAssistantId },
                  select: { parts: true }
                }).catch(() => null);
                let existingReasoningText: string | undefined;
                if (existingMsg?.parts && Array.isArray(existingMsg.parts)) {
                  const reasoningPart = (existingMsg.parts as any[]).find((p) => p.type === "reasoning");
                  if (reasoningPart && typeof reasoningPart.text === "string") {
                    existingReasoningText = reasoningPart.text;
                  }
                }
                const { partsArray: patchedParts, searchableContent: patchedSearchable } =
                  await buildMessageParts(cleanedText, existingReasoningText, true);
                await prisma.chatMessage.update({
                  where: { id: createdAssistantId },
                  data: {
                    content: cleanedText,
                    parts: patchedParts
                      ? (patchedParts as unknown as Parameters<typeof prisma.chatMessage.update>[0]["data"]["parts"])
                      : undefined,
                    searchableContent: patchedSearchable ?? undefined,
                  },
                }).catch((err) => {
                  log.warn("action_receipts_rewrite_persist_failed", {
                    conversationId: convId,
                    messageId: createdAssistantId,
                    error: err instanceof Error ? err.message : String(err),
                  });
                });
              }
            }

            // Action-write verifier · the action-block analog of the
            // SDK-tool fabrication guard. executeActions runs here in
            // deferred background, so its failures never reach
            // detectActionClaimsWithoutTools (which only inspects SDK
            // capturedToolCalls). When a MUTATION action FAILED while
            // Nick's prose claimed completion, emit a chat_claim_warn row
            // so the existing correction chip (claim-warnings.ts →
            // /api/ai/chat/claim-warnings → action-claim-warning.tsx)
            // surfaces the truth. Best-effort — never tanks the turn.
            const failedClaims = detectFailedActionClaims(results, cleanedText);
            if (failedClaims.length > 0 && convId) {
              log.warn("action_block_failed_claim", {
                conversationId: convId,
                traceId,
                failed: failedClaims.map((c) => c.verb),
              });
              await prisma.brainMemory
                .create({
                  data: {
                    category: "chat_claim_warn",
                    key: `action-fail-${traceId}`,
                    content: `Action did not complete · ${failedClaims
                      .map((c) => c.verb)
                      .join(", ")}`,
                    confidence: 0.95,
                    source: "action-result-verifier",
                    metadata: {
                      conversationId: convId,
                      traceId,
                      claims: failedClaims.map((c) => ({
                        verb: c.verb,
                        snippet: c.snippet,
                        expectedTool: c.expectedTool,
                      })),
                      toolsActuallyFired: results
                        .filter((r) => r.success)
                        .map((r) => r.action),
                      textPreview: cleanedText.slice(0, 200),
                    },
                  } as Parameters<typeof prisma.brainMemory.create>[0]["data"],
                })
                .catch(() => undefined);
            }
            return results;
          },
          { timeoutMs: 15_000 }
        );
      }

      // ── Smart reply suggestion cache warming ──
      try {
        if (text && text.length >= 40) {
          const { warmSuggestionCache, heuristicSuggestions } = await import(
            "@/lib/ai/suggestion-cache"
          );
          warmSuggestionCache(userContent, text, heuristicSuggestions(text));
        }
      } catch {
        // cache warm is best-effort
      }
}
