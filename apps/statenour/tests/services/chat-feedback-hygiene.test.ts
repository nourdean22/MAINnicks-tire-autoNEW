/**
 * recordMessageFeedback · audit 2026-10-10 (06-F9).
 *  · no "any assistant message in the last 60 s" fallback: a thumb on an id
 *    that resolves nowhere is a 404, never a label on another conversation's reply;
 *  · a flip (up -> down) replaces the feedback memory instead of swallowing the
 *    unique-key conflict and keeping the stale verdict;
 *  · clearing a thumb is recorded (AuditEvent + Langfuse score 0), so the
 *    learning stream sees the retraction.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  memUpsert: vi.fn(),
  memCreate: vi.fn(),
  auditCreate: vi.fn(),
  score: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: { findUnique: m.findUnique, findFirst: m.findFirst, update: m.update },
    brainMemory: { upsert: m.memUpsert, create: m.memCreate },
    auditEvent: { create: m.auditCreate },
  },
}));
vi.mock("@/lib/observability/langfuse-scores", () => ({ sendLangfuseScore: m.score }));
vi.mock("@/lib/observability/langfuse-annotation-queue", () => ({ enqueueLangfuseTraceForAnnotation: vi.fn() }));

import { MessageFeedbackNotFoundError, recordMessageFeedback } from "@/lib/services/chat-feedback";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  m.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === "msg1" ? { id: "msg1", conversationId: "conv1", role: "assistant", tokenUsage: { traceId: "tr1" }, model: "m", content: "hi" } : null,
  );
  m.findFirst.mockResolvedValue({ id: "other-convo-msg", conversationId: "conv9", role: "assistant" });
  m.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: { feedbackScore: number | null } }) => ({
    id: where.id,
    feedbackScore: data.feedbackScore,
    conversationId: "conv1",
  }));
  for (const f of [m.memUpsert, m.memCreate, m.auditCreate]) f.mockResolvedValue({});
});

describe("recordMessageFeedback", () => {
  it("an unresolvable id with no conversation is not found — never another conversation's latest reply", async () => {
    await expect(recordMessageFeedback({ messageId: "ghost", score: -1 })).rejects.toBeInstanceOf(MessageFeedbackNotFoundError);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("the conversation fallback still resolves inside the named conversation", async () => {
    await recordMessageFeedback({ messageId: "ghost", score: 1, conversationId: "conv1" });
    expect(m.findFirst).toHaveBeenCalledOnce();
    expect(m.findFirst.mock.calls[0][0].where).toMatchObject({ conversationId: "conv1", role: "assistant" });
  });

  it("a flip upserts the feedback memory so the new verdict replaces the old", async () => {
    await recordMessageFeedback({ messageId: "msg1", score: -1 });
    await flush();
    expect(m.memCreate).not.toHaveBeenCalled();
    expect(m.memUpsert).toHaveBeenCalledOnce();
    const arg = m.memUpsert.mock.calls[0][0];
    expect(arg.where).toEqual({ category_key: { category: "chat_feedback", key: "feedback:msg1" } });
    expect(arg.update).toMatchObject({ content: expect.stringContaining("score=-1"), confidence: 0.85 });
  });

  it("clearing a thumb writes an AuditEvent and a Langfuse score of 0", async () => {
    await recordMessageFeedback({ messageId: "msg1", score: null });
    await flush();
    expect(m.auditCreate).toHaveBeenCalledOnce();
    expect(m.auditCreate.mock.calls[0][0].data).toMatchObject({ eventType: "chat_feedback", payload: expect.objectContaining({ score: null, rating: "cleared" }) });
    expect(m.score).toHaveBeenCalledWith(expect.objectContaining({ traceId: "tr1", name: "operator_thumb", value: 0 }));
  });
});
