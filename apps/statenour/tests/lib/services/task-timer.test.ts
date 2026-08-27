/**
 * A timer only some finishers stop.
 *
 * `startTask` stamps `Task.startedAt`; completion is supposed to turn that into
 * minutes on `actualMinutes` and clear the stamp. Measured 2026-08-27, one of
 * three completion paths did the whole job:
 *
 *   service ONCE/PROMISE    banked the minutes, cleared the stamp   ✓
 *   service DAILY/WEEKLY    `void timeBump`, stamp LEFT SET         ✗
 *   agent (Nick)            never read `startedAt` at all           ✗
 *
 * So which of the two ways you happened to close a task decided whether your
 * work was measured — and on the agent path a DONE row kept a start stamp,
 * which any `startedAt` reader sees as still in progress.
 *
 * That is worse than having no timer. The rows it does produce are a biased
 * sample of how tasks were CLOSED, not of how long work took, and nothing
 * about the number says so.
 *
 * The DAILY discard is preserved on purpose — see task-timer.ts. `actualMinutes`
 * is compared against a per-instance effort estimate, and a recurring row is
 * never re-created, so accumulating across repetitions would read as an
 * enormous overage. The discard was intentional; the dangling stamp was not.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stopTimer, accumulate } from "@/lib/services/task-timer";

const T0 = new Date("2026-08-27T15:00:00.000Z");
const at = (minutesLater: number) => new Date(T0.getTime() + minutesLater * 60_000);

describe("stopTimer · turning a running clock into minutes", () => {
  it("a task that was never started yields NULL, not zero", () => {
    // Zero is a real measurement: started and finished inside one minute.
    // `actualMinutes` already has a NOT NULL default of 0 that makes untimed
    // rows look measured — 268 of 268 non-null, 0 above zero when written.
    const r = stopTimer(null, T0);
    expect(r.addMinutes).toBeNull();
    expect(r.startedAt).toBeNull();
  });

  it("banks the elapsed minutes", () => {
    expect(stopTimer(T0, at(45)).addMinutes).toBe(45);
  });

  it("FLOOR OF 1: a real but sub-minute task is not rounded back into 'never timed'", () => {
    const r = stopTimer(T0, new Date(T0.getTime() + 20_000));
    expect(r.addMinutes).toBe(1);
  });

  it("a backwards clock is a corrupt reading, not a zero-minute task", () => {
    expect(stopTimer(at(10), T0).addMinutes).toBeNull();
  });

  it("keepDuration:false still CLEARS the stamp — that half was the bug", () => {
    const r = stopTimer(T0, at(90), { keepDuration: false });
    expect(r.addMinutes).toBeNull();
    expect(r.startedAt).toBeNull();
  });

  it("always clears, whichever way it was called", () => {
    for (const r of [stopTimer(null, T0), stopTimer(T0, at(5)), stopTimer(T0, at(5), { keepDuration: false })]) {
      expect(r.startedAt).toBeNull();
    }
  });
});

describe("accumulate · an untimed completion must not erase banked minutes", () => {
  it("returns undefined when nothing was timed, so Prisma skips the column", () => {
    expect(accumulate(30, stopTimer(null, T0))).toBeUndefined();
  });

  it("adds to what is already banked", () => {
    expect(accumulate(30, stopTimer(T0, at(15)))).toBe(45);
  });

  it("treats a null column as zero when there IS something to add", () => {
    expect(accumulate(null, stopTimer(T0, at(15)))).toBe(15);
  });

  it("POSITIVE CONTROL: the two cases are genuinely different", () => {
    // Guards against a future `?? 0` that would make both branches return a
    // number and quietly overwrite banked minutes with 0.
    expect(accumulate(30, stopTimer(null, T0))).not.toBe(30);
    expect(accumulate(30, stopTimer(T0, at(0)))).toBe(31);
  });
});

describe("every completion path stops the clock", () => {
  const strip = (f: string) =>
    readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  const agent = () => strip("lib/ai/agent-actions/task-actions.ts");
  const service = () => strip("lib/services/task-actions.ts");

  it("the agent path READS the timer it used to ignore", () => {
    const code = agent();
    expect(code).toMatch(/startedAt:\s*true/);
    expect(code).toMatch(/actualMinutes:\s*true/);
    expect(code).toContain("stopTimer");
  });

  it("the agent DONE branch banks the minutes", () => {
    expect(agent()).toMatch(/actualMinutes:\s*accumulate\(/);
  });

  it("BOTH agent branches clear the stamp — DAILY too", () => {
    // Two `startedAt: null` writes: the DAILY branch (READY) and the DONE
    // branch. One was the whole dangling-stamp bug.
    const hits = agent().match(/startedAt:\s*null/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it("the service DAILY branch clears the stamp", () => {
    const code = service();
    const at = code.indexOf('status: nextStatus');
    expect(at).toBeGreaterThan(-1);
    const block = code.slice(Math.max(0, at - 400), at + 400);
    expect(block).toMatch(/startedAt:\s*null/);
  });

  it("the service path shares the one definition", () => {
    expect(service()).toContain("stopTimer");
    expect(service()).toMatch(/actualMinutes:\s*accumulate\(/);
  });
});

describe("the chat surface no longer reports a structural zero", () => {
  const registry = () => readFileSync("lib/ai/chat/command-registry.ts", "utf8");

  it("focusedMinutes is guarded before it is printed", () => {
    const code = registry()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // It printed "0m focused" every day, to the one surface that then reasons
    // out loud about the operator's day.
    expect(code).toMatch(/t\.focusedMinutes\s*>\s*0/);
  });

  it("and the empty branch says why, rather than implying no work happened", () => {
    expect(registry()).toMatch(/not a claim that no work happened/i);
  });
});
