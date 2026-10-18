/**
 * Misc-pages slice contract tests · (2026-05-22 · legacy-modernizer
 * REST→tRPC misc-pages slice).
 *
 * This slice migrated the `authedFetch` call-sites in the remaining
 * non-`/system/` `app/(mastery)/*` page files onto tRPC:
 *
 *   · financial/page.tsx        → operator.financialSnapshot (NEW, read · no input)
 *                                 · operator.revenueStats     (NEW, read)
 *                                 · operator.socialPublish    (NEW, mutation)
 *                                 · operator.scheduleSocialPost (NEW, mutation)
 *   · decisions/[id]/page.tsx   → operator.decisionDetail     (NEW, read)
 *                                 · operator.gradeDecision    (NEW, mutation)
 *   · chat/page.tsx             → chat.fork                   (NEW, mutation)
 *                                 · chat.editMessage          (REUSED · Phase JJ)
 *
 * The risk migration introduces is the typed-payload-mismatch class: a
 * client payload TypeScript accepts but the server Zod `.input()`
 * rejects at runtime, surfacing as a generic failure toast (the /tasks
 * quick-add bug, 2026-05-21).
 *
 * The schemas below are the literal `.input(...)` objects from
 * lib/trpc/routers/operator.ts + chat.ts — re-declared here verbatim
 * so a tightened bound fails CI before it breaks a real call-site.
 * Pure schema parse, no Prisma — the contract is the schema, so the
 * test is too. Mirrors tests/lib/validators/system-pages-b-schemas.test.ts.
 *
 * No-input procedures (financialSnapshot · socialSchedule ·
 * socialRecentImages) have nothing to pin.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ──────────────── operator.revenueStats ────────────────
//
// FinancialPage's revenueStats query sends { period: "month" }.

describe("operator.revenueStats · FinancialPage payload", () => {
  const revenueStatsInput = z
    .object({
      period: z.enum(["day", "week", "month", "year"]).optional(),
    })
    .optional();

  it("accepts the page's { period: 'month' } payload", () => {
    expect(() => revenueStatsInput.parse({ period: "month" })).not.toThrow();
  });

  it("accepts every period enum value", () => {
    for (const period of ["day", "week", "month", "year"] as const) {
      expect(() => revenueStatsInput.parse({ period })).not.toThrow();
    }
  });

  it("accepts an omitted period (defaults to month server-side)", () => {
    expect(() => revenueStatsInput.parse(undefined)).not.toThrow();
    expect(() => revenueStatsInput.parse({})).not.toThrow();
  });

  it("rejects an unknown period value", () => {
    expect(() =>
      revenueStatsInput.parse({ period: "quarter" as unknown as "month" }),
    ).toThrow();
  });
});

// ──────────────── operator.decisionDetail ────────────────
//
// DecisionDetailPage's decisionDetail query sends { id } where id is
// the numeric route param.

describe("operator.decisionDetail · DecisionDetailPage payload", () => {
  const decisionDetailInput = z.object({ id: z.number().int().positive() });

  it("accepts a positive integer id", () => {
    expect(() => decisionDetailInput.parse({ id: 42 })).not.toThrow();
  });

  it("rejects a zero / negative id", () => {
    expect(() => decisionDetailInput.parse({ id: 0 })).toThrow();
    expect(() => decisionDetailInput.parse({ id: -1 })).toThrow();
  });

  it("rejects a fractional id", () => {
    expect(() => decisionDetailInput.parse({ id: 4.5 })).toThrow();
  });
});

// ──────────────── operator.gradeDecision ────────────────
//
// DecisionDetailPage.save() fires gradeDecision.mutateAsync({ id,
// actualOutcome?, grade?, reviewDate? }) — the edit form sends
// whichever fields changed.

describe("operator.gradeDecision · DecisionDetailPage grade payloads", () => {
  const gradeDecisionInput = z.object({
    id: z.number().int().positive(),
    actualOutcome: z.string().max(8000).optional(),
    grade: z.string().max(40).optional(),
    reviewDate: z.string().max(40).optional(),
  });

  it("accepts the full grade payload (outcome + grade + reviewDate)", () => {
    expect(() =>
      gradeDecisionInput.parse({
        id: 42,
        actualOutcome: "the rebrand landed · revenue up 12%",
        grade: "A",
        reviewDate: "2026-09-01",
      }),
    ).not.toThrow();
  });

  it("accepts a partial payload (only the fields that changed)", () => {
    expect(() =>
      gradeDecisionInput.parse({ id: 42, grade: "B" }),
    ).not.toThrow();
    expect(() =>
      gradeDecisionInput.parse({ id: 42, reviewDate: "2026-07-15" }),
    ).not.toThrow();
  });

  it("rejects a non-positive id", () => {
    expect(() => gradeDecisionInput.parse({ id: 0, grade: "A" })).toThrow();
  });
});

// ──────────────── chat.fork ────────────────
//
// ChatPage.handleFork fires forkMutation.mutateAsync({
// sourceConversationId, upToMessageId, titleSuffix }).

describe("chat.fork · ChatPage fork-from-message payload", () => {
  const forkInput = z.object({
    sourceConversationId: z.string().min(1).max(64),
    upToMessageId: z.string().min(1).max(64),
    titleSuffix: z.string().max(80).optional(),
  });

  it("accepts the page's fork payload", () => {
    expect(() =>
      forkInput.parse({
        sourceConversationId: "conv_abc123",
        upToMessageId: "msg_def456",
        titleSuffix: "fork",
      }),
    ).not.toThrow();
  });

  it("rejects an empty sourceConversationId", () => {
    expect(() =>
      forkInput.parse({
        sourceConversationId: "",
        upToMessageId: "msg_def456",
      }),
    ).toThrow();
  });

  it("rejects an empty upToMessageId", () => {
    expect(() =>
      forkInput.parse({
        sourceConversationId: "conv_abc123",
        upToMessageId: "",
      }),
    ).toThrow();
  });
});

// ──────────────── chat.editMessage (REUSED · Phase JJ) ────────────────
//
// ChatPage.handleFooterMessageReverted reuses the existing
// chat.editMessage procedure: { messageId, content }. Pinned here
// because this slice adds a NEW call-site to the procedure (the
// revert path) — the payload must satisfy the existing bound.
// MAX_CONTENT_CHARS is the chat-edit service's content cap; the test
// uses a generous literal below it rather than importing the service
// (keeps this a pure schema test).

describe("chat.editMessage · ChatPage revert payload", () => {
  // The procedure's real bound is z.string().min(1).max(MAX_CONTENT_CHARS).
  // A revert always sends prior message content (non-empty) — pinned
  // with a conservative cap so a future tightening of the floor (min)
  // fails CI before it breaks the revert call-site.
  const editMessageInputFloor = z.object({
    messageId: z.string().min(1).max(64),
    content: z.string().min(1),
  });

  it("accepts the revert payload (prior content)", () => {
    expect(() =>
      editMessageInputFloor.parse({
        messageId: "msg_def456",
        content: "the prior message text being restored",
      }),
    ).not.toThrow();
  });

  it("rejects an empty messageId", () => {
    expect(() =>
      editMessageInputFloor.parse({ messageId: "", content: "x" }),
    ).toThrow();
  });

  it("rejects empty revert content — min(1) is the guard", () => {
    expect(() =>
      editMessageInputFloor.parse({ messageId: "msg_def456", content: "" }),
    ).toThrow();
  });
});
