/**
 * tests/ai/tool-execution-timeout.test.ts
 *
 * THE DEFECT: nothing bounded a tool's execute(). `maxDuration = 120` on
 * the chat route is a Vercel construct and inert on Railway; the provider
 * timeout guards only the non-streaming aiChat helper; and lib/tools/
 * guardian.ts offers a 30s bound but has zero call sites under
 * lib/ai/tools/. One slow tool consumed the whole turn and the operator
 * got "Nick is stuck" from a client-side abort 180s later, with nothing
 * server-side recording which tool hung.
 *
 * CANARY DISCIPLINE (root AGENTS.md). Three ways this guard could ship
 * broken, each asserted here:
 *   1. It never fires        -> "times out a hanging tool".
 *   2. It fires on everything -> "does not touch a tool that returns",
 *      and the moneyprinter case below.
 *   3. It fires on the LONG-RUNNING tools it was written to spare -- the
 *      subtle one. moneyprinter runs a multi-minute render; if the
 *      allowlist regresses it dies at 60s and video generation silently
 *      breaks. Asserted in both directions: alive at 61s, dead at 481s.
 *
 * The write-vs-read split matters because Promise.race ABANDONS the
 * losing promise rather than cancelling it: a timed-out write may still
 * land, so the model must never be told to retry one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { wrapToolsWithEmptyHandling } from "@/lib/ai/tools";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";

/** Never settles -- stands in for a hung DB query or HTTP call. */
const hang = () => new Promise<never>(() => {});

type TimeoutResult = {
  error: string;
  timedOut?: boolean;
  reflection?: { tool: string; guidance: string };
};

function wrapOne(name: string, execute: (...a: unknown[]) => unknown) {
  return wrapToolsWithEmptyHandling({ [name]: { execute } } as never) as unknown as Record<
    string,
    { execute: (a: unknown, o: unknown) => Promise<TimeoutResult> }
  >;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("default tool budget", () => {
  it("times out a hanging tool and says which one and for how long", async () => {
    const tools = wrapOne("someSlowRead", hang);
    const p = tools.someSlowRead.execute({}, {});
    await vi.advanceTimersByTimeAsync(61_000);
    const res = await p;

    expect(res.timedOut).toBe(true);
    expect(res.error).toContain("someSlowRead");
    expect(res.error).toContain("60s");
  });

  it("does not touch a tool that returns in time", async () => {
    const tools = wrapOne("fastRead", async () => ({ ok: true, value: 42 }));
    const p = tools.fastRead.execute({}, {});
    await vi.advanceTimersByTimeAsync(10);
    const res = (await p) as unknown as { ok: boolean; value: number };

    // The canary for "the guard fires on everything".
    expect(res).toEqual({ ok: true, value: 42 });
    expect((res as unknown as TimeoutResult).timedOut).toBeUndefined();
  });

  it("still converts a thrown execute into a soft-fail, not a timeout", async () => {
    const tools = wrapOne("throwingTool", async () => {
      throw new Error("bad input");
    });
    const res = await tools.throwingTool.execute({}, {});

    expect(res.error).toBe("bad input");
    expect(res.timedOut).toBeUndefined();
  });
});

describe("write-vs-read guidance on timeout", () => {
  it("tells the model NOT to retry a side-effecting tool", async () => {
    // Taken from the catalog rather than hardcoded, so this keeps
    // testing a genuinely mutating tool as the catalog changes.
    const mutating = TOOL_CATALOG.find((t) => t.sideEffecting);
    expect(mutating, "catalog should contain a sideEffecting tool").toBeTruthy();

    const tools = wrapOne(mutating!.name, hang);
    const p = tools[mutating!.name].execute({}, {});
    await vi.advanceTimersByTimeAsync(500_000);
    const res = await p;

    expect(res.timedOut).toBe(true);
    expect(res.reflection?.guidance).toMatch(/do NOT call it again/i);
    expect(res.reflection?.guidance).toMatch(/cannot confirm/i);
  });

  it("allows ONE narrower retry for a read", async () => {
    const tools = wrapOne("notInCatalogRead", hang);
    const p = tools.notInCatalogRead.execute({}, {});
    await vi.advanceTimersByTimeAsync(61_000);
    const res = await p;

    expect(res.reflection?.guidance).toMatch(/retry ONCE with a narrower query/i);
  });
});

describe("long-running allowlist", () => {
  it("does NOT kill moneyprinter at the default budget", async () => {
    const tools = wrapOne("moneyprinter", hang);
    const p = tools.moneyprinter.execute({}, {});
    await vi.advanceTimersByTimeAsync(61_000);

    // Still pending: race it against a marker that resolves now.
    const marker = Symbol("pending");
    const winner = await Promise.race([p, Promise.resolve(marker)]);
    expect(winner).toBe(marker);
  });

  it("still bounds moneyprinter at its own budget", async () => {
    const tools = wrapOne("moneyprinter", hang);
    const p = tools.moneyprinter.execute({}, {});
    await vi.advanceTimersByTimeAsync(481_000);
    const res = await p;

    expect(res.timedOut).toBe(true);
    expect(res.error).toContain("480s");
  });
});
