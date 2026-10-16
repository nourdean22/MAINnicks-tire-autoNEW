/**
 * The manual image autopost run starts in the background with an in-flight
 * claim (PR #3071 review, P1).
 *
 * A normal run takes 332-342 s and Railway's gateway times out sooner, so a
 * request that awaited the run showed the operator an error while the server
 * kept going to a live post, and a retry could post a duplicate. The start now
 * returns at once; a second start while one is in flight is refused; the claim
 * clears when the run settles either way. The outcome is the ig_autopost_log
 * row the run writes, which autopostLaneStatus shows.
 *
 * The runner is injected so no real generation runs here.
 */
import { describe, expect, it } from "vitest";
import { readManualRunState, startManualAutopostRun } from "./services/igAutopostManualRun";

function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("startManualAutopostRun", () => {
  it("returns started:true before the run finishes, refuses a second start, and clears after it resolves", async () => {
    const run = deferred();
    let finished = false;
    const calls: Array<string | undefined> = [];
    const res = startManualAutopostRun("proof", async (a) => {
      calls.push(a);
      await run.promise;
      finished = true;
    });
    expect(res.started).toBe(true);
    expect(finished).toBe(false);
    if (!res.started) throw new Error("unreachable");
    expect(readManualRunState()).toEqual({ inFlight: true, startedAt: res.startedAt });

    let secondRan = false;
    const second = startManualAutopostRun(undefined, async () => {
      secondRan = true;
    });
    expect(second).toEqual({
      started: false,
      refusal: `a manual autopost run is already in flight (started ${res.startedAt.toISOString()})`,
    });

    run.resolve();
    await settle();
    expect(finished).toBe(true);
    expect(secondRan).toBe(false);
    expect(calls).toEqual(["proof"]);
    expect(readManualRunState()).toEqual({ inFlight: false, startedAt: null });
  });

  it("clears the claim when the run rejects, and a new start is accepted", async () => {
    const run = deferred();
    const res = startManualAutopostRun(undefined, () => run.promise);
    expect(res.started).toBe(true);
    run.reject(new Error("generation boom"));
    await settle();
    expect(readManualRunState().inFlight).toBe(false);

    const again = startManualAutopostRun(undefined, async () => {});
    expect(again.started).toBe(true);
    await settle();
    expect(readManualRunState().inFlight).toBe(false);
  });

  it("clears the claim when the runner throws synchronously", async () => {
    const res = startManualAutopostRun(undefined, () => {
      throw new Error("sync boom");
    });
    expect(res.started).toBe(true);
    await settle();
    expect(readManualRunState().inFlight).toBe(false);
  });
});
