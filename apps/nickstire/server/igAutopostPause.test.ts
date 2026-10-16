/**
 * ig_autopost_paused stops the scheduled image lane BEFORE any spend
 * (job 2026-10-16-ig-autopost-controls).
 *
 * Before this flag the only "off" for the lane was legacy_autopost_live, and
 * turning that off only made runIgAutopost a dry run: it still built the brief,
 * generated, rendered, judged and Telegrammed every slot. The pause is checked
 * in runIgAutopostCron, after the slot gate (so a paused lane only reports a
 * skip when it would have acted) and before alreadyRanSlotToday and
 * runIgAutopost. The manual door (runIgAutopostOneOff, the admin source) never
 * reads it.
 *
 * "Reached generation" is observed as runIgAutopost's first read,
 * isEnabled("legacy_autopost_live"); the mock throws a sentinel there so the
 * pipeline never runs for real. "Reached the dedupe read" is observed as any
 * db() call (alreadyRanSlotToday is the only db reader before runIgAutopost).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  paused: false,
  db: vi.fn(async () => null),
  isEnabled: vi.fn(),
}));

vi.mock("./lib/db-helper", () => ({
  db: h.db,
  dbTyped: h.db,
  requireDb: async () => {
    throw new Error("requireDb not expected in this test");
  },
}));

vi.mock("./services/featureFlags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/featureFlags")>();
  return { ...actual, isEnabled: h.isEnabled };
});

import { runIgAutopostCron, runIgAutopostOneOff } from "./services/igAutopost";

const REACHED_RUN = "sentinel: runIgAutopost reached";
// 2026-10-15 12:07 UTC = 08:07 America/New_York (EDT): inside the morning slot.
const IN_SLOT = new Date("2026-10-15T12:07:00Z");
// 2026-10-15 15:00 UTC = 11:00 ET: no slot window.
const OUT_OF_SLOT = new Date("2026-10-15T15:00:00Z");

beforeEach(() => {
  h.paused = false;
  h.db.mockClear();
  h.isEnabled.mockReset();
  h.isEnabled.mockImplementation(async (key: string) => {
    if (key === "ig_autopost_paused") return h.paused;
    if (key === "legacy_autopost_live") throw new Error(REACHED_RUN);
    return false;
  });
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

const keysRead = () => h.isEnabled.mock.calls.map((c) => c[0]);

describe("runIgAutopostCron honours ig_autopost_paused", () => {
  it("paused inside a slot window: returns the skip before the dedupe read and before any generation", async () => {
    vi.setSystemTime(IN_SLOT);
    h.paused = true;
    const res = await runIgAutopostCron();
    expect(res).toEqual({ recordsProcessed: 0, details: "Skip — paused by ig_autopost_paused" });
    expect(keysRead()).toEqual(["ig_autopost_paused"]);
    expect(h.db).not.toHaveBeenCalled();
  });

  it("control: not paused inside a slot window, the cron reaches the dedupe read and runIgAutopost", async () => {
    vi.setSystemTime(IN_SLOT);
    await expect(runIgAutopostCron()).rejects.toThrow(REACHED_RUN);
    expect(keysRead()).toEqual(["ig_autopost_paused", "legacy_autopost_live"]);
    expect(h.db).toHaveBeenCalled();
  });

  it("paused outside a slot window: the slot gate answers first and the flag is not read", async () => {
    vi.setSystemTime(OUT_OF_SLOT);
    h.paused = true;
    const res = await runIgAutopostCron();
    expect(res.details).toBe("Skip — not within a posting-slot window");
    expect(h.isEnabled).not.toHaveBeenCalled();
  });
});

describe("the manual run door ignores the pause", () => {
  it("runIgAutopostOneOff reaches generation while paused and never reads the pause flag", async () => {
    vi.setSystemTime(IN_SLOT);
    h.paused = true;
    await expect(runIgAutopostOneOff()).rejects.toThrow(REACHED_RUN);
    expect(keysRead()).toEqual(["legacy_autopost_live"]);
  });
});
