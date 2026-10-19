/**
 * Tab-level page visits (2026-10-19, wave 3 group 5, review round).
 *
 * The tracker stored only the bare pathname, so usage of /brain (9 tabs) and /stats (3 tabs) was
 * unmeasurable. A tab click is NOT a page visit: page-intelligence, the page-visit GET, the pipeline's
 * late-night count and system-actions all count `page_visit` rows, so a tab change written as another
 * page_visit would inflate topPages, avgDailyVisits and totalVisits. Tab views go in their own
 * `page_tab_visit` rows (detail = the bare path, payload.tab = the tab). page_visit stays exactly as
 * before. Assertions read what prisma was asked to STORE.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { auditEvent: { create } } }));

import { recordPageTabVisit, recordPageVisit } from "@/lib/services/brain-domain";

const stored = () => create.mock.calls[0][0].data as { eventType: string; detail: string; payload: Record<string, unknown> };

beforeEach(() => create.mockReset().mockResolvedValue({ id: "evt" }));

describe("recordPageTabVisit", () => {
  it("a tab view is a page_tab_visit row: detail is the bare path, payload.tab is the tab", async () => {
    await recordPageTabVisit({ page: "/brain", tab: "wisdom" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(stored().eventType).toBe("page_tab_visit");
    expect(stored().detail).toBe("/brain");
    expect(stored().payload).toMatchObject({ page: "/brain", tab: "wisdom" });
  });

  it("an empty tab writes nothing at all", async () => {
    await recordPageTabVisit({ page: "/stats", tab: "" });
    await recordPageTabVisit({ page: "/stats", tab: null });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("recordPageVisit stays a pathname-only event", () => {
  it("writes eventType page_visit with no tab key, whatever the caller passes", async () => {
    await recordPageVisit({ page: "/brain", referrer: null, tab: "wisdom" } as never);
    expect(stored().eventType).toBe("page_visit");
    expect(stored().detail).toBe("/brain");
    expect("tab" in stored().payload).toBe(false);
  });
});
