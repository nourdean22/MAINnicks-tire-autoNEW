/**
 * The manual door for the receptionist prompt experiment.
 *
 * Pins: the door starts the SAME cycle with trigger "manual" and answers
 * before it ends; one run at a time; the scheduler's lock is honoured
 * (held-by-other is a skip, never a second run); the env the tier declares is
 * required; the drain flag is a skip; a completed run writes the cron_log row
 * and releases the lock; a thrown run writes status failed with the error and
 * releases; a timed-out run HOLDS the lock (same contract as the tier runner);
 * the budget constant equals the tier job's timeoutMs in scheduler.ts; the
 * latest-row summary carries hashes and counts and never the candidate prompt.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sliceBlock } from "../testUtils/sourceBlock";

// Serial mode shares ONE vi.mock registry across files (apps/nickstire/AGENTS.md
// section 3): a predecessor's partial schema mock would leave cronLog or
// shopSettings undefined for the runner's static import. Hoisted, so the real
// schema is in place before the import below.
vi.unmock("../../drizzle/schema");
vi.unmock("drizzle-orm");

import {
  PROMPT_EVOLUTION_BUDGET_MS,
  PROMPT_EVOLUTION_JOB_NAME,
  _resetPromptEvolutionManualRunForTests,
  promptEvolutionManualRunStatus,
  startPromptEvolutionManualRun,
  summarizeLatestRow,
  whenPromptEvolutionManualRunSettled,
  type CronLogRow,
} from "./promptEvolutionManualRun";

vi.mock("../lib/logger", () => {
  const l: Record<string, unknown> = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
  l.child = () => l;
  return { createLogger: () => l };
});

const acquired = { status: "acquired" as const, jobName: PROMPT_EVOLUTION_JOB_NAME, token: "tok" as never };

function harness(over: Partial<Parameters<typeof startPromptEvolutionManualRun>[0]> = {}) {
  const rows: CronLogRow[] = [];
  const released: unknown[] = [];
  let t = new Date("2026-10-09T14:00:00Z").getTime();
  const deps = {
    now: () => new Date(t),
    env: { OLLAMA_API_KEY: "set" } as NodeJS.ProcessEnv,
    acquireLock: vi.fn(async () => acquired),
    releaseLock: vi.fn(async (l: unknown) => { released.push(l); }),
    isDraining: () => false,
    track: <T,>(_: string, run: Promise<T>) => run,
    logRun: async (row: CronLogRow) => { rows.push(row); },
    setTimer: vi.fn(() => "timer"),
    clearTimer: vi.fn(),
    ...over,
  };
  return { deps, rows, released, advance: (ms: number) => { t += ms; } };
}

describe("startPromptEvolutionManualRun", () => {
  beforeEach(() => _resetPromptEvolutionManualRunForTests());

  it("starts the cycle, answers before it ends, then records a completed cron_log row and releases the lock", async () => {
    let finish!: (r: { recordsProcessed: number; details: string }) => void;
    const run = vi.fn(() => new Promise<{ recordsProcessed: number; details: string }>((res) => { finish = res; }));
    const h = harness({ run });
    const start = await startPromptEvolutionManualRun(h.deps);
    expect(start).toEqual({ status: "started", startedAt: "2026-10-09T14:00:00.000Z", budgetMs: PROMPT_EVOLUTION_BUDGET_MS });
    expect(run).toHaveBeenCalledWith(new Date("2026-10-09T14:00:00Z"));
    expect(h.deps.acquireLock).toHaveBeenCalledWith(PROMPT_EVOLUTION_JOB_NAME, PROMPT_EVOLUTION_BUDGET_MS * 2);
    expect(promptEvolutionManualRunStatus(new Date("2026-10-09T14:05:00Z")).active).toEqual({ startedAt: "2026-10-09T14:00:00.000Z", elapsedMs: 300_000, budgetMs: PROMPT_EVOLUTION_BUDGET_MS });

    h.advance(10 * 60_000);
    // The cycle names its own trigger (promptEvolutionWeekly.ts); the runner must not append it again.
    finish({ recordsProcessed: 1, details: "outcome: accepted · receipt prompt-evolution:abc · manual run" });
    await whenPromptEvolutionManualRunSettled();

    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({ jobName: PROMPT_EVOLUTION_JOB_NAME, status: "completed", recordsProcessed: 1, durationMs: 600_000, errorMessage: null });
    expect(h.rows[0].details).toBe("outcome: accepted · receipt prompt-evolution:abc · manual run");
    expect(h.rows[0].details.split("manual run")).toHaveLength(2);
    expect(h.released).toEqual([acquired]);
    expect(h.deps.clearTimer).toHaveBeenCalledWith("timer");
    const s = promptEvolutionManualRunStatus();
    expect(s.active).toBeNull();
    expect(s.last).toMatchObject({ status: "completed", recordsProcessed: 1, durationMs: 600_000 });
  });

  it("a second start while one runs answers 'running' and never starts a second cycle", async () => {
    let finish!: (r: { recordsProcessed: number; details: string }) => void;
    const run = vi.fn(() => new Promise<{ recordsProcessed: number; details: string }>((res) => { finish = res; }));
    const h = harness({ run });
    await startPromptEvolutionManualRun(h.deps);
    h.advance(120_000);
    const again = await startPromptEvolutionManualRun(h.deps);
    expect(again).toEqual({ status: "running", startedAt: "2026-10-09T14:00:00.000Z", elapsedMs: 120_000 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(h.deps.acquireLock).toHaveBeenCalledTimes(1);
    finish({ recordsProcessed: 0, details: "x" });
    await whenPromptEvolutionManualRunSettled();
  });

  it("two starts in the same tick under lock FALLBACK run the cycle once: the slot is claimed before the first await", async () => {
    // 2026-10-09 review: the guard was read before `await import` and the lock
    // round-trip and written after them. acquireCronLock proceeds on fallback
    // (db-null, table-missing, query-error), so two starts inside that window
    // both ran, both spending the sealed confirmation seeds.
    let finish!: (r: { recordsProcessed: number; details: string }) => void;
    const run = vi.fn(() => new Promise<{ recordsProcessed: number; details: string }>((res) => { finish = res; }));
    const h = harness({ run, acquireLock: vi.fn(async () => ({ status: "fallback" as const, reason: "query-error" as const })) });
    const [a, b] = await Promise.all([startPromptEvolutionManualRun(h.deps), startPromptEvolutionManualRun(h.deps)]);
    expect(a.status).toBe("started");
    expect(b).toEqual({ status: "running", startedAt: "2026-10-09T14:00:00.000Z", elapsedMs: 0 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(h.deps.acquireLock).toHaveBeenCalledTimes(1);
    finish({ recordsProcessed: 0, details: "x · manual run" });
    await whenPromptEvolutionManualRunSettled();
    expect(h.rows).toHaveLength(1);
    expect(promptEvolutionManualRunStatus().active).toBeNull();
  });

  it("every early return hands the slot back: a refusal, a drain skip or a held lock never leaves the door stuck", async () => {
    const refused = harness({ env: {} as NodeJS.ProcessEnv });
    await startPromptEvolutionManualRun(refused.deps);
    expect(promptEvolutionManualRunStatus().active).toBeNull();
    const held = harness({ acquireLock: vi.fn(async () => ({ status: "held-by-other" as const })) });
    await startPromptEvolutionManualRun(held.deps);
    expect(promptEvolutionManualRunStatus().active).toBeNull();
    const run = vi.fn(async () => ({ recordsProcessed: 0, details: "x · manual run" }));
    const ok = harness({ run });
    expect((await startPromptEvolutionManualRun(ok.deps)).status).toBe("started");
    await whenPromptEvolutionManualRunSettled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("the scheduler's lock wins: held-by-other is a skip, no cycle, no cron_log row", async () => {
    const run = vi.fn();
    const h = harness({ run, acquireLock: vi.fn(async () => ({ status: "held-by-other" as const })) });
    const r = await startPromptEvolutionManualRun(h.deps);
    expect(r.status).toBe("skipped");
    expect(run).not.toHaveBeenCalled();
    expect(h.rows).toHaveLength(0);
    expect(promptEvolutionManualRunStatus().active).toBeNull();
  });

  it("refuses without the env the tier job requires, before touching the lock", async () => {
    const h = harness({ env: {} as NodeJS.ProcessEnv });
    const r = await startPromptEvolutionManualRun(h.deps);
    expect(r).toMatchObject({ status: "refused" });
    expect((r as { reason: string }).reason).toContain("OLLAMA_API_KEY");
    expect(h.deps.acquireLock).not.toHaveBeenCalled();
  });

  it("a draining server is a skip; a drain that flips during the lock await hands the lock back", async () => {
    const h1 = harness({ isDraining: () => true });
    expect((await startPromptEvolutionManualRun(h1.deps)).status).toBe("skipped");
    expect(h1.deps.acquireLock).not.toHaveBeenCalled();

    let draining = false;
    const run = vi.fn();
    const h2 = harness({ run, isDraining: () => draining, acquireLock: vi.fn(async () => { draining = true; return acquired; }) });
    expect((await startPromptEvolutionManualRun(h2.deps)).status).toBe("skipped");
    expect(run).not.toHaveBeenCalled();
    expect(h2.released).toEqual([acquired]);
  });

  it("a thrown cycle writes status failed with the error, releases the lock, and the door is free again", async () => {
    const h = harness({ run: vi.fn(async () => { throw new Error("only 2 usable seeds — need >= 4"); }) });
    await startPromptEvolutionManualRun(h.deps);
    await whenPromptEvolutionManualRunSettled();
    expect(h.rows[0]).toMatchObject({ status: "failed", recordsProcessed: 0, errorMessage: "only 2 usable seeds — need >= 4" });
    expect(h.rows[0].details).toContain("manual run failed");
    expect(h.released).toEqual([acquired]);
    expect(promptEvolutionManualRunStatus().last?.status).toBe("failed");
    expect(promptEvolutionManualRunStatus().active).toBeNull();
  });

  it("a timed-out cycle holds the lock to its TTL (the handler may still be running) and says so", async () => {
    let fire!: () => void;
    const h = harness({
      run: vi.fn(() => new Promise(() => undefined)),
      setTimer: vi.fn((fn: () => void) => { fire = fn; return "timer"; }),
    });
    await startPromptEvolutionManualRun(h.deps);
    expect(h.deps.setTimer).toHaveBeenCalledWith(expect.any(Function), PROMPT_EVOLUTION_BUDGET_MS);
    h.advance(PROMPT_EVOLUTION_BUDGET_MS);
    fire();
    await whenPromptEvolutionManualRunSettled();
    expect(h.rows[0]).toMatchObject({ status: "failed", errorMessage: "timeout" });
    expect(h.rows[0].details).toContain("budget");
    expect(h.released).toEqual([]);
    expect(promptEvolutionManualRunStatus().last?.status).toBe("timeout");
  });

  it("after a timeout the slot stays held until the handler settles: a second start answers running, then the lock is released and the door frees", async () => {
    // 2026-10-10 review: the slot used to free at the timeout while the
    // handler ran on, so a second start ran a second cycle beside it.
    const timers: Array<() => void> = [];
    let finish!: () => void;
    const run = vi.fn(() => new Promise<{ recordsProcessed: number; details: string }>((r) => { finish = () => r({ recordsProcessed: 0, details: "late" }); }));
    const h = harness({ run, setTimer: vi.fn((fn: () => void) => { timers.push(fn); return "timer"; }) });
    await startPromptEvolutionManualRun(h.deps);
    timers[0](); // the budget timer fires
    await whenPromptEvolutionManualRunSettled();
    expect(promptEvolutionManualRunStatus().last?.status).toBe("timeout");
    expect(await startPromptEvolutionManualRun(h.deps)).toMatchObject({ status: "running" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(h.released).toEqual([]);
    finish(); // the handler settles late
    await vi.waitFor(() => expect(h.released).toEqual([acquired]));
    expect(promptEvolutionManualRunStatus().active).toBeNull();
    expect(await startPromptEvolutionManualRun(h.deps)).toMatchObject({ status: "started" });
  });

  it("a handler that never settles frees the slot one budget after the timeout, where the lock's TTL ends", async () => {
    const timers: Array<() => void> = [];
    const h = harness({ run: vi.fn(() => new Promise(() => undefined)), setTimer: vi.fn((fn: () => void) => { timers.push(fn); return "timer"; }) });
    await startPromptEvolutionManualRun(h.deps);
    timers[0]();
    await whenPromptEvolutionManualRunSettled();
    await vi.waitFor(() => expect(timers).toHaveLength(2));
    expect(h.deps.setTimer).toHaveBeenLastCalledWith(expect.any(Function), PROMPT_EVOLUTION_BUDGET_MS);
    expect(promptEvolutionManualRunStatus().active).not.toBeNull();
    timers[1](); // one more budget
    await vi.waitFor(() => expect(promptEvolutionManualRunStatus().active).toBeNull());
    expect(h.released).toEqual([acquired]);
  });

  it("the budget equals the tier job's timeoutMs in scheduler.ts (a drifted budget outlives its own lock)", () => {
    const src = readFileSync(resolve(__dirname, "../cron/scheduler.ts"), "utf8");
    // sliceBlock throws on a missing anchor; a raw indexOf slice would widen to EOF and pass on unrelated text.
    const block = sliceBlock(src, `name: "${PROMPT_EVOLUTION_JOB_NAME}"`, "handler:", { label: "scheduler.ts" });
    const m = /timeoutMs:\s*([0-9*\s]+),/.exec(block);
    expect(m, "the tier job must declare timeoutMs").not.toBeNull();
    // eslint-disable-next-line no-new-func
    expect(Number(new Function(`return ${m![1]}`)())).toBe(PROMPT_EVOLUTION_BUDGET_MS);
    expect(block).toContain('requiresEnv: "OLLAMA_API_KEY"');
  });

  it("the admin door sits behind requireAdminApiKey on the same registration line", () => {
    const src = readFileSync(resolve(__dirname, "../routes/adminRoutes.ts"), "utf8");
    expect(src).toMatch(/app\.post\("\/api\/admin\/run-prompt-evolution",\s*requireAdminApiKey/);
    expect(src).toMatch(/app\.get\("\/api\/admin\/prompt-evolution-status",\s*requireAdminApiKey/);
  });
});

describe("summarizeLatestRow", () => {
  it("carries hashes, counts, reasons and the trigger; never the candidate prompt or caller text", () => {
    const row = {
      ranAt: "2026-10-09T14:00:00.000Z",
      trigger: "manual",
      outcome: "accepted",
      promotionStage: "offline_candidate",
      accepted: { prompt: "FULL CANDIDATE PROMPT TEXT", promptHash: "cand1234abcd", confirmed: true, rationale: "caller said their name is Maria" },
      baseline: { promptHash: "live5678efgh", parity: "code_plus_lessons", prompt: "FULL LIVE PROMPT" },
      lanes: { parity: false, differences: ["tool stubs"] },
      cohorts: { train: 12, holdout: 12, confirm: 8, success: 8 },
      gates: { holdout: { reason: "improved", improved: 8, worsened: 0, tied: 0, pValue: 0.004 }, success: { reason: "preserved" }, confirmation: { reason: "improved" } },
      usableSeeds: 24, trainCount: 12, holdoutCount: 12,
      experimentId: "prompt-evolution:abc123", receiptDelivered: true,
      usage: { durationMs: 900_000 },
      candidateSummaries: [
        { rationale: "caller Maria wants a callback", train: "unscored", rejectedInvariants: ["clause-preservation", "reversal:price"], promptHash: "deadbeef0001" },
        { rationale: "shorter greeting", train: "9/12", promptHash: "cand1234abcd", trainMargin: 3, trainUsable: true },
      ],
    };
    const s = summarizeLatestRow(JSON.stringify(row))!;
    expect(s).toMatchObject({
      trigger: "manual", outcome: "accepted", accepted: true, confirmed: true, candidateHash: "cand1234abcd",
      baselinePromptHash: "live5678efgh", baselineParity: "code_plus_lessons", laneParity: false,
      experimentId: "prompt-evolution:abc123", receiptDelivered: true, durationMs: 900_000,
      seeds: { usable: 24, train: 12, holdout: 12, confirm: 8, success: 8 },
      gates: { holdout: "improved", success: "preserved", confirmation: "improved" },
      holdoutStats: { improved: 8, worsened: 0, tied: 0, pValue: 0.004 },
      candidates: [
        { promptHash: "deadbeef0001", train: "unscored", rejectedInvariants: ["clause-preservation", "reversal:price"], trainMargin: null, trainUsable: null },
        { promptHash: "cand1234abcd", train: "9/12", rejectedInvariants: [], trainMargin: 3, trainUsable: true },
      ],
    });
    const json = JSON.stringify(s);
    expect(json).not.toContain("callback");
    expect(json).not.toContain("shorter greeting");
    expect(json).not.toContain("FULL CANDIDATE PROMPT TEXT");
    expect(json).not.toContain("FULL LIVE PROMPT");
    expect(json).not.toContain("Maria");
  });

  it("a row from before the trigger field reads 'unknown'; a missing or unparseable row is null", () => {
    expect(summarizeLatestRow(JSON.stringify({ outcome: "rejected-holdout", accepted: null }))).toMatchObject({ trigger: "unknown", accepted: false, outcome: "rejected-holdout", candidates: [], holdoutStats: null });
    expect(summarizeLatestRow(null)).toBeNull();
    expect(summarizeLatestRow("{not json")).toBeNull();
    expect(summarizeLatestRow("[]")).toBeNull();
  });
});
