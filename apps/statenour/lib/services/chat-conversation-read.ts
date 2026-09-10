/**
 * lib/services/chat-conversation-read.ts · hooks-lib REST→tRPC slice
 * (2026-05-22)
 *
 * Conversation-list + single-conversation READ + title-rename services
 * · extracted from the inline route handlers (`GET /api/ai/chat`,
 * `GET /api/ai/chat/[id]`, `PATCH /api/ai/chat/[id]`) so the legacy
 * REST endpoints AND the new `chat.{list,conversation,renameConversation}`
 * tRPC procedures both call these single functions · drift between the
 * two consumers is structurally impossible.
 *
 * THE TS2589 FIREWALL · `ConversationDetail.messages[]` carries the
 * BrainMemory-adjacent `parts` / `attachments` / `editHistory` /
 * `errorDetails` / `tokenUsage` Prisma `Json` columns. Returning the
 * raw `findUnique` row leaks Prisma's recursive `JsonValue` machinery
 * into the AppRouter type. The `LoadedMessage` interface below projects
 * every Json column to `unknown`; the read function casts the rows to
 * it so the deep instantiation is contained to this file. The
 * use-conversations hook re-derives its own `LoadedConvoMessage` shape
 * regardless — exactly as it did with the untyped `authedFetch` JSON.
 *
 * DATE WIRE FORMAT · the tRPC clients use a plain `httpBatchLink` with
 * NO superjson transformer, so a `Date` field would arrive as a string
 * at runtime while TypeScript still typed it `Date` — a silent lie.
 * Every Date column is therefore projected to an ISO string inside the
 * read functions (matching the legacy JSON shape `r.json()` produced).
 */

import { prisma } from "@/lib/prisma";
import { stripVerifierBanner } from "@/lib/ai/chat/fabrication-rewriter";

/** A conversation-list row · matches the legacy `/api/ai/chat` shape. */

/**
 * Strip the verifier banner out of a persisted `parts` tree.
 *
 * Conservative by construction: only `{ type: "text" }` nodes are
 * touched, only their `text` field changes, and any non-array or
 * unexpected shape is returned untouched. A read projection that
 * reshapes messages on a bad guess is worse than one that leaves a
 * banner visible.
 */
export function stripVerifierBannerFromParts(parts: unknown): unknown {
  if (!Array.isArray(parts)) return parts;
  let changed = false;
  const next = parts.map((part) => {
    if (
      part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      const original = (part as { text: string }).text;
      const stripped = stripVerifierBanner(original);
      if (stripped !== original) {
        changed = true;
        return { ...(part as Record<string, unknown>), text: stripped };
      }
    }
    return part;
  });
  // Preserve referential identity when nothing was rewritten.
  return changed ? next : parts;
}

export interface ConversationListRow {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  starredAt: string | null;
  mutedAt: string | null;
  _count: { messages: number };
}

export interface ConversationListResult {
  conversations: ConversationListRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * Flat message shape · every Prisma `Json` column (`parts`,
 * `attachments`, `editHistory`, `errorDetails`, `tokenUsage`) projected
 * to `unknown` so the recursive `JsonValue` type never reaches the
 * AppRouter — the TS2589 firewall.
 */
export interface LoadedMessage {
  id: string;
  role: string;
  content: string;
  model: string | null;
  attachments: unknown;
  parts: unknown;
  clientMessageId: string | null;
  parentMessageId: string | null;
  branchId: string | null;
  editedAt: string | null;
  editHistory: unknown;
  streamingState: string | null;
  errorDetails: unknown;
  provider: string | null;
  routerReason: string | null;
  latencyMs: number | null;
  firstTokenLatencyMs: number | null;
  costCents: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  feedbackScore: number | null;
  tokenUsage: unknown;
  createdAt: string;
}

export interface ConversationDetail {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  pinnedSummary: string | null;
  /** ChatConversation.topicTags is a Prisma `Json?` column · `unknown`
   *  keeps the recursive `JsonValue` type out of the AppRouter. */
  topicTags: unknown;
  archivedAt: string | null;
  starredAt: string | null;
  mutedAt: string | null;
  lastActiveAt: string | null;
  messageCount: number;
  messages: LoadedMessage[];
}

/** Thrown when a conversation id doesn't resolve. */
export class ConversationNotFoundError extends Error {
  constructor(message = "conversation not found") {
    super(message);
    this.name = "ConversationNotFoundError";
  }
}

/**
 * List recent (non-archived) conversations, newest-first, with cursor
 * pagination. `take` clamps 1-200 (default 75). Peeks one extra row to
 * derive `hasMore` + `nextCursor`.
 */
export async function listConversations(args: {
  take?: number;
  cursor?: string;
}): Promise<ConversationListResult> {
  const requestedTake = args.take ?? 75;
  const take = Number.isFinite(requestedTake)
    ? Math.min(Math.max(requestedTake, 1), 200)
    : 75;
  const cursor = args.cursor || undefined;

  const fetched = await prisma.chatConversation.findMany({
    where: { archivedAt: null },
    orderBy: { updatedAt: "desc" },
    take: take + 1, // peek for hasMore
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      starredAt: true,
      mutedAt: true,
      _count: { select: { messages: true } },
    },
  });
  const hasMore = fetched.length > take;
  const sliced = hasMore ? fetched.slice(0, take) : fetched;
  const nextCursor =
    hasMore && sliced.length > 0 ? sliced[sliced.length - 1].id : null;

  // Project Date columns to ISO strings — see the file-level
  // DATE WIRE FORMAT note (no superjson transformer).
  const conversations: ConversationListRow[] = sliced.map((c) => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    starredAt: c.starredAt ? c.starredAt.toISOString() : null,
    mutedAt: c.mutedAt ? c.mutedAt.toISOString() : null,
    _count: c._count,
  }));

  return { conversations, hasMore, nextCursor };
}

/**
 * Read one conversation with its full message history (oldest-first).
 * Throws ConversationNotFoundError on a missing id.
 */
export async function readConversation(args: {
  id: string;
}): Promise<ConversationDetail> {
  const conversation = await prisma.chatConversation.findUnique({
    where: { id: args.id },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      pinnedSummary: true,
      topicTags: true,
      archivedAt: true,
      starredAt: true,
      mutedAt: true,
      lastActiveAt: true,
      messageCount: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          content: true,
          model: true,
          attachments: true,
          parts: true,
          clientMessageId: true,
          parentMessageId: true,
          branchId: true,
          editedAt: true,
          editHistory: true,
          streamingState: true,
          errorDetails: true,
          provider: true,
          routerReason: true,
          latencyMs: true,
          firstTokenLatencyMs: true,
          costCents: true,
          promptTokens: true,
          completionTokens: true,
          feedbackScore: true,
          tokenUsage: true,
          createdAt: true,
        },
      },
    },
  });

  if (!conversation) {
    throw new ConversationNotFoundError();
  }

  // Project every Date column to an ISO string (no superjson) + keep
  // the Json columns as `unknown` — the TS2589 firewall. The explicit
  // map (vs an `as` cast) makes both projections type-checked.
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    pinnedSummary: conversation.pinnedSummary,
    topicTags: conversation.topicTags,
    archivedAt: conversation.archivedAt
      ? conversation.archivedAt.toISOString()
      : null,
    starredAt: conversation.starredAt
      ? conversation.starredAt.toISOString()
      : null,
    mutedAt: conversation.mutedAt ? conversation.mutedAt.toISOString() : null,
    lastActiveAt: conversation.lastActiveAt
      ? conversation.lastActiveAt.toISOString()
      : null,
    messageCount: conversation.messageCount,
    messages: conversation.messages.map((m) => ({
      id: m.id,
      role: m.role,
      // 2026-09-10 · strip the verifier banner before the bubble renders
      // it. `stripVerifierBanner` has existed since 2026-07-11 with this
      // exact job -- its docstring says "the warning chip already
      // conveys the diagnostic visually" -- and had ZERO production
      // callers, so every rewritten turn shipped a raw system trace in
      // Nick's own voice. The banner stays in the persisted row for L3
      // and audits; the ActionClaimWarning chip carries the disclosure.
      content: stripVerifierBanner(m.content),
      model: m.model,
      attachments: m.attachments,
      // 2026-09-10 (review #2267 P2) · strip the banner from PARTS too.
      //
      // Stripping only `content` fixed almost nothing: the verifier
      // rewrite patches both fields (post-persist-verification.ts), and
      // hooks/use-conversations.ts:171-179 explicitly PREFERS the
      // persisted parts tree over `content`. So a normally-rewritten
      // message still hydrated and rendered the raw system trace, and
      // the content-only fix reached exactly the legacy rows that have
      // no parts -- i.e. the ones that needed it least.
      parts: stripVerifierBannerFromParts(m.parts),
      clientMessageId: m.clientMessageId,
      parentMessageId: m.parentMessageId,
      branchId: m.branchId,
      editedAt: m.editedAt ? m.editedAt.toISOString() : null,
      editHistory: m.editHistory,
      streamingState: m.streamingState,
      errorDetails: m.errorDetails,
      provider: m.provider,
      routerReason: m.routerReason,
      latencyMs: m.latencyMs,
      firstTokenLatencyMs: m.firstTokenLatencyMs,
      costCents: m.costCents,
      promptTokens: m.promptTokens,
      completionTokens: m.completionTokens,
      feedbackScore: m.feedbackScore,
      tokenUsage: m.tokenUsage,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

/**
 * Rename a conversation's title (sliced to 200 chars). Throws
 * ConversationNotFoundError on a missing id (Prisma P2025).
 */
export async function renameConversation(args: {
  id: string;
  title: string;
}): Promise<{ id: string; title: string | null }> {
  try {
    return await prisma.chatConversation.update({
      where: { id: args.id },
      data: { title: args.title.slice(0, 200) },
      select: { id: true, title: true },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") {
      throw new ConversationNotFoundError();
    }
    throw err;
  }
}
