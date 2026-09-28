import { describe, expect, it, vi } from "vitest";
import { getWorkerFreshness, WORKER_FRESHNESS_MS } from "@/lib/observability/worker-freshness";

function dbWith(createdAt: Date | null) {
  return {
    cronJobLog: {
      findFirst: vi.fn().mockResolvedValue(createdAt ? { createdAt } : null),
    },
  } as any;
}

describe("getWorkerFreshness", () => {
  const now = Date.parse("2026-09-28T03:00:00.000Z");

  it("is fresh through four missed 15-minute ticks", async () => {
    const createdAt = new Date(now - WORKER_FRESHNESS_MS);
    await expect(getWorkerFreshness(dbWith(createdAt), now)).resolves.toMatchObject({
      status: "fresh",
      ageMinutes: 60,
    });
  });

  it("turns stale after the one-hour tolerance", async () => {
    const createdAt = new Date(now - WORKER_FRESHNESS_MS - 1);
    await expect(getWorkerFreshness(dbWith(createdAt), now)).resolves.toMatchObject({
      status: "stale",
      ageMinutes: 60,
    });
  });

  it("reports unknown when no receipt exists or the probe fails", async () => {
    await expect(getWorkerFreshness(dbWith(null), now)).resolves.toMatchObject({
      status: "unknown",
      ageMinutes: null,
    });

    const failing = {
      cronJobLog: { findFirst: vi.fn().mockRejectedValue(new Error("db down")) },
    } as any;
    await expect(getWorkerFreshness(failing, now)).resolves.toMatchObject({
      status: "unknown",
      ageMinutes: null,
    });
  });
});
