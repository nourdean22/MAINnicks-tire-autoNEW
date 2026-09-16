/**
 * `ledgerRecordingState()` itself, against the REAL module.
 *
 * llmLedgerRead.test.ts mocks this function in order to drive the reader's
 * branches, which means it cannot see the predicate's own logic at all — a
 * mutation that made it ignore the latched `disabled` flag left that suite
 * entirely green. So the P1 fix it exists for had no coverage until this file.
 * That is the silent-instrument shape twice over in one PR: first a stub that
 * hid the SQL, now a stub that hid the predicate.
 *
 * The flag being latched is the whole point. `recordLlmCall` sets a
 * module-level `disabled = true` on its first insert failure and drops every
 * later call until the process restarts. An env-only readiness check therefore
 * reports "on" over a writer that has permanently stopped, and the panel would
 * present a frozen window as current usage.
 *
 * `disabled` is module state, and serial vitest shares one module registry
 * across every file — so each case takes a FRESH instance via resetModules()
 * plus a dynamic import, and never mutates the copy other suites hold.
 */
import { describe, expect, it, vi, afterEach } from "vitest";

type Ledger = typeof import("./services/llmLedger");

/** A fresh llmLedger whose database call behaves as asked. */
async function freshLedger(opts: { dbThrows?: boolean } = {}): Promise<Ledger> {
  vi.resetModules();
  vi.doMock("./db", () => ({
    getDb: () =>
      opts.dbThrows
        ? Promise.reject(new Error("Table 'llm_calls' doesn't exist"))
        : Promise.resolve({ execute: () => Promise.resolve([[], []]) }),
  }));
  return import("./services/llmLedger");
}

/**
 * Let the fire-and-forget insert settle. `recordLlmCall` returns void by
 * design and its IIFE awaits two dynamic imports before it can reach the
 * failing getDb, so a single tick is not enough — one macrotask left the flag
 * unset and the first run of this file red for the wrong reason.
 */
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 5));
};

const CALL = {
  params: { messages: [{ role: "user" as const, content: "hi" }] },
  model: "gemini-2.5-flash",
  latencyMs: 12,
  ok: true,
};

afterEach(() => {
  vi.doUnmock("./db");
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("ledgerRecordingState — the flag is not the whole story", () => {
  it("off when the env flag is unset", async () => {
    vi.stubEnv("LLM_LEDGER_ENABLED", "");
    const { ledgerRecordingState } = await freshLedger();
    expect(ledgerRecordingState()).toBe("off");
  });

  it("off when the env flag is the literal string 'false'", async () => {
    vi.stubEnv("LLM_LEDGER_ENABLED", "false");
    const { ledgerRecordingState } = await freshLedger();
    expect(ledgerRecordingState()).toBe("off");
  });

  it("on when the flag is true and no write has failed", async () => {
    vi.stubEnv("LLM_LEDGER_ENABLED", "true");
    const { ledgerRecordingState } = await freshLedger();
    expect(ledgerRecordingState()).toBe("on");
  });

  it("stopped_after_error once a write has failed — the case an env check cannot see", async () => {
    vi.stubEnv("LLM_LEDGER_ENABLED", "true");
    const ledger = await freshLedger({ dbThrows: true });

    expect(ledger.ledgerRecordingState()).toBe("on"); // nothing has failed yet

    ledger.recordLlmCall(CALL as never);
    await settle();

    expect(ledger.ledgerRecordingState()).toBe("stopped_after_error");
  });

  it("the stop LATCHES — it does not clear itself on the next healthy call", async () => {
    vi.stubEnv("LLM_LEDGER_ENABLED", "true");
    const ledger = await freshLedger({ dbThrows: true });

    ledger.recordLlmCall(CALL as never);
    await settle();
    ledger.recordLlmCall(CALL as never);
    await settle();

    // Still stopped. This is why the reader must ask, rather than assume the
    // flag: only a process restart clears it.
    expect(ledger.ledgerRecordingState()).toBe("stopped_after_error");
  });

  it("a failed write reports off, not stopped, when the flag is also off", async () => {
    // Precedence matters: "off" is the more actionable answer, because turning
    // the flag on is something the operator can do.
    vi.stubEnv("LLM_LEDGER_ENABLED", "true");
    const ledger = await freshLedger({ dbThrows: true });
    ledger.recordLlmCall(CALL as never);
    await settle();
    expect(ledger.ledgerRecordingState()).toBe("stopped_after_error");

    vi.stubEnv("LLM_LEDGER_ENABLED", "");
    expect(ledger.ledgerRecordingState()).toBe("off");
  });
});
