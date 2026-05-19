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
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, operatorProcedure } from "../trpc";
import { ServiceError } from "@/lib/utils/service-error";
import { searchChat } from "@/lib/services/chat-search";
import { readChatBranches } from "@/lib/services/chat-branches";
import { readMessageProvenance } from "@/lib/services/brain-provenance";
import { checkLane } from "@/lib/services/chat-lane-check";
import { sendEmailWithAudit } from "@/lib/services/email-send";
import {
  upscaleImage,
  varyImage,
  SourceImageNotFoundError,
} from "@/lib/services/image-actions";

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
});
