/**
 * render-complete is bound to the caller's own lease (review of #2984, P2).
 *
 * A render that outlives its 30-minute lease can be reclaimed: GET /render gives
 * the row to another worker with a NEW renderLeaseExpiresAt. The old check only
 * asked "is some lease held", so the stale worker could still complete the row
 * (publishing its output and clearing the current worker's lease) and the
 * current worker then got the 409. The worker now echoes the lease it was given.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = { id: string; status: string; deletedAt: Date | null; renderLeaseExpiresAt: Date | null; scheduledFor: Date | null; imageUrl: string | null };
const store = vi.hoisted(() => ({ row: null as null | Record<string, unknown> }));

// In-memory row; the where clause is honoured field by field (Dates by time, {not:null}).
function holds(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, cond]) => {
    const v = (row as Record<string, unknown>)[k] ?? null;
    if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
    if (cond && typeof cond === "object" && "not" in (cond as object)) return v !== null;
    return v === cond;
  });
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialPublishQueue: {
      findUnique: async () => (store.row ? { ...store.row } : null),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = store.row as Row | null;
        if (!row || !holds(row, where)) return { count: 0 };
        store.row = { ...row, ...data };
        return { count: 1 };
      },
    },
  },
  resetQueryCount: () => {},
  getQueryCount: () => 0,
}));

import { POST } from "@/app/api/sync/queue/render-complete/route";

const CURRENT = new Date("2026-10-11T12:30:00.000Z");
const STALE = new Date("2026-10-11T12:00:00.000Z");

const post = (body: Record<string, unknown>) =>
  POST(new Request("http://x.test/api/sync/queue/render-complete", { method: "POST", body: JSON.stringify(body) }) as never, {} as never);

async function status(res: Response): Promise<number> {
  return res.status;
}

beforeEach(() => {
  store.row = { id: "q1", status: "rendering", deletedAt: null, renderLeaseExpiresAt: CURRENT, scheduledFor: null, imageUrl: null };
});

describe("render-complete is bound to the caller's lease", () => {
  it("the current lease holder completes the row", async () => {
    const res = await post({ id: "q1", videoUrl: "https://cdn/v.mp4", leaseExpiresAt: CURRENT.toISOString() });
    expect(await status(res)).toBe(200);
    expect(store.row).toMatchObject({ status: "approved", imageUrl: "https://cdn/v.mp4", renderLeaseExpiresAt: null });
  });

  it("a stale worker (an older lease) gets 409 and changes nothing", async () => {
    const res = await post({ id: "q1", videoUrl: "https://cdn/stale.mp4", leaseExpiresAt: STALE.toISOString() });
    expect(await status(res)).toBe(409);
    expect(store.row).toMatchObject({ status: "rendering", imageUrl: null, renderLeaseExpiresAt: CURRENT });
  });

  it("an unparseable lease is refused and changes nothing", async () => {
    const res = await post({ id: "q1", videoUrl: "https://cdn/v.mp4", leaseExpiresAt: "not-a-date" });
    expect(await res.json()).toMatchObject({ data: { ok: false } });
    expect(store.row).toMatchObject({ status: "rendering", imageUrl: null });
  });

  it("rollout: a worker that sends no lease still completes a leased row", async () => {
    const res = await post({ id: "q1", videoUrl: "https://cdn/v.mp4" });
    expect(await status(res)).toBe(200);
    expect(store.row).toMatchObject({ status: "approved" });
  });
});
