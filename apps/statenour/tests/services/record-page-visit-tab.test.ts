/**
 * Tab-level page visits (2026-10-18, wave 3 group 5).
 *
 * The tracker stored only the bare pathname, so usage of /brain (9 tabs) and /stats (3 tabs) was
 * unmeasurable and every tab was kept for lack of evidence. The tab now rides in the audit event
 * `payload` ONLY. `detail` stays the bare path: GET /api/brain/page-visit and
 * lib/brain/page-intelligence.ts group and compare by `detail`, so a tab in `detail` would split
 * one page into many and break the blind-spot list.
 *
 * Assertions read what prisma was asked to STORE.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { auditEvent: { create } } }));

import { recordPageVisit } from "@/lib/services/brain-domain";

const stored = () => create.mock.calls[0][0].data as { detail: string; payload: Record<string, unknown> };

beforeEach(() => create.mockReset().mockResolvedValue({ id: "evt" }));

describe("recordPageVisit · tab", () => {
  it("a visit to /brain?tab=wisdom keeps detail '/brain' and carries payload.tab 'wisdom'", async () => {
    await recordPageVisit({ page: "/brain", tab: "wisdom" });
    expect(stored().detail).toBe("/brain");
    expect(stored().payload.page).toBe("/brain");
    expect(stored().payload.tab).toBe("wisdom");
  });

  it("a visit without a tab carries none (no null, no empty string)", async () => {
    await recordPageVisit({ page: "/brain" });
    expect(stored().detail).toBe("/brain");
    expect("tab" in stored().payload).toBe(false);
    create.mockClear();
    await recordPageVisit({ page: "/stats", tab: "" });
    expect("tab" in stored().payload).toBe(false);
  });

  it("the tab never leaks into detail, whatever its value", async () => {
    await recordPageVisit({ page: "/stats", tab: "body" });
    expect(stored().detail).toBe("/stats");
    expect(JSON.stringify(stored().detail)).not.toContain("body");
  });
});
