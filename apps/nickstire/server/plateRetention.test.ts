/**
 * Plate retention · the tests exist because every failure mode here is silent.
 *
 * A retention job that scrubs nothing, scrubs the wrong rows, or stops early all look
 * identical from outside: a green cron row saying "0 plates scrubbed". The only way to tell
 * them apart is to assert what the statement actually says and what the result actually
 * reports, so each test below names the disclosure or the data loss it prevents.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

/** Captures the SQL Drizzle would send, and replays a scripted affectedRows per call.
 *
 * `backlogRemains` answers the post-loop "is there still an eligible row?" probe, which is
 * a SELECT and not an UPDATE -- the two have to be answerable independently or the
 * exact-multiple case cannot be tested at all. */
function fakeDb(affectedPerCall: number[], backlogRemains = true) {
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
        // mysql2 returns [rows, fields] for a SELECT; `workRemains` reads res[0].length.
        if (seen[seen.length - 1].includes("SELECT 1")) {
          return [backlogRemains ? [{ one: 1 }] : [], []];
        }
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
});

// doMocks are NOT file-scoped in this repo's serial vitest -- one process, one mock
// registry, shared by every file (apps/nickstire/AGENTS.md s3). Unmocking in `beforeEach`
// only worked because the source-reading tests happened to run last; making a mocked test
// the final one would leave this partial `./db` factory installed for whatever file ran
// next, and it would fail somewhere that never imported this module (Codex P1 on #2270).
afterEach(() => {
  vi.doUnmock("./db");
  vi.resetModules();
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
    const { db } = fakeDb([batch], true);          // ... and the backlog is NOT clear
    mockDbModule(db);
    const { scrubExpiredPlates: run } = await import("./services/plateRetention");
    const r = await run();
    expect(r.capped).toBe(true);
    expect(r.batches).toBe(max);
    expect(db.execute).toHaveBeenCalledTimes(max + 1);   // + the "is there more?" probe
  });

  it("does NOT report capped when the last full batch CLEARED the backlog", async () => {
    // The exact-multiple case (Codex P2 on #2270). With exactly MAX_BATCHES * BATCH rows
    // eligible, all 40 updates return full and the 40th empties the table -- and the old
    // code reported `capped`, paging the operator to say old plate text remained when
    // retention was in fact current. A false page on a healthy night is how an alert stops
    // being read, and this one fires at most once before that happens.
    const { batch, max } = await limits();
    const { db } = fakeDb([batch], false);         // every batch full, nothing left after
    mockDbModule(db);
    const { scrubExpiredPlates: run } = await import("./services/plateRetention");
    const r = await run();
    expect(r.capped).toBe(false);
    expect(r.batches).toBe(max);
    expect(r.scrubbed).toBe(batch * max);
  });

  it("an UNREADABLE backlog probe reports capped, not all-clear", async () => {
    // "We could not tell" must render as the alarming answer. A false page costs a look;
    // a false all-clear costs the retention window.
    const { batch, max } = await limits();
    let n = 0;
    mockDbModule({
      execute: vi.fn(async () => {
        n += 1;
        if (n > max) throw new Error("probe exploded");
        return [{ affectedRows: batch }];
      }),
    });
    const { scrubExpiredPlates: run } = await import("./services/plateRetention");
    expect((await run()).capped).toBe(true);
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

describe("a scrub can never be undone by a redelivery", () => {
  /**
   * The hole this closes (Codex P1 on #2270): the edge's durable shop outbox retries a full
   * row indefinitely, and the ingest guard accepts `VALUES(seq) >= seq` -- equality by
   * design, so a redelivery of the same emission is idempotent. A delivery carrying the
   * ORIGINAL plate text can therefore land days after the scrub nulled it and put it back,
   * past the 30-day window, with nothing reporting it: the cron already went green, and the
   * next run only looks at rows whose text is non-NULL -- which this one now is again.
   *
   * The generated SQL is the behaviour here. It is the string the database executes.
   */
  it("gates plate columns on the STORED status, ahead of the seq guard", async () => {
    const { GUARDED_SET } = await import("./routes/cameraVisitsRoutes");
    for (const col of ["plateText", "plateStatus"]) {
      const clause = GUARDED_SET.split(", `").find((c) => c.startsWith(`${col}\` =`) || c.includes(`\`${col}\` =`));
      expect(clause, `${col} has no clause at all`).toBeTruthy();
      expect(clause).toContain("`plateStatus` = 'SCRUBBED'");
    }
  });

  it("does NOT freeze the other columns -- the guard is targeted, not a blanket", async () => {
    // The matched control. A guard that wrapped every column would pass the test above
    // while quietly making a visit's state, bay and timings unupdatable forever.
    const { GUARDED_SET } = await import("./routes/cameraVisitsRoutes");
    for (const col of ["state", "bay", "departedAt", "customerMatch"]) {
      const clause = GUARDED_SET.split("`" + col + "` = ")[1] ?? "";
      expect(clause.slice(0, 60), `${col} was frozen by the scrub guard`)
        .not.toContain("'SCRUBBED'");
    }
  });

  it("orders the assignments so the check reads the OLD status", async () => {
    // MySQL evaluates ON DUPLICATE KEY UPDATE left to right, so a column referenced on the
    // right-hand side holds whatever it has AT THAT POINT. If `plateStatus` were assigned
    // before `plateText`, the incoming status would already have overwritten SCRUBBED and
    // `plateText`'s guard would read the NEW value -- the check defeated by its own update.
    const { COLUMNS } = await import("./routes/cameraVisitsRoutes");
    expect(COLUMNS.indexOf("plateText")).toBeLessThan(COLUMNS.indexOf("plateStatus"));
  });
});

describe("the scrub is actually SCHEDULED", () => {
  it("is registered in the DAILY tier and automatically enabled", async () => {
    // Was a source-substring check. Both substrings survive `enabled: false` or a move out
    // of the daily tier, so it passed while automatic daily retention had stopped -- the
    // presence-not-behaviour shape this repo bans (Codex P1 on #2270). `getJobCadences()`
    // reports what the scheduler will actually do.
    const { getJobCadences } = await import("./cron/scheduler");
    const job = getJobCadences().get("plate-retention-scrub");
    expect(job, "the scrub is not registered with the scheduler at all").toBeTruthy();
    expect(job!.tier).toBe("daily");
    expect(job!.intervalMin).toBe(24 * 60);
    expect(job!.scheduledAutomatically,
           "registered but staged off the scheduler -- retention would never run").toBe(true);
  });

  it("SCRUBBED is not an ingest status -- a producer may never claim a row was scrubbed", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("./routes/cameraVisitsRoutes.ts", import.meta.url), "utf8");
    const line = src.split("\n").find((l) => l.includes("const PLATE_STATUS ="));
    expect(line).toBeTruthy();
    expect(line).not.toContain(STORED_SCRUBBED);
  });
});
