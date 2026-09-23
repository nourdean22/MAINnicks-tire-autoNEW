/**
 * cron_job_logs."skipReason" · a skip is its own outcome (2026-09-23).
 *
 * A run that returned `{ skipped: "NICK_AUTONOMY off" }` used to settle as
 * `success` with resultCount NULL - the same row as a run that worked and
 * reported no count (479 of 694 successes in 24 h were NULL-count, and none
 * could be told apart). These assert what the route-cron writer actually hands
 * prisma, plus the reader both writers share. The Inngest writer is covered in
 * tests/observability/cron-lifecycle.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ id: "row" }),
  findMany: vi.fn().mockResolvedValue([]),
  publishDurable: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { cronJobLog: { create: h.create, findMany: h.findMany } },
}));
vi.mock("@/lib/db/brain-bus-durable", () => ({
  publishDurable: h.publishDurable,
}));

import { logCronRun } from "@/lib/services/cron-manager";
import { deriveSkipReason, SKIP_REASON_MAX } from "@/lib/services/cron-skip-reason";

function lastRow(): Record<string, unknown> {
  const call = h.create.mock.calls.at(-1);
  return (call?.[0] as { data: Record<string, unknown> }).data;
}

beforeEach(() => {
  h.create.mockClear();
});

describe("deriveSkipReason", () => {
  it("reads both shapes the fleet returns", () => {
    expect(deriveSkipReason({ ok: true, skipped: "NICK_AUTONOMY off" })).toBe("NICK_AUTONOMY off");
    expect(deriveSkipReason({ slot: "morning", skipped: true, reason: "INNGEST_MEGA_V2 off" })).toBe(
      "INNGEST_MEGA_V2 off",
    );
    expect(deriveSkipReason({ skipped: true })).toBe("skipped");
  });

  it("anything else is not a skip, and the answer is null, never a guess", () => {
    expect(deriveSkipReason({ processed: 4, skipped: 3 })).toBeNull(); // skipped ITEMS in a run that worked
    expect(deriveSkipReason({ skippedCount: 2 })).toBeNull();
    expect(deriveSkipReason({ skipped: false, reason: "x" })).toBeNull();
    expect(deriveSkipReason({ skipped: "   " })).toBeNull();
    expect(deriveSkipReason({ ok: true, reason: "x" })).toBeNull(); // a reason alone is not a skip
    expect(deriveSkipReason([{ skipped: "x" }])).toBeNull();
    expect(deriveSkipReason("skipped")).toBeNull();
    expect(deriveSkipReason(null)).toBeNull();
  });

  it("is bounded", () => {
    expect(deriveSkipReason({ skipped: "x".repeat(1000) })).toHaveLength(SKIP_REASON_MAX);
  });
});

describe("cron-manager writes skipReason on the success row", () => {
  it("THE DISCRIMINATION: a skipped run and a worked run with no count write different rows", async () => {
    await logCronRun("nick-action-execute", async () => ({ ok: true, skipped: "NICK_AUTONOMY off" }));
    const skipped = lastRow();
    await logCronRun("nick-action-execute", async () => ({ ok: true }));
    const worked = lastRow();

    expect(skipped).toMatchObject({ status: "success", resultCount: null, skipReason: "NICK_AUTONOMY off" });
    expect(worked).toMatchObject({ status: "success", resultCount: null, skipReason: null });
  });
});
