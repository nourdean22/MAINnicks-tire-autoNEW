import { describe, it, expect, vi, beforeEach } from "vitest";
import { processSearchOpportunities } from "@/lib/intelligence/search-opportunity";
import { processOpportunityContentDrafts } from "@/lib/intelligence/content-alpha";
import { prisma } from "@/lib/prisma";
import { fetchGSCAndGBPMetrics } from "@/lib/intelligence/connectors/gsc";
import { createDraft } from "@/lib/content/drafts";

// Mock prisma database functions
const mockOpportunityLogFindFirst = vi.fn();
const mockOpportunityLogFindMany = vi.fn();
const mockOpportunityLogCreate = vi.fn();
const mockSocialPublishQueueFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    opportunityLog: {
      findFirst: (...args: any[]) => mockOpportunityLogFindFirst(...args),
      findMany: (...args: any[]) => mockOpportunityLogFindMany(...args),
      create: (...args: any[]) => mockOpportunityLogCreate(...args),
    },
    socialPublishQueue: {
      findMany: (...args: any[]) => mockSocialPublishQueueFindMany(...args),
    },
  },
}));

// Mock GSC Connector
vi.mock("@/lib/intelligence/connectors/gsc", () => ({
  fetchGSCAndGBPMetrics: vi.fn(),
}));

// Mock AI Provider & SDK
const generateTextMock = vi.fn();
vi.mock("ai", () => ({
  generateText: (...args: any[]) => generateTextMock(...args),
}));

vi.mock("@/lib/ai/provider", () => ({
  getModel: () => ({
    modelId: "mock-reason-model",
  }),
}));

// Mock createDraft
const mockCreateDraft = vi.fn();
vi.mock("@/lib/content/drafts", () => ({
  createDraft: (...args: any[]) => mockCreateDraft(...args),
}));

describe("Statenour OS V2 Growth Engines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpportunityLogFindFirst.mockReset();
    mockOpportunityLogFindMany.mockReset();
    mockOpportunityLogCreate.mockReset();
    mockSocialPublishQueueFindMany.mockReset();
    mockCreateDraft.mockReset();
    generateTextMock.mockReset();
    vi.mocked(fetchGSCAndGBPMetrics).mockReset();
  });

  describe("GSC Search Opportunity Engine", () => {
    it("should log new opportunity for high-intent, high-impression, low-CTR search queries", async () => {
      // Mock GSC query list
      vi.mocked(fetchGSCAndGBPMetrics).mockResolvedValue({
        gsc: [
          { query: "brakes repair cleveland", clicks: 10, impressions: 800, ctr: 0.05, position: 4.2 }, // Matches all criteria
          { query: "cheap tires cleveland", clicks: 50, impressions: 300, ctr: 0.16, position: 2.1 }, // Low impressions & high CTR
          { query: "random query string", clicks: 10, impressions: 900, ctr: 0.02, position: 8.5 }, // Non-automotive intent
        ],
        gbp: { rating: 4.8, totalReviews: 120, recentReviewText: "nice" }
      });

      mockOpportunityLogFindFirst.mockResolvedValue(null);
      mockOpportunityLogCreate.mockResolvedValue({ id: "opp_1" });

      const count = await processSearchOpportunities();

      expect(count).toBe(1);
      expect(mockOpportunityLogCreate).toHaveBeenCalledTimes(1);
      const logArg = mockOpportunityLogCreate.mock.calls[0][0].data;
      expect(logArg.title).toBe('SEO Search Gap: "brakes repair cleveland"');
      expect(logArg.domain).toBe("seo");
      expect(logArg.impact).toBeGreaterThan(0);
      expect(logArg.score).toBeGreaterThan(0);
      expect(logArg.status).toBe("pending");
    });

    it("should deduplicate and skip creating log if a pending log already exists", async () => {
      vi.mocked(fetchGSCAndGBPMetrics).mockResolvedValue({
        gsc: [
          { query: "brakes repair cleveland", clicks: 10, impressions: 800, ctr: 0.05, position: 4.2 },
        ],
        gbp: { rating: 4.8, totalReviews: 120, recentReviewText: "nice" }
      });

      // Mock finding an existing pending opportunity
      mockOpportunityLogFindFirst.mockResolvedValue({ id: "opp_existing", title: 'SEO Search Gap: "brakes repair cleveland"' });

      const count = await processSearchOpportunities();

      expect(count).toBe(0);
      expect(mockOpportunityLogCreate).not.toHaveBeenCalled();
    });
  });

  describe("Content Alpha Engine", () => {
    it("should generate drafts for high-scoring pending opportunities and log to publish queue", async () => {
      const mockOpportunities = [
        {
          id: "opp_1",
          title: "SEO Search Gap: \"brakes repair cleveland\"",
          description: "Keyword brakes repair cleveland has high search impressions.",
          domain: "seo",
          score: 85,
          status: "pending",
        },
      ];

      mockOpportunityLogFindMany.mockResolvedValue(mockOpportunities);
      mockSocialPublishQueueFindMany.mockResolvedValue([]); // No previous drafts

      generateTextMock.mockResolvedValue({
        text: JSON.stringify([
          {
            content: "Looking for top brakes repair in Cleveland? Come to Nick's!",
            kind: "post",
            suggestedPlatforms: ["instagram", "facebook"],
          },
          {
            content: "Local Cleveland Brake Repair special offer at Nick's.",
            kind: "post",
            suggestedPlatforms: ["gbp"],
          },
        ]),
      });

      mockCreateDraft.mockResolvedValue({ id: "draft_1", key: "draft_draft_1" });

      const count = await processOpportunityContentDrafts();

      expect(count).toBe(2);
      expect(mockCreateDraft).toHaveBeenCalledTimes(2);
      expect(mockCreateDraft.mock.calls[0][0]).toMatchObject({
        content: "Looking for top brakes repair in Cleveland? Come to Nick's!",
        kind: "post",
        suggestedPlatforms: ["instagram", "facebook"],
        source: "content_alpha_engine",
        sourceMetadata: {
          opportunityId: "opp_1",
          opportunityTitle: 'SEO Search Gap: "brakes repair cleveland"',
        },
      });
    });

    it("should skip opportunity if score is below threshold", async () => {
      // FindMany returns empty because score >= 75 filter is applied in DB query
      mockOpportunityLogFindMany.mockResolvedValue([]);

      const count = await processOpportunityContentDrafts();

      expect(count).toBe(0);
      expect(generateTextMock).not.toHaveBeenCalled();
    });

    it("should skip generating draft if draft already exists in last 14 days for that opportunity", async () => {
      const mockOpportunities = [
        {
          id: "opp_1",
          title: "SEO Search Gap: \"brakes repair cleveland\"",
          description: "Keyword brakes repair cleveland has high search impressions.",
          domain: "seo",
          score: 85,
          status: "pending",
        },
      ];

      mockOpportunityLogFindMany.mockResolvedValue(mockOpportunities);

      // Mock recent drafts returning a draft with same opportunityId
      mockSocialPublishQueueFindMany.mockResolvedValue([
        {
          id: "draft_old",
          source: "content_alpha_engine",
          sourceMetadata: {
            opportunityId: "opp_1",
          },
        },
      ]);

      const count = await processOpportunityContentDrafts();

      expect(count).toBe(0);
      expect(generateTextMock).not.toHaveBeenCalled();
    });
  });
});
