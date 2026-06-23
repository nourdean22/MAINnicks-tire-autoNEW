import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchFREDIndicators } from "@/lib/intelligence/connectors/fred";
import { fetchNHTSARecalls } from "@/lib/intelligence/connectors/nhtsa";
import { calculateOpportunityScore } from "@/lib/intelligence/scoring";
import { groundClaim } from "@/lib/intelligence/grounding";

// Mock the dependencies
const mocks = {
  semanticSearch: vi.fn(),
};

vi.mock("@/lib/brain/embedding-utils", () => ({
  semanticSearch: (...args: any[]) => mocks.semanticSearch(...args),
}));

describe("Intelligence OS System Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Scoring Calculations
  describe("Opportunity Scoring Engine", () => {
    it("should compute accurate priority scores based on strategic parameters", () => {
      // Score = (Impact * 0.4) + (Urgency * 0.3) + (Confidence * 20) + (Reversibility * 0.1)
      const score = calculateOpportunityScore(90, 80, 0.95, 20);
      // Expected = (90 * 0.4) + (80 * 0.3) + (0.95 * 20) + (20 * 0.1) = 36 + 24 + 19 + 2 = 81
      expect(score).toBe(81);
    });

    it("should respect boundaries and cap at 100", () => {
      const score = calculateOpportunityScore(100, 100, 1.0, 100);
      expect(score).toBe(100);
    });

    it("should respect boundaries and clamp to 0", () => {
      const score = calculateOpportunityScore(0, 0, 0.0, 0);
      expect(score).toBe(0);
    });
  });

  // 2. Grounding Validator
  describe("Grounding & Similarity Validator", () => {
    it("should classify a claim as source_supported when similarity is high", async () => {
      mocks.semanticSearch.mockResolvedValue([
        { content: "Google Maps rank for brakes Cleveland is 6.", similarity: 0.85 },
      ]);

      const grounded = await groundClaim(
        "Google Maps rank dropped to 6 in Cleveland",
        "research_claim",
        0.9
      );

      expect(grounded.status).toBe("source_supported");
      expect(grounded.verificationScore).toBe(0.85);
      expect(grounded.bestMatchChunk).toBe("Google Maps rank for brakes Cleveland is 6.");
    });

    it("should classify a claim as weak_support when similarity is moderate", async () => {
      mocks.semanticSearch.mockResolvedValue([
        { content: "Google Maps rank is unstable in some regions.", similarity: 0.62 },
      ]);

      const grounded = await groundClaim(
        "Google Maps ranking drops to 6",
        "research_claim",
        0.9
      );

      expect(grounded.status).toBe("weak_support");
      expect(grounded.verificationScore).toBe(0.62);
    });

    it("should classify a claim as unverified when similarity is low", async () => {
      mocks.semanticSearch.mockResolvedValue([
        { content: "Unrelated text about garage tools and tire pressure.", similarity: 0.34 },
      ]);

      const grounded = await groundClaim(
        "Google Maps ranking drops to 6",
        "research_claim",
        0.9
      );

      expect(grounded.status).toBe("unverified");
      expect(grounded.verificationScore).toBe(0.34);
    });

    it("should fallback cleanly if no matches are found", async () => {
      mocks.semanticSearch.mockResolvedValue([]);

      const grounded = await groundClaim(
        "Unique unprecedented event",
        "research_claim",
        0.9
      );

      expect(grounded.status).toBe("unverified");
      expect(grounded.verificationScore).toBe(0);
      expect(grounded.bestMatchChunk).toBeNull();
    });
  });

  // 3. Connectors
  describe("FRED & NHTSA Connectors", () => {
    it("should fetch mock FRED indicators when API key is missing", async () => {
      // Clear process env key for clean mock testing
      const originalKey = process.env.FRED_API_KEY;
      delete process.env.FRED_API_KEY;

      const indicators = await fetchFREDIndicators();
      expect(indicators).toHaveLength(3);
      expect(indicators[0].seriesId).toBe("CPIAUCSL");
      expect(indicators[1].seriesId).toBe("UNRATE");
      expect(indicators[2].seriesId).toBe("FEDFUNDS");

      // Restore key
      process.env.FRED_API_KEY = originalKey;
    });

    it("should fetch NHTSA recalls and fall back cleanly to mocks", async () => {
      const vehicles = [
        { make: "Ford", model: "F-150", year: 2020 },
      ];
      const recalls = await fetchNHTSARecalls(vehicles);
      expect(recalls.length).toBeGreaterThan(0);
      expect(recalls[0].VehicleMake).toBe("FORD");
      expect(recalls[0].VehicleModel).toBe("F-150");
      expect(recalls[0].ModelYear).toBe("2020");
    });
  });
});
