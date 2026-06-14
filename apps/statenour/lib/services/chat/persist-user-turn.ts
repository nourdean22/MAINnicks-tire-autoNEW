/**
 * persistUserTurn · May 02 · chat-route extract chunk 1
 *
 * Lifted verbatim from app/api/ai/chat/route.ts (the dbWritePromise
 * IIFE at lines 158-368). Owns the user-side write path of a chat
 * turn:
 *
 *   1. Resolve conversation id (create one if null)
 *   2. Idempotency check (clientMessageId primary, 5-min content match
 *      fallback for legacy paths) — bail early if duplicate
 *   3. Persist the user message with full v7.6 field set (parts,
 *      attachments, attachmentsHash, searchableContent, clientMessageId,
 *      streamingState)
 *   4. Bump conversation messageCount + lastActiveAt (fire-and-forget)
 *   5. Fire-and-forget importance scorer (BrainMemory write if signal ≥6)
 *   6. Fire-and-forget task-completion detector (auto-completes high-
 *      confidence matches, surfaces low-confidence as brain_insight)
 *
 * Returns the conversation id (the existing one, the newly-minted one,
 * or "temp" if the convo create failed). The caller awaits this id
 * before persisting the assistant turn so both rows land on the same
 * conversation.
 *
 * Behavior preserved exactly — this is a mechanical lift, no logic
 * changes. All fire-and-forget side effects retain their .catch(()=>{})
 * swallows so a side-effect failure can never tank the chat stream.
 */

import { prisma } from "@/lib/prisma";
import type { ErrorDomain } from "@/lib/errors/record-error";

interface ChatLogger {
  info(event: string, ctx?: Record<string, unknown>): void;
  warn(event: string, ctx?: Record<string, unknown>): void;
  error?(event: string, ctx?: Record<string, unknown>): void;
}

export interface PersistUserTurnInput {
  /** Conversation id from the request body. May be null on first turn. */
  convId: string | null | undefined;
  /** Last message in the AI-SDK messages array. Only persisted if role === "user". */
  lastUserMsg: (Record<string, unknown> & { role?: string; parts?: unknown }) | null | undefined;
  /** Plain-text user content extracted by the gate. */
  userContent: string;
  log: ChatLogger;
  /**
   * Optional pass-through to the route's recordError helper. Typed as
   * the canonical ErrorDomain signature so callers can pass the import
   * directly without an adapter shim.
   */
  recordError?: (domain: ErrorDomain, err: unknown, ctx?: Record<string, unknown>) => void;
}

export async function persistUserTurn(input: PersistUserTurnInput): Promise<string> {
  const { convId: incomingConvId, lastUserMsg, userContent, log, recordError } = input;

  try {
    let id: string | null | undefined = incomingConvId;
    const isUserTurn = lastUserMsg?.role === "user";

    // Edge case preserved from the original lift: a first-turn request
    // with no user message still mints a bare conversation. When there
    // IS a user message, the conversation + first message are created
    // together in the atomic transaction below.
    if (!id && !isUserTurn) {
      const firstText = userContent || "New chat";
      const conv = await prisma.chatConversation.create({
        data: { title: firstText.slice(0, 80) },
        select: { id: true },
      });
      id = conv.id;
    }

    if (isUserTurn) {
      // v7.6 · Apr 29 · ChatMessage Batch A · C2 — full field-set persist.
      // Helpers in lib/ai/chat/message-fields.ts own the parts tree
      // extraction, attachments hash, FTS plaintext, and client-msg-id
      // pull so user + assistant write paths stay consistent.
      const {
        extractParts,
        extractAttachments,
        computeAttachmentsHash,
        buildSearchableContent,
        extractClientMessageId,
        synthesizeFallbackClientMessageId,
      } = await import("@/lib/ai/chat/message-fields");

      const userParts = (lastUserMsg as { parts?: unknown }).parts;
      const parts = extractParts(userParts, userContent);
      const attachments = extractAttachments(parts);
      const hasAttachments = attachments.length > 0;
      const attachmentsHash = computeAttachmentsHash(attachments);
      const searchableContent = buildSearchableContent(parts, userContent);

      // The message row minus its conversationId + clientMessageId —
      // both branches below spread this and add those two fields.
      const baseMessageData = {
        role: "user" as const,
        content: userContent,
        // v7.3 attachments column kept for back-compat (read path).
        attachments: hasAttachments
          ? (attachments as unknown as Parameters<typeof prisma.chatMessage.create>[0]["data"]["attachments"])
          : undefined,
        // v7.6 Batch A — rich content tree, searchable plaintext,
        // attachment hash, and stream state.
        parts: parts
          ? (parts as unknown as Parameters<typeof prisma.chatMessage.create>[0]["data"]["parts"])
          : undefined,
        searchableContent: searchableContent ?? undefined,
        attachmentsHash: attachmentsHash ?? undefined,
        streamingState: "complete" as const, // user msgs always "complete" on write
      };

      let savedMessage: { id: string };

      if (id) {
        // EXISTING conversation · idempotency-checked single insert.
        const convId = id;
        // v7.6 · C5 · Apr 29 — Idempotency primary: client-minted id.
        // Fallback: deterministic hash of (conv+role+content+10s-bucket)
        // so silent retries within ~10s still resolve to the same id.
        const clientMessageId =
          extractClientMessageId(lastUserMsg) ??
          synthesizeFallbackClientMessageId({
            conversationId: convId,
            role: "user",
            content: userContent,
          });

        // v7.6 · Apr 29 · Idempotency guard.
        // Primary: client-minted id — server-side dedup on
        // (conversationId, clientMessageId). Fallback: legacy 5min
        // content match (covers messages predating the client-id
        // wiring). Don't dedup if attachments differ — re-uploads with
        // the photo are intentional.
        if (clientMessageId) {
          const existingByClientId = await prisma.chatMessage
            .findFirst({
              where: { conversationId: convId, clientMessageId },
              select: { id: true },
            })
            .catch(() => null);
          if (existingByClientId) {
            log.warn("duplicate_client_msg_id_suppressed", {
              conversationId: convId.slice(0, 8),
              clientMessageId: clientMessageId.slice(0, 8),
            });
            return convId;
          }
        } else if (!hasAttachments) {
          const dupSince = new Date(Date.now() - 5 * 60_000);
          const existingDupe = await prisma.chatMessage
            .findFirst({
              where: {
                conversationId: convId,
                role: "user",
                content: userContent,
                createdAt: { gte: dupSince },
              },
              select: { id: true },
            })
            .catch(() => null);
          if (existingDupe) {
            log.warn("duplicate_user_msg_suppressed_content_match", {
              conversationId: convId.slice(0, 8),
              window: "5min",
            });
            return convId;
          }
        }

        savedMessage = await prisma.chatMessage.create({
          data: {
            conversationId: convId,
            ...baseMessageData,
            clientMessageId: clientMessageId ?? undefined,
          },
          select: { id: true },
        });

        // v7.6 · Apr 29 · Conversation activity update. Bump
        // messageCount + lastActiveAt so the sidebar can sort cheaply
        // without MAX(message.createdAt) per row.
        prisma.chatConversation
          .update({
            where: { id: convId },
            data: { messageCount: { increment: 1 }, lastActiveAt: new Date() },
          })
          .catch(() => null);
      } else {
        // NEW conversation · the conversation row AND its first message
        // are created in ONE transaction. Pre-fix these were two
        // separate awaits — a crash (or a chatMessage.create failure)
        // between them orphaned an empty conversation that showed in the
        // sidebar but opened to nothing. messageCount is seeded to 1
        // since the first message lands in the same transaction.
        const firstText = userContent || "New chat";
        const created = await prisma.$transaction(async (tx) => {
          const conv = await tx.chatConversation.create({
            data: {
              title: firstText.slice(0, 80),
              messageCount: 1,
              lastActiveAt: new Date(),
            },
            select: { id: true },
          });
          const clientMessageId =
            extractClientMessageId(lastUserMsg) ??
            synthesizeFallbackClientMessageId({
              conversationId: conv.id,
              role: "user",
              content: userContent,
            });
          const msg = await tx.chatMessage.create({
            data: {
              conversationId: conv.id,
              ...baseMessageData,
              clientMessageId: clientMessageId ?? undefined,
            },
            select: { id: true },
          });
          return { convId: conv.id, msgId: msg.id };
        });
        id = created.convId;
        savedMessage = { id: created.msgId };
      }
      // Apr 18 · Fire-and-forget importance scorer. Classifies every
      // user turn and auto-writes a BrainMemory row when signal ≥6.
      // Does not block streaming. No UI feedback — Nick's system
      // prompt on the NEXT turn inherits whatever was persisted.
      void (async () => {
        try {
          const { persistIfImportant } = await import("@/lib/brain/importance-scorer");
          const result = await persistIfImportant(
            savedMessage.id,
            userContent,
            id,
          );
          if (result.persisted) {
            log.info("importance_persisted", {
              category: result.category,
              score: result.score,
              msgId: savedMessage.id.slice(0, 8),
            });
          }
        } catch (err) {
          log.warn("importance_scorer_failed", { err: err instanceof Error ? err.message : String(err) });
        }

        // Apr 19 · Task completion detection. Parses "just finished
        // X" language, fuzzy-matches against open tasks. High-
        // confidence matches auto-complete. Lower-confidence
        // surfaces via brain_insight so the UI can show a "mark
        // this done?" chip next turn.
        try {
          const { detectTaskCompletion } = await import("@/lib/brain/task-completion-detector");
          const match = await detectTaskCompletion(userContent);
          if (match) {
            if (match.confidence >= 0.8) {
              // Auto-complete via direct prisma update — don't
              // fire the internal /api/tasks/check (which would
              // re-trigger skills/ghost/etc). Those will pick up
              // on the next DONE event.
              // v9.1.19 · attach actor (resolves to "nick" inside
              // chat ALS scope) + entity-audit log so AI-driven
              // completions appear in the Task's audit trail.
              const { checkTask } = await import("@/lib/services/task-actions");
              await checkTask({
                id: match.taskId,
                action: "complete",
                completionNote: `Auto-completed from chat turn: "${match.userPhrase}"`,
              });
              await prisma.auditEvent.create({
                data: {
                  actor: "task_completion_detector",
                  eventType: "brain_insight",
                  detail: `Auto-completed "${match.title.slice(0, 80)}" from chat turn (${Math.round(match.confidence * 100)}% match)`,
                  payload: { taskId: match.taskId, confidence: match.confidence, userPhrase: match.userPhrase } as never,
                },
              }).catch(() => {});
              log.info("task_auto_completed", { taskId: match.taskId, confidencePct: Math.round(match.confidence * 100) });
            } else {
              // Surface a brain_insight so Nour can confirm via UI
              await prisma.auditEvent.create({
                data: {
                  actor: "task_completion_detector",
                  eventType: "brain_insight",
                  detail: `Did you just finish "${match.title.slice(0, 80)}"? (${Math.round(match.confidence * 100)}% match)`,
                  payload: { taskId: match.taskId, confidence: match.confidence, userPhrase: match.userPhrase, suggestion: true } as never,
                },
              }).catch(() => {});
            }
          }
        } catch (err) {
          log.warn("task_completion_detector_failed", { err: err instanceof Error ? err.message : String(err) });
        }
      })();
    }
    return id || "temp";
  } catch (dbErr) {
    if (recordError) {
      recordError("chat:db-write", dbErr, { conversationId: incomingConvId });
    }
    return incomingConvId || "temp";
  }
}
