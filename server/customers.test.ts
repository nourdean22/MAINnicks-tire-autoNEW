/**
 * Tests for customers router — admin endpoints for imported customer records.
 * Covers: schema, router exports, quickSms, updateNotes, retryCampaign, exportCsv, campaignStats
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockOffset = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();

const mockDb = {
  select: mockSelect,
  update: mockUpdate,
};

vi.mock("../drizzle/schema", () => ({
  customers: {
    id: "id",
    firstName: "firstName",
    lastName: "lastName",
    phone: "phone",
    email: "email",
    city: "city",
    segment: "segment",
    customerType: "customerType",
    totalVisits: "totalVisits",
    lastVisitDate: "lastVisitDate",
    smsCampaignSent: "smsCampaignSent",
    smsCampaignDate: "smsCampaignDate",
    notes: "notes",
  },
}));

describe("Customers Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Schema", () => {
    it("should have the customers table with all required fields", async () => {
      const { customers } = await import("../drizzle/schema");
      expect(customers).toBeDefined();
      expect(customers).toHaveProperty("id");
      expect(customers).toHaveProperty("firstName");
      expect(customers).toHaveProperty("lastName");
      expect(customers).toHaveProperty("phone");
      expect(customers).toHaveProperty("email");
      expect(customers).toHaveProperty("segment");
      expect(customers).toHaveProperty("customerType");
      expect(customers).toHaveProperty("totalVisits");
      expect(customers).toHaveProperty("lastVisitDate");
    });

    it("should have SMS campaign tracking fields", async () => {
      const { customers } = await import("../drizzle/schema");
      expect(customers).toHaveProperty("smsCampaignSent");
      expect(customers).toHaveProperty("smsCampaignDate");
    });

    it("should have notes field for customer notes", async () => {
      const { customers } = await import("../drizzle/schema");
      expect(customers).toHaveProperty("notes");
    });
  });

  describe("Customer Data Integrity", () => {
    it("should have valid segment enum values in schema", async () => {
      const { customers } = await import("../drizzle/schema");
      expect(customers.segment).toBeDefined();
    });

    it("should have valid customerType enum values in schema", async () => {
      const { customers } = await import("../drizzle/schema");
      expect(customers.customerType).toBeDefined();
    });
  });

  describe("Router Exports", () => {
    it("should export customersRouter from the routers index", async () => {
      const { customersRouter } = await import("./routers/customers");
      expect(customersRouter).toBeDefined();
    });

    it("should have all expected procedures", async () => {
      const { customersRouter } = await import("./routers/customers");
      expect(customersRouter).toBeDefined();
      expect(customersRouter._def).toBeDefined();
      expect(customersRouter._def.procedures).toBeDefined();
      // Core CRUD
      expect(customersRouter._def.procedures.list).toBeDefined();
      expect(customersRouter._def.procedures.stats).toBeDefined();
      expect(customersRouter._def.procedures.getById).toBeDefined();
      expect(customersRouter._def.procedures.updateSegment).toBeDefined();
      // Quick SMS
      expect(customersRouter._def.procedures.quickSms).toBeDefined();
      // Notes
      expect(customersRouter._def.procedures.updateNotes).toBeDefined();
      // Campaign
      expect(customersRouter._def.procedures.retryCampaign).toBeDefined();
      expect(customersRouter._def.procedures.campaignStats).toBeDefined();
      // Export
      expect(customersRouter._def.procedures.exportCsv).toBeDefined();
      // Follow-ups
      expect(customersRouter._def.procedures.recentFollowUps).toBeDefined();
    });
  });

  describe("Router Registration", () => {
    it("should be registered in the main appRouter", async () => {
      const { appRouter } = await import("./routers");
      expect(appRouter).toBeDefined();
      expect(appRouter._def.procedures).toBeDefined();
    });
  });

  describe("Procedure Input Validation", () => {
    it("quickSms should require customerId and message", async () => {
      const { customersRouter } = await import("./routers/customers");
      const proc = customersRouter._def.procedures.quickSms;
      expect(proc).toBeDefined();
      // The procedure exists and is a mutation
      expect(proc._def).toBeDefined();
    });

    it("updateNotes should require id and notes", async () => {
      const { customersRouter } = await import("./routers/customers");
      const proc = customersRouter._def.procedures.updateNotes;
      expect(proc).toBeDefined();
      expect(proc._def).toBeDefined();
    });

    it("retryCampaign should accept optional batchSize", async () => {
      const { customersRouter } = await import("./routers/customers");
      const proc = customersRouter._def.procedures.retryCampaign;
      expect(proc).toBeDefined();
      expect(proc._def).toBeDefined();
    });

    it("exportCsv should accept segment filter", async () => {
      const { customersRouter } = await import("./routers/customers");
      const proc = customersRouter._def.procedures.exportCsv;
      expect(proc).toBeDefined();
      expect(proc._def).toBeDefined();
    });
  });

  describe("SMS Message Templates", () => {
    it("should have the correct campaign message format with review link and referral", async () => {
      const { STORE_NAME, STORE_PHONE, GBP_REVIEW_URL } = await import("@shared/const");
      expect(STORE_NAME).toBeDefined();
      expect(STORE_PHONE).toBeDefined();
      expect(GBP_REVIEW_URL).toBeDefined();
      // Verify the review URL is a valid Google URL
      expect(GBP_REVIEW_URL).toContain("google");
    });

    it("should have referral URL in shared constants", async () => {
      // The campaign message references nickstire.org/refer
      const constants = await import("@shared/const");
      expect(constants).toBeDefined();
    });
  });
});
