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

describe("Social Inventory Publisher Claim Blockers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.REEL_PUBLISH_ENABLED = "true";
  });

  it("should block publishing and mark item as failed when caption contains claim blockers", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: 101,
          topic: "Safety",
          status: "approved",
          contentType: "image",
          platform: "facebook",
          hookText: "Guaranteed to never pop!",
          bodyText: "Best tires in the world.",
          assetPaths: ["https://example.com/tire.jpg"],
        }
      ]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis()
    };

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
    expect(result.recordsProcessed).toBe(0);
  });

  it("should proceed with publishing if no claim blockers are found", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: 102,
          topic: "Tips",
          status: "approved",
          contentType: "image",
          platform: "facebook",
          hookText: "Check your tire pressure.",
          bodyText: "It helps with gas mileage.",
          assetPaths: ["https://example.com/tire.jpg"],
        }
      ]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis()
    };

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
});
