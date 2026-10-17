/**
 * W4 fix round 2 (c): the ticker's mastery lane shows no "rising this week" chip from a weekly read
 * that failed. computeCharacterSheet marks every stat `rising7dUnknown` then, and a partial weekly
 * number (one half of the read answered) must not become "+N XP this week". The MEASURED control:
 * a read that succeeded still yields the riser chip. The "next level" chip reads progress, not the
 * week, and stays either way.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ sheet: [] as unknown[] }));
vi.mock("@/lib/mastery/character-sheet", () => ({ computeCharacterSheet: async () => h.sheet }));
vi.mock("@/lib/utils/cache", () => ({ cached: (_k: string, _t: number, fn: () => unknown) => fn() }));
vi.mock("@/lib/ultron/timelines", () => ({ computeInputs: vi.fn(), generateTimelines: vi.fn() }));
vi.mock("@/lib/nickstire/query", () => ({ queryNickBatch: vi.fn(), readBridge: vi.fn() }));

import { fetchMasteryItems } from "@/lib/services/ultron-ticker";

const stat = (label: string, rising7dXp: number, progressPct: number, unknown = false) => ({
  key: label.toLowerCase(),
  label,
  level: 4,
  xpIntoLevel: 70,
  xpForNext: 100,
  progressPct,
  rising7dXp,
  ...(unknown ? { rising7dUnknown: true } : {}),
});

beforeEach(() => {
  h.sheet = [];
});

describe("ticker mastery lane with an unreadable week", () => {
  it("control: a measured week yields the riser chip", async () => {
    h.sheet = [stat("Focus", 9, 70), stat("Craft", 0, 10)];
    const items = await fetchMasteryItems();
    expect(items.find((i) => i.id === "mastery-riser")?.label).toBe("Focus +9 XP this week");
  });

  it("shows no riser chip when the week could not be read, and keeps the next-level chip", async () => {
    h.sheet = [stat("Focus", 9, 70, true), stat("Craft", 0, 10, true)];
    const items = await fetchMasteryItems();
    expect(items.find((i) => i.id === "mastery-riser"), "an unread week became a riser chip").toBeUndefined();
    expect(items.find((i) => i.id === "mastery-next")).toBeTruthy();
  });
});
