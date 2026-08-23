/**
 * Task completion must leave a trace. Three instruments, all previously blind.
 *
 * THE INCIDENT, 2026-08-23. The operator reported that completing a task threw an
 * error. Diagnosing it meant asking the system what had happened, and every
 * instrument reached for was structurally incapable of answering:
 *
 *   · task_events had recorded ZERO completions — 292 rows across created /
 *     revived / reframed / started / snoozed, and not one "completed". The kind
 *     existed in the union; nobody ever emitted it. Its silence was nearly read as
 *     "no completion was attempted".
 *   · error_logs had no completion failure — because checkTask threw ServiceError
 *     and the tRPC handler converted it without recording anything. The path could
 *     not write there at all.
 *   · reality_gap_writeback_failed had exactly ONE reference repo-wide: its own
 *     writer. Nothing read it, so every dropped effort-band average was invisible.
 *
 * An instrument that cannot observe its own subject is worse than no instrument,
 * because its silence gets mistaken for evidence. These assert the wiring at the
 * source, in the same shape as the cron-heartbeat wiring canary: there is no
 * harness here that can drive checkTask end to end without a large mock of a large
 * function, and a test that pretends to is a worse control than one that is honest
 * about asserting the call site.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const TASK_ACTIONS = "lib/services/task-actions.ts";
const TASK_ROUTER = "lib/trpc/routers/task.ts";
const TASK_EVENTS = "lib/brain/task-events.ts";

describe("task completion is observable", () => {
  // NOTE — the emit itself is covered BEHAVIOURALLY in
  // tests/lib/services/task-completion-event.test.ts, which drives checkTask and
  // asserts on the mocked emitTaskEventAsync. The source-text version that used
  // to live here asserted only that `kind: "completed"` appeared somewhere
  // between two function declarations, and it was GREEN over a live blind spot:
  // the recurring branch returns ~300 lines before that string, so every DAILY
  // and WEEKLY completion emitted nothing while this file reported success.
  // What remains here is the error-logging wiring, which has no cheap harness.

  it("'completed' is a real kind the log accepts, not an invented string", () => {
    // Guards the other half: an emit with a kind the union does not carry would be
    // a type error today, but the union is edited by hand and could lose it.
    expect(src(TASK_EVENTS)).toContain('| "completed"');
  });

  it("the completion mutation records its own failures", () => {
    const s = src(TASK_ROUTER);
    const checkHandler = s.slice(s.indexOf("check: operatorProcedure"), s.indexOf("start: operatorProcedure"));
    expect(checkHandler.length).toBeGreaterThan(0);
    expect(
      checkHandler,
      "this catch converted ServiceError into TRPCError and logged NOTHING, which is " +
        "why error_logs came back empty during the incident and proved nothing",
    ).toContain("logError");
    expect(checkHandler).toContain("trpc.task.check");
  });

  it("a 4xx is logged at warn and a real failure at error — not everything at one level", () => {
    const s = src(TASK_ROUTER);
    const checkHandler = s.slice(s.indexOf("check: operatorProcedure"), s.indexOf("start: operatorProcedure"));
    // Logging operator typos at "error" trains the reader to ignore the channel,
    // which is how a log stops being an instrument.
    expect(checkHandler).toMatch(/status < 500 \? "warn" : "error"/);
  });

  it("BOTH tRPC completion procedures log — covering only one was the first mistake", () => {
    // /missions routes completion two ways (use-mission-actions.handleCompleteTask):
    //   recurring DAILY/WEEKLY -> trpc.task.check
    //   everything else        -> trpc.task.update with status "DONE"
    // The first fix covered only task.check, leaving half the operator-visible
    // failures unlogged.
    //
    // CORRECTION, made under review: an earlier version of this comment called
    // these two INDEPENDENT paths. They are not. updateTask short-circuits into
    // checkTask at tasks.ts:891 (`isCompletionTransition`), and the completion
    // branch further down at tasks.ts:1031 is annotated in-source as
    // "★ UNREACHABLE since the isCompletionTransition short-circuit above".
    // They converge on one spine. That convergence is exactly WHY the recurring
    // early-return inside checkTask was the whole remaining hole — believing the
    // routes were separate is what let it through the first time.
    const s = src(TASK_ROUTER);
    // Slice FORWARD from update, not between two procedure names: `delete` is
    // declared BEFORE `update` in this router, so an indexOf-to-indexOf window
    // was negative and produced an empty string that passed nothing.
    const at = s.indexOf("  update: operatorProcedure");
    expect(at, "the update procedure must exist").toBeGreaterThan(-1);
    const updateHandler = s.slice(at, at + 2500);
    expect(updateHandler.length).toBeGreaterThan(0);
    expect(
      updateHandler,
      "task.update is the NON-recurring completion path and had the identical " +
        "convert-and-discard catch as task.check",
    ).toContain("logError");
    expect(updateHandler).toContain("trpc.task.update");
  });

  it("the swallow itself is preserved — observability must not become a new failure path", () => {
    const s = src(TASK_ACTIONS);
    const i = s.indexOf('log.warn("reality_gap_writeback_failed"');
    const around = s.slice(Math.max(0, i - 1400), i + 600);
    // The real invariant is that the call cannot throw INSIDE a catch block, not
    // that it uses any particular import style. An earlier version asserted
    // `void import("@/lib/utils/error-log")` — pinning the mechanism to a dynamic
    // import that was itself the hazard: a chunk-load failure under a partial
    // deploy would reject unhandled, exactly the outage the logging was meant to
    // reveal. logError is synchronous, guarded by `if (prisma?.errorLog?.create)`,
    // and documented "never throws, never blocks" (lib/utils/error-log.ts:6), so a
    // direct call is the safe form. What must NOT appear here is an await.
    expect(around).toContain("logError(");
    expect(around, "awaiting the log inside a catch is what would break a completion").not.toMatch(
      /await\s+logError/,
    );
    expect(around).not.toContain('import("@/lib/utils/error-log")');
  });
});
