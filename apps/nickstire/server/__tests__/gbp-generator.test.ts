import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateGBPPost } from "../services/gbpContentGenerator";
import { getGoogleReviews } from "../google-reviews";

// Mock getGoogleReviews
vi.mock("../google-reviews", () => {
  return {
    getGoogleReviews: vi.fn(),
  };
});

vi.hoisted(() => {
  const query: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockImplementation(function (this: any, table) {
      if (table) {
        this.currentTableName = table.name || 
          table._meta?.name || 
          table[Symbol.for('drizzle:Name')] || 
          table[Symbol.for('drizzle:OriginalName')] || 
          "";
      }
      return this;
    }),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: vi.fn().mockImplementation(function (this: any, onFulfilled) {
      let result: any[] = [];
      const tableName = this.currentTableName;
      this.currentTableName = ""; // reset
      
      if (tableName === "review_pipeline") {
        result = (global as any).mockReviews || [];
      } else if (tableName === "specials") {
        result = (global as any).mockSpecials || [];
      } else if (tableName === "gbp_post_log") {
        result = (global as any).mockGbpPostLog || [];
      }
      
      return Promise.resolve(result).then(onFulfilled);
    }),
  };
  (global as any).mockQuery = query;
  (global as any).mockDb = {
    select: vi.fn().mockReturnValue(query),
    insert: vi.fn().mockReturnValue(query),
    update: vi.fn().mockReturnValue(query),
    delete: vi.fn().mockReturnValue(query),
  };
});

// Mock database helper
vi.mock("../lib/db-helper", () => {
  return {
    db: vi.fn().mockResolvedValue((global as any).mockDb),
  };
});

describe("GBP Generator and Fabrication Guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global as any).mockReviews = [];
    (global as any).mockSpecials = [];
    (global as any).mockGbpPostLog = [];
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

  it("successfully creates proof post using DB-stored reviews when Places API is down/empty", async () => {
    vi.mocked(getGoogleReviews).mockResolvedValue(null);
    
    // Set up mock reviews on the global object for table-aware mockQuery
    (global as any).mockReviews = [
      {
        authorName: "Jane Smith",
        rating: 5,
        reviewText: "Great customer service and reasonable prices at Nick's.",
        reviewTime: 1718474400,
        relativeTime: "2 days ago",
      },
    ];

    const post = await generateGBPPost("proof");
    expect(post.archetype).toBe("proof");
    expect(post.text).toContain("Jane S. shared their experience");
    expect(post.text).toContain("Great customer service and reasonable prices");
    expect(post.provenance).toBe("real-review");
  });
});
