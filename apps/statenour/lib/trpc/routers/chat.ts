/**
 * lib/trpc/routers/chat.ts · Phase Z (2026-05-18 PM)
 *
 * Chat domain procedures · 4th domain router after `nick` (reasoning),
 * `operator` (forward-looking state), and `system` (telemetry).
 *
 * Replaces (coexistence · legacy REST stays mounted):
 *   · GET /api/chat/search → search
 *
 * Both call the same `searchChat()` service · drift impossible.
 *
 * NOTE · the chat streaming endpoint (POST /api/ai/chat) is
 * INTENTIONALLY EXCLUDED from tRPC migration per
 * `docs/migrations/J-trpc-migration.md` · SSE subscriptions need
 * WebSocket infra (separate phase scope). The chat fork/edit
 * mutations stay on REST per coexistence pattern · separate scope.
 *
 * Phase B.5 (2026-05-22 · legacy-modernizer REST→tRPC chat slice)
 * adds 7 procedures covering the chat-domain component call-sites:
 *   · updateConversation / deleteConversation (mutations)
 *   · laneCheckFeedback / messageFeedback     (mutations)
 *   · suggestions / autocomplete / inspectPrompt (queries · read-shaped)
 * Each delegates to a shared `lib/services/chat-*` function the
 * legacy REST route also calls · drift impossible.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, operatorProcedure } from "../trpc";
import { ServiceError } from "@/lib/utils/service-error";
import { searchChat } from "@/lib/services/chat-search";
import { readChatBranches } from "@/lib/services/chat-branches";
import { readMessageProvenance } from "@/lib/services/brain-provenance";
import {
  checkLane,
  recordLaneCheckFeedback,
} from "@/lib/services/chat-lane-check";
import { sendEmailWithAudit } from "@/lib/services/email-send";
import {
  upscaleImage,
  varyImage,
  SourceImageNotFoundError,
} from "@/lib/services/image-actions";
import {
  readMessageEditView,
  editChatMessage,
  MessageNotFoundError,
  ConcurrentEditError,
  EmptyContentError,
  ContentTooLongError,
  MAX_CONTENT_CHARS,
} from "@/lib/services/chat-edit";
import { readClaimWarnings } from "@/lib/services/claim-warnings";
import {
  updateConversation,
  deleteConversation,
  ConversationNotFoundError,
} from "@/lib/services/chat-conversation";
import {
  recordMessageFeedback,
  InvalidFeedbackScoreError,
  MessageFeedbackNotFoundError,
} from "@/lib/services/chat-feedback";
import { buildSuggestions } from "@/lib/services/chat-suggestions";
import { buildAutocomplete } from "@/lib/services/chat-autocomplete";
import { inspectPrompt } from "@/lib/services/chat-prompt-inspect";

export const chatRouter = router({
  /**
   * Phase Z (2026-05-18 PM) · owner-only · full-text + ILIKE-fallback
   * search across all ChatMessage rows. Debounced from the client
   * via React Query's staleTime + per-input refetch · replaces the
   * manual debounce + setState in the legacy chat-history-search
   * component (Cmd+F overlay).
   */
  search: operatorProcedure
    .input(
      z.object({
        q: z.string().max(500),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ input }) => searchChat({ q: input.q, limit: input.limit })),

  /**
   * Phase DD (2026-05-18 PM) · owner-only · per-message sibling
   * cycle reader. Powers the MessageBranchSwitcher "‹ alt 2 of 3 ›"
   * controls on regenerated assistant messages.
   *
   * Delegates to `lib/services/chat-branches.ts` shared service ·
   * legacy REST endpoint at /api/ai/chat/branches/[parentMessageId]
   * calls the same function · drift impossible.
   *
   * Edge cases · parentMessageId not found returns empty siblings
   * array (NOT a tRPC error · caller might race the regen write).
   */
  branches: operatorProcedure
    .input(z.object({ parentMessageId: z.string().min(1).max(64) }))
    .query(async ({ input }) =>
      readChatBranches({ parentMessageId: input.parentMessageId }),
    ),

  /**
   * Phase EE (2026-05-18 PM) · owner-only · reverse-search what
   * brain memories shaped a specific assistant message. Powers
   * the "brain context" section of MessageInfoCard ("3 memories
   * shaped this reply" disclosure).
   *
   * Delegates to `lib/services/brain-provenance.ts` shared service
   * · legacy REST endpoint at /api/brain/provenance/[messageId]
   * calls the same function · drift impossible.
   *
   * Edge cases · message not found surfaces as NOT_FOUND tRPC error
   * via ServiceError translation · caller decides how to render.
   */
  messageProvenance: operatorProcedure
    .input(z.object({ messageId: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      try {
        return await readMessageProvenance({ messageId: input.messageId });
      } catch (err) {
        if (err instanceof ServiceError && err.status === 404) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * Phase GG (2026-05-18 PM) · owner-only · proactive lane-correction
   * chip for an assistant reply. Reads cached blind-spot detector +
   * Dania silence signal · session-dedupes per domain · returns at
   * most one chip per call (or null when nothing's worth surfacing).
   *
   * Delegates to `lib/services/chat-lane-check.ts` shared service ·
   * legacy POST /api/ai/chat/lane-check calls the same function ·
   * drift impossible. Modeled as a `query` despite the legacy POST
   * because it's read-shaped from the client's perspective (no DB
   * writes · the only state mutation is an in-memory dedupe Map that
   * persists across both call paths).
   *
   * Input caps mirror the legacy route's slice() behavior · long
   * messages get truncated to the most-recent tail.
   */
  laneCheck: operatorProcedure
    .input(
      z.object({
        userMessage: z.string().max(8000),
        assistantMessage: z.string().max(16000),
      }),
    )
    .query(async ({ input }) =>
      checkLane({
        userMessage: input.userMessage,
        assistantMessage: input.assistantMessage,
      }),
    ),

  /**
   * Phase HH (2026-05-18 PM) · owner-only · email send for the
   * EmailDraftCard "Send" button. First true `.mutation()` procedure
   * in the chat router · establishes the 6th J playbook pattern.
   *
   * Delegates to `lib/services/email-send.ts` which wraps the Resend
   * `sendEmail()` service + writes an audit trail. Legacy POST
   * /api/email/send calls the same function · drift impossible.
   *
   * Modeled as `.mutation()` · genuine state change (Resend API call
   * + AuditEvent row insert). The pre-HH legacy POST returned
   * `{ok: true, id: string|null}` on success and `{ok: false, error}`
   * on failure · the tRPC mutation throws TRPCError on failure (the
   * client uses isError + error.message to surface state) which the
   * pre-HH consumer's try/catch+toast pattern handles cleanly.
   *
   * Auth · operatorProcedure · same gate as the legacy requireSession.
   * Zod bounds match the legacy SendSchema verbatim.
   */
  sendEmail: operatorProcedure
    .input(
      z.object({
        to: z.string().email().max(254),
        subject: z.string().min(1).max(998),
        body: z.string().min(1).max(50_000),
        html: z.string().max(120_000).optional(),
      }),
    )
    .mutation(async ({ input }) => sendEmailWithAudit(input)),

  /**
   * Phase II (2026-05-18 PM) · owner-only · upscale a generated image
   * via Venice. Powers the hover overlay's 2x/4x buttons on rendered
   * chat images. Delegates to `lib/services/image-actions.upscaleImage`.
   */
  upscaleImage: operatorProcedure
    .input(
      z.object({
        sourceImageId: z.string().min(1).max(64),
        scale: z.union([z.literal(2), z.literal(4)]),
        enhance: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) =>
      upscaleImage({
        sourceImageId: input.sourceImageId,
        scale: input.scale,
        enhance: input.enhance,
      }),
    ),

  /**
   * Phase II (2026-05-18 PM) · owner-only · re-generate an image with
   * the same prompt + different seeds for A/B variants. Powers the
   * "vary" button on rendered chat images. Delegates to
   * `lib/services/image-actions.varyImage`. SourceImageNotFoundError
   * surfaces as NOT_FOUND tRPC error · client renders inline.
   */
  varyImage: operatorProcedure
    .input(
      z.object({
        sourceImageId: z.string().min(1).max(64),
        count: z.number().int().min(1).max(4).optional(),
        speed: z.enum(["fast", "balanced", "quality"]).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await varyImage({
          sourceImageId: input.sourceImageId,
          count: input.count,
          speed: input.speed,
        });
      } catch (err) {
        if (err instanceof SourceImageNotFoundError) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * Phase JJ (2026-05-18 PM) · owner-only · read a chat message's
   * current content + full edit history (most-recent-first, capped to
   * last 10 versions). Powers the "edited" badge drawer in
   * MessageEditControls · lazy-fetched via `utils.chat.editHistory.fetch()`
   * on history-button click (no auto-refetch needed).
   *
   * Delegates to `lib/services/chat-edit.readMessageEditView` shared
   * service · legacy GET /api/ai/chat/edit/[messageId] calls the same
   * function · drift impossible.
   *
   * Edge cases · MessageNotFoundError surfaces as NOT_FOUND tRPC error.
   */
  editHistory: operatorProcedure
    .input(z.object({ messageId: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      try {
        return await readMessageEditView({ messageId: input.messageId });
      } catch (err) {
        if (err instanceof MessageNotFoundError) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * Phase JJ (2026-05-18 PM) · owner-only · in-place edit of an existing
   * chat message · prepends prior content to editHistory[], synthesizes
   * new parts tree (text + surviving file attachments), refreshes
   * searchableContent, sets new editedAt. Optimistic-concurrency via
   * updateMany count=0 surfaces as CONFLICT (two devices editing same
   * message · second writer must retry).
   *
   * Delegates to `lib/services/chat-edit.editChatMessage` shared service
   * · legacy PATCH /api/ai/chat/edit/[messageId] calls the same
   * function · drift impossible.
   *
   * Modeled as `.mutation()` · genuine state change. Caller's
   * onSuccess handler should call
   * `utils.chat.editHistory.invalidate({messageId})` to refresh any
   * open history drawer.
   *
   * Edge cases · empty/too-long content → BAD_REQUEST · not found →
   * NOT_FOUND · concurrent write → CONFLICT (retry · UI shows toast).
   */
  editMessage: operatorProcedure
    .input(
      z.object({
        messageId: z.string().min(1).max(64),
        content: z.string().min(1).max(MAX_CONTENT_CHARS),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await editChatMessage({
          messageId: input.messageId,
          content: input.content,
        });
      } catch (err) {
        if (err instanceof MessageNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: err.message });
        }
        if (err instanceof ConcurrentEditError) {
          throw new TRPCError({ code: "CONFLICT", message: err.message });
        }
        if (err instanceof EmptyContentError || err instanceof ContentTooLongError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  /**
   * Phase MM (2026-05-18 PM) · owner-only · read action-claim warnings
   * for a conversation · powers the ActionClaimWarning chip that shows
   * when Nick claimed an action ("added the tasks") but no tool fired.
   *
   * Delegates to `lib/services/claim-warnings.readClaimWarnings` shared
   * service · legacy GET /api/ai/chat/claim-warnings calls the same
   * function · drift impossible.
   *
   * Lazy + delayed · the component fires this 600ms after stream end
   * via setTimeout (gives the BrainMemory write time to land). With
   * tRPC the wait still happens client-side but the query benefits
   * from React Query's staleTime + dedup if multiple bubbles in the
   * same conversation race the call.
   */
  claimWarnings: operatorProcedure
    .input(
      z.object({
        conversationId: z.string().min(1).max(64),
        limit: z.number().int().min(1).max(10).default(1),
      }),
    )
    .query(async ({ input }) =>
      readClaimWarnings({
        conversationId: input.conversationId,
        limit: input.limit,
      }),
    ),

  /**
   * Phase B.5 (2026-05-22) · owner-only · toggle a conversation's
   * archive/star/mute flags + rename. Powers the per-result Star /
   * Archive controls in the ChatHistorySearch (Cmd+F) overlay.
   *
   * Delegates to `lib/services/chat-conversation.updateConversation`
   * shared service · legacy PATCH /api/ai/chat/conversation/[id]
   * calls the same function · drift impossible.
   *
   * Modeled as `.mutation()` · genuine state change (Date|null writes
   * on archivedAt/starredAt/mutedAt + a title update).
   *
   * Edge cases · missing conversation → NOT_FOUND · an empty patch
   * (no flag + no title) → BAD_REQUEST · both surface via the
   * ConversationNotFoundError / "no fields to update" translation
   * so the component's error toast is preserved.
   */
  updateConversation: operatorProcedure
    .input(
      z.object({
        id: z.string().min(1).max(64),
        archived: z.boolean().optional(),
        starred: z.boolean().optional(),
        muted: z.boolean().optional(),
        title: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await updateConversation(input);
      } catch (err) {
        if (err instanceof ConversationNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: err.message });
        }
        if (err instanceof Error && err.message === "no fields to update") {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  /**
   * Phase B.5 (2026-05-22) · owner-only · hard-delete a conversation.
   * Powers the Trash control in the ChatHistorySearch (Cmd+F) overlay.
   *
   * Delegates to `lib/services/chat-conversation.deleteConversation`
   * shared service · legacy DELETE /api/ai/chat/[id] calls the same
   * function · drift impossible.
   *
   * Modeled as `.mutation()` · genuine state change. Idempotent · a
   * missing row is swallowed by the service so the result is always
   * `{ ok: true }` (matches the legacy route's
   * `.delete().catch(() => null)`).
   */
  deleteConversation: operatorProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => deleteConversation({ id: input.id })),

  /**
   * Phase B.5 (2026-05-22) · owner-only · record a lane-correction
   * chip tap/dismiss. Powers the LaneCorrectionChip feedback signal
   * (fired on the action link tap + on the X dismiss).
   *
   * Delegates to `lib/services/chat-lane-check.recordLaneCheckFeedback`
   * shared service — folded into the same module that backs the
   * `laneCheck` query above (it's the write side of that feature) ·
   * legacy POST /api/ai/chat/lane-check/feedback calls the same
   * function · drift impossible.
   *
   * Modeled as `.mutation()` · writes a SystemMetric row. NON-FATAL
   * by contract · the service swallows every error to `{ ok: true }`
   * (telemetry must never break the chip UI) so this procedure never
   * throws · the legacy route mirrors this with an HTTP-200 catch.
   */
  laneCheckFeedback: operatorProcedure
    .input(
      z.object({
        action: z.enum(["tapped", "dismissed"]),
        domain: z.string().min(1).max(64),
        severity: z.string().max(40).optional(),
        userMessage: z.string().max(8000).optional(),
        assistantMessage: z.string().max(16000).optional(),
      }),
    )
    .mutation(async ({ input }) => recordLaneCheckFeedback(input)),

  /**
   * Phase B.5 (2026-05-22) · owner-only · record a thumbs up/down on
   * an assistant message. Powers the good/bad toggle in the
   * MessageInfoCard `i`-glyph dropdown · feeds the router learning
   * loop ground truth.
   *
   * Delegates to `lib/services/chat-feedback.recordMessageFeedback`
   * shared service · legacy POST /api/ai/chat/feedback calls the same
   * function · drift impossible. The service does the 3-tier
   * messageId resolution (by id → by conversationId → latest
   * assistant in 60s) + the fire-and-forget BrainMemory + AuditEvent
   * writes on a non-null score.
   *
   * Modeled as `.mutation()` · genuine state change (feedbackScore
   * write). The component's setFeedbackOptimistic uses a try/catch
   * that reverts on failure · a thrown TRPCError satisfies that.
   *
   * Edge cases · score outside {-1,0,1,null} → BAD_REQUEST · no
   * message resolvable via any tier → NOT_FOUND.
   */
  messageFeedback: operatorProcedure
    .input(
      z.object({
        messageId: z.string().min(1).max(64),
        score: z.union([
          z.literal(-1),
          z.literal(0),
          z.literal(1),
          z.null(),
        ]),
        reason: z.string().max(1000).optional(),
        snippet: z.string().max(2000).optional(),
        conversationId: z.string().min(1).max(64).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await recordMessageFeedback({
          messageId: input.messageId,
          score: input.score,
          reason: input.reason,
          snippet: input.snippet,
          conversationId: input.conversationId,
        });
      } catch (err) {
        if (err instanceof InvalidFeedbackScoreError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        if (err instanceof MessageFeedbackNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: err.message });
        }
        throw err;
      }
    }),

  /**
   * Phase B.5 (2026-05-22) · owner-only · 3 terse smart-reply chips
   * for the latest assistant message. Powers the SmartReplies row
   * below an assistant bubble.
   *
   * Delegates to `lib/services/chat-suggestions.buildSuggestions`
   * shared service · legacy POST /api/ai/chat/suggestions calls the
   * same function · drift impossible.
   *
   * Modeled as a `.query()` despite the legacy POST · it is
   * read-shaped from the client's perspective (no DB write · the
   * SystemMetric write inside recordSuggestionMetric is fire-and-
   * forget telemetry, not the request's purpose) · same reasoning
   * as the `laneCheck` query above. The component fires it 250ms
   * after stream-end · React Query's per-input dedup + staleTime
   * replace the manual setTimeout-gated fetch.
   *
   * Never throws · buildSuggestions resolves its own failure path
   * to the error-fallback triplet.
   */
  suggestions: operatorProcedure
    .input(
      z.object({
        userMessage: z.string().max(8000),
        assistantMessage: z.string().max(16000),
      }),
    )
    .query(async ({ input }) =>
      buildSuggestions({
        userMessage: input.userMessage,
        assistantMessage: input.assistantMessage,
      }),
    ),

  /**
   * Phase B.5 (2026-05-22) · owner-only · ghost-text completions for
   * the chat composer. Powers the usePromptSuggestions hook (the
   * "as you type" suggestion bar above the input).
   *
   * Delegates to `lib/services/chat-autocomplete.buildAutocomplete`
   * shared service · legacy POST /api/ai/autocomplete calls the same
   * function · drift impossible. Heuristic-only · no LLM cost.
   *
   * Modeled as a `.query()` despite the legacy POST · pure read,
   * no DB write. The hook fires it per-keystroke after a 250ms
   * debounce + aborts the in-flight request on the next keystroke ·
   * with tRPC the lazy imperative fetch (`utils.chat.autocomplete
   * .fetch`) keeps the debounce + abort semantics the hook owns.
   *
   * `partial` is capped at 200 chars · the service slices it anyway,
   * the bound is the tRPC-boundary guard.
   */
  autocomplete: operatorProcedure
    .input(
      z.object({
        partial: z.string().max(200),
        recentTopic: z.string().max(200).optional(),
      }),
    )
    .query(async ({ input }) =>
      buildAutocomplete({
        partial: input.partial,
        recentTopic: input.recentTopic,
      }),
    ),

  /**
   * Phase B.5 (2026-05-22) · owner-only · inspect the exact system
   * prompt Nick would receive on the next message. Powers the
   * PromptInspector modal (cache status · length · truncation
   * analysis · head/tail preview · "download full").
   *
   * Delegates to `lib/services/chat-prompt-inspect.inspectPrompt`
   * shared service · legacy GET /api/ai/inspect-prompt calls the
   * same function · drift impossible.
   *
   * BEHAVIOUR RESHAPE · the legacy GET supported `?raw=1` to return
   * the full prompt as a `text/plain` Response. tRPC cannot return
   * a raw text body, so this procedure returns the structured object
   * whole — INCLUDING the full effective prompt as the `prompt`
   * field. The PromptInspector reads `result.prompt` for its
   * "download full" action instead of a second `?raw=1` fetch. The
   * REST route keeps its `?raw=1` text/plain path by serving
   * `result.prompt` verbatim · both transports stay in sync.
   *
   * Modeled as a `.query()` · pure read (the prompt-cache write is
   * a memoization side effect, not the request's purpose).
   * `fresh: true` bypasses the cache + rebuilds.
   */
  inspectPrompt: operatorProcedure
    .input(z.object({ fresh: z.boolean().optional() }))
    .query(async ({ input }) => inspectPrompt({ fresh: input.fresh })),
});
