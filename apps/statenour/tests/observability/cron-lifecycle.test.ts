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
        const hits = rows.filter(
          (r) =>
            (where.jobName === undefined || r.jobName === where.jobName) &&
            (where.status === undefined || r.status === where.status) &&
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
    },
  };
  return { prisma, rows, history };
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
   * ⚠ THIS TEST PINS A KNOWN LIMITATION, NOT A CAPABILITY.
   *
   * `cron_job_logs` has no run-id column yet, so a settle matches the NEWEST
   * `started` row for the job rather than its own. With two overlapping runs
   * of the SAME cron, the first to finish settles the newer row and the older
   * one is stranded until `isStaleRun` catches it.
   *
   * It is pinned rather than left undefined for two reasons: the behaviour is
   * survivable today (one schedule per cron, no concurrent instances), and
   * writing it down is what makes the follow-up legible — when the `runId`
   * column lands, THIS test should start failing, and its replacement is the
   * exact-match assertion. A limitation nobody encoded is a limitation the
   * next person rediscovers as a bug.
   */
  it("LIMITATION — overlapping runs of one cron settle by recency, not identity", async () => {
    const { prisma, rows } = makeStore();
    const { CronLifecycleMiddleware } = await loadMiddleware(prisma);
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    const fn = cronFn("industry-pull");

    await mw.onRunStart({ ctx: { runId: "run-1" }, fn });
    await mw.onRunStart({ ctx: { runId: "run-2" }, fn });
    await mw.onRunComplete({ ctx: { runId: "run-1" }, fn });

    // Two rows exist; run-1 finishing settled the NEWER one.
    expect(rows).toHaveLength(2);
    expect(rows[1].status).toBe("success");
    expect(rows[0].status).toBe("started");
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
