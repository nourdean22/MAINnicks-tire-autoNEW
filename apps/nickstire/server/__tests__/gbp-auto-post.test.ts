import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateAndNotifyGBPPost } from "../services/gbpAutoPost";
import * as featureFlags from "../services/featureFlags";
import * as gbpContentGenerator from "../services/gbpContentGenerator";
import * as telegram from "../services/telegram";

vi.mock("../services/featureFlags", () => ({
  isEnabled: vi.fn(),
}));

vi.mock("../services/gbpContentGenerator", () => ({
  generateGBPPost: vi.fn().mockResolvedValue({
    archetype: "proof",
    provenance: "real-review",
    text: "Mock post content",
    callToAction: "BOOK",
    ctaUrl: "https://example.com",
    imageHint: "Mock image hint",
  }),
  logPostToDb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/telegram", () => ({
  sendTelegram: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/db-helper", () => ({
  db: vi.fn().mockResolvedValue({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => {
      // Return empty array to bypass the 24-hour cooldown check
      return Promise.resolve([]);
    }),
  }),
}));

describe("generateAndNotifyGBPPost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips and returns feature flag disabled message when flag is off", async () => {
    vi.mocked(featureFlags.isEnabled).mockResolvedValue(false);

    // Set time to a Monday
    vi.setSystemTime(new Date("2026-06-22T10:00:00Z"));

    const result = await generateAndNotifyGBPPost();
    expect(result.recordsProcessed).toBe(0);
    expect(result.details).toContain("feature flag is disabled");
    expect(gbpContentGenerator.generateGBPPost).not.toHaveBeenCalled();
    expect(telegram.sendTelegram).not.toHaveBeenCalled();
  });

  it("skips and returns day check message on a non-Monday even when flag is on", async () => {
    vi.mocked(featureFlags.isEnabled).mockResolvedValue(true);

    // Set time to a Tuesday (June 23, 2026)
    vi.setSystemTime(new Date("2026-06-23T10:00:00Z"));

    const result = await generateAndNotifyGBPPost();
    expect(result.recordsProcessed).toBe(0);
    expect(result.details).toContain("runs Mondays only");
    expect(gbpContentGenerator.generateGBPPost).not.toHaveBeenCalled();
    expect(telegram.sendTelegram).not.toHaveBeenCalled();
  });

  it("generates and notifies on Monday when feature flag is enabled", async () => {
    vi.mocked(featureFlags.isEnabled).mockResolvedValue(true);

    // Set time to a Monday (June 22, 2026)
    vi.setSystemTime(new Date("2026-06-22T10:00:00Z"));

    const result = await generateAndNotifyGBPPost({ dryRun: true, requiresReview: true });
    expect(result.recordsProcessed).toBe(1);
    expect(result.details).toContain("GBP weekly post");
    expect(gbpContentGenerator.generateGBPPost).toHaveBeenCalled();
    expect(telegram.sendTelegram).toHaveBeenCalledWith(
      expect.stringContaining("GBP POST")
    );
  });
});
