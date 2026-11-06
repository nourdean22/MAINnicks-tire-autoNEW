/**
 * 2026-11-06 · receptionist-made callback promises are retired (Nour: the receptionist
 * gives him no callback obligations). escalate no longer writes them; the ones already
 * open must stop nagging too: no "Promise overdue · callback promised by Front Counter"
 * row from the sweep, no count on the promise-debt card, no "FROM CALLS ... OVERDUE"
 * line in the morning brief. Operator-made promises are untouched (positive control).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ execute: vi.fn(), getDb: vi.fn(), upsert: vi.fn() }));
vi.mock("../db", () => ({ getDb: h.getDb }));
vi.mock("./opportunityQueue", () => ({ upsertOpportunity: h.upsert, transitionOpportunity: vi.fn() }));

import { listOpenPromises, promiseDebt, sweepOverduePromises } from "./promiseLedger";

function params(q: { queryChunks: unknown[] }): unknown[] {
  const out: unknown[] = [];
  const walk = (chunks: unknown[]) => {
    for (const c of chunks) {
      if (c && typeof c === "object" && "queryChunks" in (c as object)) walk((c as { queryChunks: unknown[] }).queryChunks);
      else if (c && typeof c === "object" && "value" in (c as object) && Array.isArray((c as { value: unknown }).value)) continue;
      else out.push(c);
    }
  };
  walk(q.queryChunks);
  return out;
}
const reads = () => h.execute.mock.calls.map((c) => params(c[0]));

describe("open voice promises are invisible to every reader that nags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getDb.mockResolvedValue({ execute: h.execute });
    h.execute.mockResolvedValue([[]]);
  });

  it("the open list (the sweep's page and the promises panel)", async () => {
    await listOpenPromises(50);
    expect(reads()[0]).toContain("voice");
  });

  it("the promise-debt card", async () => {
    await promiseDebt();
    expect(reads()[0]).toContain("voice");
  });

  it("the sweep reads exclude voice; an operator promise still escalates (positive control)", async () => {
    h.execute.mockResolvedValueOnce([[{
      id: "p1", promise_type: "callback", promised_action: "call Sam", due_at: "2026-09-29T10:00:00Z", status: "open",
      owner: "Nour", created_by: "admin", created_at: "2026-09-29T09:00:00Z", escalated_at: null,
    }]]);
    h.upsert.mockResolvedValue("inserted");
    await sweepOverduePromises();
    const selects = h.execute.mock.calls.filter((c) => String(JSON.stringify(c[0])).includes("SELECT"));
    expect(selects.length).toBeGreaterThan(0);
    for (const c of selects) expect(params(c[0])).toContain("voice");
    expect(h.upsert).toHaveBeenCalledTimes(1);
  });
});

describe("the voice-promise writer and its backlog readers are gone (2026-11-06)", () => {
  it("promiseLedger exports none of them, and voiceAgent never reaches the ledger", async () => {
    const mod = await import("./promiseLedger");
    for (const name of ["createVoicePromise", "voicePromiseBacklog", "renderVoicePromiseLine"]) {
      expect([name, name in mod]).toEqual([name, false]);
    }
    const voice = readFileSync(join(process.cwd(), "server/routers/voiceAgent.ts"), "utf-8");
    expect(voice).not.toMatch(/promiseLedger|createVoicePromise|createPromise\(/);
  });
});

describe("the morning brief has no FROM CALLS callback to-do line", () => {
  it("does not read the voice promise backlog", () => {
    const src = readFileSync(join(process.cwd(), "server/cron/jobs/morningBrief.ts"), "utf-8");
    expect(src).not.toMatch(/voicePromiseBacklog\(/);
  });
});
