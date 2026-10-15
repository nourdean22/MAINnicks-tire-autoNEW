/**
 * Interceptor fast paths (/save, logged decision, brain dump, /img, F5 commands, strict/chill) save
 * their user row through ensureConvAndPersistUser. That row used to carry no client_message_id, so the
 * turn guard (which finds a turn by that id) saw "no user row" the moment the lease ended, and a
 * re-send fired the write again: a second MasteryDecision, a second paid image, a second conversation
 * for a first send (adversarial review of #3060, four lenses, 2026-10-15).
 *
 * Drives the REAL fast-path writers and the REAL guardTurn over one in-memory chat_messages store. The
 * claim is stubbed to "free": the point is what is SAVED once the lease has ended.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  clientMessageId?: string | null;
  parentMessageId?: string | null;
  content?: string;
  parts?: unknown;
  streamingState?: string;
  tokenUsage?: unknown;
  createdAt: Date;
};

const h = vi.hoisted(() => ({ rows: [] as unknown[], seq: 0, clock: 0, conversations: 0 }));
const rows = () => h.rows as Row[];

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as Record<string, unknown>[]).some((w) => matches(row, w));
    const actual = (row as unknown as Record<string, unknown>)[k] ?? null;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      const o = v as { gt?: Date; gte?: Date; lt?: Date };
      const t = (actual as Date).getTime();
      return (o.gt === undefined || t > o.gt.getTime()) && (o.gte === undefined || t >= o.gte.getTime()) && (o.lt === undefined || t < o.lt.getTime());
    }
    return actual === v;
  });
}
const hits = (a: { where: Record<string, unknown>; orderBy?: { createdAt?: string } }) =>
  rows()
    .filter((r) => matches(r, a.where))
    .sort((x, y) => (a.orderBy?.createdAt === "desc" ? -1 : 1) * (x.createdAt.getTime() - y.createdAt.getTime()));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatConversation: {
      create: async () => ({ id: `conv-new-${++h.conversations}` }),
      update: async () => ({}),
    },
    chatMessage: {
      create: async (a: { data: Omit<Row, "id" | "createdAt"> }) => {
        const row = { ...a.data, id: `row-${++h.seq}`, createdAt: new Date(1_000 + ++h.clock * 10) } as Row;
        rows().push(row);
        return { id: row.id };
      },
      findFirst: async (a: { where: Record<string, unknown>; orderBy?: { createdAt?: string } }) => {
        const hit = hits(a)[0];
        return hit ? { ...hit } : null;
      },
      findMany: async (a: { where: Record<string, unknown>; orderBy?: { createdAt?: string } }) => hits(a).map((r) => ({ ...r })),
    },
  },
}));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/services/chat/turn-claim", () => ({
  claimTurn: vi.fn(async (input: { traceId: string }) => ({
    kind: "claimed",
    claim: { traceId: input.traceId, setConversation: vi.fn(), settleWith: vi.fn(), finish: vi.fn(), holdWhileBodyOpen: (r: Response) => r },
  })),
}));

import { buildFastStream, ensureConvAndPersistUser } from "@/lib/ai/chat/handlers/shared";
import { guardTurn } from "@/lib/services/chat/turn-guard";

const send = (convId: string | undefined, id: string | undefined, text = "log this decision: move the swap queue") =>
  ensureConvAndPersistUser(convId, text, { id, role: "user" } as never);

const guard = (over: Partial<Parameters<typeof guardTurn>[0]> = {}) =>
  guardTurn({
    lastMessage: { id: "m-dec-1", role: "user" },
    conversationId: "conv-1",
    trigger: "submit-message",
    traceId: "T-replay",
    transcriptOff: false,
    ...over,
  });

const userRows = () => rows().filter((r) => r.role === "user");

beforeEach(() => {
  h.rows = [];
  h.seq = 0;
  h.clock = 0;
  h.conversations = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("a fast-path user row names its message", () => {
  it("carries the id the client minted, so the guard can find it", async () => {
    await send("conv-1", "m-dec-1");
    expect(userRows()).toHaveLength(1);
    expect(userRows()[0]).toMatchObject({ conversationId: "conv-1", clientMessageId: "m-dec-1" });
  });

  it("CONTROL - a message with no id is saved as before, with no client id", async () => {
    await send("conv-1", undefined);
    expect(userRows()).toHaveLength(1);
    expect(userRows()[0].clientMessageId ?? null).toBeNull();
  });

  it("the same message arriving twice saves one user row", async () => {
    await send("conv-1", "m-dec-1");
    await send("conv-1", "m-dec-1");
    expect(userRows()).toHaveLength(1);
  });

  it("a new thread's first message gets the id on the row it creates", async () => {
    const convId = await send(undefined, "m-dec-1");
    expect(convId).toBe("conv-new-1");
    expect(userRows()[0]).toMatchObject({ conversationId: "conv-new-1", clientMessageId: "m-dec-1" });
  });
});

describe("after the lease has ended, a re-send of a finished fast-path turn is refused", () => {
  it.each(["submit-message", "regenerate-message"])("%s: the guard finds the turn and does not run it again", async (trigger) => {
    await send("conv-1", "m-dec-1");
    await buildFastStream("conv-1", "Decision logged.", "dec", "nl-decision");

    const result = await guard({ trigger });

    expect(result.kind).toBe("refuse");
    if (result.kind === "refuse") {
      expect(result.response.status).toBe(409);
      expect((await result.response.clone().json()).code).toBe(trigger === "submit-message" ? "turn_answered" : "turn_ran");
    }
  });

  it("a first-send replay (no thread id) is found by the minted id and told the thread the first run created", async () => {
    const convId = await send(undefined, "m-dec-1");
    await buildFastStream(convId, "Decision logged.", "dec", "nl-decision");

    const result = await guard({ conversationId: undefined, trigger: "regenerate-message" });

    expect(result.kind).toBe("refuse");
    if (result.kind === "refuse") expect(result.response.headers.get("X-Conversation-Id")).toBe(convId);
  });

  it("a fast-path run that died before its reply is answered, in the thread it created", async () => {
    const convId = await send(undefined, "m-dec-1");

    const result = await guard({ conversationId: undefined, trigger: "regenerate-message" });

    expect(result).toMatchObject({ kind: "run", conversationId: convId });
  });
});
