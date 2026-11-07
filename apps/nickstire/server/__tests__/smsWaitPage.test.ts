/**
 * Page the counter (audit 2026-11-07): average first reply was 66 h. When a real inbound
 * text has had no outbound reply for 15 minutes while the shop is open (BUSINESS hours,
 * America/New_York), the on-duty manager gets ONE internal text through the same sender
 * as COMING IN (textOnDutyManager). Once per conversation: the claim is an INSERT IGNORE
 * on cron_alerts_fired, so a second tick, or a second replica, cannot page twice.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  waits: [] as Array<Record<string, unknown>>,
  claims: new Set<string>(),
  reads: 0,
  textOnDutyManager: vi.fn(),
}));

function render(q: unknown): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const walk = (node: unknown): string => {
    if (node && typeof node === "object" && Array.isArray((node as { queryChunks?: unknown[] }).queryChunks)) {
      return (node as { queryChunks: unknown[] }).queryChunks.map(walk).join("");
    }
    if (node && typeof node === "object" && Array.isArray((node as { value?: unknown }).value)) {
      return (node as { value: string[] }).value.join("");
    }
    params.push(node);
    return "?";
  };
  return { text: walk(q).replace(/\s+/g, " ").trim(), params };
}

vi.mock("../db", () => ({
  getDb: async () => ({
    execute: async (q: unknown) => {
      const { text, params } = render(q);
      if (/^INSERT IGNORE INTO cron_alerts_fired/.test(text)) {
        const key = `${params[0]}|${params[1]}`;
        if (h.claims.has(key)) return [{ affectedRows: 0 }, []];
        h.claims.add(key);
        return [{ affectedRows: 1 }, []];
      }
      if (/^DELETE FROM cron_alerts_fired/.test(text)) {
        h.claims.delete(`${params[0]}|${params[1]}`);
        return [{ affectedRows: 1 }, []];
      }
      if (/FROM sms_response_jobs j/.test(text)) {
        h.reads++;
        return [h.waits, []];
      }
      throw new Error(`unexpected query: ${text}`);
    },
  }),
}));

vi.mock("../services/eventBus", () => ({ textOnDutyManager: (...a: unknown[]) => h.textOnDutyManager(...a) }));

import { pageWaitingTexts } from "../services/smsWaitPage";

// 2026-11-04 is a Wednesday (EST, UTC-5): open 08:00-18:00. 2026-11-08 is a Sunday: 09:00-16:00.
const WED_2PM = new Date("2026-11-04T19:00:00Z");
const WED_10PM = new Date("2026-11-05T03:00:00Z");
const SUN_830AM = new Date("2026-11-08T13:30:00Z");
const SUN_930AM = new Date("2026-11-08T14:30:00Z");

const wait = (over: Record<string, unknown> = {}) => ({
  firstJobId: 101,
  conversationId: 501,
  phone: "+12163217788",
  customerName: "Pat",
  body: "can i bring my car in today",
  allBodies: "can i bring my car in today",
  texts: 1,
  waitingMinutes: 17,
  ...over,
});

beforeEach(() => {
  h.waits = [];
  h.claims.clear();
  h.reads = 0;
  h.textOnDutyManager.mockReset().mockResolvedValue({ status: "sent" });
});

describe("pageWaitingTexts", () => {
  it("inside hours, a real text waiting 15+ minutes pages the counter once, through textOnDutyManager", async () => {
    h.waits = [wait()];
    await expect(pageWaitingTexts(WED_2PM)).resolves.toMatchObject({ paged: 1 });
    expect(h.textOnDutyManager).toHaveBeenCalledTimes(1);
    const text = String(h.textOnDutyManager.mock.calls[0][0]);
    expect(text).toMatch(/^TEXT WAITING/);
    expect(text).toContain("Pat - (216) 321-7788");
    expect(text).toContain("can i bring my car in today");
    expect(text).toContain("17m");
  });

  it("a second tick (or a second replica) does not page the same conversation again", async () => {
    h.waits = [wait()];
    await pageWaitingTexts(WED_2PM);
    await expect(pageWaitingTexts(new Date(WED_2PM.getTime() + 45_000))).resolves.toMatchObject({ paged: 0 });
    expect(h.textOnDutyManager).toHaveBeenCalledTimes(1);
  });

  it("outside opening hours it never pages and never reads", async () => {
    h.waits = [wait()];
    await expect(pageWaitingTexts(WED_10PM)).resolves.toMatchObject({ paged: 0, skipped: "shop closed" });
    await expect(pageWaitingTexts(SUN_830AM)).resolves.toMatchObject({ paged: 0, skipped: "shop closed" });
    expect(h.textOnDutyManager).not.toHaveBeenCalled();
    expect(h.reads).toBe(0);
  });

  it("uses each day's own hours: Sunday opens at 9", async () => {
    h.waits = [wait()];
    await expect(pageWaitingTexts(SUN_930AM)).resolves.toMatchObject({ paged: 1 });
  });

  it("a text waiting under 15 minutes is not paged", async () => {
    h.waits = [wait({ waitingMinutes: 14 })];
    await expect(pageWaitingTexts(WED_2PM)).resolves.toMatchObject({ paged: 0 });
    expect(h.textOnDutyManager).not.toHaveBeenCalled();
  });

  it("a spam-only thread and an internal line are not paged", async () => {
    h.waits = [
      wait({ conversationId: 601, firstJobId: 201, body: "https://bit.ly/abcdEF", allBodies: "https://bit.ly/abcdEF" }),
      wait({ conversationId: 602, firstJobId: 202, phone: "+12168620005" }),
    ];
    await expect(pageWaitingTexts(WED_2PM)).resolves.toMatchObject({ paged: 0 });
    expect(h.textOnDutyManager).not.toHaveBeenCalled();
  });

  it("a failed send gives the claim back, so the next tick tries again", async () => {
    h.waits = [wait()];
    h.textOnDutyManager.mockResolvedValueOnce({ status: "failed", reason: "gateway down" });
    await expect(pageWaitingTexts(WED_2PM)).resolves.toMatchObject({ paged: 0 });
    await expect(pageWaitingTexts(WED_2PM)).resolves.toMatchObject({ paged: 1 });
    expect(h.textOnDutyManager).toHaveBeenCalledTimes(2);
  });

  it("several waiting conversations go out as ONE text, each claimed", async () => {
    h.waits = [wait(), wait({ conversationId: 502, firstJobId: 102, customerName: null, body: "coolant leak", allBodies: "coolant leak", waitingMinutes: 40 })];
    await expect(pageWaitingTexts(WED_2PM)).resolves.toMatchObject({ paged: 2 });
    expect(h.textOnDutyManager).toHaveBeenCalledTimes(1);
    expect(String(h.textOnDutyManager.mock.calls[0][0])).toMatch(/coolant leak[\s\S]*can i bring my car in today/);
    expect(h.claims.size).toBe(2);
  });
});
