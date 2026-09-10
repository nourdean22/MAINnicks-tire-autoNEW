/**
 * Plate retention · the tests exist because every failure mode here is silent.
 *
 * A retention job that scrubs nothing, scrubs the wrong rows, or stops early all look
 * identical from outside: a green cron row saying "0 plates scrubbed". The only way to tell
 * them apart is to assert what the statement actually says and what the result actually
 * reports, so each test below names the disclosure or the data loss it prevents.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { scrubExpiredPlates, PLATE_RETENTION_DAYS } from "./services/plateRetention";

/** The value STORED in `vehicle_visits.plateStatus`. Pinned as a literal on purpose: it is
 *  a data contract other code and humans read back, so importing the constant would let a
 *  rename pass this suite while silently changing what is in the database. */
const STORED_SCRUBBED = "SCRUBBED";

/** Read off the result rather than imported, so the numbers under test are exactly the ones
 *  the cron reports to the operator. */
async function limits() {
  const { db } = fakeDb([0]);
  mockDbModule(db);
  const { scrubExpiredPlates: run } = await import("./services/plateRetention");
  const r = await run();
  return { batch: r.batchSize, max: r.maxBatches };
}

/** Captures the SQL Drizzle would send, and replays a scripted affectedRows per call. */
function fakeDb(affectedPerCall: number[]) {
  const seen: string[] = [];
  const params: unknown[][] = [];
  let call = 0;
  return {
    seen,
    params,
    db: {
      execute: vi.fn(async (q: { queryChunks?: unknown[] }) => {
        // Drizzle's sql`` template interleaves StringChunk literals (a `.value` string
        // ARRAY) with the bound values themselves -- and a bound string arrives as a BOXED
        // `String` object, so a strict-equality assertion against a primitive would fail
        // for a value that is in fact present. Both are unwrapped here, once.
        const chunks = (q.queryChunks ?? []) as unknown[];
        const isLiteral = (c: unknown) => Array.isArray((c as { value?: unknown })?.value);
        seen.push(chunks.map((c) => (isLiteral(c) ? (c as { value: string[] }).value.join("") : "?")).join(""));
        params.push(chunks.filter((c) => !isLiteral(c)).map((c) => (c instanceof Date ? c : String(c))));
        const n = affectedPerCall[Math.min(call, affectedPerCall.length - 1)];
        call += 1;
        return [{ affectedRows: n }];
      }),
    },
  };
}

function mockDbModule(db: unknown) {
  vi.doMock("./db", () => ({ getDbTyped: async () => db }));
}

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock("./db");
});

describe("plate retention", () => {
  it("keeps the SAME window as statenour, or the two apps enforce different policies", async () => {
    // The policy is one sentence in ADR-0017 and it is implemented twice, in two languages,
    // against two databases. Nothing but this line stops one of them drifting.
    //
    // Read as TEXT, not imported: statenour's module pulls in Prisma through its own `@/`
    // alias, which nickstire's vitest cannot resolve -- and importing another app's runtime
    // across the boundary is exactly what this repo's layer gates exist to stop. The
    // literal is the contract; comparing the literals is the whole assertion.
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("../../statenour/lib/services/plate-retention.ts", import.meta.url), "utf8");
    const m = src.match(/PLATE_RETENTION_DAYS\s*=\s*(\d+)/);
    expect(m, "statenour no longer declares PLATE_RETENTION_DAYS -- this parity check is blind")
      .toBeTruthy();
    expect(PLATE_RETENTION_DAYS).toBe(Number(m![1]));
  });

  it("spares plate reads that MATCHED a customer, exactly as statenour does", async () => {
    const { db, seen } = fakeDb([0]);
    mockDbModule(db);
    const { scrubExpiredPlates: run } = await import("./services/plateRetention");
    await run(new Date("2026-09-10T00:00:00Z"));
    // A plate the customer gave us is not a plate we harvested; the policy retains it.
    // Without this clause the scrub would delete the shop's own linked-vehicle records.
    expect(seen[0]).toContain("customerMatch <> 'EXACT'");
  });

  it("marks scrubbed rows SCRUBBED rather than leaving them indistinguishable from NONE", async () => {
    const { db, seen, params } = fakeDb([0]);
    mockDbModule(db);
    const { scrubExpiredPlates: run } = await import("./services/plateRetention");
    await run(new Date("2026-09-10T00:00:00Z"));
    expect(seen[0]).toContain("plateText = NULL");
    // A reader must be able to say "the policy removed it", not "the camera saw nothing".
    expect(params[0].flat()).toContain(STORED_SCRUBBED);
  });

  it("cuts off exactly PLATE_RETENTION_DAYS before the run, not before 'now' at read time", async () => {
    const { db, params } = fakeDb([0]);
    mockDbModule(db);
    const { scrubExpiredPlates: run } = await import("./services/plateRetention");
    const now = new Date("2026-09-10T12:00:00Z");
    await run(now);
    const cutoff = params[0].flat().find((p) => p instanceof Date) as Date;
    expect(cutoff.toISOString()).toBe("2026-08-11T12:00:00.000Z");
    expect(now.getTime() - cutoff.getTime()).toBe(PLATE_RETENTION_DAYS * 86_400_000);
  });

  it("stops after a SHORT batch instead of looping forever on an empty table", async () => {
    const { db } = fakeDb([0]);
    mockDbModule(db);
    const { scrubExpiredPlates: run } = await import("./services/plateRetention");
    const r = await run();
    expect(r).toMatchObject({ scrubbed: 0, batches: 1, capped: false });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("keeps batching while each batch comes back FULL", async () => {
    const { batch } = await limits();
    const { db } = fakeDb([batch, batch, 7]);
    mockDbModule(db);
    const { scrubExpiredPlates: run } = await import("./services/plateRetention");
    const r = await run();
    expect(r.scrubbed).toBe(batch * 2 + 7);
    expect(r.batches).toBe(3);
    expect(r.capped).toBe(false);
  });

  it("reports CAPPED when the safety stop fires, and never as a clean run", async () => {
    // The distinction the operator acts on: "retention is current" vs "retention is behind".
    // A capped run reported as clean means plate text sits past its window under a green cron.
    const { batch, max } = await limits();
    const { db } = fakeDb([batch]);
    mockDbModule(db);
    const { scrubExpiredPlates: run } = await import("./services/plateRetention");
    const r = await run();
    expect(r.capped).toBe(true);
    expect(r.batches).toBe(max);
    expect(db.execute).toHaveBeenCalledTimes(max);
  });

  it("THROWS when the database is unavailable rather than reporting zero scrubbed", async () => {
    // The empty-vs-error line. `{scrubbed: 0}` on a dead connection is a green cron row for
    // as long as the outage lasts, and it says the exact opposite of what is true.
    mockDbModule(null);
    const { scrubExpiredPlates: run } = await import("./services/plateRetention");
    await expect(run()).rejects.toThrow(/database unavailable/i);
  });

  it("treats an UNRECOGNISED driver response as a full batch, not as zero", async () => {
    // Assuming zero would end the loop after one statement and silently leave the backlog.
    // Assuming full costs one extra empty statement in the worst case.
    let calls = 0;
    mockDbModule({
      execute: vi.fn(async () => {
        calls += 1;
        return calls === 1 ? ({ weird: true } as unknown) : [{ affectedRows: 0 }];
      }),
    });
    const { scrubExpiredPlates: run } = await import("./services/plateRetention");
    const r = await run();
    expect(calls).toBe(2);
    expect(r.capped).toBe(false);
  });
});

describe("the scrub is actually SCHEDULED", () => {
  it("appears in the daily cron tier -- a service with no caller scrubs nothing", async () => {
    // The orphan-writer check. This module could be perfect and still never run.
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("./cron/scheduler.ts", import.meta.url), "utf8");
    expect(src).toContain('name: "plate-retention-scrub"');
    expect(src).toContain("scrubExpiredPlates");
  });

  it("SCRUBBED is not an ingest status -- a producer may never claim a row was scrubbed", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("./routes/cameraVisitsRoutes.ts", import.meta.url), "utf8");
    const line = src.split("\n").find((l) => l.includes("const PLATE_STATUS ="));
    expect(line).toBeTruthy();
    expect(line).not.toContain(STORED_SCRUBBED);
  });
});
