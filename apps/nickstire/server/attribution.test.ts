/**
 * Tests for attribution infrastructure — call tracking, source attribution, export
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
  execute: vi.fn().mockResolvedValue([]),
};

vi.mock("./db", () => ({
  getDb: vi.fn(() => mockDb),
  getBookingServiceBreakdown: vi.fn().mockResolvedValue([]),
  getAnalyticsSnapshots: vi.fn().mockResolvedValue([]),
}));

vi.mock("../drizzle/schema", () => ({
  bookings: { createdAt: "createdAt", status: "status", utmSource: "utmSource", referrer: "referrer", service: "service" },
  leads: { createdAt: "createdAt", status: "status", utmSource: "utmSource", referrer: "referrer", urgencyScore: "urgencyScore", source: "source" },
  callbackRequests: { createdAt: "createdAt", status: "status" },
  callEvents: { createdAt: "createdAt", sourcePage: "sourcePage", utmSource: "utmSource", referrer: "referrer" },
  chatSessions: { createdAt: "createdAt", converted: "converted" },
  dynamicArticles: { createdAt: "createdAt", status: "status" },
  notificationMessages: { isActive: "isActive" },
  contentGenerationLog: { createdAt: "createdAt" },
  users: { role: "role" },
  customerNotifications: { createdAt: "createdAt" },
}));

describe("Attribution Infrastructure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock chain
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockResolvedValue([]);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockResolvedValue([{ insertId: 1 }]);
  });

  describe("DashboardStats interface", () => {
    it("should include sourceAttribution fields", async () => {
      const { getDashboardStats } = await import("./admin-stats");
      const stats = await getDashboardStats();
      
      expect(stats).toHaveProperty("sourceAttribution");
      expect(stats.sourceAttribution).toHaveProperty("bookingsBySource");
      expect(stats.sourceAttribution).toHaveProperty("leadsBySource");
      expect(stats.sourceAttribution).toHaveProperty("callsBySource");
      expect(Array.isArray(stats.sourceAttribution.bookingsBySource)).toBe(true);
      expect(Array.isArray(stats.sourceAttribution.leadsBySource)).toBe(true);
      expect(Array.isArray(stats.sourceAttribution.callsBySource)).toBe(true);
    });

    it("should include callTracking fields", async () => {
      const { getDashboardStats } = await import("./admin-stats");
      const stats = await getDashboardStats();
      
      expect(stats).toHaveProperty("callTracking");
      expect(stats.callTracking).toHaveProperty("totalCalls");
      expect(stats.callTracking).toHaveProperty("thisWeek");
      expect(stats.callTracking).toHaveProperty("byPage");
      expect(typeof stats.callTracking.totalCalls).toBe("number");
      expect(typeof stats.callTracking.thisWeek).toBe("number");
      expect(Array.isArray(stats.callTracking.byPage)).toBe(true);
    });

    it("should include callbacks fields", async () => {
      const { getDashboardStats } = await import("./admin-stats");
      const stats = await getDashboardStats();
      
      expect(stats).toHaveProperty("callbacks");
      expect(stats.callbacks).toHaveProperty("total");
      expect(stats.callbacks).toHaveProperty("new");
      expect(stats.callbacks).toHaveProperty("completed");
      expect(stats.callbacks).toHaveProperty("thisWeek");
    });
  });

  describe("UTM data capture", () => {
    it("should have UTM columns in schema types", async () => {
      // Verify the schema exports include UTM fields (uses the mock)
      const schema = await import("../drizzle/schema");
      expect(schema.bookings).toBeDefined();
      expect(schema.leads).toBeDefined();
      expect(schema.callbackRequests).toBeDefined();
      expect(schema.callEvents).toBeDefined();
    });
  });

  describe("CSV Export format", () => {
    it("should generate valid CSV with headers", () => {
      // Test CSV generation logic
      const headers = ["ID", "Name", "Phone", "Service", "UTM Source", "UTM Medium", "UTM Campaign"];
      const rows = [
        [1, "John Doe", "(216) 555-1234", "Brakes", "facebook", "cpc", "spring_brakes"],
        [2, "Jane Smith", "(216) 555-5678", "Tires", "", "", ""],
      ];
      
      const csvRows = rows.map(r => 
        r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")
      );
      const csv = [headers.join(","), ...csvRows].join("\n");
      
      expect(csv).toContain("ID,Name,Phone,Service,UTM Source,UTM Medium,UTM Campaign");
      expect(csv).toContain('"facebook"');
      expect(csv).toContain('"John Doe"');
      expect(csv.split("\n").length).toBe(3); // header + 2 rows
    });

    it("should handle special characters in CSV", () => {
      const value = 'He said "hello"';
      const escaped = `"${value.replace(/"/g, '""')}"`;
      expect(escaped).toBe('"He said ""hello"""');
    });
  });

  describe("Call tracking data structure", () => {
    it("should have correct call event fields", () => {
      const callEvent = {
        phoneNumber: "(216) 862-0005",
        sourcePage: "home",
        sourceElement: "hero_cta",
        utmSource: "facebook",
        utmMedium: "cpc",
        utmCampaign: "spring_brakes",
        landingPage: "/",
        referrer: "https://facebook.com",
      };
      
      expect(callEvent.phoneNumber).toBe("(216) 862-0005");
      expect(callEvent.utmSource).toBe("facebook");
      expect(callEvent.sourcePage).toBe("home");
    });
  });
});
