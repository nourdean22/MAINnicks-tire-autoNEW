/**
 * 2026-11-01 · Nick can answer "is the shop open" from a tool (job 2026-11-01-double-check-missed, part 2).
 *
 * The chat rule says shop hours and open/closed come only from a tool result in the turn, and no
 * tool returned hours. lib/nickstire/shop-hours.ts is the ONE statenour copy; apps/nickstire/shared/
 * business.ts `hours.structured` is the source of truth. A copy that drifts silently is the defect
 * class this repo keeps hitting, so the drift test reads business.ts as TEXT and fails on any
 * disagreement (a deleted/renamed block fails too: it must find 7 days).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SHOP_HOURS, SHOP_HOURS_COMPACT, SHOP_TIMEZONE, shopHoursView } from "@/lib/nickstire/shop-hours";
import { SMS_VOICE } from "@/lib/ai/knowledge/brand-constants";

const BUSINESS_TS = resolve(__dirname, "../../../nickstire/shared/business.ts");
const BRAND_CONSTANTS_TS = resolve(__dirname, "../../lib/ai/knowledge/brand-constants.ts");
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

describe("drift: statenour shop hours equal nickstire's business.ts", () => {
  const text = readFileSync(BUSINESS_TS, "utf8");

  it("POSITIVE CONTROL: the scan locates the structured block and all 7 days", () => {
    const block = /structured:\s*\{([^}]*)\}/.exec(text);
    expect(block, "hours.structured block not found in business.ts").not.toBeNull();
    const pairs = [...block![1].matchAll(/(\w+):\s*"(\d{2}:\d{2}-\d{2}:\d{2})"/g)];
    expect(pairs).toHaveLength(7);
  });

  it("every weekday string is identical", () => {
    const block = /structured:\s*\{([^}]*)\}/.exec(text)![1];
    const theirs = Object.fromEntries([...block.matchAll(/(\w+):\s*"(\d{2}:\d{2}-\d{2}:\d{2})"/g)].map((m) => [m[1], m[2]]));
    expect(SHOP_HOURS).toEqual(theirs);
  });

  it("the timezone is identical", () => {
    const tz = /timezone:\s*"([^"]+)"/.exec(text);
    expect(tz?.[1]).toBe(SHOP_TIMEZONE);
  });

  it("the typed hours strings in brand-constants.ts say the same hours", () => {
    const src = readFileSync(BRAND_CONSTANTS_TS, "utf8");
    const hits = [...src.matchAll(/Mon-Sat (\d+)AM-(\d+)PM(?:,| \|) Sun (\d+)AM-(\d+)PM/g)];
    expect(hits.length).toBeGreaterThanOrEqual(3); // POSITIVE CONTROL: the scan found the typed copies
    const h12 = (hhmm: string) => String(Number(hhmm.slice(0, 2)) % 12 || 12);
    const [mo, so] = [SHOP_HOURS.monday.split("-"), SHOP_HOURS.sunday.split("-")];
    for (const m of hits) expect([m[1], m[2], m[3], m[4]]).toEqual([h12(mo[0]), h12(mo[1]), h12(so[0]), h12(so[1])]);
  });

  it("the SMS voice line is built from the constant, not typed", () => {
    expect(SMS_VOICE).toContain(`(${SHOP_HOURS_COMPACT})`);
    expect(SHOP_HOURS_COMPACT).toBe("Mon-Sat 8-6 / Sun 9-4");
  });
});

describe("shopHoursView: openNow in America/New_York, DST-safe", () => {
  const at = (iso: string) => shopHoursView(new Date(iso));

  it("returns the full weekly table and the timezone", () => {
    const v = at("2026-07-06T15:00:00Z");
    expect(v.timezone).toBe("America/New_York");
    expect(Object.keys(v.weekly).sort()).toEqual([...DAYS].sort());
    expect(v.weekly.sunday).toBe("09:00-16:00");
  });

  it("summer (EDT, UTC-4): Monday opens 08:00 and closes 18:00 ET", () => {
    expect(at("2026-07-06T11:59:00Z").openNow).toBe(false); // 07:59 EDT
    expect(at("2026-07-06T12:00:00Z").openNow).toBe(true); // 08:00 EDT
    expect(at("2026-07-06T21:59:00Z").openNow).toBe(true); // 17:59 EDT
    expect(at("2026-07-06T22:00:00Z").openNow).toBe(false); // 18:00 EDT
  });

  it("winter (EST, UTC-5): the same wall-clock hours, five hours behind UTC", () => {
    expect(at("2026-01-12T12:59:00Z").openNow).toBe(false); // 07:59 EST
    expect(at("2026-01-12T13:00:00Z").openNow).toBe(true); // 08:00 EST
    expect(at("2026-01-12T22:59:00Z").openNow).toBe(true); // 17:59 EST
    expect(at("2026-01-12T23:00:00Z").openNow).toBe(false); // 18:00 EST
  });

  it("the DST fall-back Sunday (2026-11-01): Sunday hours 09:00-16:00 on EST wall-clock", () => {
    expect(at("2026-11-01T13:59:00Z").openNow).toBe(false); // 08:59 EST (a fixed UTC-4 would say 09:59: open)
    expect(at("2026-11-01T14:00:00Z").openNow).toBe(true); // 09:00 EST
    expect(at("2026-11-01T20:59:00Z").openNow).toBe(true); // 15:59 EST
    expect(at("2026-11-01T21:00:00Z").openNow).toBe(false); // 16:00 EST
    expect(at("2026-11-01T14:00:00Z").today).toEqual({ weekday: "sunday", hours: "09:00-16:00" });
  });

  it("the spring-forward Sunday (2026-03-08) uses EDT after 02:00", () => {
    expect(at("2026-03-08T12:59:00Z").openNow).toBe(false); // 08:59 EDT
    expect(at("2026-03-08T13:00:00Z").openNow).toBe(true); // 09:00 EDT
  });

  it("Sunday 16:30 ET is closed (Sunday close is 16:00) while Saturday 16:30 ET is open (Saturday close is 18:00)", () => {
    expect(at("2026-07-12T20:30:00Z").openNow).toBe(false); // Sunday
    expect(at("2026-07-11T20:30:00Z").openNow).toBe(true); // Saturday
  });

  it("the weekday is the ET weekday, not the server's UTC weekday", () => {
    const v = at("2026-11-02T03:00:00Z"); // Sunday 22:00 EST; UTC already says Monday
    expect(v.today.weekday).toBe("sunday");
    expect(v.openNow).toBe(false);
  });

  it("says its basis: the regular weekly schedule, holidays are not modelled", () => {
    expect(at("2026-07-06T15:00:00Z").basis).toMatch(/regular weekly hours.*holiday/i);
  });
});
