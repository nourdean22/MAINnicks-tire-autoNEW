/**
 * Cross-domain-residuals slice contract tests · (2026-05-22 ·
 * legacy-modernizer REST→tRPC · chat + ultron cross-domain residuals).
 *
 * This slice migrated the leftover cross-domain `authedFetch` calls in
 * `components/chat/*` + `components/ultron/*` (a chat file calling a
 * /api/brain/* endpoint, etc) onto tRPC. It added 12 NEW procedures
 * across the `system` / `nick` / `brain` / `task` routers.
 *
 * Most are no-input reads (`system.veniceStatus`, `system.providerHealth`,
 * `nick.suggestions`, `brain.escalations`, `brain.industryIntel`,
 * `brain.ghostPredict`, `brain.recomputeGhostPredict`) — nothing to pin.
 * The FOUR procedures with a structured `.input()` are pinned here:
 *
 *   · system.agentTraceByMessage    · { messageId, conversationId? }
 *   · brain.recordSuggestionSignal  · discriminated union (action|outcome)
 *   · brain.dismissGhostPrediction  · { taskIdOrTitle }
 *   · task.undo                     · { token }
 *
 * The risk a migration introduces is the typed-payload-mismatch class:
 * a client payload TypeScript accepts but the server Zod `.input()`
 * rejects at runtime, surfacing as a generic failure toast (the /tasks
 * quick-add bug, 2026-05-21).
 *
 * The schemas below are the literal `.input(...)` objects from
 * lib/trpc/routers/{system,brain,task}.ts — re-declared here verbatim so
 * a tightened bound fails CI before it breaks a real call-site. Pure
 * schema parse, no Prisma. Mirrors tests/lib/validators/
 * hooks-slice-schemas.test.ts.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ──────────────── system.agentTraceByMessage ────────────────
//
// ReasoningTrace fires utils.system.agentTraceByMessage.fetch({
// messageId, conversationId? }) on first expand.

describe("system.agentTraceByMessage · ReasoningTrace fetch payload", () => {
  const agentTraceByMessageInput = z.object({
    messageId: z.string().min(1).max(128),
    conversationId: z.string().min(1).max(64).optional(),
  });

  it("accepts the bare payload — { messageId }", () => {
    expect(() =>
      agentTraceByMessageInput.parse({ messageId: "msg_abc123" }),
    ).not.toThrow();
  });

  it("accepts the fresh-stream payload — { messageId, conversationId }", () => {
    expect(() =>
      agentTraceByMessageInput.parse({
        messageId: "msg_abc123",
        conversationId: "conv_xyz789",
      }),
    ).not.toThrow();
  });

  it("rejects an empty messageId", () => {
    expect(() =>
      agentTraceByMessageInput.parse({ messageId: "" }),
    ).toThrow();
  });

  it("rejects an empty conversationId when present", () => {
    expect(() =>
      agentTraceByMessageInput.parse({
        messageId: "msg_abc123",
        conversationId: "",
      }),
    ).toThrow();
  });
});

// ──────────────── brain.recordSuggestionSignal ────────────────
//
// NickSuggestions fires signalMutation.mutate({ type: "action",
// suggestionId, suggestionKind, event }) on chip tap (acted) + X
// (dismissed). The input is a strict discriminated union on `type`
// built from the suggestion-loop lib's own z.enum exports.

describe("brain.recordSuggestionSignal · NickSuggestions chip payload", () => {
  // SuggestionKind / ActionEvent / OutcomePolarity verbatim from
  // lib/brain/suggestion-loop.ts.
  const SuggestionKind = z.enum([
    "task",
    "goal",
    "sms",
    "research",
    "reflection",
    "decision",
    "purchase",
    "weak-axis",
    "stuck-task",
    "overdue",
    "stalled-goal",
    "pattern",
    "orphan-nudge",
    "contradiction",
    "drift",
    "unresolved-reflection",
    "broken-promise",
    "stale-pin",
    "other",
  ]);
  const ActionEvent = z.enum(["acted", "dismissed", "modified", "deferred"]);
  const OutcomePolarity = z.enum(["positive", "negative", "neutral"]);

  const recordSuggestionSignalInput = z.discriminatedUnion("type", [
    z.object({
      type: z.literal("action"),
      suggestionId: z.string().min(1).max(128),
      suggestionKind: SuggestionKind,
      event: ActionEvent,
      delaySeconds: z
        .number()
        .int()
        .nonnegative()
        .max(60 * 60 * 24 * 365)
        .optional(),
      modifiedTo: z.string().max(2000).optional(),
      notes: z.string().max(2000).optional(),
    }),
    z.object({
      type: z.literal("outcome"),
      suggestionId: z.string().min(1).max(128),
      suggestionKind: SuggestionKind,
      polarity: OutcomePolarity,
      delaySeconds: z
        .number()
        .int()
        .nonnegative()
        .max(60 * 60 * 24 * 365)
        .optional(),
      notes: z.string().max(4000).optional(),
    }),
  ]);

  it("accepts the chip-tap action payload — { type: 'action', …, event: 'acted' }", () => {
    expect(() =>
      recordSuggestionSignalInput.parse({
        type: "action",
        suggestionId: "broken-promise-abc123",
        suggestionKind: "broken-promise",
        event: "acted",
      }),
    ).not.toThrow();
  });

  it("accepts the chip-dismiss action payload — { …, event: 'dismissed' }", () => {
    expect(() =>
      recordSuggestionSignalInput.parse({
        type: "action",
        suggestionId: "stale-pin-xyz",
        suggestionKind: "stale-pin",
        event: "dismissed",
      }),
    ).not.toThrow();
  });

  it("accepts the outcome variant — { type: 'outcome', …, polarity }", () => {
    expect(() =>
      recordSuggestionSignalInput.parse({
        type: "outcome",
        suggestionId: "weak-axis-fitness",
        suggestionKind: "weak-axis",
        polarity: "positive",
      }),
    ).not.toThrow();
  });

  it("rejects a payload with no discriminator", () => {
    expect(() =>
      recordSuggestionSignalInput.parse({
        suggestionId: "x",
        suggestionKind: "task",
        event: "acted",
      }),
    ).toThrow();
  });

  it("rejects an action payload carrying a `polarity` instead of `event`", () => {
    expect(() =>
      recordSuggestionSignalInput.parse({
        type: "action",
        suggestionId: "x",
        suggestionKind: "task",
        polarity: "positive",
      }),
    ).toThrow();
  });

  it("rejects an event outside the action allowlist", () => {
    expect(() =>
      recordSuggestionSignalInput.parse({
        type: "action",
        suggestionId: "x",
        suggestionKind: "task",
        event: "ignored" as unknown as "acted",
      }),
    ).toThrow();
  });

  it("rejects an unknown suggestionKind", () => {
    expect(() =>
      recordSuggestionSignalInput.parse({
        type: "action",
        suggestionId: "x",
        suggestionKind: "made-up-kind" as unknown as "task",
        event: "acted",
      }),
    ).toThrow();
  });

  it("rejects an empty suggestionId", () => {
    expect(() =>
      recordSuggestionSignalInput.parse({
        type: "action",
        suggestionId: "",
        suggestionKind: "task",
        event: "acted",
      }),
    ).toThrow();
  });
});

// ──────────────── brain.dismissGhostPrediction ────────────────
//
// GhostNickStrip fires dismissMutation.mutateAsync({ taskIdOrTitle })
// from the per-prediction "not going to do this" button.

describe("brain.dismissGhostPrediction · GhostNickStrip dismiss payload", () => {
  const dismissGhostPredictionInput = z.object({
    taskIdOrTitle: z.string().min(1).max(400),
  });

  it("accepts a taskId payload", () => {
    expect(() =>
      dismissGhostPredictionInput.parse({ taskIdOrTitle: "task_abc123" }),
    ).not.toThrow();
  });

  it("accepts a title-string payload (predictions can be untitled tasks)", () => {
    expect(() =>
      dismissGhostPredictionInput.parse({
        taskIdOrTitle: "Call the parts supplier about the backorder",
      }),
    ).not.toThrow();
  });

  it("rejects an empty taskIdOrTitle", () => {
    expect(() =>
      dismissGhostPredictionInput.parse({ taskIdOrTitle: "" }),
    ).toThrow();
  });
});

// ──────────────── task.undo ────────────────
//
// UndoChip (inside ToolResultCard) fires undoMutation.mutateAsync({
// token }) on tap. The token min(8) mirrors the route's length guard.

describe("task.undo · UndoChip consume payload", () => {
  const undoInput = z.object({
    token: z.string().min(8).max(128),
  });

  it("accepts a well-formed undo token", () => {
    expect(() =>
      undoInput.parse({ token: "undo_tok_abc123xyz" }),
    ).not.toThrow();
  });

  it("rejects a token under the 8-char floor", () => {
    expect(() => undoInput.parse({ token: "short" })).toThrow();
  });

  it("rejects an empty token", () => {
    expect(() => undoInput.parse({ token: "" })).toThrow();
  });
});
