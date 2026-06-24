import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  explodeTopic,
  generateHookLibrary,
  validateClaimSafety,
  generateScoredDraft,
  runManufacturingPipeline,
  getReserveStatus,
  replenishReserve
} from "../services/contentManufacturing";
import { invokeLLM } from "../_core/llm";

// Mock Database
let currentTableName = "";
let mockDbResult: any[] = [];
let mockCampaignsResult: any[] = [];
let mockInventoryResult: any[] = [];
const insertValuesMock = vi.fn().mockReturnThis();

const mockDb: any = {
  select: vi.fn().mockImplementation(() => {
    const builder = {
      from: vi.fn().mockImplementation((table) => {
        if (table) {
          currentTableName = table.name || 
            table._meta?.name || 
            table[Symbol.for('drizzle:Name')] || 
            table[Symbol.for('drizzle:OriginalName')] || 
            "";
        }
        return builder;
      }),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((onFulfilled) => {
        let result = mockDbResult;
        if (currentTableName === "content_manufacturing_campaigns") {
          result = mockCampaignsResult;
        } else if (currentTableName === "social_content_inventory") {
          result = mockInventoryResult;
        }
        currentTableName = ""; // reset
        return Promise.resolve(result).then(onFulfilled);
      }),
    };
    return builder;
  }),
  insert: vi.fn().mockImplementation(() => {
    return {
      values: insertValuesMock,
      then: vi.fn().mockImplementation((onFulfilled) => {
        return Promise.resolve([]).then(onFulfilled);
      }),
    };
  })
};

vi.mock("../db", () => ({
  getDbTyped: () => Promise.resolve(mockDb),
  getDb: () => Promise.resolve(mockDb),
}));

vi.mock("../services/weatherIntelligence", () => ({
  checkWeatherTriggers: vi.fn().mockResolvedValue({
    triggered: ["cold_snap"],
    details: "Cold snap trigger: 25 degrees"
  })
}));

vi.mock("../_core/llm", () => ({
  invokeLLM: vi.fn()
}));

describe("Content Domination Engine - Manufacturing & Safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbResult = [];
    mockCampaignsResult = [];
    mockInventoryResult = [];
    insertValuesMock.mockClear();
    currentTableName = "";
  });

  describe("explodeTopic", () => {
    it("should explode a topic into narrative content angles", async () => {
      mockDbResult = [
        { query: "brake pads Cleveland" }
      ];

      const mockAngles = [
        {
          angle: "Cleveland winter brake inspection checklist",
          narrativeFranchise: "Cleveland Car Survival Guide",
          entertainmentPillar: "Contrarian Content",
          description: "Crucial checks for brakes before winter hits Cleveland."
        }
      ];

      vi.mocked(invokeLLM).mockResolvedValueOnce({
        id: "test",
        created: 123,
        model: "model",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({ angles: mockAngles })
            },
            finish_reason: "stop"
          }
        ]
      });

      const result = await explodeTopic("brakes");
      expect(result).toEqual(mockAngles);
      expect(invokeLLM).toHaveBeenCalledTimes(1);
    });
  });

  describe("generateHookLibrary", () => {
    it("should generate hooks and compute overall scores correctly", async () => {
      const angle = {
        angle: "Cleveland winter brake inspection checklist",
        narrativeFranchise: "Cleveland Car Survival Guide",
        entertainmentPillar: "Contrarian Content",
        description: "Crucial checks for brakes before winter hits Cleveland."
      };

      const mockHooks = [
        {
          hookText: "Don't let Cleveland winter freeze your brakes.",
          hookCategory: "local",
          scoreCuriosity: 80,
          scoreEmotion: 70,
          scoreLocalRelevance: 95,
          scoreAuthority: 85
        }
      ];

      vi.mocked(invokeLLM).mockResolvedValueOnce({
        id: "test",
        created: 123,
        model: "model",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({ hooks: mockHooks })
            },
            finish_reason: "stop"
          }
        ]
      });

      const result = await generateHookLibrary("brakes", angle);
      expect(result).toHaveLength(1);
      
      // Math: Math.round(80 * 0.3 + 70 * 0.25 + 95 * 0.25 + 85 * 0.2)
      // 80 * 0.3 = 24
      // 70 * 0.25 = 17.5
      // 95 * 0.25 = 23.75
      // 85 * 0.2 = 17
      // 24 + 17.5 + 23.75 + 17 = 82.25 => Math.round(82.25) = 82
      expect(result[0].scoreOverall).toBe(82);
    });
  });

  describe("validateClaimSafety", () => {
    it("should allow approved prices and reject unallowed prices", () => {
      const allowedDraft = {
        hookText: "Get an oil change for $49 or synthetic for $80.",
        bodyText: "Or get used tires starting at $60.",
        visualStyle: "Style A",
        persona: "Cleveland Car Doctor",
        interactiveDmKeyword: "TIRES",
        caption: "Approved prices: $25, $40, $100 are also OK.",
        hashtags: ["brakes"],
        scoreCuriosity: 80,
        scoreEmotion: 80,
        scoreShareability: 80,
        scoreCommentPotential: 80,
        scoreSavePotential: 80,
        scoreLocalRelevance: 80,
        scoreRevenueRelevance: 80,
        scoreAuthority: 80,
        scoreHookStrength: 80,
        briefJson: "{}"
      };

      const result = validateClaimSafety(allowedDraft);
      expect(result.safe).toBe(true);
      expect(result.errors).toHaveLength(0);

      const unallowedDraft = {
        ...allowedDraft,
        hookText: "Brake service starting at only $120 today!"
      };

      const result2 = validateClaimSafety(unallowedDraft);
      expect(result2.safe).toBe(false);
      expect(result2.errors[0]).toContain("Violated Rule 1");
    });

    it("should reject hard diagnostic guarantees", () => {
      const hardDraft = {
        hookText: "This noise guaranteed means a broken transmission.",
        bodyText: "We will fix it easily.",
        visualStyle: "Style A",
        persona: "Cleveland Car Doctor",
        interactiveDmKeyword: "TIRES",
        caption: "Hurry in before your transmission blows.",
        hashtags: ["brakes"],
        scoreCuriosity: 80,
        scoreEmotion: 80,
        scoreShareability: 80,
        scoreCommentPotential: 80,
        scoreSavePotential: 80,
        scoreLocalRelevance: 80,
        scoreRevenueRelevance: 80,
        scoreAuthority: 80,
        scoreHookStrength: 80,
        briefJson: "{}"
      };

      const result = validateClaimSafety(hardDraft);
      expect(result.safe).toBe(false);
      expect(result.errors).toContain("Violated Rule 2: Hard diagnostic/guarantee term found \"guaranteed\". Use soft terms instead.");
      expect(result.errors).toContain("Violated Rule 2: Hard diagnostic/guarantee term found \"will fix\". Use soft terms instead.");
      expect(result.errors).toContain("Violated Rule 2: Hard diagnostic/guarantee term found \"broken transmission\". Use soft terms instead.");
    });

    it("should reject fake review testimonials", () => {
      const fakeReviewDraft = {
        hookText: "John says five stars!",
        bodyText: "He reviewed us and said the service was amazing.",
        visualStyle: "Style A",
        persona: "Cleveland Car Doctor",
        interactiveDmKeyword: "TIRES",
        caption: "Come check us out.",
        hashtags: ["brakes"],
        scoreCuriosity: 80,
        scoreEmotion: 80,
        scoreShareability: 80,
        scoreCommentPotential: 80,
        scoreSavePotential: 80,
        scoreLocalRelevance: 80,
        scoreRevenueRelevance: 80,
        scoreAuthority: 80,
        scoreHookStrength: 80,
        briefJson: "{}"
      };

      const result = validateClaimSafety(fakeReviewDraft);
      expect(result.safe).toBe(false);
      expect(result.errors[0]).toContain("Violated Rule 3");
    });
  });

  describe("generateScoredDraft", () => {
    it("should generate a full social draft from angle and hook", async () => {
      const angle = {
        angle: "Cleveland winter brake inspection checklist",
        narrativeFranchise: "Cleveland Car Survival Guide",
        entertainmentPillar: "Contrarian Content",
        description: "Crucial checks for brakes before winter hits Cleveland."
      };

      const hook = {
        hookText: "Don't let Cleveland winter freeze your brakes.",
        hookCategory: "local",
        scoreCuriosity: 80,
        scoreEmotion: 70,
        scoreLocalRelevance: 95,
        scoreAuthority: 85,
        scoreOverall: 82
      };

      const mockDraft = {
        hookText: "Don't let Cleveland winter freeze your brakes.",
        bodyText: "Here's the checklist...",
        visualStyle: "Style A",
        persona: "Cleveland Car Doctor",
        interactiveDmKeyword: "SURVIVE",
        caption: "Stay safe this winter.",
        hashtags: ["cleveland", "brakes"],
        scoreCuriosity: 85,
        scoreEmotion: 75,
        scoreShareability: 80,
        scoreCommentPotential: 90,
        scoreSavePotential: 85,
        scoreLocalRelevance: 95,
        scoreRevenueRelevance: 80,
        scoreAuthority: 85,
        scoreHookStrength: 82,
        briefJson: "{}"
      };

      vi.mocked(invokeLLM).mockResolvedValueOnce({
        id: "test",
        created: 123,
        model: "model",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify(mockDraft)
            },
            finish_reason: "stop"
          }
        ]
      });

      const result = await generateScoredDraft(
        "brakes",
        angle,
        hook,
        "cleveland_car_doctor",
        "reel",
        "both"
      );

      expect(result).toEqual({
        ...mockDraft,
        weatherTriggerCondition: "cold_snap"
      });
    });
  });

  describe("runManufacturingPipeline", () => {
    it("should successfully generate and persist a safe, high-scoring draft", async () => {
      const mockAngles = [
        {
          angle: "Cleveland winter brake inspection checklist",
          narrativeFranchise: "Cleveland Car Survival Guide",
          entertainmentPillar: "Contrarian Content",
          description: "Crucial checks for brakes before winter hits Cleveland."
        }
      ];

      const mockHooks = [
        {
          hookText: "Don't let Cleveland winter freeze your brakes.",
          hookCategory: "local",
          scoreCuriosity: 80,
          scoreEmotion: 70,
          scoreLocalRelevance: 95,
          scoreAuthority: 85
        }
      ];

      const mockDraft = {
        hookText: "Don't let Cleveland winter freeze your brakes.",
        bodyText: "Here's the checklist...",
        visualStyle: "Style A",
        persona: "Cleveland Car Doctor",
        interactiveDmKeyword: "SURVIVE",
        caption: "Stay safe this winter.",
        hashtags: ["cleveland", "brakes"],
        scoreCuriosity: 90,
        scoreEmotion: 90,
        scoreShareability: 90,
        scoreCommentPotential: 90,
        scoreSavePotential: 90,
        scoreLocalRelevance: 90,
        scoreRevenueRelevance: 90,
        scoreAuthority: 90,
        scoreHookStrength: 82,
        briefJson: "{}"
      };

      vi.mocked(invokeLLM)
        .mockResolvedValueOnce({
          id: "test",
          created: 123,
          model: "model",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ angles: mockAngles }) }, finish_reason: "stop" }]
        })
        .mockResolvedValueOnce({
          id: "test",
          created: 123,
          model: "model",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ hooks: mockHooks }) }, finish_reason: "stop" }]
        })
        .mockResolvedValueOnce({
          id: "test",
          created: 123,
          model: "model",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(mockDraft) }, finish_reason: "stop" }]
        });

      const result = await runManufacturingPipeline("campaign_123", "brakes", "cleveland_car_doctor");
      expect(result.success).toBe(true);
      expect(result.draftsCreated).toBe(1);
      expect(insertValuesMock).toHaveBeenCalledTimes(1);
    });

    it("should retry generation if a draft fails safety validation on early attempts", async () => {
      const mockAngles = [
        {
          angle: "Cleveland winter brake inspection checklist",
          narrativeFranchise: "Cleveland Car Survival Guide",
          entertainmentPillar: "Contrarian Content",
          description: "Crucial checks for brakes before winter hits Cleveland."
        }
      ];

      const mockHooks = [
        {
          hookText: "Don't let Cleveland winter freeze your brakes.",
          hookCategory: "local",
          scoreCuriosity: 80,
          scoreEmotion: 70,
          scoreLocalRelevance: 95,
          scoreAuthority: 85
        }
      ];

      const mockDraftUnsafe = {
        hookText: "Get brake service for $120!",
        bodyText: "Here's the checklist...",
        visualStyle: "Style A",
        persona: "Cleveland Car Doctor",
        interactiveDmKeyword: "SURVIVE",
        caption: "Stay safe this winter.",
        hashtags: ["cleveland", "brakes"],
        scoreCuriosity: 90,
        scoreEmotion: 90,
        scoreShareability: 90,
        scoreCommentPotential: 90,
        scoreSavePotential: 90,
        scoreLocalRelevance: 90,
        scoreRevenueRelevance: 90,
        scoreAuthority: 90,
        scoreHookStrength: 82,
        briefJson: "{}"
      };

      const mockDraftSafe = {
        hookText: "Don't let Cleveland winter freeze your brakes.",
        bodyText: "Here's the checklist...",
        visualStyle: "Style A",
        persona: "Cleveland Car Doctor",
        interactiveDmKeyword: "SURVIVE",
        caption: "Stay safe this winter.",
        hashtags: ["cleveland", "brakes"],
        scoreCuriosity: 90,
        scoreEmotion: 90,
        scoreShareability: 90,
        scoreCommentPotential: 90,
        scoreSavePotential: 90,
        scoreLocalRelevance: 90,
        scoreRevenueRelevance: 90,
        scoreAuthority: 90,
        scoreHookStrength: 82,
        briefJson: "{}"
      };

      vi.mocked(invokeLLM)
        .mockResolvedValueOnce({
          id: "test",
          created: 123,
          model: "model",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ angles: mockAngles }) }, finish_reason: "stop" }]
        })
        .mockResolvedValueOnce({
          id: "test",
          created: 123,
          model: "model",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ hooks: mockHooks }) }, finish_reason: "stop" }]
        })
        .mockResolvedValueOnce({
          id: "test",
          created: 123,
          model: "model",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(mockDraftUnsafe) }, finish_reason: "stop" }]
        })
        .mockResolvedValueOnce({
          id: "test",
          created: 123,
          model: "model",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(mockDraftSafe) }, finish_reason: "stop" }]
        });

      const result = await runManufacturingPipeline("campaign_123", "brakes", "cleveland_car_doctor");
      expect(result.success).toBe(true);
      expect(result.draftsCreated).toBe(1);
    });

    it("should filter out drafts whose overall score is below the gate threshold (75)", async () => {
      const mockAngles = [
        {
          angle: "Cleveland winter brake inspection checklist",
          narrativeFranchise: "Cleveland Car Survival Guide",
          entertainmentPillar: "Contrarian Content",
          description: "Crucial checks for brakes before winter hits Cleveland."
        }
      ];

      const mockHooks = [
        {
          hookText: "Don't let Cleveland winter freeze your brakes.",
          hookCategory: "local",
          scoreCuriosity: 80,
          scoreEmotion: 70,
          scoreLocalRelevance: 95,
          scoreAuthority: 85
        }
      ];

      const mockDraftLowScore = {
        hookText: "Don't let Cleveland winter freeze your brakes.",
        bodyText: "Here's the checklist...",
        visualStyle: "Style A",
        persona: "Cleveland Car Doctor",
        interactiveDmKeyword: "SURVIVE",
        caption: "Stay safe this winter.",
        hashtags: ["cleveland", "brakes"],
        scoreCuriosity: 50,
        scoreEmotion: 50,
        scoreShareability: 50,
        scoreCommentPotential: 50,
        scoreSavePotential: 50,
        scoreLocalRelevance: 50,
        scoreRevenueRelevance: 50,
        scoreAuthority: 50,
        scoreHookStrength: 50,
        briefJson: "{}"
      };

      vi.mocked(invokeLLM)
        .mockResolvedValueOnce({
          id: "test",
          created: 123,
          model: "model",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ angles: mockAngles }) }, finish_reason: "stop" }]
        })
        .mockResolvedValueOnce({
          id: "test",
          created: 123,
          model: "model",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ hooks: mockHooks }) }, finish_reason: "stop" }]
        })
        .mockResolvedValueOnce({
          id: "test",
          created: 123,
          model: "model",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(mockDraftLowScore) }, finish_reason: "stop" }]
        });

      const result = await runManufacturingPipeline("campaign_123", "brakes", "cleveland_car_doctor");
      expect(result.success).toBe(false);
      expect(result.draftsCreated).toBe(0);
    });
  });

  describe("getReserveStatus", () => {
    it("should calculate correct reserves, coverage, and deficit alerts", async () => {
      mockCampaignsResult = [
        { id: "campaign_1", topic: "brakes", persona: "cleveland_car_doctor", targetMonthlyVolume: 30, isActive: true },
        { id: "campaign_2", topic: "tires", persona: "tire_whisperer", targetMonthlyVolume: 30, isActive: true }
      ];

      mockInventoryResult = Array(10).fill({
        id: "draft_x",
        contentType: "reel",
        topic: "brakes",
        status: "pending"
      });

      const result = await getReserveStatus();

      expect(result.reserves.reel.count).toBe(10);
      expect(result.reserves.reel.days).toBe(5);
      expect(result.reserves.reel.deficit).toBe(55);

      expect(result.reserves.carousel.count).toBe(0);
      expect(result.reserves.carousel.days).toBe(0);
      expect(result.reserves.carousel.deficit).toBe(30);

      // Check alerts
      expect(result.deficitAlerts).toContain("Reserve Deficit: Need 110 more reels to meet the 60-day safety threshold.");
      expect(result.deficitAlerts).toContain("Reserve Deficit: Need 30 more carousels to meet the 30-day safety threshold.");
      expect(result.deficitAlerts).toContain("Campaign Gap: \"tires\" has low coverage. Generate 15 more drafts.");
    });
  });

  describe("replenishReserve", () => {
    it("should trigger manufacturing for campaigns with deficits", async () => {
      mockCampaignsResult = [
        { id: "campaign_1", topic: "brakes", persona: "cleveland_car_doctor", targetMonthlyVolume: 30, isActive: true }
      ];

      mockInventoryResult = [];

      const mockAngles = [
        {
          angle: "Cleveland winter brake inspection checklist",
          narrativeFranchise: "Cleveland Car Survival Guide",
          entertainmentPillar: "Contrarian Content",
          description: "Crucial checks for brakes before winter hits Cleveland."
        }
      ];

      const mockHooks = [
        {
          hookText: "Don't let Cleveland winter freeze your brakes.",
          hookCategory: "local",
          scoreCuriosity: 80,
          scoreEmotion: 70,
          scoreLocalRelevance: 95,
          scoreAuthority: 85
        }
      ];

      const mockDraft = {
        hookText: "Don't let Cleveland winter freeze your brakes.",
        bodyText: "Here's the checklist...",
        visualStyle: "Style A",
        persona: "Cleveland Car Doctor",
        interactiveDmKeyword: "SURVIVE",
        caption: "Stay safe this winter.",
        hashtags: ["cleveland", "brakes"],
        scoreCuriosity: 90,
        scoreEmotion: 90,
        scoreShareability: 90,
        scoreCommentPotential: 90,
        scoreSavePotential: 90,
        scoreLocalRelevance: 90,
        scoreRevenueRelevance: 90,
        scoreAuthority: 90,
        scoreHookStrength: 82,
        briefJson: "{}"
      };

      vi.mocked(invokeLLM)
        .mockResolvedValueOnce({
          id: "test",
          created: 123,
          model: "model",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ angles: mockAngles }) }, finish_reason: "stop" }]
        })
        .mockResolvedValueOnce({
          id: "test",
          created: 123,
          model: "model",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ hooks: mockHooks }) }, finish_reason: "stop" }]
        })
        .mockResolvedValueOnce({
          id: "test",
          created: 123,
          model: "model",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(mockDraft) }, finish_reason: "stop" }]
        });

      const result = await replenishReserve();
      expect(result.success).toBe(true);
      expect(result.draftsCreated).toBe(1);
      expect(result.campaignRuns).toContain("brakes");
    });
  });
});
