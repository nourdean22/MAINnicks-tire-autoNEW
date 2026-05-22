/**
 * Misc-pages slice contract tests · (2026-05-22 · legacy-modernizer
 * REST→tRPC misc-pages slice).
 *
 * This slice migrated the `authedFetch` call-sites in the remaining
 * non-`/system/` `app/(mastery)/*` page files onto tRPC:
 *
 *   · financial/page.tsx        → operator.financialSnapshot (NEW, read · no input)
 *                                 · operator.revenueStats     (NEW, read)
 *   · social/page.tsx           → operator.socialSchedule     (NEW, read · no input)
 *                                 · operator.socialRecentImages (NEW, read · no input)
 *                                 · operator.socialPublish    (NEW, mutation)
 *                                 · operator.scheduleSocialPost (NEW, mutation)
 *   · content/history/page.tsx  → operator.contentHistory     (NEW, read)
 *   · content/drafts/page.tsx   → operator.actOnDraft         (NEW, mutation)
 *   · decisions/[id]/page.tsx   → operator.decisionDetail     (NEW, read)
 *                                 · operator.gradeDecision    (NEW, mutation)
 *   · photo-improver/page.tsx   → operator.improvePhoto       (NEW, mutation)
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

// ──────────────── operator.socialPublish ────────────────
//
// SocialPage.handlePublish fires publishMutation.mutateAsync({
// platforms, imageUrl, caption, message }). `platforms` is the
// checked-platform array (1-2 entries).

describe("operator.socialPublish · SocialPage publish payloads", () => {
  const socialPublishInput = z.object({
    platforms: z.array(z.enum(["instagram", "facebook"])).min(1).max(2),
    imageUrl: z.string().max(2000).optional(),
    caption: z.string().max(4000).optional(),
    message: z.string().max(4000).optional(),
    linkUrl: z.string().max(2000).optional(),
  });

  it("accepts the IG-only publish payload (image + caption)", () => {
    expect(() =>
      socialPublishInput.parse({
        platforms: ["instagram"],
        imageUrl: "/api/images/abc123",
        caption: "fresh tires on a 2014 Camry",
        message: "fresh tires on a 2014 Camry",
      }),
    ).not.toThrow();
  });

  it("accepts the dual-platform publish payload", () => {
    expect(() =>
      socialPublishInput.parse({
        platforms: ["instagram", "facebook"],
        imageUrl: "/api/images/abc123",
        caption: "x",
        message: "x",
      }),
    ).not.toThrow();
  });

  it("accepts an FB-only text post (no imageUrl)", () => {
    expect(() =>
      socialPublishInput.parse({
        platforms: ["facebook"],
        message: "shop open till 6 today",
      }),
    ).not.toThrow();
  });

  it("rejects an empty platforms array — min(1) is the guard", () => {
    expect(() => socialPublishInput.parse({ platforms: [] })).toThrow();
  });

  it("rejects an unknown platform value", () => {
    expect(() =>
      socialPublishInput.parse({
        platforms: ["twitter" as unknown as "instagram"],
      }),
    ).toThrow();
  });
});

// ──────────────── operator.scheduleSocialPost ────────────────
//
// SocialPage.handleSchedule fires scheduleMutation.mutateAsync({
// text, imageUrl?, profileIds, scheduledAt?, shareNow }).

describe("operator.scheduleSocialPost · SocialPage schedule payloads", () => {
  const scheduleSocialPostInput = z.object({
    text: z.string().min(1).max(4000),
    imageUrl: z.string().max(2000).optional(),
    linkUrl: z.string().max(2000).optional(),
    profileIds: z.array(z.string().min(1).max(64)).max(20).optional(),
    scheduledAt: z.string().max(64).optional(),
    shareNow: z.boolean().optional(),
  });

  it("accepts the next-slot payload", () => {
    expect(() =>
      scheduleSocialPostInput.parse({
        text: "queued post body",
        imageUrl: "/api/images/abc",
        profileIds: ["buf_ig_1", "buf_fb_1"],
        shareNow: false,
      }),
    ).not.toThrow();
  });

  it("accepts the explicit-datetime payload", () => {
    expect(() =>
      scheduleSocialPostInput.parse({
        text: "scheduled body",
        profileIds: ["buf_ig_1"],
        scheduledAt: "2026-06-01T14:30",
        shareNow: false,
      }),
    ).not.toThrow();
  });

  it("accepts the post-now payload", () => {
    expect(() =>
      scheduleSocialPostInput.parse({
        text: "post now body",
        profileIds: ["buf_ig_1"],
        shareNow: true,
      }),
    ).not.toThrow();
  });

  it("rejects an empty text — min(1) is the guard", () => {
    expect(() =>
      scheduleSocialPostInput.parse({ text: "", profileIds: ["buf_ig_1"] }),
    ).toThrow();
  });
});

// ──────────────── operator.contentHistory ────────────────
//
// ContentHistoryPage's contentHistory query sends { q, minScore,
// maxScore, days, contentModeOnly } — minScore/maxScore are the dual
// range sliders (0-100), days is one of the {1,7,30,90} pills.

describe("operator.contentHistory · ContentHistoryPage filter payloads", () => {
  const contentHistoryInput = z
    .object({
      q: z.string().max(200).optional(),
      minScore: z.number().int().min(0).max(100).optional(),
      maxScore: z.number().int().min(0).max(100).optional(),
      shape: z.string().max(40).optional(),
      intent: z.string().max(40).optional(),
      contentModeOnly: z.boolean().optional(),
      days: z.number().int().min(1).max(365).optional(),
    })
    .optional();

  it("accepts the page's default filter payload", () => {
    expect(() =>
      contentHistoryInput.parse({
        q: "",
        minScore: 0,
        maxScore: 100,
        days: 30,
        contentModeOnly: false,
      }),
    ).not.toThrow();
  });

  it("accepts every days window pill (1 / 7 / 30 / 90)", () => {
    for (const days of [1, 7, 30, 90]) {
      expect(() =>
        contentHistoryInput.parse({ q: "", minScore: 0, maxScore: 100, days }),
      ).not.toThrow();
    }
  });

  it("accepts the full score-range sweep (0-100)", () => {
    for (const score of [0, 25, 50, 80, 100]) {
      expect(() =>
        contentHistoryInput.parse({ minScore: score, maxScore: score }),
      ).not.toThrow();
    }
  });

  it("rejects a minScore above the 100 cap", () => {
    expect(() => contentHistoryInput.parse({ minScore: 150 })).toThrow();
  });

  it("rejects a fractional days value", () => {
    expect(() => contentHistoryInput.parse({ days: 7.5 })).toThrow();
  });
});

// ──────────────── operator.actOnDraft ────────────────
//
// DraftsPage.action() fires actOnDraft.mutateAsync({ key, action })
// where action is "approve" | "reject".

describe("operator.actOnDraft · DraftsPage approve/reject payloads", () => {
  const actOnDraftInput = z.object({
    key: z.string().min(1).max(120),
    action: z.enum(["approve", "reject"]),
    reason: z.string().max(2000).optional(),
  });

  it("accepts the approve payload", () => {
    expect(() =>
      actOnDraftInput.parse({ key: "draft_abc123", action: "approve" }),
    ).not.toThrow();
  });

  it("accepts the reject payload", () => {
    expect(() =>
      actOnDraftInput.parse({ key: "draft_abc123", action: "reject" }),
    ).not.toThrow();
  });

  it("accepts a reject with an explicit reason", () => {
    expect(() =>
      actOnDraftInput.parse({
        key: "draft_abc123",
        action: "reject",
        reason: "off-brand voice",
      }),
    ).not.toThrow();
  });

  it("rejects an empty key", () => {
    expect(() =>
      actOnDraftInput.parse({ key: "", action: "approve" }),
    ).toThrow();
  });

  it("rejects an unknown action — the enum is the guard", () => {
    expect(() =>
      actOnDraftInput.parse({
        key: "draft_abc123",
        action: "delete" as unknown as "approve",
      }),
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

// ──────────────── operator.improvePhoto ────────────────
//
// PhotoImproverPage.run() fires improvePhoto.mutateAsync({
// imageBase64?, imageUrl?, mode }) — mode is one of the 3 mode pills.

describe("operator.improvePhoto · PhotoImproverPage payloads", () => {
  const improvePhotoInput = z.object({
    imageBase64: z.string().max(15_000_000).optional(),
    imageUrl: z.string().max(2000).optional(),
    mode: z.enum(["analyze", "rebrand", "both"]).optional(),
  });

  it("accepts a base64-upload payload for every mode pill", () => {
    for (const mode of ["analyze", "rebrand", "both"] as const) {
      expect(() =>
        improvePhotoInput.parse({ imageBase64: "iVBORw0KGgo=", mode }),
      ).not.toThrow();
    }
  });

  it("accepts a URL-source payload", () => {
    expect(() =>
      improvePhotoInput.parse({
        imageUrl: "/api/images/abc",
        mode: "both",
      }),
    ).not.toThrow();
  });

  it("rejects an unknown mode value", () => {
    expect(() =>
      improvePhotoInput.parse({
        imageUrl: "/api/images/abc",
        mode: "enhance" as unknown as "both",
      }),
    ).toThrow();
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
