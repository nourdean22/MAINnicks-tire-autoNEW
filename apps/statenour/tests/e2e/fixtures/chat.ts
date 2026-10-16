/**
 * DEMO fixtures for Chat (/chat), shaped like the real tRPC outputs (UI v3
 * Wave 3a). Typed against the routers' own output types, so a contract change
 * breaks `tsc` here (a failing type is a fixture bug, not something to cast away).
 *
 * The reads /chat makes on load:
 *   system.providerHealth, system.toolsHealth  the header pill (chat-capability-indicator.tsx)
 *   chat.list                                  the conversation list (hooks/use-conversations.ts)
 *   chat.conversation                          the seeded conversation's messages, read when the
 *                                              operator picks it in the History drawer
 *   operator.mit                               the composer's @mit mention (hooks/use-mention-suggestions.ts)
 * plus one REST probe, GET /api/ai/chat/none/stream, answered with a 204 in ./index.ts (REST_NO_CONTENT).
 *
 * /chat does NOT open a conversation on its own ("no auto-resume, user picks from
 * history", use-conversations.ts), so the six-feet render opens the drawer with
 * ?h=1 and taps the seeded row (vt-render.ts openChatHistory). The seeded
 * conversation is one user turn and one assistant turn that ran one tool, so the
 * list renders both bubbles and the receipt line.
 *
 * Both health reads are in the MEASURED shape: the pill says "ready", not
 * "checking capabilities" and not "AI health unknown" (capability-label.ts).
 */
import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@/lib/trpc/root";

import { SHELL_PULSE } from "./shell";
import { FIXED_TIME, NOW_MS } from "./time";

type RouterOutputs = inferRouterOutputs<AppRouter>;

/** Wire timestamps are ISO strings; ages are measured back from the pinned clock, never the real one. */
const minutesAgo = (minutes: number): string => new Date(NOW_MS - minutes * 60_000).toISOString();

/** The title of the one seeded conversation: the History drawer row the render taps. */
export const CHAT_TITLE = "Demo chat: the demo supplier quote";
/** Nick's reply. Exists only in these fixtures (tests/repo/v3-gate.test.ts greps the app source for it). */
export const CHAT_REPLY = "Demo reply: the demo supplier quote is drafted and waits on one approval. Sending it frees the demo order behind it.";
const CHAT_QUESTION = "Demo question: where does the demo supplier quote stand?";

const CONVERSATION_ID = "demo-conv-1";

/**
 * operator.mit, read by the composer's @mit mention hook on mount. The same MIT the shell's pulse strip
 * shows (SHELL_PULSE), keyed by the ET day of the pinned clock (FIXED_TIME is written in ET).
 */
export const CHAT_MIT: RouterOutputs["operator"]["mit"] = {
  key: FIXED_TIME.slice(0, 10),
  text: SHELL_PULSE.items.find((i) => i.kind === "mit")?.text ?? null,
  updatedAt: minutesAgo(240),
};

export const CHAT_PROVIDER_HEALTH: RouterOutputs["system"]["providerHealth"] = {
  generatedAt: minutesAgo(0),
  providers: [
    {
      name: "ollama",
      configured: true,
      available: true,
      modelId: "demo-model",
      quotaExhausted: false,
      quotaCooldownRemainingMs: 0,
      toolsSupported: true,
      recentCalls: 12,
      recentErrors: 0,
      errorRate: 0,
      avgLatencyMs: 900,
    },
  ],
  rateLimit: { activeKeys: 0, warm: true, buckets: [] },
  overallTone: "green",
  pillLabel: "all providers healthy",
};

export const CHAT_TOOLS_HEALTH: RouterOutputs["system"]["toolsHealth"] = {
  timestamp: minutesAgo(0),
  summary: { totalTools: 12, totalCategories: 1, ok: 1, degraded: 0, down: 0, overallStatus: "operational" },
  dependencies: {
    database: { status: "ok", detail: "Demo fixture: 12ms latency", checked: ["demo-probe"] },
  },
  categories: {
    personal_read: { tools: 12, deps: ["database"], status: "ok" },
  },
};

export const CHAT_LIST: RouterOutputs["chat"]["list"] = {
  conversations: [
    {
      id: CONVERSATION_ID,
      title: CHAT_TITLE,
      createdAt: minutesAgo(130),
      updatedAt: minutesAgo(120),
      starredAt: null,
      mutedAt: null,
      _count: { messages: 2 },
    },
  ],
  hasMore: false,
  nextCursor: null,
};

type ConversationMessage = RouterOutputs["chat"]["conversation"]["messages"][number];

/** Every field the router sends, null where the demo has nothing to claim (no model, no cost, no latency). */
function message(id: string, role: "user" | "assistant", content: string, parts: unknown[], createdAt: string): ConversationMessage {
  return {
    id,
    role,
    content,
    model: null,
    attachments: null,
    parts,
    clientMessageId: null,
    parentMessageId: null,
    branchId: null,
    editedAt: null,
    editHistory: null,
    streamingState: "complete",
    errorDetails: null,
    provider: null,
    routerReason: null,
    latencyMs: null,
    firstTokenLatencyMs: null,
    costCents: null,
    promptTokens: null,
    completionTokens: null,
    feedbackScore: null,
    tokenUsage: null,
    createdAt,
  };
}

/**
 * One tool call that returned data. The assistant turn needs a tool part for the
 * receipt chip to mount at all (ToolReceiptSummary renders null without tool
 * parts or a live trace id), and the chip's honest line for it is
 * "Tool calls: 1 returned data".
 */
const SEARCH_PART = {
  type: "tool-searchMemories",
  toolCallId: "demo-call-1",
  state: "output-available",
  input: { query: "demo supplier quote" },
  output: { count: 1, results: [{ content: "Demo memory: the demo supplier quote waits on one approval" }] },
};

export const CHAT_CONVERSATION: RouterOutputs["chat"]["conversation"] = {
  id: CONVERSATION_ID,
  title: CHAT_TITLE,
  createdAt: minutesAgo(130),
  updatedAt: minutesAgo(120),
  pinnedSummary: null,
  topicTags: null,
  archivedAt: null,
  starredAt: null,
  mutedAt: null,
  lastActiveAt: minutesAgo(120),
  messageCount: 2,
  messages: [
    message("demo-msg-1", "user", CHAT_QUESTION, [{ type: "text", text: CHAT_QUESTION }], minutesAgo(125)),
    message("demo-msg-2", "assistant", CHAT_REPLY, [SEARCH_PART, { type: "text", text: CHAT_REPLY }], minutesAgo(124)),
  ],
};
