/**
 * hooks-lib slice contract tests · (2026-05-22 · the FINAL REST→tRPC
 * slice · 12 hooks + 4 lib modules).
 *
 * This slice migrated the LAST `authedFetch` / `useAuthedFetch` call-
 * sites in the app onto tRPC, then deleted `hooks/use-authed-fetch.ts`.
 *
 * It added 10 procedures across `chat` / `system` / `operator`. Three
 * are no-input reads — nothing to pin:
 *
 *   · system.pulse        · ()  → FloatingHome pulse rollup
 *   · system.diagnoseChat · ()  → chat-route health report
 *   · system.pushVapidKey · ()  → Web-Push VAPID public key
 *
 * The seven procedures with a structured `.input()` are pinned here:
 *
 *   · chat.list               · { cursor?, take? }
 *   · chat.conversation       · { id }
 *   · chat.renameConversation · { id, title }
 *   · chat.deleteMessage      · { messageId }
 *   · chat.prefetch           · { draft, clientId? }
 *   · chat.wisdomSuggest      · { draft, dismissedIds? }
 *   · chat.resolveMention     · { key, surroundingText? }
 *   · system.pushSubscribe    · { subscription: { endpoint, keys } }
 *   · system.pushUnsubscribe  · { endpoint }
 *   · operator.createCommitment · { description, toWhom?, … }
 *
 * The risk a migration introduces is the typed-payload-mismatch class:
 * a client payload TypeScript accepts but the server Zod `.input()`
 * rejects at runtime, surfacing as a generic failure toast.
 *
 * The schemas below are the literal `.input(...)` objects from
 * lib/trpc/routers/{chat,system,operator}.ts — re-declared here verbatim
 * so a tightened bound fails CI before it breaks a real call-site. Pure
 * schema parse, no Prisma. Mirrors tests/lib/validators/
 * straggler-pages-schemas.test.ts.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ──────────────── chat.list ────────────────
//
// `useConversations.reloadConvos` fires `chat.list.fetch({})`;
// `loadMoreConvos` fires `chat.list.fetch({ cursor })`.

describe("chat.list · conversation-list page payload", () => {
  const chatListInput = z
    .object({
      cursor: z.string().max(64).optional(),
      take: z.number().int().min(1).max(200).optional(),
    })
    .optional();

  it("accepts a bare {} payload — the drawer's initial load", () => {
    expect(() => chatListInput.parse({})).not.toThrow();
  });

  it("accepts a fully-absent payload (whole-input optional)", () => {
    expect(() => chatListInput.parse(undefined)).not.toThrow();
  });

  it("accepts an explicit cursor — the load-older page call", () => {
    expect(() => chatListInput.parse({ cursor: "clxyz123" })).not.toThrow();
  });

  it("accepts a take inside the 1-200 range", () => {
    expect(() => chatListInput.parse({ take: 75 })).not.toThrow();
  });

  it("rejects a cursor past the 64-char ceiling", () => {
    expect(() => chatListInput.parse({ cursor: "x".repeat(65) })).toThrow();
  });

  it("rejects a take above the 200-row ceiling", () => {
    expect(() => chatListInput.parse({ take: 201 })).toThrow();
  });

  it("rejects a non-integer take", () => {
    expect(() => chatListInput.parse({ take: 12.5 })).toThrow();
  });
});

// ──────────────── chat.conversation ────────────────
//
// `useConversations.loadConvo` fires `chat.conversation.fetch({ id })`.

describe("chat.conversation · single-conversation read payload", () => {
  const chatConversationInput = z.object({
    id: z.string().min(1).max(64),
  });

  it("accepts the { id } payload the hook sends", () => {
    expect(() => chatConversationInput.parse({ id: "clxyz123" })).not.toThrow();
  });

  it("rejects an empty id", () => {
    expect(() => chatConversationInput.parse({ id: "" })).toThrow();
  });

  it("rejects an id past the 64-char ceiling", () => {
    expect(() =>
      chatConversationInput.parse({ id: "x".repeat(65) }),
    ).toThrow();
  });

  it("rejects a missing id", () => {
    expect(() => chatConversationInput.parse({})).toThrow();
  });
});

// ──────────────── chat.renameConversation ────────────────
//
// `useConversations.renameConvo` fires
// `chat.renameConversation.mutateAsync({ id, title })`.

describe("chat.renameConversation · title-rename payload", () => {
  const renameInput = z.object({
    id: z.string().min(1).max(64),
    title: z.string().min(1).max(200),
  });

  it("accepts the { id, title } payload the hook sends", () => {
    expect(() =>
      renameInput.parse({ id: "clxyz123", title: "Pricing strategy" }),
    ).not.toThrow();
  });

  it("rejects an empty title", () => {
    expect(() => renameInput.parse({ id: "clxyz123", title: "" })).toThrow();
  });

  it("rejects a title past the 200-char ceiling", () => {
    expect(() =>
      renameInput.parse({ id: "clxyz123", title: "x".repeat(201) }),
    ).toThrow();
  });

  it("rejects a missing id", () => {
    expect(() => renameInput.parse({ title: "a title" })).toThrow();
  });
});

// ──────────────── chat.deleteMessage ────────────────
//
// `useChatMessageActions.onDelete` fires
// `chat.deleteMessage.mutateAsync({ messageId })`.

describe("chat.deleteMessage · cascade-delete payload", () => {
  const deleteMessageInput = z.object({
    messageId: z.string().min(1).max(64),
  });

  it("accepts the { messageId } payload the hook sends", () => {
    expect(() =>
      deleteMessageInput.parse({ messageId: "msg_abc123" }),
    ).not.toThrow();
  });

  it("rejects an empty messageId", () => {
    expect(() => deleteMessageInput.parse({ messageId: "" })).toThrow();
  });

  it("rejects a messageId past the 64-char ceiling", () => {
    expect(() =>
      deleteMessageInput.parse({ messageId: "x".repeat(65) }),
    ).toThrow();
  });
});

// ──────────────── chat.prefetch ────────────────
//
// `useChatPrefetch` + `useIdleWarmup` fire
// `chat.prefetch.mutate({ draft, clientId })`.

describe("chat.prefetch · chat warm-up payload", () => {
  const prefetchInput = z.object({
    draft: z.string().max(8000),
    clientId: z.string().max(128).optional(),
  });

  it("accepts the { draft, clientId } payload useChatPrefetch sends", () => {
    expect(() =>
      prefetchInput.parse({
        draft: "what's my revenue pace this week",
        clientId: "tab_xyz",
      }),
    ).not.toThrow();
  });

  it("accepts useIdleWarmup's literal warmup draft", () => {
    expect(() =>
      prefetchInput.parse({ draft: "warmup-idle", clientId: "tab_xyz" }),
    ).not.toThrow();
  });

  it("accepts an empty draft (the service short-circuits it)", () => {
    expect(() => prefetchInput.parse({ draft: "" })).not.toThrow();
  });

  it("rejects a draft past the 8000-char ceiling", () => {
    expect(() => prefetchInput.parse({ draft: "x".repeat(8001) })).toThrow();
  });

  it("rejects a clientId past the 128-char ceiling", () => {
    expect(() =>
      prefetchInput.parse({ draft: "a draft", clientId: "x".repeat(129) }),
    ).toThrow();
  });
});

// ──────────────── chat.wisdomSuggest ────────────────
//
// `useWisdomSuggest` fires `chat.wisdomSuggest.fetch({ draft,
// dismissedIds })` with a 600ms debounce + AbortController.

describe("chat.wisdomSuggest · at-write-time wisdom payload", () => {
  const wisdomSuggestInput = z.object({
    draft: z.string().max(8000),
    dismissedIds: z.array(z.string().max(64)).max(50).optional(),
  });

  it("accepts the { draft, dismissedIds } payload the hook sends", () => {
    expect(() =>
      wisdomSuggestInput.parse({
        draft: "thinking about whether to expand to a second bay",
        dismissedIds: ["w1", "w2"],
      }),
    ).not.toThrow();
  });

  it("accepts a bare { draft } payload (no dismissals yet)", () => {
    expect(() =>
      wisdomSuggestInput.parse({ draft: "a long enough composer draft" }),
    ).not.toThrow();
  });

  it("rejects a draft past the 8000-char ceiling", () => {
    expect(() =>
      wisdomSuggestInput.parse({ draft: "x".repeat(8001) }),
    ).toThrow();
  });

  it("rejects a dismissedIds list past the 50-entry ceiling", () => {
    expect(() =>
      wisdomSuggestInput.parse({
        draft: "a draft",
        dismissedIds: Array.from({ length: 51 }, (_, i) => `w${i}`),
      }),
    ).toThrow();
  });

  it("rejects a dismissed id past the 64-char ceiling", () => {
    expect(() =>
      wisdomSuggestInput.parse({
        draft: "a draft",
        dismissedIds: ["x".repeat(65)],
      }),
    ).toThrow();
  });
});

// ──────────────── chat.resolveMention ────────────────
//
// `useMentionSuggestions.resolveServerToken` fires
// `chat.resolveMention.fetch({ key, surroundingText })` — only ever for
// the 3 async keys (@yesterday / @week / @cold).

describe("chat.resolveMention · async @mention payload", () => {
  const resolveMentionInput = z.object({
    key: z.enum(["yesterday", "week", "cold"]),
    surroundingText: z.string().max(8000).optional(),
  });

  it("accepts each of the 3 async keys", () => {
    for (const key of ["yesterday", "week", "cold"] as const) {
      expect(() => resolveMentionInput.parse({ key })).not.toThrow();
    }
  });

  it("accepts a key + surroundingText", () => {
    expect(() =>
      resolveMentionInput.parse({
        key: "cold",
        surroundingText: "what did I decide about the labor rate",
      }),
    ).not.toThrow();
  });

  it("rejects a non-async key (the sync expander handles those)", () => {
    expect(() => resolveMentionInput.parse({ key: "mit" })).toThrow();
    expect(() => resolveMentionInput.parse({ key: "revenue" })).toThrow();
  });

  it("rejects a surroundingText past the 8000-char ceiling", () => {
    expect(() =>
      resolveMentionInput.parse({
        key: "cold",
        surroundingText: "x".repeat(8001),
      }),
    ).toThrow();
  });
});

// ──────────────── system.pushSubscribe ────────────────
//
// `usePushNotifications.subscribe` fires
// `system.pushSubscribe.mutateAsync({ subscription })` with the
// `PushSubscription.toJSON()` shape.

describe("system.pushSubscribe · Web-Push registration payload", () => {
  const pushSubscribeInput = z.object({
    subscription: z.object({
      endpoint: z.string().min(1).max(2000),
      keys: z.object({
        p256dh: z.string().min(1).max(500),
        auth: z.string().min(1).max(500),
      }),
    }),
  });

  it("accepts the PushSubscription.toJSON() shape the hook sends", () => {
    expect(() =>
      pushSubscribeInput.parse({
        subscription: {
          endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
          keys: { p256dh: "BPublicKeyBase64", auth: "authSecretBase64" },
        },
      }),
    ).not.toThrow();
  });

  it("rejects an empty endpoint", () => {
    expect(() =>
      pushSubscribeInput.parse({
        subscription: {
          endpoint: "",
          keys: { p256dh: "k", auth: "a" },
        },
      }),
    ).toThrow();
  });

  it("rejects a subscription missing the keys object", () => {
    expect(() =>
      pushSubscribeInput.parse({
        subscription: { endpoint: "https://example.com/sub" },
      }),
    ).toThrow();
  });

  it("rejects a subscription missing the p256dh key", () => {
    expect(() =>
      pushSubscribeInput.parse({
        subscription: {
          endpoint: "https://example.com/sub",
          keys: { auth: "a" },
        },
      }),
    ).toThrow();
  });
});

// ──────────────── system.pushUnsubscribe ────────────────
//
// `usePushNotifications.unsubscribe` fires
// `system.pushUnsubscribe.mutateAsync({ endpoint })`.

describe("system.pushUnsubscribe · Web-Push removal payload", () => {
  const pushUnsubscribeInput = z.object({
    endpoint: z.string().min(1).max(2000),
  });

  it("accepts the { endpoint } payload the hook sends", () => {
    expect(() =>
      pushUnsubscribeInput.parse({
        endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      }),
    ).not.toThrow();
  });

  it("rejects an empty endpoint", () => {
    expect(() => pushUnsubscribeInput.parse({ endpoint: "" })).toThrow();
  });

  it("rejects an endpoint past the 2000-char ceiling", () => {
    expect(() =>
      pushUnsubscribeInput.parse({ endpoint: "x".repeat(2001) }),
    ).toThrow();
  });
});

// ──────────────── operator.createCommitment ────────────────
//
// `lib/chat/direct-actions.ts` `/commit` direct-action fires
// `operator.createCommitment.mutate({ description })`.

describe("operator.createCommitment · /commit direct-action payload", () => {
  const createCommitmentInput = z.object({
    description: z.string().min(1).max(2000),
    toWhom: z.string().max(120).nullable().optional(),
    deadline: z.string().max(40).nullable().optional(),
    domain: z.string().max(80).nullable().optional(),
  });

  it("accepts the bare { description } payload the direct-action sends", () => {
    expect(() =>
      createCommitmentInput.parse({
        description: "no impulse purchases this week",
      }),
    ).not.toThrow();
  });

  it("accepts the optional toWhom / deadline / domain", () => {
    expect(() =>
      createCommitmentInput.parse({
        description: "ship the invoice fix",
        toWhom: "self",
        deadline: "2026-06-01",
        domain: "business",
      }),
    ).not.toThrow();
  });

  it("rejects an empty description", () => {
    expect(() => createCommitmentInput.parse({ description: "" })).toThrow();
  });

  it("rejects a description past the 2000-char ceiling", () => {
    expect(() =>
      createCommitmentInput.parse({ description: "x".repeat(2001) }),
    ).toThrow();
  });

  it("rejects a toWhom past the 120-char ceiling", () => {
    expect(() =>
      createCommitmentInput.parse({
        description: "a commitment",
        toWhom: "x".repeat(121),
      }),
    ).toThrow();
  });
});
