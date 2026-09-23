/**
 * Cron run lifecycle · the invariant is that a row NEVER claims more than the
 * run has actually demonstrated.
 *
 * This file replaces tests/observability/inngest-cron-self-row.test.ts. That
 * suite ratcheted the PRESENCE and POSITION of 17 hand-placed `recordSelfRow`
 * calls, and it had to, because the instrumentation was hand-placed. It was
 * also blind twice in one night — once to a `getInngest().createFunction(`
 * call shape, once to a comment containing a `.createFunction(` literal.
 *
 * ★ The instrumentation is now client middleware, so "is every cron
 *   instrumented" stopped being a question about 17 call sites and became a
 *   question about one registration. What is worth ratcheting changed with it,
 *   and the tests below ratchet the two things that can still silently rot:
 *   the registration, and anyone hand-rolling a premature success row again.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const FUNCTIONS_DIR = join(__dirname, "../../lib/inngest/functions");
const CLIENT_FILE = join(__dirname, "../../lib/inngest/client.ts");

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/prisma");
  vi.doUnmock("@/lib/utils/error-log");
});

/**
 * An in-memory `cron_job_log`. Asserting on a STORE rather than on call
 * arguments is the point: it lets a test assert the row's whole trajectory,
 * so "never reports success" is proven across the run instead of inferred
 * from one call that happened not to say it.
 */
function makeStore() {
  const rows: Record<string, unknown>[] = [];
  const history: string[] = [];
  // Reconciliation sweeps land here, NOT in `history`: two tests above pin the
  // exact per-run trajectory, and a zero-hit sweep is not part of a run's story.
  const sweeps: string[] = [];
  let seq = 0;
  const prisma = {
    cronJobLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `r${++seq}`, createdAt: new Date(Date.now() - 1000), ...data };
        rows.push(row);
        history.push(`create:${String(data.status)}`);
        return row;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        // `status` arrives as a string OR as prisma's `{ in: [...] }` (the
        // 2026-09-22 settle accepts started|interrupted when the run id is exact).
        const statusOk = (r: Record<string, unknown>) => {
          const s = where.status as string | { in: string[] } | undefined;
          if (s === undefined) return true;
          return typeof s === "string" ? r.status === s : s.in.includes(r.status as string);
        };
        const hits = rows.filter(
          (r) =>
            (where.jobName === undefined || r.jobName === where.jobName) &&
            statusOk(r) &&
            (where.runId === undefined || r.runId === where.runId),
        );
        return hits.length > 0 ? hits[hits.length - 1] : null;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = rows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        history.push(`update:${String(data.status)}`);
        return row;
      },
      // 2026-09-22 · the reconciliation reads stale started rows (`scan`), looks up
      // their run ids' terminal siblings, then updates by id list. Operators
      // modelled: equality, { in }, { not }, { lt } on a Date.
      findMany: async ({ where, take }: { where: Record<string, unknown>; select?: unknown; take?: number; distinct?: unknown }) => {
        const match = (r: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(where)) {
            const rv = r[k];
            if (v !== null && typeof v === "object") {
              const op = v as { in?: unknown[]; not?: unknown; lt?: Date };
              if (op.in !== undefined && !op.in.includes(rv)) return false;
              if ("not" in op && rv === op.not) return false;
              if (op.lt !== undefined && !((rv as Date).getTime() < op.lt.getTime())) return false;
            } else if (rv !== v) return false;
          }
          return true;
        };
        if (where.status === "started" && (where.createdAt as { lt?: Date } | undefined)?.lt) sweeps.push("scan");
        const hits = rows.filter(match);
        return typeof take === "number" ? hits.slice(0, take) : hits;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id?: { in: string[] }; status?: string; createdAt?: { lt?: Date } };
        data: Record<string, unknown>;
      }) => {
        const hits = rows.filter(
          (r) =>
            (where.id?.in === undefined || where.id.in.includes(r.id as string)) &&
            (where.status === undefined || r.status === where.status) &&
            (where.createdAt?.lt === undefined || (r.createdAt as Date).getTime() < where.createdAt.lt.getTime()),
        );
        for (const r of hits) Object.assign(r, data);
        sweeps.push(`${String(data.status)}:${hits.length}`);
        return { count: hits.length };
      },
    },
  };
  return { prisma, rows, history, sweeps };
}

async function loadMiddleware(prisma: unknown) {
  vi.resetModules();
  vi.doMock("@/lib/prisma", () => ({ prisma }));
  vi.doMock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
  return import("../../lib/inngest/cron-lifecycle");
}

const cronFn = (id: string) => ({ opts: { id, triggers: [{ cron: "0 9 * * *" }] } });
const eventFn = (id: string) => ({ opts: { id, triggers: [{ event: "some/event" }] } });

describe("cron lifecycle · the acceptance test from the 2026-09-17 audit", () => {
  /**
   * Verbatim from the audit packet:
   *
   *   "deliberately crash after invocation. The job must show started, then
   *    failed or stale — never succeeded."
   */
  it("ACCEPTANCE — a crash after invocation shows started, then failed, and NEVER success", async () => {
    const { prisma, rows, history } = makeStore();
    const { CronLifecycleMiddleware } = await loadMiddleware(prisma);
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    const fn = cronFn("goal-pruner");
    const ctx = { runId: "run-abc" };

    await mw.onRunStart({ ctx, fn });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("started");

    // Attempt 0 blows up, but Inngest will retry — this is NOT yet a failure,
    // and calling it one would be the mirror image of a premature success.
    await mw.onRunError({ ctx, fn, error: new Error("boom"), isFinalAttempt: false });
    expect(rows[0].status).toBe("started");

    // Retries exhausted. Now, and only now, it is a failure.
    await mw.onRunError({ ctx, fn, error: new Error("boom"), isFinalAttempt: true });
    expect(rows[0].status).toBe("failed");
    expect(String(rows[0].error)).toContain("boom");

    // The whole trajectory, not just the end state.
    expect(history).toEqual(["create:started", "update:failed"]);
    expect(history.some((h) => h.includes("success"))).toBe(false);
  });

  it("a clean run goes started -> success, and settles exactly one row", async () => {
    const { prisma, rows, history } = makeStore();
    const { CronLifecycleMiddleware } = await loadMiddleware(prisma);
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    const fn = cronFn("morning-brief");
    const ctx = { runId: "run-ok" };

    await mw.onRunStart({ ctx, fn });
    await mw.onRunComplete({ ctx, fn });

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("success");
    expect(history).toEqual(["create:started", "update:success"]);
    expect(typeof rows[0].duration).toBe("number");
  });

  /**
   * ★ THIS TEST REPLACED ONE NAMED `LIMITATION`.
   *
   * Before the `runId` column existed (applied to prod 2026-09-17), a settle
   * could only match "newest `started` row for this job", so the previous
   * version of this test PINNED the wrong behaviour on purpose: with two runs
   * in flight, the first to finish settled the newer row and stranded the
   * older. It was written to start failing the day the column landed, and it
   * did — this is its replacement.
   *
   * ⚠ A limitation nobody encodes is one the next person rediscovers as a bug.
   * Encoding it is also what made the upgrade path obvious.
   */
  it("settles the row belonging to ITS OWN run when two runs overlap", async () => {
    const { prisma, rows } = makeStore();
    const { CronLifecycleMiddleware } = await loadMiddleware(prisma);
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    const fn = cronFn("industry-pull");

    await mw.onRunStart({ ctx: { runId: "run-1" }, fn });
    await mw.onRunStart({ ctx: { runId: "run-2" }, fn });
    await mw.onRunComplete({ ctx: { runId: "run-1" }, fn });

    const byRun = Object.fromEntries(rows.map((r) => [r.runId, r.status]));
    expect(byRun["run-1"], "the finishing run must settle its OWN row").toBe("success");
    expect(byRun["run-2"], "the still-running row must be left alone").toBe("started");
  });

  it("records runId on the started row", async () => {
    const { prisma, rows } = makeStore();
    const { CronLifecycleMiddleware } = await loadMiddleware(prisma);
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    await mw.onRunStart({ ctx: { runId: "run-xyz" }, fn: cronFn("goal-pruner") });
    expect(rows[0].runId).toBe("run-xyz");
  });

  it("FALLBACK — a run with no readable runId still settles by recency", async () => {
    // Not dead code: rows written before the column existed have runId NULL,
    // and a run whose id cannot be read still deserves a terminal status
    // rather than being stranded at `started` forever.
    const { prisma, rows } = makeStore();
    const { CronLifecycleMiddleware } = await loadMiddleware(prisma);
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    const fn = cronFn("industry-pull");

    await mw.onRunStart({ ctx: {}, fn });
    await mw.onRunComplete({ ctx: {}, fn });

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("success");
  });
});

/**
 * ★★★ THE FIXTURES ABOVE ASSERT MY ASSUMPTION. THIS ASSERTS REALITY.
 *
 * `isCronTriggered` and `jobNameOf` read `fn.opts.triggers` and `fn.opts.id`,
 * which were derived from Inngest's .d.ts. If either name is wrong at runtime,
 * `isCronTriggered` returns false for EVERY function and the middleware writes
 * nothing — the whole fleet goes dark, silently, looking exactly like "crons
 * stopped running". Hand-built `{ opts: { ... } }` fixtures cannot catch that:
 * they encode the same assumption they are meant to test.
 *
 * So this builds REAL InngestFunction objects with the real SDK and runs them
 * through the real middleware. It is the only test here that would survive the
 * SDK renaming a property, and the only one that fails on an Inngest upgrade
 * that changes the shape — which is precisely when we need to know.
 */
describe("cron lifecycle · against real SDK objects, not fixtures", () => {
  it("detects a real cron function and a real event function correctly", async () => {
    const { Inngest } = await import("inngest");
    const { prisma, rows } = makeStore();
    const { CronLifecycleMiddleware } = await loadMiddleware(prisma);

    const client = new Inngest({ id: "lifecycle-test-app" });
    const realCron = client.createFunction(
      { id: "goal-pruner", triggers: [{ cron: "0 9 * * *" }] },
      async () => "ok",
    );
    const realEvent = client.createFunction(
      { id: "social-publish", triggers: [{ event: "social/publish" }] },
      async () => "ok",
    );

    const mw = new CronLifecycleMiddleware({ client: {} as never });
    await mw.onRunStart({ ctx: { runId: "r1" }, fn: realEvent });
    expect(rows, "an event-triggered function must not open a cron row").toHaveLength(0);

    await mw.onRunStart({ ctx: { runId: "r2" }, fn: realCron });
    await mw.onRunComplete({ ctx: { runId: "r2" }, fn: realCron });

    expect(rows).toHaveLength(1);
    // The job name must come off the real object, not a guess: this is what
    // config/crons.ts and probe-cron-truth.mjs reconcile against.
    expect(rows[0].jobName).toBe("goal-pruner");
    expect(rows[0].status).toBe("success");
  });
});

describe("cron lifecycle · scope", () => {
  it("ignores event-triggered functions entirely", async () => {
    const { prisma, rows } = makeStore();
    const { CronLifecycleMiddleware } = await loadMiddleware(prisma);
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    const fn = eventFn("social-publish");

    await mw.onRunStart({ ctx: { runId: "r" }, fn });
    await mw.onRunComplete({ ctx: { runId: "r" }, fn });

    // Otherwise every event-driven run lands in cron_job_log as a job no
    // schedule expects, and every audit built on that table inherits the noise.
    expect(rows).toHaveLength(0);
  });

  it("records a cron function that also has an event trigger", async () => {
    const { prisma, rows } = makeStore();
    const { CronLifecycleMiddleware } = await loadMiddleware(prisma);
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    const fn = { opts: { id: "dual", triggers: [{ event: "x/y" }, { cron: "0 * * * *" }] } };

    await mw.onRunStart({ ctx: { runId: "r" }, fn });
    expect(rows).toHaveLength(1);
  });
});

describe("cron lifecycle · never throws", () => {
  /**
   * `recordSelfRow` shipped this bug once: it used `.catch()`, which only
   * handles a REJECTED PROMISE. An undefined `prisma.cronJobLog` throws
   * SYNCHRONOUSLY on property access, before a promise exists, so `.catch()`
   * never ran and the error escaped into a real cron.
   *
   * ⚠ The stakes are higher here than they were there. Middleware runs OUTSIDE
   * step semantics on every function — a throw is not retried, not
   * checkpointed, and fails the run outright.
   */
  const brokenClients: [string, unknown][] = [
    ["a client with no cronJobLog at all", {}],
    ["a client that is null", null],
    ["a create that rejects", { cronJobLog: { create: () => Promise.reject(new Error("db down")) } }],
    [
      "a create that throws synchronously",
      {
        cronJobLog: {
          create: () => {
            throw new Error("sync boom");
          },
        },
      },
    ],
  ];

  for (const [label, client] of brokenClients) {
    it(`CANARY — onRunStart survives ${label}`, async () => {
      const { CronLifecycleMiddleware } = await loadMiddleware(client);
      const mw = new CronLifecycleMiddleware({ client: {} as never });
      await expect(
        mw.onRunStart({ ctx: { runId: "r" }, fn: cronFn("some-cron") }),
      ).resolves.toBeUndefined();
    });

    it(`CANARY — onRunComplete survives ${label}`, async () => {
      const { CronLifecycleMiddleware } = await loadMiddleware(client);
      const mw = new CronLifecycleMiddleware({ client: {} as never });
      await expect(
        mw.onRunComplete({ ctx: { runId: "r" }, fn: cronFn("some-cron") }),
      ).resolves.toBeUndefined();
    });
  }

  it("does not invent a terminal row when the started row is missing", async () => {
    // A settle with nothing to settle must record NOTHING. Creating a success
    // row here would assert a run whose beginning was never witnessed.
    const { prisma, rows } = makeStore();
    const { CronLifecycleMiddleware } = await loadMiddleware(prisma);
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    await mw.onRunComplete({ ctx: { runId: "orphan" }, fn: cronFn("goal-pruner") });
    expect(rows).toHaveLength(0);
  });
});

describe("TERMINAL_OK_STATUSES · the false-green regression guard", () => {
  it("EXCLUDES started — this is the whole defect", async () => {
    const { TERMINAL_OK_STATUSES } = await import("../../lib/inngest/cron-lifecycle");
    // `not: "failed"` counted `started` as healthy, so a cron that fired and
    // crashed read as a fresh green. If this ever includes `started` again,
    // /system/crons goes back to certifying broken jobs as working.
    expect(TERMINAL_OK_STATUSES).not.toContain("started");
  });

  it("INCLUDES partial — mega-fanout's real terminal outcome", async () => {
    const { TERMINAL_OK_STATUSES } = await import("../../lib/inngest/cron-lifecycle");
    // Dropping this is the opposite failure: false-paging every run that
    // legitimately finished with some children failed.
    expect(TERMINAL_OK_STATUSES).toContain("partial");
    expect(TERMINAL_OK_STATUSES).toContain("success");
  });
});

describe("isStaleRun", () => {
  it("only a started row can be stale, and only after the window", async () => {
    const { isStaleRun, STALE_RUN_MINUTES } = await import("../../lib/inngest/cron-lifecycle");
    const now = Date.now();
    const old = new Date(now - (STALE_RUN_MINUTES + 1) * 60_000);
    const fresh = new Date(now - 60_000);

    expect(isStaleRun("started", old, now)).toBe(true);
    expect(isStaleRun("started", fresh, now)).toBe(false);
    // A finished run is never stale, however old it is.
    expect(isStaleRun("success", old, now)).toBe(false);
    expect(isStaleRun("failed", old, now)).toBe(false);
  });
});

/**
 * ── RATCHET 1 · the registration ────────────────────────────────────
 *
 * The middleware covers every function only while it is actually registered.
 * One deleted line silently un-instruments the entire fleet, and nothing else
 * in the test suite would notice.
 */
describe("RATCHET · the middleware is registered on the client", () => {
  it("MUTATION — a line comment containing a path glob must not eat the file", () => {
    // The exact text that broke this ratchet on first run: a `//` comment
    // mentioning a route glob, whose star-slash sequence reads as a block
    // comment opener if block comments are stripped first.
    const src = ['// routes under /api/cron/* are wrapped', 'middleware: [CronLifecycleMiddleware],'].join(
      "\n",
    );
    expect(stripComments(src)).toMatch(/middleware\s*:\s*\[CronLifecycleMiddleware/);
  });

  it("MUTATION — a url in live code survives comment stripping", () => {
    expect(stripComments('const u = "https://x.test/a";')).toContain("https://x.test/a");
  });

  it("client.ts passes CronLifecycleMiddleware to the Inngest constructor", () => {
    const src = stripComments(readFileSync(CLIENT_FILE, "utf8"));
    expect(src).toMatch(/middleware\s*:\s*\[[^\]]*CronLifecycleMiddleware/);
    expect(src).toMatch(/import\s*\{[^}]*CronLifecycleMiddleware[^}]*\}\s*from/);
  });
});

/**
 * ── RATCHET 2 · nobody hand-rolls a premature success row again ─────
 *
 * ★★★ THIS IS THE GENERALISED VERSION OF THE BUG, AND IT IS THE ONE THAT
 * ACTUALLY BIT. Three functions — cron-heartbeat, quality-bench and
 * suggestion-improve — each wrote `cronJobLog.create({ status: "success" })`
 * as the FIRST statement of the handler, before doing any work. The oldest
 * shipped 2026-07-28 with a comment calling it "proof-of-invocation", which is
 * what it was; `success` is just not what proof-of-invocation says.
 *
 * `cron-heartbeat` is the sharpest case: `fleet-truth` reads exactly that
 * jobName+success pair for its `inngest-heartbeat` probe, so the fleet page
 * went green whenever the watchdog FIRED, not when it completed. A watchdog
 * certifying itself healthy before doing its job is precisely the failure it
 * exists to catch.
 */
export function findPrematureSuccessRows(src: string): string[] {
  const flat = stripComments(src).replace(/\s+/g, " ");
  const hits: string[] = [];
  // `cronJobLog.create(...)` whose data literal carries a terminal status.
  // Terminal status at a create is the tell: a create happens before the work,
  // so the only honest status it can carry is a non-terminal one.
  for (const m of flat.matchAll(/cronJobLog\s*\.\s*create\s*\(([^;]{0,400}?)\)\s*[;.]/g)) {
    const arg = m[1] ?? "";
    const status = /status\s*:\s*"([^"]+)"/.exec(arg);
    if (status && (status[1] === "success" || status[1] === "partial")) {
      hits.push(status[1]);
    }
  }
  return hits;
}

/**
 * ⚠⚠⚠ LINE COMMENTS FIRST. THIS ORDER IS THE WHOLE CORRECTNESS OF THE FUNCTION.
 *
 * The obvious implementation strips block comments first, and it is wrong in a
 * way that passes every test you think to write. `lib/inngest/client.ts`
 * explains the instrumentation in a `//` comment that mentions the route glob
 * `/api/cron/` followed by a star. That star-slash-star sequence OPENS a block
 * comment as far as a naive stripper is concerned, so it swallowed everything
 * up to the next real close — including the `middleware: [...]` line this file
 * exists to assert. The ratchet reported the fleet un-instrumented while the
 * fleet was, in fact, instrumented.
 *
 * ★ A comment's CONTENT broke the scanner that reads comments — the third time
 *   this exact shape has bitten this repo (the terse-lane guard, then a comment
 *   containing a `.createFunction(` literal, now a path glob). Removing line
 *   comments first makes the glob disappear before it can be misread.
 *
 * The `[^:]` guard keeps `https://` inside real code from being treated as a
 * line comment, which would truncate string literals and unbalance the source.
 */
export function stripComments(src: string): string {
  return src
    .split("\n")
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

describe("RATCHET · no inngest cron writes its own terminal row", () => {
  // ── negative + positive fixtures. A guard that only ever passes proves
  //    nothing, and this repo has shipped two of those in one night.
  it("MUTATION — detects the exact shape that shipped three times", () => {
    expect(
      findPrematureSuccessRows(
        `await prisma.cronJobLog.create({ data: { jobName: "x", status: "success" } });`,
      ),
    ).toEqual(["success"]);
  });

  it("MUTATION — detects it across line breaks and a trailing .catch()", () => {
    expect(
      findPrematureSuccessRows(
        `await prisma.cronJobLog\n  .create({ data: { jobName: "x", status: "success" } })\n  .catch(() => {});`,
      ),
    ).toEqual(["success"]);
  });

  it("MUTATION — a commented-out example must NOT trip it", () => {
    expect(
      findPrematureSuccessRows(
        `// await prisma.cronJobLog.create({ data: { status: "success" } });`,
      ),
    ).toEqual([]);
    expect(
      findPrematureSuccessRows(
        `/* await prisma.cronJobLog.create({ data: { status: "success" } }); */`,
      ),
    ).toEqual([]);
  });

  it("MUTATION — a create with a non-terminal status is allowed", () => {
    expect(
      findPrematureSuccessRows(`prisma.cronJobLog.create({ data: { status: "started" } });`),
    ).toEqual([]);
  });

  it("the live fleet is clean", () => {
    const offenders: string[] = [];
    for (const f of readdirSync(FUNCTIONS_DIR)) {
      if (!/\.tsx?$/.test(f)) continue;
      const hits = findPrematureSuccessRows(readFileSync(join(FUNCTIONS_DIR, f), "utf8"));
      if (hits.length > 0) offenders.push(`${f} -> ${hits.join(", ")}`);
    }
    expect(
      offenders,
      "An Inngest cron must not write its own cron_job_log row. The client middleware " +
        "(lib/inngest/cron-lifecycle.ts) owns that, and a hand-rolled create before the " +
        "work reports an outcome the run has not reached yet.",
    ).toEqual([]);
  });
});

/**
 * 2026-09-22 · outcome receipts. Measured read-only on prod, last 24h: 704
 * runs, 694 `success`, 0 `failed` - and 692 of the 694 successes carried
 * `resultCount = null`. The column exists and nothing wrote it, so "success"
 * said nothing about work done, while the jobs themselves already return
 * summaries like `{ swept: 0 }` or `{ ok: true, skipped: "no_meta_token" }`
 * that Inngest hands the middleware as `output`. 49 rows sat at `started`
 * forever — and the first reading of them ("dead runs") was WRONG: grouped by
 * run id they were 4-5 duplicate `started` rows per SUCCESSFUL mega-fanout run
 * (see the parallel-step describe below). A genuinely dead run — process
 * killed, no terminal event — is still a real third outcome that reads like a
 * live one. No migration: the count goes into the existing column; a stale
 * orphan `started` row becomes `interrupted`, a stale duplicate `duplicate`.
 */
describe("cron lifecycle · outcome receipts (2026-09-22)", () => {
  const settled = async (output: unknown) => {
    const { prisma, rows } = makeStore();
    const { CronLifecycleMiddleware } = await loadMiddleware(prisma);
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    const fn = cronFn("approval-sweeper");
    const ctx = { runId: "run-1" };
    await mw.onRunStart({ ctx, fn });
    await mw.onRunComplete({ ctx, fn, output });
    return rows[0];
  };

  it("a job that reports a count settles with resultCount = that count", async () => {
    expect((await settled({ swept: 7 })).resultCount).toBe(7);
    expect((await settled({ ok: true, measured: 0, reason: "no_published_posts_in_window" })).resultCount).toBe(0);
    expect((await settled({ processed: 12, failed: 1 })).resultCount).toBe(12);
    expect((await settled([1, 2, 3])).resultCount).toBe(3);
  });

  it("a job that reports no count settles with resultCount = null, never an invented 0", async () => {
    // A skip is not zero work done; without an outcome column the honest
    // value is unknown. `deriveResultCount` never guesses.
    expect((await settled({ ok: true, skipped: "no_meta_token" })).resultCount).toBeNull();
    expect((await settled({ slot: "morning", sent: true, reason: "x" })).resultCount).toBeNull(); // a boolean is not a count
    expect((await settled("ok")).resultCount).toBeNull();
    expect((await settled(undefined)).resultCount).toBeNull();
    expect((await settled({ processed: -3 })).resultCount).toBeNull();
    expect((await settled({ processed: 2.5 })).resultCount).toBeNull();
  });

  it("a job that says it skipped settles with skipReason, a worked run with null (2026-09-23)", async () => {
    // Before the column, both rows below were identical: success, resultCount null.
    expect(await settled({ ok: true, skipped: "no_meta_token" })).toMatchObject({
      status: "success",
      resultCount: null,
      skipReason: "no_meta_token",
    });
    expect(await settled({ slot: "evening", skipped: true, reason: "INNGEST_MEGA_V2 off" })).toMatchObject({
      skipReason: "INNGEST_MEGA_V2 off",
    });
    expect((await settled({ swept: 7 })).skipReason).toBeNull();
  });

  it("deriveResultCount is the single reader of a job's summary", async () => {
    const { deriveResultCount } = await loadMiddleware(makeStore().prisma);
    expect(deriveResultCount({ drained: 4 })).toBe(4);
    expect(deriveResultCount({ resultCount: 9, processed: 2 })).toBe(9); // explicit wins
    expect(deriveResultCount({ status: "pinned", numberCount: 3 })).toBe(3); // *Count suffix
    expect(deriveResultCount({ tasksCreated: 2, contactNames: ["a", "b"] })).toBe(2); // *Created suffix
    expect(deriveResultCount({ sourcesAttempted: 5, sourcesIngested: 4, totalClaims: 40, failures: 1 })).toBe(4);
    // review on #2525: industry-pull returns { sourcesOk, itemsAdded, errors } - Added is work, Ok is not a count key
    expect(deriveResultCount({ sourcesOk: 3, itemsAdded: 12, errors: 0 })).toBe(12);
    expect(deriveResultCount({ failedCount: 2, sentCount: 5 })).toBe(5); // a failure stem is not work done
    expect(deriveResultCount({ errorCount: 9 })).toBeNull();
    expect(deriveResultCount({ dryRun: 4 })).toBeNull(); // *Run suffix, but a dry-run marker is not work
    expect(deriveResultCount({ jobsRun: 7 })).toBe(7);
    // review on #2525: Prisma Int is signed 32-bit; a larger value is rejected by the database and would
    // strand a finished run at started (the same bound countFrom in cron-manager.ts enforces)
    expect(deriveResultCount({ processed: 2_147_483_647 })).toBe(2_147_483_647);
    expect(deriveResultCount({ processed: 2_147_483_648 })).toBeNull();
    expect(deriveResultCount([1, 2, 3])).toBe(3);
    expect(deriveResultCount({ notes: "x" })).toBeNull();
    expect(deriveResultCount(null)).toBeNull();
  });

  it("a failed run keeps resultCount null and its status", async () => {
    const { prisma, rows } = makeStore();
    const { CronLifecycleMiddleware } = await loadMiddleware(prisma);
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    const fn = cronFn("approval-sweeper");
    await mw.onRunStart({ ctx: {}, fn });
    await mw.onRunError({ ctx: {}, fn, error: new Error("boom"), isFinalAttempt: true });
    expect(rows[0].status).toBe("failed");
    expect(rows[0].resultCount ?? null).toBeNull();
  });

  it("a `started` row past STALE_RUN_MINUTES is reconciled to `interrupted` when the next cron starts; fresh and terminal rows are untouched", async () => {
    const { prisma, rows, sweeps } = makeStore();
    const m = 60_000;
    rows.push({ id: "old", jobName: "mega-fanout-morning", status: "started", createdAt: new Date(Date.now() - 7 * 60 * m) });
    rows.push({ id: "just-past", jobName: "mega-fanout-evening", status: "started", createdAt: new Date(Date.now() - 100 * m) });
    rows.push({ id: "fresh", jobName: "outbox-drain", status: "started", createdAt: new Date(Date.now() - 80 * m) });
    rows.push({ id: "done", jobName: "mega-fanout-evening", status: "success", createdAt: new Date(Date.now() - 8 * 60 * m) });
    const { CronLifecycleMiddleware, CRON_STATUS, STALE_RUN_MINUTES } = await loadMiddleware(prisma);
    expect(STALE_RUN_MINUTES).toBe(90); // the boundary the fixtures above straddle
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    await mw.onRunStart({ ctx: { runId: "now" }, fn: cronFn("approval-sweeper") });

    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by("old").status).toBe(CRON_STATUS.interrupted);
    expect(by("just-past").status).toBe(CRON_STATUS.interrupted);
    expect(String(by("old").error)).toMatch(/no terminal event/i);
    expect(by("fresh").status).toBe("started");
    expect(by("done").status).toBe("success");
    expect(rows.find((r) => r.jobName === "approval-sweeper")!.status).toBe("started"); // the run that triggered the sweep
    expect(sweeps).toEqual(["scan", "interrupted:2"]);
  });

  it("the sweep is throttled: many starts inside one window sweep once", async () => {
    const { prisma, sweeps } = makeStore();
    const { CronLifecycleMiddleware } = await loadMiddleware(prisma);
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    for (let i = 0; i < 5; i++) await mw.onRunStart({ ctx: {}, fn: cronFn(`job-${i}`) });
    expect(sweeps).toHaveLength(1);
  });

  it("`interrupted` is a presumption, not a verdict: a real terminal event for the SAME run id overrides it", async () => {
    // A retry that lands after the ceiling is a legitimate run; its outcome
    // outranks the age-based guess, and a success clears the presumed-dead text.
    const { prisma, rows } = makeStore();
    const { CronLifecycleMiddleware, CRON_STATUS } = await loadMiddleware(prisma);
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    rows.push({ id: "late", jobName: "goal-pruner", runId: "r-late", status: CRON_STATUS.interrupted, error: "no terminal event ...", createdAt: new Date(Date.now() - 120 * 60_000) });
    await mw.onRunComplete({ ctx: { runId: "r-late" }, fn: cronFn("goal-pruner"), output: { swept: 3 } });
    expect(rows[0].status).toBe("success");
    expect(rows[0].resultCount).toBe(3);
    expect(rows[0].error).toBeNull();
  });

  it("but WITHOUT a run id the recency fallback still settles only a `started` row", async () => {
    const { prisma, rows } = makeStore();
    const { CronLifecycleMiddleware, CRON_STATUS } = await loadMiddleware(prisma);
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    rows.push({ id: "old-int", jobName: "goal-pruner", status: CRON_STATUS.interrupted, createdAt: new Date(Date.now() - 120 * 60_000) });
    await mw.onRunComplete({ ctx: {}, fn: cronFn("goal-pruner"), output: { swept: 3 } });
    expect(rows[0].status).toBe(CRON_STATUS.interrupted); // a guess must not upgrade a presumed-dead row
  });

  it("`interrupted` is named in the vocabulary and is NOT a terminal-ok status", async () => {
    const { CRON_STATUS, TERMINAL_OK_STATUSES } = await loadMiddleware(makeStore().prisma);
    expect(CRON_STATUS.interrupted).toBe("interrupted");
    expect(TERMINAL_OK_STATUSES).not.toContain("interrupted");
  });
});

describe("RATCHET · the out-of-band failure backstop honours the same override rule (2026-09-22)", () => {
  // Sliced per SQL block, not matched against the whole file: the whole-file
  // shape gave lib/brain/semantic-link.ts a false green once (see its comment).
  const src = readFileSync(join(__dirname, "../../lib/inngest/on-failure.ts"), "utf8");
  const exactStart = src.indexOf("const failedRunId");
  const scanStart = src.indexOf("const candidates");
  it("the file still has both blocks in the expected order", () => {
    expect(exactStart).toBeGreaterThan(0);
    expect(scanStart).toBeGreaterThan(exactStart);
  });
  it("the exact-run-id match accepts started OR interrupted", () => {
    expect(src.slice(exactStart, scanStart)).toMatch(
      /status: \{ in: \[CRON_STATUS\.started, CRON_STATUS\.interrupted\] \}/,
    );
  });
  it("the suffix scan (a guess) stays started-only", () => {
    const scan = src.slice(scanStart, scanStart + 400);
    expect(scan).toMatch(/status: CRON_STATUS\.started,/);
    expect(scan).not.toMatch(/interrupted/);
  });
});

/**
 * 2026-09-22 · MEASURED on prod, read-only: every mega-fanout run since the middleware
 * shipped had 5-6 rows under ONE run id — 4-5 `started` + 1 `success`. mega-fanout runs
 * `Promise.allSettled` of `step.run`s under `concurrency: { limit: 5 }`; Inngest executes
 * parallel steps as separate requests, each with 0 memoized steps and attempt 0, and
 * fires `onRunStart` on each. The settle updated only the newest row, so 49 rows sat at
 * `started` looking like 49 deaths. They were duplicate births.
 */
describe("cron lifecycle · one run, one row — parallel-step requests (2026-09-22)", () => {
  it("a second onRunStart for the SAME run id does not open a second row, and the run still settles", async () => {
    const { prisma, rows } = makeStore();
    const { CronLifecycleMiddleware } = await loadMiddleware(prisma);
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    const fn = cronFn("mega-fanout-morning");
    for (let i = 0; i < 5; i++) await mw.onRunStart({ ctx: { runId: "run-parallel" }, fn });
    expect(rows.filter((r) => r.jobName === "mega-fanout-morning")).toHaveLength(1);
    await mw.onRunComplete({ ctx: { runId: "run-parallel" }, fn, output: { jobsRun: 7 } });
    expect(rows.filter((r) => r.status === "started")).toHaveLength(0);
    expect(rows[0].status).toBe("success");
    expect(rows[0].resultCount).toBe(7); // jobsRun: the *Run suffix is work done
  });

  it("without a run id there is nothing to dedupe on: two starts stay two rows (the pre-runId fallback)", async () => {
    const { prisma, rows } = makeStore();
    const { CronLifecycleMiddleware } = await loadMiddleware(prisma);
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    const fn = cronFn("goal-pruner");
    await mw.onRunStart({ ctx: {}, fn });
    await mw.onRunStart({ ctx: {}, fn });
    expect(rows).toHaveLength(2);
  });

  it("the sweep marks a stale started row with a terminal sibling `duplicate`, and only a sibling-less one `interrupted`", async () => {
    const { prisma, rows, sweeps } = makeStore();
    const m = 60_000;
    rows.push({ id: "a-dup", jobName: "mega-fanout-evening", runId: "run-a", status: "started", createdAt: new Date(Date.now() - 300 * m) });
    rows.push({ id: "a-ok", jobName: "mega-fanout-evening", runId: "run-a", status: "success", createdAt: new Date(Date.now() - 299 * m) });
    rows.push({ id: "b-dead", jobName: "outbox-drain", runId: "run-b", status: "started", createdAt: new Date(Date.now() - 300 * m) });
    rows.push({ id: "c-legacy", jobName: "industry-pull", status: "started", createdAt: new Date(Date.now() - 300 * m) }); // no run id at all
    const { CronLifecycleMiddleware, CRON_STATUS } = await loadMiddleware(prisma);
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    await mw.onRunStart({ ctx: { runId: "now" }, fn: cronFn("approval-sweeper") });
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by("a-dup").status).toBe(CRON_STATUS.duplicate);
    expect(String(by("a-dup").error)).toMatch(/duplicate/i);
    expect(by("a-ok").status).toBe("success");
    expect(by("b-dead").status).toBe(CRON_STATUS.interrupted);
    expect(by("c-legacy").status).toBe(CRON_STATUS.interrupted);
    expect(sweeps).toEqual(["scan", "duplicate:1", "interrupted:2"]);
  });

  it("`duplicate` is in the vocabulary and in neither positive list", async () => {
    const { CRON_STATUS, TERMINAL_OK_STATUSES } = await loadMiddleware(makeStore().prisma);
    expect(CRON_STATUS.duplicate).toBe("duplicate");
    expect(TERMINAL_OK_STATUSES).not.toContain("duplicate");
  });
});
