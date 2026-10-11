/**
 * A failed page_visit read must reject, not resolve as "no visits" (audit 02-F1). With `.catch(() => [])` the
 * empty array made every IMPORTANT_PAGES entry a blind spot, so the daily brief printed a false BLIND SPOT warning
 * instead of its "unknown" branch (compose-daily-brief.ts already catches and renders renderPagesBlock(null)).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { auditEvent: { findMany } } }));

import { analyzePagePatterns, IMPORTANT_PAGES } from "@/lib/brain/page-intelligence";

beforeEach(() => {
  findMany.mockReset(); // braces: a returned function would run as a cleanup hook and call the mock
});

describe("analyzePagePatterns read failure", () => {
  it("rejects when the audit-event read fails", async () => {
    findMany.mockImplementation(async () => {
      throw new Error("db down");
    });
    await expect(analyzePagePatterns()).rejects.toThrow("db down");
  });

  it("control: a measured empty week still resolves with every important page as a blind spot", async () => {
    findMany.mockResolvedValue([]);
    const p = await analyzePagePatterns();
    expect(p.topPages).toEqual([]);
    expect(p.blindSpots).toEqual(IMPORTANT_PAGES.map((x) => x.label));
  });
});
