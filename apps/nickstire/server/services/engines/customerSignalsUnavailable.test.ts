/**
 * Q-23 phase 6 · predictChurn and predictRepeatVisits say when their read failed.
 *
 * Both catches returned the same empty lists as a quiet customer base, and the
 * Customer Intelligence card painted them as "0". A failure now carries
 * `unavailable: true`, which client/src/pages/admin/intelligence/customerSignals.ts
 * reads as UNMEASURED. A successful read never carries it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ execute: vi.fn(), select: vi.fn() }));

vi.mock("../../db", () => ({
  getDb: async () => ({ execute: h.execute, select: h.select }),
}));

import { predictRepeatVisits } from "./customer";
import { predictChurn } from "../intelligenceEngines";

afterEach(() => {
  h.execute.mockReset();
  h.select.mockReset();
});

/** A drizzle-like select chain: every builder step returns it, awaiting it settles `result`. */
function selectChain(result: Promise<unknown>) {
  const chain: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => result.then(ok, bad),
  };
  for (const step of ["from", "where", "orderBy", "limit", "innerJoin", "leftJoin", "groupBy"]) {
    chain[step] = () => chain;
  }
  return chain;
}

describe("predictRepeatVisits · failure is not 'nobody is due'", () => {
  it("a failed read returns unavailable: true", async () => {
    h.execute.mockRejectedValueOnce(new Error("TiDB timeout"));
    const r = await predictRepeatVisits();
    expect(r.unavailable).toBe(true);
    expect(r.dueSoon).toEqual([]);
  });

  it("an empty read is a successful read, without the marker", async () => {
    h.execute.mockResolvedValueOnce([[], []]);
    const r = await predictRepeatVisits();
    expect(r.unavailable).toBeUndefined();
    expect(r.dueSoon).toEqual([]);
  });
});

describe("predictChurn · failure is not 'nobody is at risk'", () => {
  it("a failed customer read returns unavailable: true", async () => {
    h.select.mockImplementation(() => selectChain(Promise.reject(new Error("TiDB timeout"))));
    const r = await predictChurn();
    expect(r.unavailable).toBe(true);
    expect(r.highRisk).toEqual([]);
  });

  it("an empty customer base is a successful read, without the marker", async () => {
    h.select.mockImplementation(() => selectChain(Promise.resolve([])));
    h.execute.mockResolvedValue([[], []]);
    const r = await predictChurn();
    expect(r.unavailable).toBeUndefined();
    expect(r.highRisk).toEqual([]);
  });
});
