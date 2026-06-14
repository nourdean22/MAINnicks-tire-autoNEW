/**
 * Review Replies — markPosted loop closure + stats rot signal.
 *
 * The owner loop is: fetch review → AI draft → approve (DB only) →
 * owner pastes into the Google Business app → MARK POSTED (DB only).
 * These tests pin the state machine: "posted" is only reachable from
 * "approved", and stats surface the oldest approved-but-unposted reply
 * so the backlog can't rot silently.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { reviewRepliesRouter } from "../routers/reviewReplies";
import type { TrpcContext } from "../_core/context";

const h = vi.hoisted(() => ({
  /** Each select() call shifts one result off this queue. */
  selectQueue: [] as unknown[],
  /** Every update().set(values).where() lands here. */
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("../lib/db-helper", () => {
  function chain(result: unknown) {
    const c: {
      from: () => typeof c;
      where: () => typeof c;
      limit: () => Promise<unknown>;
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => Promise<unknown>;
    } = {
      from: () => c,
      where: () => c,
      limit: () => Promise.resolve(result),
      then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
    };
    return c;
  }
  return {
    db: vi.fn(async () => ({
      select: () => chain(h.selectQueue.shift() ?? []),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => {
            h.updates.push(values);
            return Promise.resolve();
          },
        }),
      }),
    })),
  };
});

function adminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "admin-user",
      email: "admin@nickstire.com",
      name: "Admin User",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

function userContext(): TrpcContext {
  return {
    ...adminContext(),
    user: { ...adminContext().user!, id: 2, openId: "regular", role: "user" },
  };
}

beforeEach(() => {
  h.selectQueue.length = 0;
  h.updates.length = 0;
  vi.clearAllMocks();
});

describe("reviewReplies.markPosted", () => {
  it("marks an approved reply posted with a postedAt timestamp", async () => {
    h.selectQueue.push([{ id: 7, status: "approved", finalReply: "Thanks for coming by!" }]);
    const caller = reviewRepliesRouter.createCaller(adminContext());

    const result = await caller.markPosted({ id: 7 });

    expect(result).toEqual({ success: true });
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].status).toBe("posted");
    expect(h.updates[0].postedAt).toBeInstanceOf(Date);
  });

  it("refuses a draft — approval must come first", async () => {
    h.selectQueue.push([{ id: 8, status: "draft", draftReply: "Draft text" }]);
    const caller = reviewRepliesRouter.createCaller(adminContext());

    let caught: any;
    try {
      await caller.markPosted({ id: 8 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toMatch(/approve the draft first/);
    expect(h.updates).toHaveLength(0);
  });

  it("refuses an already-posted reply (no double-posting state churn)", async () => {
    h.selectQueue.push([{ id: 9, status: "posted", finalReply: "Done" }]);
    const caller = reviewRepliesRouter.createCaller(adminContext());

    let caught: any;
    try {
      await caller.markPosted({ id: 9 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toMatch(/approve the draft first/);
    expect(h.updates).toHaveLength(0);
  });

  it("throws when the reply does not exist", async () => {
    h.selectQueue.push([]);
    const caller = reviewRepliesRouter.createCaller(adminContext());

    let caught: any;
    try {
      await caller.markPosted({ id: 999 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toMatch(/not found/);
    expect(h.updates).toHaveLength(0);
  });

  it("rejects non-admin users before touching the database", async () => {
    const caller = reviewRepliesRouter.createCaller(userContext());

    // Assert the PERMISSION error specifically — a bare rejects.toThrow()
    // would also pass via the handler's own "not found" throw (empty mock
    // queue), which would NOT prove the auth gate fired.
    let caught: any;
    try {
      await caller.markPosted({ id: 7 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toMatch(/permission/i);
    expect(h.updates).toHaveLength(0);
  });
});

describe("reviewReplies.stats — backlog rot signal", () => {
  it("returns oldestApprovedAt from the oldest approved-but-unposted reply", async () => {
    const oldest = new Date("2026-06-01T12:00:00Z");
    h.selectQueue.push(
      [{ count: 2 }], // draft
      [{ count: 3 }], // approved
      [{ count: 1 }], // skipped
      [{ count: 4 }], // posted
      [{ oldest }],   // min(approvedAt) over approved
    );
    const caller = reviewRepliesRouter.createCaller(adminContext());

    const stats = await caller.stats();

    expect(stats.draft).toBe(2);
    expect(stats.approved).toBe(3);
    expect(stats.skipped).toBe(1);
    expect(stats.posted).toBe(4);
    expect(stats.total).toBe(10);
    expect(stats.oldestApprovedAt).toBeInstanceOf(Date);
    expect(stats.oldestApprovedAt?.getTime()).toBe(oldest.getTime());
  });

  it("returns null oldestApprovedAt when nothing is approved", async () => {
    h.selectQueue.push(
      [{ count: 0 }],
      [{ count: 0 }],
      [{ count: 0 }],
      [{ count: 0 }],
      [{ oldest: null }],
    );
    const caller = reviewRepliesRouter.createCaller(adminContext());

    const stats = await caller.stats();

    expect(stats.total).toBe(0);
    expect(stats.oldestApprovedAt).toBeNull();
  });
});
