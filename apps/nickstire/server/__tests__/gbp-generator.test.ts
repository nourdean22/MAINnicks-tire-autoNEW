import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateGBPPost } from "../services/gbpContentGenerator";

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
        result = ((global as any).mockReviews || []).filter((r: any) => r.rating === undefined || r.rating >= 4);
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

  it("gracefully falls back to another archetype when DB has no qualifying reviews", async () => {
    (global as any).mockReviews = [];
    const post = await generateGBPPost("proof");
    expect(post.archetype).not.toBe("proof");
    expect(post.text).toBeDefined();
  });

  it("gracefully falls back to another archetype when no reviews meet the quality threshold (rating >= 4, text >= 10 chars)", async () => {
    (global as any).mockReviews = [
      { authorName: "Tester A", rating: 3, reviewText: "Bad service", relativeTime: "1 day ago", reviewTime: 1718474400 },
      { authorName: "Tester B", rating: 5, reviewText: "Ok", relativeTime: "1 day ago", reviewTime: 1718474400 },
    ];
    const post = await generateGBPPost("proof");
    expect(post.archetype).not.toBe("proof");
    expect(post.text).toBeDefined();
  });

  it("successfully creates proof post using real review from DB", async () => {
    (global as any).mockReviews = [
      {
        authorName: "John Doe",
        rating: 5,
        reviewText: "I had a wonderful experience getting my brakes serviced at this honest shop.",
        relativeTime: "1 week ago",
        reviewTime: 1718474400,
      },
    ];

    const post = await generateGBPPost("proof");
    expect(post.archetype).toBe("proof");
    expect(post.text).toContain("John D. shared their experience");
    expect(post.text).toContain("wonderful experience getting my brakes serviced");
    expect(post.provenance).toBe("real-review");
  });
});
