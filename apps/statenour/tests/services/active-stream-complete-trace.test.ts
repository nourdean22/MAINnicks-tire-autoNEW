/**
 * tests/services/active-stream-complete-trace.test.ts · round 3 review (Codex P2), 2026-10-25.
 *
 * The chat route's 500 path closes the registry row (a buffered lane registered the turn before
 * generating). That close was keyed by conversation only and fire-and-forget, so an immediate
 * retry that registered a NEW turn for the same conversation could have its row marked complete
 * by the old turn's late cleanup: reconnects to the retry would stop waiting and 204.
 *
 * Pinned against a small stateful store: a close named for turn T1 never closes T2's row, even
 * when T2 registers between the close's read and its write (claim-before-act: the write is a
 * compare-and-swap on the trace the decision read).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = { id: string; category: string; key: string; metadata: Record<string, unknown>; expiresAt: Date; deletedAt: null };
const store = new Map<string, Row>();
let afterRead: (() => void) | null = null;
const keyOf = (w: { category_key: { category: string; key: string } }) => `${w.category_key.category}|${w.category_key.key}`;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      upsert: async (a: { where: { category_key: { category: string; key: string } }; create: Row; update: Partial<Row> }) => {
        const k = keyOf(a.where);
        const cur = store.get(k);
        store.set(k, cur ? { ...cur, ...a.update } as Row : { ...a.create, id: `row-${store.size + 1}`, deletedAt: null });
        return {};
      },
      findUnique: async (a: { where: { category_key: { category: string; key: string } } }) => {
        const row = store.get(keyOf(a.where));
        const snapshot = row ? { ...row, metadata: { ...row.metadata } } : null;
        const hook = afterRead;
        afterRead = null;
        hook?.(); // a racer acts between this read and the caller's write
        return snapshot;
      },
      update: async (a: { where: { id: string }; data: Partial<Row> }) => {
        for (const [k, r] of store) if (r.id === a.where.id) store.set(k, { ...r, ...a.data } as Row);
        return {};
      },
      updateMany: async (a: { where: { id: string; metadata?: { path: string[]; equals: unknown } }; data: Partial<Row> }) => {
        let count = 0;
        for (const [k, r] of store) {
          if (r.id !== a.where.id) continue;
          const pin = a.where.metadata;
          if (pin && r.metadata[pin.path[0]] !== pin.equals) continue;
          store.set(k, { ...r, ...a.data } as Row);
          count += 1;
        }
        return { count };
      },
    },
  },
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { registerActiveStream, completeActiveStream, getActiveStream } from "@/lib/services/chat/active-stream";

beforeEach(() => {
  store.clear();
  afterRead = null;
});

describe("closing a failed turn's registry row", () => {
  it("a close named for T1 after T2 registered leaves T2's row active", async () => {
    await registerActiveStream("c1", "T1");
    await registerActiveStream("c1", "T2"); // the retry
    await completeActiveStream("c1", { traceId: "T1" });
    expect(await getActiveStream("c1")).toMatchObject({ status: "active", traceId: "T2" });
  });

  it("T2 registering between the close's read and its write still wins", async () => {
    await registerActiveStream("c1", "T1");
    afterRead = () => {
      void registerActiveStream("c1", "T2");
    };
    await completeActiveStream("c1", { traceId: "T1" });
    expect(await getActiveStream("c1")).toMatchObject({ status: "active", traceId: "T2" });
  });

  it("CONTROL: the close named for the row's own turn closes it", async () => {
    await registerActiveStream("c1", "T1");
    await completeActiveStream("c1", { traceId: "T1" });
    expect(await getActiveStream("c1")).toMatchObject({ status: "complete", traceId: "T1" });
  });
});
