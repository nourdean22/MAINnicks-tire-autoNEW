import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSocialInventoryPublisher } from "../socialInventoryPublisher";
import { getDbTyped } from "../../../db";

vi.mock("../../../db", () => ({
  getDbTyped: vi.fn(),
}));

vi.mock("../../../services/socialPublish", () => ({
  publishToSocial: vi.fn(),
  assertPermanentPublicMediaUrl: vi.fn(),
  captionClaimBlockers: vi.fn(),
}));

/**
 * Drizzle's mysql2 driver resolves `.update()` to `[ResultSetHeader, FieldPacket[]]`
 * (drizzle-orm/mysql2/session.d.ts:13). The publisher's at-most-once claim reads
 * affectedRows off that tuple, so the mock has to model the real shape — a bare
 * `mockReturnThis()` made every claim read 0 and silently skip the publish.
 *
 * `where` returns a dedicated thenable rather than `this`: the select chain calls
 * `.limit()` on it, the update chain awaits it. The root db object must stay
 * non-thenable or `await getDbTyped()` would unwrap it.
 */
function makeMockDb(rows: unknown[], opts: { claimAffectedRows?: number } = {}) {
  const whereResult: Record<string, unknown> = {
    limit: vi.fn().mockResolvedValue(rows),
    then: (resolve: (value: unknown) => void) =>
      resolve([{ affectedRows: opts.claimAffectedRows ?? 1 }, []]),
  };
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnValue(whereResult),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  };
}

const dueImageRow = {
  id: 102,
  topic: "Tips",
  status: "approved",
  contentType: "image",
  platform: "facebook",
  hookText: "Check your tire pressure.",
  bodyText: "It helps with gas mileage.",
  assetPaths: ["https://example.com/tire.jpg"],
};

describe("Social Inventory Publisher Claim Blockers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.REEL_PUBLISH_ENABLED = "true";
  });

  it("should block publishing and mark item as failed when caption contains claim blockers", async () => {
    const mockDb = makeMockDb([
      {
        id: 101,
        topic: "Safety",
        status: "approved",
        contentType: "image",
        platform: "facebook",
        hookText: "Guaranteed to never pop!",
        bodyText: "Best tires in the world.",
        assetPaths: ["https://example.com/tire.jpg"],
      },
    ]);

    (getDbTyped as any).mockResolvedValue(mockDb);

    const { publishToSocial, captionClaimBlockers } = await import("../../../services/socialPublish");
    (captionClaimBlockers as any).mockReturnValue(["guaranteed", "best in the world"]);

    const result = await runSocialInventoryPublisher();

    expect(captionClaimBlockers).toHaveBeenCalledWith("Guaranteed to never pop!\n\nBest tires in the world.");
    expect(publishToSocial).not.toHaveBeenCalled();

    // Verify it updated the DB status to "failed"
    expect(mockDb.set).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      errorMessage: expect.stringContaining("Caption blocked due to unsafe claims: guaranteed, best in the world")
    }));

    // Should return 0 records posted successfully
    expect(result.recordsProcessed).toBe(1);
  });

  it("should proceed with publishing if no claim blockers are found", async () => {
    const mockDb = makeMockDb([dueImageRow]);

    (getDbTyped as any).mockResolvedValue(mockDb);

    const { publishToSocial, captionClaimBlockers } = await import("../../../services/socialPublish");
    (captionClaimBlockers as any).mockReturnValue([]);
    (publishToSocial as any).mockResolvedValue({ results: [{ success: true, platform: "facebook" }] });

    const result = await runSocialInventoryPublisher();

    expect(captionClaimBlockers).toHaveBeenCalled();
    expect(publishToSocial).toHaveBeenCalled();

    // Verify it updated the DB status to "published"
    expect(mockDb.set).toHaveBeenCalledWith(expect.objectContaining({
      status: "published"
    }));

    expect(result.recordsProcessed).toBe(1);
  });

  it("claims the row BEFORE publishing, so a concurrent worker cannot double-post", async () => {
    const mockDb = makeMockDb([dueImageRow]);
    (getDbTyped as any).mockResolvedValue(mockDb);

    const { publishToSocial, captionClaimBlockers } = await import("../../../services/socialPublish");
    (captionClaimBlockers as any).mockReturnValue([]);
    (publishToSocial as any).mockResolvedValue({ results: [{ success: true, platform: "facebook" }] });

    await runSocialInventoryPublisher();

    // The "publishing" claim must be written before Meta is ever contacted.
    const claimCallIndex = mockDb.set.mock.calls.findIndex(
      ([arg]: [Record<string, unknown>]) => arg?.status === "publishing",
    );
    expect(claimCallIndex).toBeGreaterThanOrEqual(0);
    expect(mockDb.set.mock.invocationCallOrder[claimCallIndex]).toBeLessThan(
      (publishToSocial as any).mock.invocationCallOrder[0],
    );
  });

  it("skips the row when the claim is lost (another worker got it first)", async () => {
    // affectedRows 0 = the CAS matched nothing: status moved since our select.
    const mockDb = makeMockDb([dueImageRow], { claimAffectedRows: 0 });
    (getDbTyped as any).mockResolvedValue(mockDb);

    const { publishToSocial, captionClaimBlockers } = await import("../../../services/socialPublish");
    (captionClaimBlockers as any).mockReturnValue([]);

    const result = await runSocialInventoryPublisher();

    expect(publishToSocial).not.toHaveBeenCalled();
    expect(result.recordsProcessed).toBe(0);
  });

  it("records a partial publish as published_partial, never as published", async () => {
    const mockDb = makeMockDb([{ ...dueImageRow, platform: "both" }]);
    (getDbTyped as any).mockResolvedValue(mockDb);

    const { publishToSocial, captionClaimBlockers } = await import("../../../services/socialPublish");
    (captionClaimBlockers as any).mockReturnValue([]);
    // Facebook lands, Instagram does not — the exact case the old `allFailed`
    // branch recorded as a clean "published".
    (publishToSocial as any).mockResolvedValue({
      results: [
        { success: true, platform: "facebook" },
        { success: false, platform: "instagram", error: "media container error" },
      ],
    });

    await runSocialInventoryPublisher();

    const statuses = mockDb.set.mock.calls.map(([arg]: [Record<string, unknown>]) => arg?.status);
    expect(statuses).toContain("published_partial");
    expect(statuses).not.toContain("published");
  });
});
