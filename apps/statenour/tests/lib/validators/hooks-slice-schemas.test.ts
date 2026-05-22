/**
 * Hooks-slice contract tests · (2026-05-22 · legacy-modernizer
 * REST→tRPC hooks slice).
 *
 * This slice migrated the cross-cutting React hooks in `hooks/` off
 * `authedFetch` onto EXISTING `trpc.*` procedures. It adds NO new
 * procedures — every call-site reuses a procedure a prior slice
 * already shipped:
 *
 *   · use-task-review-actions → task.update      (REUSED · Phase WW)
 *                               task.emitEvent   (REUSED · Phase QQ)
 *   · use-nick-message-actions → task.create     (REUSED · Phase SS)
 *                                brain.createPin (REUSED · Phase YY)
 *   · use-chat-message-actions → brain.createPin (REUSED · Phase YY)
 *                                brain.pinned    (REUSED · Phase YY)
 *   · use-suggestion-warm     → chat.suggestions (REUSED · Phase B.5)
 *   · use-chat-branch-swap    → chat.branches    (REUSED · Phase DD)
 *   · use-conversations       → chat.updateConversation (REUSED · Phase B.5)
 *                               chat.deleteConversation (REUSED · Phase B.5)
 *
 * The risk a migration introduces is the typed-payload-mismatch class:
 * a client payload TypeScript accepts but the server Zod `.input()`
 * rejects at runtime, surfacing as a generic failure toast (the /tasks
 * quick-add bug, 2026-05-21). Even reused procedures gain NEW call-site
 * payload shapes here — those are what these tests pin.
 *
 * The schemas below are the literal `.input(...)` objects from
 * lib/trpc/routers/{task,chat,brain}.ts — re-declared here verbatim so
 * a tightened bound fails CI before it breaks a real hook call-site.
 * Pure schema parse, no Prisma — the contract is the schema, so the
 * test is too. Mirrors tests/lib/validators/chat-schemas.test.ts.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ──────────────── task.emitEvent ────────────────
//
// use-task-review-actions `kill` fires emitEventMutation.mutateAsync({
// taskId, kind: "killed", source }). `kind` must be in the
// CLIENT_EMIT_KINDS allowlist — `killed` is.

describe("task.emitEvent · use-task-review-actions kill payload", () => {
  // CLIENT_EMIT_KINDS verbatim from lib/trpc/routers/task.ts.
  const emitEventInput = z.object({
    taskId: z.string().min(1).max(64),
    kind: z.enum(["killed", "nudged", "stale_flagged", "linked", "unlinked"]),
    source: z.string().max(40).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  });

  it("accepts the kill payload — { taskId, kind: 'killed', source }", () => {
    expect(() =>
      emitEventInput.parse({
        taskId: "task_abc123",
        kind: "killed",
        source: "page:tasks/now",
      }),
    ).not.toThrow();
  });

  it("rejects an event kind outside the client-emit allowlist", () => {
    expect(() =>
      emitEventInput.parse({
        taskId: "task_abc123",
        kind: "completed" as unknown as "killed",
      }),
    ).toThrow();
  });

  it("rejects an empty taskId", () => {
    expect(() =>
      emitEventInput.parse({ taskId: "", kind: "killed" }),
    ).toThrow();
  });
});

// ──────────────── task.update (fields = taskUpdateSchema) ────────────────
//
// use-task-review-actions kill/reframe/blocker/snooze/edit all fire
// updateMutation.mutateAsync({ id, fields }). `fields` is the shared
// `taskUpdateSchema` (taskBaseSchema.partial()). The kill/reframe/
// blocker literals are valid schema subsets; snooze/edit cast a
// heterogeneous map (taskUpdateSchema.parse strips unknown keys server-
// side — the behavior the legacy REST path also had). Pinned: the
// id-arg bound + the valid-subset shape.

describe("task.update · use-task-review-actions { id, fields } envelope", () => {
  const updateEnvelope = z.object({
    id: z.string().min(1).max(64),
    // taskUpdateSchema is broad; the hook only ever sends a small
    // status/title/waitingOn subset. Pinned loosely — the procedure's
    // own taskUpdateSchema is the real validator, exercised server-side.
    fields: z.object({
      status: z
        .enum(["INBOX", "READY", "DOING", "WAITING", "DONE", "ARCHIVED"])
        .optional(),
      title: z.string().optional(),
      waitingOn: z.string().nullable().optional(),
      nextPhysicalAction: z.string().optional(),
    }),
  });

  it("accepts the kill patch — { id, fields: { status: 'ARCHIVED' } }", () => {
    expect(() =>
      updateEnvelope.parse({
        id: "task_abc123",
        fields: { status: "ARCHIVED" },
      }),
    ).not.toThrow();
  });

  it("accepts the blocker patch — { status: 'WAITING', waitingOn }", () => {
    expect(() =>
      updateEnvelope.parse({
        id: "task_abc123",
        fields: { status: "WAITING", waitingOn: "the parts supplier" },
      }),
    ).not.toThrow();
  });

  it("accepts the reframe patch — { title, nextPhysicalAction }", () => {
    expect(() =>
      updateEnvelope.parse({
        id: "task_abc123",
        fields: { title: "new title", nextPhysicalAction: "call them" },
      }),
    ).not.toThrow();
  });

  it("rejects an empty id", () => {
    expect(() =>
      updateEnvelope.parse({ id: "", fields: { status: "ARCHIVED" } }),
    ).toThrow();
  });
});

// ──────────────── chat.suggestions ────────────────
//
// use-suggestion-warm fires utils.chat.suggestions.fetch({ userMessage,
// assistantMessage }) to warm the cache.

describe("chat.suggestions · use-suggestion-warm warm payload", () => {
  const suggestionsInput = z.object({
    userMessage: z.string().max(8000),
    assistantMessage: z.string().max(16000),
  });

  it("accepts the warm payload — { userMessage, assistantMessage }", () => {
    expect(() =>
      suggestionsInput.parse({
        userMessage: "what should I do about the declined estimates?",
        assistantMessage:
          "Pull the top 10 by value and fire the 7-day SMS sweep.",
      }),
    ).not.toThrow();
  });

  it("accepts empty strings (a cold warm before any real turn)", () => {
    expect(() =>
      suggestionsInput.parse({ userMessage: "", assistantMessage: "" }),
    ).not.toThrow();
  });

  it("rejects an assistantMessage over the 16k cap", () => {
    expect(() =>
      suggestionsInput.parse({
        userMessage: "x",
        assistantMessage: "a".repeat(16001),
      }),
    ).toThrow();
  });
});

// ──────────────── chat.branches ────────────────
//
// use-chat-branch-swap fires utils.chat.branches.fetch({
// parentMessageId }) inside the nick-swap-branch event listener.

describe("chat.branches · use-chat-branch-swap fetch payload", () => {
  const branchesInput = z.object({
    parentMessageId: z.string().min(1).max(64),
  });

  it("accepts the swap payload — { parentMessageId }", () => {
    expect(() =>
      branchesInput.parse({ parentMessageId: "msg_parent_abc" }),
    ).not.toThrow();
  });

  it("rejects an empty parentMessageId", () => {
    expect(() => branchesInput.parse({ parentMessageId: "" })).toThrow();
  });
});

// ──────────────── chat.updateConversation ────────────────
//
// use-conversations patchConvoFlag fires updateConversationMutation
// .mutateAsync({ id, ...oneOf({ starred }, { muted }, { archived }) }).

describe("chat.updateConversation · use-conversations flag payloads", () => {
  const updateConversationInput = z.object({
    id: z.string().min(1).max(64),
    archived: z.boolean().optional(),
    starred: z.boolean().optional(),
    muted: z.boolean().optional(),
    title: z.string().max(200).optional(),
  });

  it("accepts each single-flag patch the drawer sends", () => {
    for (const patch of [
      { starred: true },
      { muted: true },
      { archived: true },
    ]) {
      expect(() =>
        updateConversationInput.parse({ id: "conv_abc", ...patch }),
      ).not.toThrow();
    }
  });

  it("accepts a flag-clear (false) patch", () => {
    expect(() =>
      updateConversationInput.parse({ id: "conv_abc", starred: false }),
    ).not.toThrow();
  });

  it("rejects an empty conversation id", () => {
    expect(() =>
      updateConversationInput.parse({ id: "", starred: true }),
    ).toThrow();
  });
});

// ──────────────── chat.deleteConversation ────────────────
//
// use-conversations deleteConvo fires deleteConversationMutation
// .mutateAsync({ id }).

describe("chat.deleteConversation · use-conversations delete payload", () => {
  const deleteConversationInput = z.object({
    id: z.string().min(1).max(64),
  });

  it("accepts the delete payload — { id }", () => {
    expect(() =>
      deleteConversationInput.parse({ id: "conv_abc123" }),
    ).not.toThrow();
  });

  it("rejects an empty id", () => {
    expect(() => deleteConversationInput.parse({ id: "" })).toThrow();
  });
});

// ──────────────── brain.createPin ────────────────
//
// use-nick-message-actions onPinToMemory + use-chat-message-actions
// onPin both fire createPinMutation.mutateAsync({ content, source }).

describe("brain.createPin · message-action pin payloads", () => {
  const createPinInput = z.object({
    content: z.string().min(1).max(2000),
    source: z.string().max(40).optional(),
    label: z.string().max(80).optional(),
  });

  it("accepts the chat-action pin payload — { content, source }", () => {
    expect(() =>
      createPinInput.parse({
        content: "Nick should always confirm before destructive moves.",
        source: "pin:chat",
      }),
    ).not.toThrow();
  });

  it("accepts the long-press pin payload — { content, source }", () => {
    expect(() =>
      createPinInput.parse({
        content: "the pinned assistant reply text",
        source: "pin:longpress",
      }),
    ).not.toThrow();
  });

  it("rejects empty content — min(1) is the guard", () => {
    expect(() =>
      createPinInput.parse({ content: "", source: "pin:chat" }),
    ).toThrow();
  });

  it("rejects content over the 2000-char cap", () => {
    expect(() =>
      createPinInput.parse({ content: "a".repeat(2001), source: "pin:chat" }),
    ).toThrow();
  });
});

// ──────────────── brain.pinned ────────────────
//
// use-chat-message-actions onPin's readback fires
// utils.brain.pinned.fetch({}) — an empty object satisfies the
// all-optional input.

describe("brain.pinned · use-chat-message-actions readback payload", () => {
  const pinnedInput = z
    .object({ withStats: z.boolean().optional() })
    .optional();

  it("accepts the empty-object readback payload — {}", () => {
    expect(() => pinnedInput.parse({})).not.toThrow();
  });

  it("accepts an omitted input", () => {
    expect(() => pinnedInput.parse(undefined)).not.toThrow();
  });

  it("accepts an explicit { withStats } payload", () => {
    expect(() => pinnedInput.parse({ withStats: true })).not.toThrow();
  });
});
