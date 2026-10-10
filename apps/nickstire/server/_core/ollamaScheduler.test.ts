/**
 * Ollama slot scheduler · doctrine tests.
 *
 * Pins the two properties that make three slots deliberate instead of
 * accidental: background work (P2+) can never occupy the last free slot,
 * and a higher-priority waiter always passes a lower one in the queue —
 * without the blocked background waiter jamming the line.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetSchedulerForTests, acquireOllamaSlot, schedulerSnapshot } from "./ollamaScheduler";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("ollama slot scheduler", () => {
  beforeEach(() => {
    __resetSchedulerForTests();
  });

  it("grants up to 3 slots, queues the 4th, and grants it on release", async () => {
    const r1 = await acquireOllamaSlot(0);
    const r2 = await acquireOllamaSlot(1);
    const r3 = await acquireOllamaSlot(0);
    let granted4 = false;
    const p4 = acquireOllamaSlot(1).then((rel) => { granted4 = true; return rel; });
    await tick();
    expect(granted4).toBe(false);
    expect(schedulerSnapshot().queueDepth).toBe(1);
    r1();
    const rel4 = await p4;
    expect(granted4).toBe(true);
    r2(); r3(); rel4();
    expect(schedulerSnapshot().held).toBe(0);
  });

  it("background (P2+) may never take the last free slot; P1 takes it immediately", async () => {
    const b1 = await acquireOllamaSlot(2);
    const b2 = await acquireOllamaSlot(3);
    // Two background slots held = the background cap. A third background
    // request must queue even though a slot is physically free…
    let b3granted = false;
    const b3 = acquireOllamaSlot(2).then((rel) => { b3granted = true; return rel; });
    await tick();
    expect(b3granted).toBe(false);
    expect(schedulerSnapshot().held).toBe(2);
    // …while a shadow-eval P1 walks straight into the reserved slot.
    const r1 = await acquireOllamaSlot(1);
    expect(schedulerSnapshot().held).toBe(3);
    // Releasing the P1 does NOT free background capacity (cap unchanged)…
    r1();
    await tick();
    expect(b3granted).toBe(false);
    // …but releasing a background slot does.
    b1();
    const relB3 = await b3;
    expect(b3granted).toBe(true);
    b2(); relB3();
  });

  it("priority ordering: a later P1 passes an earlier P3 in the queue", async () => {
    const holds = [await acquireOllamaSlot(0), await acquireOllamaSlot(0), await acquireOllamaSlot(1)];
    const order: string[] = [];
    const p3 = acquireOllamaSlot(3).then((rel) => { order.push("P3"); return rel; });
    const p1 = acquireOllamaSlot(1).then((rel) => { order.push("P1"); return rel; });
    await tick();
    holds[0]();
    await tick();
    holds[1]();
    await tick();
    expect(order[0]).toBe("P1");
    const rels = await Promise.all([p1, p3]);
    holds[2](); rels.forEach((r) => r());
  });

  it("double-release never double-frees a slot", async () => {
    const r1 = await acquireOllamaSlot(0);
    r1();
    r1();
    expect(schedulerSnapshot().held).toBe(0);
    const a = await acquireOllamaSlot(0);
    const b = await acquireOllamaSlot(0);
    const c = await acquireOllamaSlot(0);
    expect(schedulerSnapshot().held).toBe(3);
    a(); b(); c();
  });

  it("telemetry records grants and queue events per priority", async () => {
    const r = await acquireOllamaSlot(1);
    r();
    const snap = schedulerSnapshot();
    expect(snap.granted[1]).toBe(1);
    expect(snap.slots).toBe(3);
    expect(snap.backgroundCap).toBe(2);
  });
});

describe("acquireOllamaSlot maxWaitMs (2026-10-09, opt-in)", () => {
  it("a capped waiter that is not granted in time rejects with a timeout-shaped error and leaves the queue clean; a grant before the cap resolves", async () => {
    vi.useFakeTimers();
    try {
      __resetSchedulerForTests();
      // Background cap is SLOTS-1 = 2: two P2 holders, the third P2 queues.
      const r1 = await acquireOllamaSlot(2);
      const r2 = await acquireOllamaSlot(2);
      const capped = acquireOllamaSlot(2, 1_000);
      capped.catch(() => undefined); // observed below; never unhandled
      expect(schedulerSnapshot().queueDepth).toBe(1);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(capped).rejects.toThrow(/slot wait timed out after 1000 ms/);
      expect(schedulerSnapshot().queueDepth).toBe(0);
      // A release now grants nobody stale: held drops and stays.
      r1();
      expect(schedulerSnapshot().held).toBe(1);

      // Grant before the cap: resolves, and the stale timer fire is a no-op.
      const r3 = await acquireOllamaSlot(2);
      const soon = acquireOllamaSlot(2, 5_000);
      expect(schedulerSnapshot().queueDepth).toBe(1);
      r2();
      const release = await soon;
      expect(typeof release).toBe("function");
      await vi.advanceTimersByTimeAsync(5_000);
      expect(schedulerSnapshot().queueDepth).toBe(0);
      release();
      r3();
      expect(schedulerSnapshot().held).toBe(0);
      // Uncapped waiters still wait indefinitely (the default contract).
      const a = await acquireOllamaSlot(2);
      const b = await acquireOllamaSlot(2);
      let settled = false;
      const forever = acquireOllamaSlot(2).then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(settled).toBe(false);
      a();
      await forever;
      expect(settled).toBe(true);
      b();
    } finally {
      vi.useRealTimers();
      __resetSchedulerForTests();
    }
  });
});
