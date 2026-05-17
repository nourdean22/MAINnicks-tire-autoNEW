/**
 * Inbox janitor smoke tests · v10.0.155
 *
 * The cron's logic is small enough (filter inboxes → check empty →
 * soft-delete) that the meaningful coverage is the predicate
 * isInboxMission(), which is already tested in
 * tests/lib/services/mission-helpers.test.ts.
 *
 * This file covers the orchestration: that the route handler is
 * reachable, returns the documented shape, and skips inboxes with
 * live tasks.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    mission: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    task: {
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));
vi.mock("@/lib/utils/http", () => ({
  cronHandler: (h: (req: Request, ctx: unknown) => Promise<unknown>) => h,
}));

// Import after mocks are set up so the route binds to them.
import { GET } from "@/app/api/cron/inbox-janitor/route";

const baseReq = new Request("http://test/api/cron/inbox-janitor");
const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cron/inbox-janitor", () => {
  it("returns archived=0 when no candidate missions exist", async () => {
    mockPrisma.mission.findMany.mockResolvedValueOnce([]);
    const r = (await (GET as unknown as (req: Request, ctx: unknown) => Promise<unknown>)(
      baseReq,
      ctx,
    )) as { archived: number; scanned: number; inboxes: number };
    expect(r.archived).toBe(0);
    expect(r.scanned).toBe(0);
    expect(r.inboxes).toBe(0);
  });

  it("ignores non-inbox missions even if they're cold + empty", async () => {
    mockPrisma.mission.findMany.mockResolvedValueOnce([
      { id: "real1", title: "rising dragon 2.0 projects", updatedAt: new Date() },
      { id: "real2", title: "home garage cave 1.0", updatedAt: new Date() },
    ]);
    const r = (await (GET as unknown as (req: Request, ctx: unknown) => Promise<unknown>)(
      baseReq,
      ctx,
    )) as { archived: number };
    expect(r.archived).toBe(0);
    expect(mockPrisma.task.count).not.toHaveBeenCalled();
    expect(mockPrisma.mission.update).not.toHaveBeenCalled();
  });

  it("archives an inbox with zero live tasks", async () => {
    mockPrisma.mission.findMany.mockResolvedValueOnce([
      { id: "inb1", title: "Inbox - business", updatedAt: new Date("2026-04-01") },
    ]);
    mockPrisma.task.count.mockResolvedValueOnce(0);
    mockPrisma.mission.update.mockResolvedValueOnce({});
    const r = (await (GET as unknown as (req: Request, ctx: unknown) => Promise<unknown>)(
      baseReq,
      ctx,
    )) as { archived: number; archivedIds: string[] };
    expect(r.archived).toBe(1);
    expect(r.archivedIds).toEqual(["inb1"]);
    const updateCall = mockPrisma.mission.update.mock.calls[0][0];
    expect(updateCall.where.id).toBe("inb1");
    expect(updateCall.data.deletedAt).toBeInstanceOf(Date);
    expect(updateCall.data.status).toBe("PAUSED");
  });

  it("does NOT archive an inbox that still has live tasks", async () => {
    mockPrisma.mission.findMany.mockResolvedValueOnce([
      { id: "inb-live", title: "Inbox - personal", updatedAt: new Date("2026-04-01") },
    ]);
    mockPrisma.task.count.mockResolvedValueOnce(3);
    const r = (await (GET as unknown as (req: Request, ctx: unknown) => Promise<unknown>)(
      baseReq,
      ctx,
    )) as { archived: number };
    expect(r.archived).toBe(0);
    expect(mockPrisma.mission.update).not.toHaveBeenCalled();
  });

  it("treats a count error (-1) the same as 'has tasks' (skip archival)", async () => {
    mockPrisma.mission.findMany.mockResolvedValueOnce([
      { id: "inb-err", title: "Inbox", updatedAt: new Date("2026-04-01") },
    ]);
    mockPrisma.task.count.mockRejectedValueOnce(new Error("DB hiccup"));
    const r = (await (GET as unknown as (req: Request, ctx: unknown) => Promise<unknown>)(
      baseReq,
      ctx,
    )) as { archived: number };
    expect(r.archived).toBe(0);
    expect(mockPrisma.mission.update).not.toHaveBeenCalled();
  });

  it("archives multiple inboxes in one run", async () => {
    mockPrisma.mission.findMany.mockResolvedValueOnce([
      { id: "i1", title: "Inbox - business", updatedAt: new Date("2026-04-01") },
      { id: "i2", title: "Inbox - health", updatedAt: new Date("2026-04-01") },
      { id: "real", title: "rising dragon 2.0", updatedAt: new Date("2026-04-01") },
    ]);
    mockPrisma.task.count.mockResolvedValueOnce(0); // i1 empty
    mockPrisma.task.count.mockResolvedValueOnce(0); // i2 empty
    mockPrisma.mission.update.mockResolvedValue({});
    const r = (await (GET as unknown as (req: Request, ctx: unknown) => Promise<unknown>)(
      baseReq,
      ctx,
    )) as { archived: number; archivedIds: string[] };
    expect(r.archived).toBe(2);
    expect(r.archivedIds).toEqual(["i1", "i2"]);
  });
});
