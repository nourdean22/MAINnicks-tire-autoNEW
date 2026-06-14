import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateGBPPost } from "../services/gbpContentGenerator";
import { getGoogleReviews } from "../google-reviews";

// Mock getGoogleReviews
vi.mock("../google-reviews", () => {
  return {
    getGoogleReviews: vi.fn(),
  };
});

// Mock database helper
vi.mock("../lib/db-helper", () => {
  return {
    db: vi.fn().mockResolvedValue({
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    }),
  };
});

describe("GBP Generator and Fabrication Guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gracefully falls back to another archetype when getGoogleReviews returns null or empty reviews list", async () => {
    vi.mocked(getGoogleReviews).mockResolvedValue(null);
    const post = await generateGBPPost("proof");
    expect(post.archetype).not.toBe("proof");
    expect(post.text).toBeDefined();
  });

  it("gracefully falls back to another archetype when no reviews meet the quality threshold (rating >= 4, text >= 10 chars)", async () => {
    vi.mocked(getGoogleReviews).mockResolvedValue({
      placeId: "test",
      name: "Nick's",
      rating: 4.8,
      totalReviews: 2,
      lastUpdated: Date.now(),
      address: "", phone: "", website: "", openNow: null, hours: [],
      reviews: [
        { authorName: "Tester A", rating: 3, text: "Bad service", relativeTime: "1 day ago", time: Date.now() },
        { authorName: "Tester B", rating: 5, text: "Ok", relativeTime: "1 day ago", time: Date.now() },
      ],
    });
    const post = await generateGBPPost("proof");
    expect(post.archetype).not.toBe("proof");
    expect(post.text).toBeDefined();
  });

  it("successfully creates proof post using real review text when available", async () => {
    vi.mocked(getGoogleReviews).mockResolvedValue({
      placeId: "test",
      name: "Nick's",
      rating: 4.8,
      totalReviews: 1,
      lastUpdated: Date.now(),
      address: "", phone: "", website: "", openNow: null, hours: [],
      reviews: [
        {
          authorName: "John Doe",
          rating: 5,
          text: "I had a wonderful experience getting my brakes serviced at this honest shop.",
          relativeTime: "1 week ago",
          time: Date.now(),
        },
      ],
    });

    const post = await generateGBPPost("proof");
    expect(post.archetype).toBe("proof");
    expect(post.text).toContain("John D. shared their experience");
    expect(post.text).toContain("wonderful experience getting my brakes serviced");
    expect(post.text).not.toContain("Marcus L.");
    expect(post.text).not.toContain("grinding brakes");
  });
});
