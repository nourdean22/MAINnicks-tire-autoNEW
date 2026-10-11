/**
 * cron_job_logs.resultCount · proving the column DISCRIMINATES.
 *
 * WHY THIS EXISTS
 * Before 2026-08-22 `cron_job_logs` had six columns — id, jobName, status,
 * duration, error, createdAt — and no result count. A full ingest and a
 * zero-result ingest were therefore indistinguishable BY SCHEMA. No amount of
 * monitoring discipline could have caught the difference, because the difference
 * was not representable.
 *
 * `ingest-reviews` ran 4x/day for sixteen days at a 100% failure rate — measured,
 * 64 runs and 64 failures, 2026-08-04 to 08-19 — and nothing paged.
 *
 * Shipping the column without proving it discriminates would be the same defect
 * class one layer up: a schema that CAN represent the distinction, wired to
 * nothing that records it. So these assert the producer end to end — what
 * logCronRun actually writes into the row — not merely that a field exists.
 *
 * NULL vs 0 IS THE WHOLE POINT.
 *   NULL = this run made no claim about a count.
 *   0    = the run happened and produced nothing.
 * Collapsing them re-manufactures the fabrication the nullable column was chosen
 * to avoid, and would have written a false "produced nothing" onto all 66,529
 * pre-existing rows had the column carried DEFAULT 0.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ id: "row" }),
  update: vi.fn().mockResolvedValue({ id: "row" }),
  findMany: vi.fn().mockResolvedValue([]),
  publishDurable: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { cronJobLog: { create: h.create, update: h.update, findMany: h.findMany } },
}));
vi.mock("@/lib/db/brain-bus-durable", () => ({
  publishDurable: h.publishDurable,
}));

import { logCronRun } from "@/lib/services/cron-manager";

/**
 * The row as stored after logCronRun's most recent run: the `started` row it
 * created, overlaid with the terminal update that settled it (2026-10-10).
 */
function lastRow(): Record<string, unknown> {
  const started = (h.create.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> }).data;
  const settled = (h.update.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> }).data;
  return { ...started, ...settled };
}

beforeEach(() => {
  h.create.mockClear();
  h.update.mockClear();
  h.publishDurable.mockClear();
});

describe("cron_job_logs.resultCount", () => {
  it("THE DISCRIMINATION: a zero-result run and a productive run write different rows", async () => {
    // This is the assertion the column exists for. Both runs SUCCEED — same
    // status, same shape, indistinguishable in the old six-column table.
    await logCronRun("ingest-x", async () => ({ ok: true, resultCount: 0 }));
    const empty = lastRow();

    await logCronRun("ingest-x", async () => ({ ok: true, resultCount: 5 }));
    const full = lastRow();

    // The precondition has to be REAL or the discrimination claim is theatre. An
    // earlier version asserted `empty.error === full.error`, which on the success
    // path is undefined === undefined — true by construction, incapable of failing.
    expect(empty.status).toBe("success");
    expect(full.status).toBe("success");
    expect(empty.jobName).toBe(full.jobName);
    expect(empty.error, "the success path writes no error key at all").toBeUndefined();
    expect(full.error).toBeUndefined();
    expect(typeof empty.duration, "duration is written on both").toBe("number");
    expect(typeof full.duration).toBe("number");
    // Every pre-existing column now compared: jobName equal, status equal, error
    // absent on both, duration present on both. The ONLY thing that differs is the
    // new column — which is precisely the claim under test.

    expect(empty.resultCount).toBe(0);
    expect(full.resultCount).toBe(5);
    expect(
      empty.resultCount,
      "if these are equal the column does not discriminate and the migration bought nothing",
    ).not.toBe(full.resultCount);
  });

  it("a handler that makes no claim writes NULL, never 0", async () => {
    await logCronRun("silent-job", async () => ({ ok: true, notes: "nothing to count" }));
    expect(lastRow().resultCount).toBeNull();
  });

  // 08-F13 (ruling R2): one counting rule for the column. Route crons used their own
  // countFrom (explicit resultCount only), so outbox-drain / brain-bus-drain stored NULL
  // while the Inngest path (deriveResultCount) read the same summary as a count.
  it("a route cron's work-count key is its count, the same rule as the Inngest path", async () => {
    await logCronRun("outbox-drain", async () => ({ ok: true, claimed: 3, drained: 3, failed: 0, newDead: 0 }));
    expect(lastRow().resultCount).toBe(3);
    await logCronRun("silent-job", async () => ({ drained: 3 }));
    expect(lastRow().resultCount).toBe(3);
  });

  it("0 is a claim and survives as 0 — not coerced to null by falsiness", async () => {
    // `r.resultCount || null` would turn a real zero into "made no claim",
    // erasing precisely the case this column was added to make visible.
    await logCronRun("zero-job", async () => ({ resultCount: 0 }));
    expect(lastRow().resultCount).toBe(0);
    expect(lastRow().resultCount).not.toBeNull();
  });

  it("a THROWN handler writes no count — a run that produced no answer is not a run that produced nothing", async () => {
    await logCronRun("boom", async () => {
      throw new Error("upstream down");
    });
    const row = lastRow();
    expect(row.status).toBe("failed");
    expect(row.resultCount ?? null).toBeNull();
  });

  it("an ok:false run still records its count — a failed run can have produced partial output", async () => {
    await logCronRun("degraded", async () => ({ ok: false, reason: "partial feed", resultCount: 2 }));
    const row = lastRow();
    expect(row.status).toBe("failed");
    expect(row.resultCount).toBe(2);
  });

  it("a non-numeric or non-finite claim is NULL, not a coerced number", async () => {
    await logCronRun("bad-1", async () => ({ resultCount: "5" }));
    expect(lastRow().resultCount, "a string is not a count").toBeNull();

    await logCronRun("bad-2", async () => ({ resultCount: Number.NaN }));
    expect(lastRow().resultCount, "NaN is not a count").toBeNull();

    await logCronRun("bad-3", async () => null);
    expect(lastRow().resultCount, "a null result carries no claim").toBeNull();

    // Infinity was the surviving mutation: swapping Number.isFinite for
    // !Number.isNaN left the suite green while Infinity flowed to Prisma.
    await logCronRun("bad-4", async () => ({ resultCount: Number.POSITIVE_INFINITY }));
    expect(lastRow().resultCount, "Infinity is not a storable count").toBeNull();

    // An array is a list of results: its length is the count (deriveResultCount rule 4).
    await logCronRun("bad-5", async () => [1, 2, 3]);
    expect(lastRow().resultCount, "an array counts its items").toBe(3);
  });

  it("rejects values a Postgres INTEGER cannot store — a rejected write loses the WHOLE row", () => {
    // Not a style preference. prisma.cronJobLog.create rejects an out-of-domain
    // value, the rejection lands in logCronRun's .catch, and the row is never
    // written — leaving the run with no trace at all, which is a worse version of
    // the very condition this column was added to end.
    return (async () => {
      await logCronRun("frac", async () => ({ resultCount: 2.5 }));
      expect(lastRow().resultCount, "a non-integer is not an INTEGER").toBeNull();

      await logCronRun("huge", async () => ({ resultCount: 3_000_000_000 }));
      expect(lastRow().resultCount, "beyond INTEGER range").toBeNull();

      await logCronRun("neg", async () => ({ resultCount: -5 }));
      expect(lastRow().resultCount, "a negative is not a count of work done").toBeNull();
    })();
  });
});
