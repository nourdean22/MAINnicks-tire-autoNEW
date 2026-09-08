/**
 * tests/services/plate-retention.test.ts · 2026-09-08 (ADR-0017 section 7)
 *
 * The privacy promise is "plate reads live 30 days unless linked to a
 * customer record". The scrub is one raw UPDATE; this pins its predicate
 * (unlinked, older than the window, plate text present) and that the
 * cutoff is derived from the injected clock, not from wall time.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ $executeRaw: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { scrubExpiredPlates, PLATE_RETENTION_DAYS } from "@/lib/services/plate-retention";

describe("plate retention scrub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$executeRaw.mockResolvedValue(3);
  });

  it("nulls plate text on unlinked camera events older than 30 days and reports the count", async () => {
    const now = new Date("2026-09-08T16:00:00Z");
    await expect(scrubExpiredPlates(now)).resolves.toBe(3);
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = db.$executeRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const sql = strings.join("?");
    expect(sql).toMatch(/UPDATE device_events/);
    expect(sql).toMatch(/event = 'vehicle_detected'/);
    expect(sql).toMatch(/created_at < \?/);
    expect(sql).toMatch(/customerRef/);
    expect(sql).toMatch(/<> 'matched'/);
    expect(sql).toMatch(/plateScrubbedAt/);
    expect(values).toContainEqual(new Date(now.getTime() - PLATE_RETENTION_DAYS * 24 * 60 * 60 * 1000));
  });
});
