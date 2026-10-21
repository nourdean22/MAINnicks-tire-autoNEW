/**
 * The PUBLIC customerEvents.log refuses event names that start with "admin_"
 * (2026-10-21).
 *
 * aiReferrals.summary counts customer_events rows named admin_ai_referral as
 * staff-logged referrals. customerEvents.log is public, so without this guard
 * anyone could inflate that count with one POST. The guard reads the
 * eventName field only: the same text inside eventData or sourcePage of a
 * normal event is free text and must still be stored.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const h = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  getDbCalls: 0,
}));

vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const fake = { insert: () => ({ values: async (v: Record<string, unknown>) => { h.inserts.push(v); } }) };
  const getDb = async () => { h.getDbCalls += 1; return fake; };
  return { ...actual, getDb, getDbTyped: getDb };
});

import { customerEventsRouter } from "../routers/admin/customerEvents";

const publicCaller = () =>
  customerEventsRouter.createCaller({ user: null, req: { headers: {} }, res: {} } as unknown as TrpcContext);

beforeEach(() => {
  h.inserts.length = 0;
  h.getDbCalls = 0;
});

describe("customerEvents.log refuses admin_* event names", () => {
  it.each(["admin_ai_referral", "ADMIN_ai_referral", " admin_x", "Admin_", "\tadmin_ai_referral"])(
    "%j is refused before any database call and nothing is written",
    async (eventName) => {
      await expect(publicCaller().log({ eventName })).resolves.toEqual({ success: false });
      expect(h.inserts).toHaveLength(0);
      expect(h.getDbCalls).toBe(0);
    },
  );

  // A case- or accent-insensitive collation can compare these EQUAL to admin_ai_referral
  // in the summary's WHERE, so a look-alike is a forgery too.
  it.each(["​admin_ai_referral", "ádmin_ai_referral", "ａｄｍｉｎ_ai_referral", "admin_ai_referral   "])(
    "look-alike %j is refused too",
    async (eventName) => {
      await expect(publicCaller().log({ eventName })).resolves.toEqual({ success: false });
      expect(h.inserts).toHaveLength(0);
    },
  );

  it("positive control: a normal event name is still written", async () => {
    await expect(publicCaller().log({ eventName: "ribbon_photo_view", eventData: { src: "/a.jpg" } })).resolves.toEqual({ success: true });
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].eventName).toBe("ribbon_photo_view");
  });

  it("names that only CONTAIN admin, or look like it, are not refused", async () => {
    for (const eventName of ["sticky_admin_click", "administrator_view", "admin-panel_open", "adminx"]) {
      await expect(publicCaller().log({ eventName })).resolves.toEqual({ success: true });
    }
    expect(h.inserts.map((r) => r.eventName)).toEqual(["sticky_admin_click", "administrator_view", "admin-panel_open", "adminx"]);
  });

  it("admin_ai_referral inside eventData or sourcePage of a normal event is free text and IS written", async () => {
    await publicCaller().log({
      eventName: "cta_click",
      eventData: { label: "admin_ai_referral" },
      sourcePage: "/admin_ai_referral",
    });
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]).toMatchObject({ eventName: "cta_click", sourcePage: "/admin_ai_referral" });
  });
});
