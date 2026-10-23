/**
 * Home shows open contradictions as ONE count row, never row text (2026-10-23).
 *
 * The reader is lib/services/contradictions.ts countUnresolvedContradictions, the
 * number the /brain panel totals. 80 rows on Home would flood it, so it is a
 * count and a link to the panel; the daily question lives in chat. A failed
 * count must reject out of the loader so buildOperatorBrief's `guarded` turns it
 * into the "contradictions unavailable" state, never into "no contradictions".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ count: vi.fn() }));
vi.mock("@/lib/services/outcome-ledger", () => ({ recordShownBounded: vi.fn() }));
vi.mock("@/lib/services/contradictions", () => ({ countUnresolvedContradictions: h.count }));

import { __testInternals } from "@/lib/home/operator-brief";

beforeEach(() => {
  h.count.mockReset();
});

describe("Home contradiction row", () => {
  it("is one count row linking to the panel, with no row text", async () => {
    h.count.mockResolvedValue(80);
    const items = await __testInternals.loadContradictionItems();
    expect(items).toEqual([{ kind: "contradiction", count: 80, href: "/brain?tab=memory" }]);
  });

  it("is absent on a measured zero", async () => {
    h.count.mockResolvedValue(0);
    expect(await __testInternals.loadContradictionItems()).toEqual([]);
  });

  it("rejects on a failed count so the brief reports the source unavailable", async () => {
    h.count.mockRejectedValue(new Error("db down"));
    await expect(__testInternals.loadContradictionItems()).rejects.toThrow("db down");
  });
});
