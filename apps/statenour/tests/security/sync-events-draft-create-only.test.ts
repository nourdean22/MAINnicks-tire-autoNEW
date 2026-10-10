/**
 * tests/security/sync-events-draft-create-only.test.ts · audit 2026-10-10 SN-01 (2).
 *
 * `nickstire:social_draft:sync` on /api/sync/events used to upsert on
 * `data.id` with whatever `status` the caller sent. Any holder of the bridge
 * key could therefore create a row already `approved` / `scheduled` (claimable
 * by the publish worker; `approved` reels are claimed by the render lane) or
 * overwrite a row the operator had approved, scheduled, or already published.
 *
 * Contract locked here:
 *   1. A bridge event can never put a row INTO an actionable state: approved,
 *      scheduled, rendering (or any unknown status) land as `pending`.
 *   2. An event for an existing row that is not `pending` leaves it untouched
 *      and reports `ignored: "row not pending"`. The check is in the write's
 *      own WHERE, not a read-then-write.
 *   3. Terminal statuses nickstire really sends stay as sent: `published`
 *      (apps/nickstire/server/routers/content.ts reel/carousel post logs,
 *      routers/gbp.ts GBP posts all mirror ALREADY-LIVE posts) and `rejected`.
 *      Forcing those to `pending` would put a live post back in the queue as
 *      publishable, one tap from a duplicate post.
 *
 * The store is an in-memory fake that honours the upsert WHERE the way Prisma
 * does with a non-unique filter: a matching row is updated, a missing row is
 * created, and an existing row the filter excludes makes the create collide
 * on the primary key (P2002).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { id: string; status: string; content: string };
type Where = { id: string; status?: string };

const { rows, upsert } = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown> & { id: string; status: string; content: string }>();
  const upsert = vi.fn(async ({ where, create, update }: { where: { id: string; status?: string }; create: any; update: any }) => {
    const existing = rows.get(where.id);
    const matches = existing && (where.status === undefined || existing.status === where.status);
    if (existing && matches) {
      const next = { ...existing, ...update };
      rows.set(where.id, next);
      return next;
    }
    if (existing) {
      throw Object.assign(new Error("Unique constraint failed on the fields: (`id`)"), { code: "P2002" });
    }
    rows.set(where.id, { ...create });
    return create;
  });
  return { rows, upsert };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialPublishQueue: { upsert },
    auditEvent: { create: vi.fn(async () => ({ id: "aud_1" })), findMany: vi.fn(async () => []) },
    apiRequestLog: { create: vi.fn(async () => ({})) },
    errorLog: { create: vi.fn(async () => ({})) },
  },
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn().mockReturnValue(0),
}));
vi.mock("@/lib/auth-guard", () => ({
  requireSyncAuth: vi.fn(),
  requireCronAuth: vi.fn(),
  requireEvidenceAuth: vi.fn(),
  requireSession: vi.fn(async () => ({ user: "operator" })),
}));
vi.mock("@/lib/services/coach-events", () => ({ recordCoachEvent: vi.fn(async () => null) }));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitDriftFired: vi.fn() }));
vi.mock("@/lib/brain/pipeline-controller", () => ({ processShopEvent: vi.fn(async () => ({})) }));

import { POST } from "@/app/api/sync/events/route";

function draftEvent(data: Record<string, unknown>) {
  return { type: "nickstire:social_draft:sync", timestamp: "2026-10-10T12:00:00.000Z", source: "nickstire", data };
}

async function send(data: Record<string, unknown>) {
  const res = await POST(
    new Request("http://test.invalid/api/sync/events", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify(draftEvent(data)),
    }),
    {} as never,
  );
  return { status: res.status, body: (await res.json()) as any };
}

function seed(row: Row) {
  rows.set(row.id, { ...row });
}

beforeEach(() => {
  rows.clear();
  upsert.mockClear();
});

describe("social_draft:sync · positive control", () => {
  it("a new pending draft is created as pending", async () => {
    const r = await send({ id: "d1", content: "hello", status: "pending", platforms: ["instagram"] });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(rows.get("d1")).toMatchObject({ id: "d1", content: "hello", status: "pending" });
    expect(r.body.data.results[0]).not.toHaveProperty("ignored");
  });

  it("an existing PENDING row is updated (latest-wins edit still lands)", async () => {
    seed({ id: "d2", content: "old", status: "pending" });
    const r = await send({ id: "d2", content: "new", status: "pending" });
    expect(r.status).toBe(200);
    expect(rows.get("d2")).toMatchObject({ content: "new", status: "pending" });
  });
});

describe("social_draft:sync · the bridge key cannot make a row actionable", () => {
  it.each(["approved", "scheduled", "rendering", "live-now"])("a new draft sent as %s is created as pending", async (status) => {
    await send({ id: `new-${status}`, content: "x", status });
    expect(rows.get(`new-${status}`)?.status).toBe("pending");
  });

  it("an existing pending row sent as approved stays pending", async () => {
    seed({ id: "d3", content: "old", status: "pending" });
    await send({ id: "d3", content: "edited", status: "approved" });
    expect(rows.get("d3")).toMatchObject({ content: "edited", status: "pending" });
  });

  it("the not-pending guard is in the write's own WHERE, not a separate read", async () => {
    await send({ id: "d4", content: "x", status: "pending" });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].where).toEqual({ id: "d4", status: "pending" });
  });
});

describe("social_draft:sync · rows past pending are never touched", () => {
  it.each(["approved", "scheduled", "rendering", "published", "rejected"])(
    "an existing %s row keeps its content and status; the event reports ignored",
    async (status) => {
      seed({ id: "p1", content: "operator-approved copy", status, platforms: ["instagram"] });
      const r = await send({ id: "p1", content: "overwrite attempt", status: "pending", platforms: ["gbp"] });
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.data.results[0]).toMatchObject({ type: "nickstire:social_draft:sync", ignored: "row not pending" });
      expect(rows.get("p1")).toEqual({ id: "p1", content: "operator-approved copy", status, platforms: ["instagram"] });
    },
  );
});

describe("social_draft:sync · nickstire's terminal mirrors keep their status", () => {
  it("a post nickstire already published is recorded as published, not re-queued as pending", async () => {
    await send({ id: "reel-winter-tires", content: "posted", status: "published", publishedAt: "2026-10-10T11:00:00.000Z" });
    expect(rows.get("reel-winter-tires")?.status).toBe("published");
  });

  it("a rejected draft stays rejected", async () => {
    await send({ id: "d5", content: "nope", status: "rejected" });
    expect(rows.get("d5")?.status).toBe("rejected");
  });
});
