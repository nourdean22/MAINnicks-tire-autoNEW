import { vi } from "vitest";

// Prevent module cache pollution from other tests that mock these globally
vi.doUnmock("../db");
vi.doUnmock("../lib/db-helper");
vi.doUnmock("../../drizzle/schema");
vi.doUnmock("drizzle-orm");
vi.doUnmock("drizzle-orm/mysql2");
vi.doUnmock("mysql2/promise");

import { describe, expect, it, afterEach } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { db } from "../lib/db-helper";

const HAS_DB = !!process.env.DATABASE_URL;

function createVoiceContext(): TrpcContext {
  return {
    user: null,
    isVoiceAgentInternal: true,
    req: {
      protocol: "https",
      headers: {},
    } as any,
    res: {
      clearCookie: () => {},
    } as any,
  };
}

describe.skipIf(!HAS_DB)("voiceAgent Router Procedures", () => {
  const testPhone = "2165559999";
  const testName = "Test Voice Agent Sentinel";
  const testVehicle = "2020 Honda Civic";
  const testService = "Tires";

  afterEach(async () => {
    // Clean up any test leads or callbacks inserted during the test run
    try {
      const d = await db();
      const { leads, callbackRequests } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      if (d && typeof d.delete === "function") {
        await d.delete(leads).where(eq(leads.phone, testPhone));
        await d.delete(callbackRequests).where(eq(callbackRequests.phone, testPhone));
      }
    } catch (err) {
      console.warn("Cleanup failed:", err);
    }
  });

  describe("bookSlot", () => {
    it("returns walk-in/drop-off guidance and does not insert any booking row", async () => {
      const d = await db();
      const { bookings } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      // Count bookings before
      const countBefore = d && typeof d.select === "function"
        ? (await d.select().from(bookings).where(eq(bookings.phone, testPhone))).length
        : 0;

      const caller = appRouter.createCaller(createVoiceContext());
      const res = await caller.voiceAgent.bookSlot({
        name: testName,
        phone: testPhone,
        vehicle: testVehicle,
        service: testService,
        preferredDay: "Monday",
      });

      // Assert return format
      expect(res).toBeDefined();
      expect(res.success).toBe(true);
      expect(res.reference).toBe("WALKIN-INFO");
      expect(res.status).toBe("walk_in_guidance");
      expect(res.message).toContain("No appointment was booked");
      expect(res.message).toContain("first come, first served");

      // Verify no booking was inserted
      const countAfter = d && typeof d.select === "function"
        ? (await d.select().from(bookings).where(eq(bookings.phone, testPhone))).length
        : 0;
      expect(countAfter).toBe(countBefore);
    });
  });

  describe("checkTireStock", () => {
    it("creates a high-urgency lead with updated problem text and no promised SLA callback time", async () => {
      const d = await db();
      const { leads } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const caller = appRouter.createCaller(createVoiceContext());
      const res = await caller.voiceAgent.checkTireStock({
        name: testName,
        phone: testPhone,
        tireSize: "215/55R16",
        vehicle: testVehicle,
      });

      expect(res).toBeDefined();
      expect(res.success).toBe(true);
      expect(res.message).toContain("check the physical rack");
      expect(res.message).not.toContain("15 minutes");

      // Verify lead exists in db
      if (d && typeof d.select === "function") {
        const insertedLeads = await d.select().from(leads).where(eq(leads.phone, testPhone));
        expect(insertedLeads.length).toBe(1);
        const lead = insertedLeads[0];
        expect(lead.urgencyScore).toBe(5);
        expect(lead.problem).toContain("[VOICE-AGENT RACK CHECK]");
        expect(lead.problem).toContain("Physical rack check requested (no callback time promised)");
        expect(lead.problem).not.toContain("15 min callback");
        expect(lead.problem).not.toContain("promised 15 min");
      }
    });
  });

  describe("scheduleCallback", () => {
    it("correctly inserts callback request in the database", async () => {
      const d = await db();
      const { callbackRequests } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const caller = appRouter.createCaller(createVoiceContext());
      const res = await caller.voiceAgent.scheduleCallback({
        name: testName,
        phone: testPhone,
        reason: "Need alignment quote",
        preferredTime: "morning",
      });

      expect(res).toBeDefined();
      expect(res.success).toBe(true);

      if (d && typeof d.select === "function") {
        const insertedCallbacks = await d.select().from(callbackRequests).where(eq(callbackRequests.phone, testPhone));
        expect(insertedCallbacks.length).toBe(1);
        expect(insertedCallbacks[0].context).toContain("[VOICE-AGENT CALLBACK]");
        expect(insertedCallbacks[0].context).toContain("prefers: morning");
        expect(insertedCallbacks[0].context).toContain("Need alignment quote");
      }
    });
  });

  describe("sendConfirmationSms", () => {
    it("runs successfully and handles degraded SMS states", async () => {
      const caller = appRouter.createCaller(createVoiceContext());
      const res = await caller.voiceAgent.sendConfirmationSms({
        phone: testPhone,
        summary: "Walk-in tire service request",
      });

      expect(res).toBeDefined();
      expect(res).toHaveProperty("sent");
    });
  });
});
