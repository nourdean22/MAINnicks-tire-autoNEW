/**
 * IG-lane liveness fixes, 2026-08-19 — the morning after 10/10 posting runs
 * failed across three days with exactly two shapes:
 *
 *   "The operation was aborted due to timeout"  — no timeoutMs, so the 30s
 *                                                 default killed slow completions
 *   "LLM returned no caption content"           — a 200 with empty content
 *
 * while every call defaulted to priority 2 (BACKGROUND on the three-slot Ollama
 * scheduler), queueing live posting behind benchmarks at busy ticks. The same
 * calls succeed standalone — the in-service-contention signature.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("invokeLLMForPosting retries once and only once", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.doUnmock("./_core/llm");
    vi.resetModules();
  });

  const good = { choices: [{ message: { content: '{"ok":true}' } }] };
  const empty = { choices: [{ message: { content: "   " } }] };

  const load = async () => (await import("./services/igAutopost")).invokeLLMForPosting;

  it("an empty completion is retried, and the second answer is returned", async () => {
    const calls: unknown[] = [];
    vi.doMock("./_core/llm", () => ({
      invokeLLM: async (p: unknown) => {
        calls.push(p);
        return calls.length === 1 ? empty : good;
      },
    }));
    const fn = await load();
    const res = await fn({ messages: [{ role: "user", content: "x" }] } as never);
    expect(res.choices[0].message.content).toBe('{"ok":true}');
    expect(calls).toHaveLength(2);
  });

  it("a thrown transport error is retried once", async () => {
    let n = 0;
    vi.doMock("./_core/llm", () => ({
      invokeLLM: async () => {
        n += 1;
        if (n === 1) throw new Error("The operation was aborted due to timeout");
        return good;
      },
    }));
    const fn = await load();
    await expect(fn({ messages: [] } as never)).resolves.toBeTruthy();
    expect(n).toBe(2);
  });

  it("two failures throw — no third attempt, no unbounded loop", async () => {
    let n = 0;
    vi.doMock("./_core/llm", () => ({
      invokeLLM: async () => {
        n += 1;
        throw new Error("The operation was aborted due to timeout");
      },
    }));
    const fn = await load();
    await expect(fn({ messages: [] } as never)).rejects.toThrow(/timeout/);
    expect(n).toBe(2);
  });

  it("guards are defaults, not overrides — a caller's own values win", async () => {
    let seen: Record<string, unknown> = {};
    vi.doMock("./_core/llm", () => ({
      invokeLLM: async (p: Record<string, unknown>) => {
        seen = p;
        return good;
      },
    }));
    const fn = await load();
    await fn({ messages: [], timeoutMs: 5_000 } as never);
    expect(seen.timeoutMs).toBe(5_000); // caller wins
    expect(seen.priority).toBe(1); // guard fills the gap
  });
});

describe("every posting-lane LLM call carries the guards", () => {
  it("igAutopost has no bare invokeLLM call left", () => {
    const src = read("server/services/igAutopost.ts");
    // The wrapper itself is the single permitted caller.
    const bare = src.match(/await invokeLLM\(/g) ?? [];
    expect(bare).toHaveLength(1);
    expect(src.match(/invokeLLMForPosting\(/g)!.length).toBeGreaterThanOrEqual(4); // def + 3 sites
  });

  it("the daily brief call is a live lane, not background", () => {
    const src = read("server/services/reelBriefGen.ts");
    // Anchored INSIDE the invoke call (its own comment), because slicing from
    // the log line hit the log's own closing brace before the call began.
    const fn = src.slice(src.indexOf("Full-brief generation routinely exceeds"));
    const call = fn.slice(0, fn.indexOf("});"));
    expect(call).toContain("priority: 1");
    expect(call).toContain("timeoutMs: 120000");
  });
});

describe("the daily tick names repair states instead of calling them unknown", () => {
  it("repair_queued/rendering read as in-flight; repair_failed reads as needing action", () => {
    const src = read("server/cron/jobs/dailyReelPost.ts");
    expect(src).toContain("Repair in flight (status: ${job.status})");
    expect(src).toContain("Repair FAILED - waiting for a re-queue");
    // The catch-all stays for genuinely unknown statuses.
    expect(src).toContain("Unknown job status:");
  });
});
