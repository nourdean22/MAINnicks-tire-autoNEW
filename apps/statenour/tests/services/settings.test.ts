import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userPreference: {
      findUnique: (...args: unknown[]) => mocks.findUnique(...args),
      upsert: (...args: unknown[]) => mocks.upsert(...args),
    },
  },
}));

import { getSetting, setSetting, invalidateSettingsCache } from "@/lib/services/settings";

describe("getSetting cache TTL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateSettingsCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("caches database queries for the TTL window and refreshes after expiration", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00Z"));

    // First call: database query returns 5000.
    mocks.findUnique.mockResolvedValueOnce({ key: "ai.dailyBudgetCents", value: "5000", type: "number" });
    const val1 = await getSetting("ai.dailyBudgetCents", 2000);
    expect(val1).toBe(5000);
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);

    // Second call: immediate, should return cached 5000 without hitting DB.
    const val2 = await getSetting("ai.dailyBudgetCents", 2000);
    expect(val2).toBe(5000);
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);

    // Advance time by 29 seconds: still within the 30-second TTL.
    vi.setSystemTime(new Date("2026-07-10T12:00:29Z"));
    const val3 = await getSetting("ai.dailyBudgetCents", 2000);
    expect(val3).toBe(5000);
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);

    // Advance time past 30 seconds: cache expires, hits DB again, returns updated value.
    vi.setSystemTime(new Date("2026-07-10T12:00:31Z"));
    mocks.findUnique.mockResolvedValueOnce({ key: "ai.dailyBudgetCents", value: "8000", type: "number" });
    const val4 = await getSetting("ai.dailyBudgetCents", 2000);
    expect(val4).toBe(8000);
    expect(mocks.findUnique).toHaveBeenCalledTimes(2);
  });
});
