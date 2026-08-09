import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The first-call probe exists to answer a question grep cannot: which of the
 * 163 no-caller-in-repo procedures are actually served in production. Every
 * tRPC procedure is reachable over HTTP by callers outside this repository, so
 * a static census is an upper bound, never a delete list.
 *
 * These pin the MECHANISM — that a served procedure logs exactly once per
 * process — because a probe that silently stops emitting would read as "this
 * procedure is dead" and get something deleted. That failure is worse than no
 * probe at all, so it is the thing under test.
 */

const logInfo = vi.fn();
vi.mock("../lib/logger", () => ({
  createLogger: () => ({
    info: (...a: unknown[]) => logInfo(...a),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { publicProcedure, router, __seenProceduresForTest } = await import("../_core/trpc");

const appRouter = router({
  alpha: publicProcedure.query(() => "a"),
  beta: publicProcedure.query(() => "b"),
});

// minimal context — these procedures touch none of it
const caller = () => appRouter.createCaller({} as never);

describe("tRPC first-call probe", () => {
  beforeEach(() => logInfo.mockClear());

  it("logs a first-call line the first time a procedure is served", async () => {
    await caller().alpha();
    const lines = logInfo.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("[tRPC first-call]") && l.includes("alpha"))).toBe(true);
  });

  it("does NOT log again for the same procedure — one line per process, not per call", async () => {
    await caller().alpha();
    logInfo.mockClear();
    await caller().alpha();
    await caller().alpha();
    const repeats = logInfo.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes("[tRPC first-call]") && l.includes("alpha"));
    expect(repeats).toEqual([]);
  });

  it("tracks each procedure independently, so one busy path cannot mask a quiet one", async () => {
    await caller().alpha();
    logInfo.mockClear();
    await caller().beta();
    const lines = logInfo.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("[tRPC first-call]") && l.includes("beta"))).toBe(true);
  });

  it("records served procedures in the seen set, and nothing that was never called", async () => {
    await caller().alpha();
    const seen = __seenProceduresForTest();
    expect(seen.has("alpha")).toBe(true);
    expect(seen.has("neverCalled")).toBe(false);
  });
});
