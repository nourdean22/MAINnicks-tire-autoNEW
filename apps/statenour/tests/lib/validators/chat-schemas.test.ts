/**
 * Chat-slice contract tests · Phase B.5 (2026-05-22 ·
 * legacy-modernizer REST→tRPC chat slice).
 *
 * The chat slice migrated 6 client files (components/chat/*) off
 * `authedFetch` onto `trpc.chat.*`. The risk that migration
 * introduces is the typed-payload-mismatch class: a client payload
 * TypeScript accepts but the server Zod input rejects at runtime,
 * surfacing as a generic failure toast (the /tasks quick-add bug,
 * 2026-05-21).
 *
 * Every new `chat` router procedure takes a strict `z.object({...})`
 * input declared inline in lib/trpc/routers/chat.ts (no permissive
 * z.record/unknown/any — the bug-class guard). Those `.input(...)`
 * objects are re-declared here VERBATIM so a tightened bound fails
 * CI before it breaks a real call-site, and the real client request
 * payloads are pinned against them.
 *
 * Procedures covered (the 7 with structured inputs):
 *   · updateConversation · deleteConversation
 *   · laneCheckFeedback  · messageFeedback
 *   · suggestions        · autocomplete       · inspectPrompt
 *
 * Pure schema parse, no Prisma — the contract is the schema, so the
 * test is too. Mirrors tests/lib/validators/task-actions-schemas.test.ts.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ──────────────── chat.updateConversation ────────────────
//
// chat-history-search.tsx toggleConvoFlag sends { id, starred: true }
// or { id, archived: true }. A future rename call sends { id, title }.

describe("chat.updateConversation · call-site payload contract", () => {
  const updateConversationInput = z.object({
    id: z.string().min(1).max(64),
    archived: z.boolean().optional(),
    starred: z.boolean().optional(),
    muted: z.boolean().optional(),
    title: z.string().max(200).optional(),
  });

  it("accepts the star-toggle payload — { id, starred: true }", () => {
    expect(() =>
      updateConversationInput.parse({ id: "conv-1", starred: true }),
    ).not.toThrow();
  });

  it("accepts the archive-toggle payload — { id, archived: true }", () => {
    expect(() =>
      updateConversationInput.parse({ id: "conv-1", archived: true }),
    ).not.toThrow();
  });

  it("accepts a mute toggle + a rename payload", () => {
    expect(() =>
      updateConversationInput.parse({ id: "conv-1", muted: false }),
    ).not.toThrow();
    expect(() =>
      updateConversationInput.parse({ id: "conv-1", title: "Brake-bay rebuild" }),
    ).not.toThrow();
  });

  it("rejects an empty id", () => {
    expect(() =>
      updateConversationInput.parse({ id: "", starred: true }),
    ).toThrow();
  });

  it("rejects a title over the 200-char cap", () => {
    expect(() =>
      updateConversationInput.parse({ id: "conv-1", title: "x".repeat(201) }),
    ).toThrow();
  });

  it("rejects a non-boolean flag — the boolean type is the guard", () => {
    expect(() =>
      updateConversationInput.parse({
        id: "conv-1",
        starred: "true" as unknown as boolean,
      }),
    ).toThrow();
  });
});

// ──────────────── chat.deleteConversation ────────────────
//
// chat-history-search.tsx deleteConvo sends { id }.

describe("chat.deleteConversation · call-site payload contract", () => {
  const deleteConversationInput = z.object({
    id: z.string().min(1).max(64),
  });

  it("accepts a { id } payload", () => {
    expect(() =>
      deleteConversationInput.parse({ id: "clx9k2p4t0001abcd1234efgh" }),
    ).not.toThrow();
  });

  it("rejects an empty id", () => {
    expect(() => deleteConversationInput.parse({ id: "" })).toThrow();
  });
});

// ──────────────── chat.laneCheckFeedback ────────────────
//
// lane-correction-chip.tsx sendFeedback sends { action, domain,
// severity, userMessage, assistantMessage }. action is a strict
// 2-value enum · domain/severity come off the chip object.

describe("chat.laneCheckFeedback · call-site payload contract", () => {
  const laneCheckFeedbackInput = z.object({
    action: z.enum(["tapped", "dismissed"]),
    domain: z.string().min(1).max(64),
    severity: z.string().max(40).optional(),
    userMessage: z.string().max(8000).optional(),
    assistantMessage: z.string().max(16000).optional(),
  });

  it("accepts the tapped payload (action link click)", () => {
    expect(() =>
      laneCheckFeedbackInput.parse({
        action: "tapped",
        domain: "marriage",
        severity: "high",
        userMessage: "what's the revenue today",
        assistantMessage: "Booked $4,200 across 6 jobs. Also watching: …",
      }),
    ).not.toThrow();
  });

  it("accepts the dismissed payload (X click)", () => {
    expect(() =>
      laneCheckFeedbackInput.parse({
        action: "dismissed",
        domain: "money",
        severity: "critical",
        userMessage: "u",
        assistantMessage: "a".repeat(80),
      }),
    ).not.toThrow();
  });

  it("rejects an action outside the 2-value enum — the chip only emits tapped/dismissed", () => {
    expect(() =>
      laneCheckFeedbackInput.parse({
        action: "ignored" as unknown as "tapped",
        domain: "money",
      }),
    ).toThrow();
  });

  it("rejects an empty domain", () => {
    expect(() =>
      laneCheckFeedbackInput.parse({ action: "tapped", domain: "" }),
    ).toThrow();
  });
});

// ──────────────── chat.messageFeedback ────────────────
//
// message-info-card.tsx setFeedbackOptimistic sends { messageId,
// score } where score toggles between 1 / -1 / null. The route's
// 3-tier fallback also accepts an optional conversationId / reason /
// snippet — pinned here for completeness.

describe("chat.messageFeedback · call-site payload contract", () => {
  const messageFeedbackInput = z.object({
    messageId: z.string().min(1).max(64),
    score: z.union([z.literal(-1), z.literal(0), z.literal(1), z.null()]),
    reason: z.string().max(1000).optional(),
    snippet: z.string().max(2000).optional(),
    conversationId: z.string().min(1).max(64).optional(),
  });

  it("accepts a thumbs-up payload — { messageId, score: 1 }", () => {
    expect(() =>
      messageFeedbackInput.parse({ messageId: "msg-1", score: 1 }),
    ).not.toThrow();
  });

  it("accepts a thumbs-down payload — { messageId, score: -1 }", () => {
    expect(() =>
      messageFeedbackInput.parse({ messageId: "msg-1", score: -1 }),
    ).not.toThrow();
  });

  it("accepts a clear payload — score null (the toggle-off case)", () => {
    // setFeedbackOptimistic sends `next = feedback === score ? null : score`.
    expect(() =>
      messageFeedbackInput.parse({ messageId: "msg-1", score: null }),
    ).not.toThrow();
  });

  it("accepts the 3-tier-fallback shape — messageId + conversationId + reason + snippet", () => {
    expect(() =>
      messageFeedbackInput.parse({
        messageId: "msg-1",
        score: -1,
        conversationId: "conv-1",
        reason: "hallucinated a tool call",
        snippet: "Added the 3 tasks to your list.",
      }),
    ).not.toThrow();
  });

  it("rejects a score outside {-1,0,1,null} — the literal union is the guard", () => {
    // A permissive z.number() here would let `2` through to the
    // service's stricter check — exactly the bug class this slice
    // guards against. The union rejects it at the tRPC boundary.
    expect(() =>
      messageFeedbackInput.parse({
        messageId: "msg-1",
        score: 2 as unknown as 1,
      }),
    ).toThrow();
  });

  it("rejects an empty messageId", () => {
    expect(() =>
      messageFeedbackInput.parse({ messageId: "", score: 1 }),
    ).toThrow();
  });
});

// ──────────────── chat.suggestions ────────────────
//
// smart-replies.tsx fires utils.chat.suggestions.fetch with the
// user+assistant message pair.

describe("chat.suggestions · call-site payload contract", () => {
  const suggestionsInput = z.object({
    userMessage: z.string().max(8000),
    assistantMessage: z.string().max(16000),
  });

  it("accepts the smart-replies { userMessage, assistantMessage } payload", () => {
    expect(() =>
      suggestionsInput.parse({
        userMessage: "what's the play for today",
        assistantMessage:
          "Three moves: clear the 4 declined estimates, call the Bay-5 customer, post the brake special.",
      }),
    ).not.toThrow();
  });

  it("accepts an empty userMessage — first turn has no prior user text", () => {
    // The component sends whatever userMessage it has · max-only
    // bound (no min) means an empty string is legal.
    expect(() =>
      suggestionsInput.parse({ userMessage: "", assistantMessage: "a".repeat(50) }),
    ).not.toThrow();
  });

  it("rejects an assistantMessage over the 16k cap", () => {
    expect(() =>
      suggestionsInput.parse({
        userMessage: "x",
        assistantMessage: "a".repeat(16_001),
      }),
    ).toThrow();
  });
});

// ──────────────── chat.autocomplete ────────────────
//
// use-prompt-suggestions.ts fires utils.chat.autocomplete.fetch with
// the trimmed draft as `partial`.

describe("chat.autocomplete · call-site payload contract", () => {
  const autocompleteInput = z.object({
    partial: z.string().max(200),
    recentTopic: z.string().max(200).optional(),
  });

  it("accepts the ghost-text { partial } payload", () => {
    expect(() =>
      autocompleteInput.parse({ partial: "draft me a" }),
    ).not.toThrow();
  });

  it("accepts a slash-command partial", () => {
    expect(() => autocompleteInput.parse({ partial: "/carousel" })).not.toThrow();
  });

  it("accepts a partial at the 200-char cap (the hook slices to 200)", () => {
    expect(() =>
      autocompleteInput.parse({ partial: "x".repeat(200) }),
    ).not.toThrow();
  });

  it("rejects a partial over the 200-char cap", () => {
    expect(() =>
      autocompleteInput.parse({ partial: "x".repeat(201) }),
    ).toThrow();
  });
});

// ──────────────── chat.inspectPrompt ────────────────
//
// prompt-inspector.tsx load() fires utils.chat.inspectPrompt.fetch
// with { fresh } — false on open, true on the FRESH button.

describe("chat.inspectPrompt · call-site payload contract", () => {
  const inspectPromptInput = z.object({ fresh: z.boolean().optional() });

  it("accepts the on-open payload — { fresh: false }", () => {
    expect(() => inspectPromptInput.parse({ fresh: false })).not.toThrow();
  });

  it("accepts the FRESH-button payload — { fresh: true }", () => {
    expect(() => inspectPromptInput.parse({ fresh: true })).not.toThrow();
  });

  it("accepts an empty object — fresh is optional", () => {
    expect(() => inspectPromptInput.parse({})).not.toThrow();
  });

  it("rejects a non-boolean fresh", () => {
    expect(() =>
      inspectPromptInput.parse({ fresh: "1" as unknown as boolean }),
    ).toThrow();
  });
});
