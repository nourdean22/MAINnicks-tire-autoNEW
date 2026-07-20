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
    // 2026-07-20 · Rewritten. This used to assert the tool created an
    // urgency-5 "[VOICE-AGENT RACK CHECK]" lead. Rack checks now hand off to a
    // person and write NOTHING — no lead row, no Telegram, no promise (the old
    // "front desk will follow up" had no completion path anywhere). The
    // behavioural contract is pinned DB-free in
    // voiceAgent.no-fabrication.test.ts, which — unlike this file — is not
    // skipIf(!HAS_DB) and therefore actually runs in CI. What's left here is
    // the DB-dependent half: proving no lead row appears.
    it("writes NO lead row — a rack check is a hand-off, not a capture", async () => {
      const d = await db();
      const { leads } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const caller = appRouter.createCaller(createVoiceContext());
      const res = await caller.voiceAgent.checkTireStock({
        tireSize: "215/55R16",
        vehicle: testVehicle,
      });

      expect(res).toBeDefined();
      expect(res.success).toBe(true);
      expect(res.handOffToHuman).toBe(true);

      if (d && typeof d.select === "function") {
        const insertedLeads = await d.select().from(leads).where(eq(leads.phone, testPhone));
        expect(insertedLeads.length).toBe(0);
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
