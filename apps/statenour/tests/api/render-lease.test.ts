/**
 * Render lease — the claim query's WHERE shape is the whole safety argument.
 *
 * `"rendering"` is OVERLOADED. The render lane sets it (this route), but so do
 * lib/inngest/functions/social-publish.ts and lib/services/social-actions.ts,
 * where it means "publishing underway". Reclaiming any stale `"rendering"` row
 * would steal rows mid-publish.
 *
 * The discriminator is the lease: the publish paths never write one, so their
 * rows keep `renderLeaseExpiresAt = NULL`, and the reclaim branch demands a
 * NON-NULL, EXPIRED lease. These tests pin that predicate, because relaxing it
 * to a bare `status: "rendering"` would look like a harmless simplification and
 * would silently start stealing publishes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const findFirst = vi.fn();
const update = vi.fn();
const updateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialPublishQueue: {
      updateMany: (...a: unknown[]) => updateMany(...a),
    },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({ socialPublishQueue: { findFirst, update } }),
  },
}));

vi.mock("@/lib/utils/http", () => ({
  apiHandler: (h: (req: Request, ctx: unknown) => Promise<unknown>) => h,
}));

async function callRoute() {
  vi.resetModules();
  const mod = await import("@/app/api/sync/queue/render/route");
  return { mod, res: await mod.GET(new Request("http://x/api/sync/queue/render"), {} as never) };
}

beforeEach(() => {
  findFirst.mockReset();
  update.mockReset();
  updateMany.mockReset();
  updateMany.mockResolvedValue({ count: 0 });
  findFirst.mockResolvedValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe("claim predicate · a publish-path row can never be stolen", () => {
  it("requires the reclaim branch to have a NON-NULL, EXPIRED lease", async () => {
    await callRoute();
    const where = findFirst.mock.calls[0][0].where;
    const reclaim = where.OR.find((c: Record<string, unknown>) => c.status === "rendering");

    expect(reclaim, "there must be a reclaim branch").toBeTruthy();
    // Both halves matter. `not: null` is what excludes the publish path;
    // `lt: now` is what stops it stealing a live render.
    expect(reclaim.renderLeaseExpiresAt?.not).toBeNull();
    expect(reclaim.renderLeaseExpiresAt?.lt).toBeInstanceOf(Date);
  });

  it("still claims fresh approved work", async () => {
    await callRoute();
    const where = findFirst.mock.calls[0][0].where;
    expect(where.OR.some((c: Record<string, unknown>) => c.status === "approved")).toBe(true);
  });

  it("keeps the reel/imageUrl narrowing so it cannot claim non-render work", async () => {
    await callRoute();
    const where = findFirst.mock.calls[0][0].where;
    expect(where.kind).toBe("reel");
    expect(where.imageUrl).toBeNull();
    expect(where.deletedAt).toBeNull();
  });

  it("bounds retries so a poison item cannot loop forever", async () => {
    const { mod } = await callRoute();
    const where = findFirst.mock.calls[0][0].where;
    expect(where.renderAttempts.lt).toBe(mod.MAX_RENDER_ATTEMPTS);
  });
});

describe("claiming writes a lease", () => {
  it("sets claimedAt, an expiry in the future, and increments attempts", async () => {
    findFirst.mockResolvedValueOnce({ id: "q1" });
    update.mockResolvedValueOnce({
      id: "q1", content: "c", kind: "reel", sourceMetadata: null,
      renderAttempts: 1, renderLeaseExpiresAt: new Date(),
    });

    const { mod } = await callRoute();
    const data = update.mock.calls[0][0].data;

    expect(data.status).toBe("rendering");
    expect(data.renderClaimedAt).toBeInstanceOf(Date);
    expect(data.renderAttempts).toEqual({ increment: 1 });
    // Counting CLAIMS not failures is deliberate: a worker that dies silently
    // never reports a failure, so failure-counting could never bound the loop.
    expect(data.renderLeaseExpiresAt.getTime() - data.renderClaimedAt.getTime())
      .toBe(mod.RENDER_LEASE_MINUTES * 60_000);
  });
});

describe("exhausted items are retired VISIBLY, not filtered into a black hole", () => {
  it("retires expired leases at the attempt cap before claiming", async () => {
    const { mod } = await callRoute();
    expect(updateMany).toHaveBeenCalledTimes(1);
    const { where, data } = updateMany.mock.calls[0][0];

    expect(where.renderAttempts.gte).toBe(mod.MAX_RENDER_ATTEMPTS);
    expect(where.renderLeaseExpiresAt.not).toBeNull();
    // Must land on an ALREADY-SURFACED status. A bespoke "render_failed" that
    // no admin view renders would be an invisible parking space — the same
    // defect the lease exists to remove.
    expect(data.status).toBe("rejected");
    expect(data.rejectionReason).toMatch(/render abandoned/i);
    expect(data.renderLeaseExpiresAt).toBeNull();
  });

  it("retires BEFORE the claim so an exhausted row cannot be re-leased", async () => {
    await callRoute();
    expect(updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(findFirst.mock.invocationCallOrder[0]);
  });
});
