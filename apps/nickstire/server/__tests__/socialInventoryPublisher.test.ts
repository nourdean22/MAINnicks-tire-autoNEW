import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runSocialInventoryPublisher } from "../cron/jobs/socialInventoryPublisher";

// Mock database
let mockDueItems: any[] = [];
const mockUpdate = vi.fn().mockImplementation(() => {
  const builder = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockImplementation(() => Promise.resolve([])),
    then: vi.fn().mockImplementation((onFulfilled) => {
      return Promise.resolve([]).then(onFulfilled);
    }),
  };
  return builder;
});

let currentTableName = "";
const mockDb: any = {
  select: vi.fn().mockImplementation(() => {
    const builder = {
      from: vi.fn().mockImplementation((table) => {
        if (table) {
          currentTableName = table.name || table._meta?.name || table[Symbol.for('drizzle:Name')] || "";
        }
        return builder;
      }),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((onFulfilled) => {
        let result: any[] = [];
        if (currentTableName === "social_content_inventory") {
          result = mockDueItems;
        }
        currentTableName = "";
        return Promise.resolve(result).then(onFulfilled);
      }),
    };
    return builder;
  }),
  update: mockUpdate,
};

vi.mock("../db", () => ({
  getDbTyped: () => Promise.resolve(mockDb),
  getDb: () => Promise.resolve(mockDb),
}));

// Mock social publishing
const mockPublishToSocial = vi.fn().mockResolvedValue({
  results: [
    { platform: "instagram", success: true, postId: "ig_123" },
    { platform: "facebook", success: true, postId: "fb_123" }
  ]
});
vi.mock("../services/socialPublish", () => ({
  publishToSocial: (...args: any[]) => mockPublishToSocial(...args),
  assertPermanentPublicMediaUrl: () => {},
}));

// Mock self-learning loops
const mockSyncSocialMetrics = vi.fn().mockResolvedValue({ matched: 1, updated: 1 });
const mockAttributeRevenueToSocial = vi.fn().mockResolvedValue({ itemsProcessed: 1, bookingsAttributed: 2 });
vi.mock("../services/contentManufacturing", () => ({
  syncSocialMetrics: () => mockSyncSocialMetrics(),
  attributeRevenueToSocial: () => mockAttributeRevenueToSocial(),
  replenishReserve: vi.fn().mockResolvedValue({ success: true, draftsCreated: 0, campaignRuns: [] }),
}));

describe("runSocialInventoryPublisher", () => {
  const originalEnv = process.env.REEL_PUBLISH_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDueItems = [];
    process.env.REEL_PUBLISH_ENABLED = "true";
  });

  afterEach(() => {
    process.env.REEL_PUBLISH_ENABLED = originalEnv;
  });

  it("should do nothing if no due items are found", async () => {
    mockDueItems = [];
    const result = await runSocialInventoryPublisher();
    expect(result.recordsProcessed).toBe(0);
    expect(mockPublishToSocial).not.toHaveBeenCalled();
  });

  it("should publish due items and run self-learning sync", async () => {
    mockDueItems = [
      {
        id: "item_1",
        contentType: "reel",
        platform: "both",
        hookText: "Don't drive on salt!",
        bodyText: "Road salt damages your brakes.",
        assetPaths: ["/assets/video1.mp4"],
        scheduledAt: new Date(Date.now() - 1000),
      }
    ];

    const result = await runSocialInventoryPublisher();
    expect(result.recordsProcessed).toBe(1);
    expect(mockPublishToSocial).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
  });
});
