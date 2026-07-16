/**
 * checkAiBudget · strict mode + daily cap (audit 2026-07-16).
 *
 * Pre-fix, strict mode was DECORATIVE on the hot path: the guard read
 * `s.strictMode && estimateCents > 10`, but the only live caller — the
 * chat gate — passes a hardcoded estimate of 2. `2 > 10` is never true,
 * so the operator could flip "strict mode" in the power panel and every
 * chat turn kept spending, silently. These pins keep the switch honest.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindMany = vi.fn();
const mockAggregate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: { findMany: (a: unknown) => mockFindMany(a), upsert: vi.fn() },
    aiGeneration: { aggregate: (a: unknown) => mockAggregate(a) },
  },
}));

import { checkAiBudget } from "@/lib/services/power-panel";

/** Power settings live as sparse BrainMemory rows whose `content` is
 *  JSON-encoded `{ value }` — mirror that shape exactly. */
const settings = (rows: Record<string, unknown>) =>
  Object.entries(rows).map(([key, value]) => ({
    key,
    content: JSON.stringify({ value }),
    updatedAt: new Date(),
  }));

beforeEach(() => {
  vi.clearAllMocks();
  mockFindMany.mockResolvedValue([]);
  mockAggregate.mockResolvedValue({ _sum: { costCents: 0 } });
});

describe("checkAiBudget · strict mode", () => {
  it("BLOCKS a chat-shaped call (the gate's estimate) when strict mode is on", async () => {
    // The exact shape the chat gate uses. Pre-fix this returned allowed:true
    // because the guard demanded estimateCents > 10.
    mockFindMany.mockResolvedValue(settings({ strictMode: true }));

    const r = await checkAiBudget(0);

    expect(r.allowed).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/strict mode/i);
  });

  it("BLOCKS regardless of the estimate — no silent threshold exemption", async () => {
    mockFindMany.mockResolvedValue(settings({ strictMode: true }));

    for (const estimate of [0, 2, 9, 10]) {
      expect((await checkAiBudget(estimate)).allowed).toBe(false);
    }
  });

  it("allows non-discretionary callers to bypass strict mode explicitly", async () => {
    mockFindMany.mockResolvedValue(settings({ strictMode: true }));

    expect((await checkAiBudget(0, { bypassStrict: true })).allowed).toBe(true);
  });

  it("allows normal calls when strict mode is off", async () => {
    mockFindMany.mockResolvedValue(settings({ strictMode: false }));

    expect((await checkAiBudget(0)).allowed).toBe(true);
  });
});

describe("checkAiBudget · daily cap (unchanged behaviour)", () => {
  it("blocks once today's spend exceeds the cap", async () => {
    mockFindMany.mockResolvedValue(settings({ dailyCostCapCents: 100 }));
    mockAggregate.mockResolvedValue({ _sum: { costCents: 120 } });

    const r = await checkAiBudget(0);

    expect(r.allowed).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/daily cost cap/i);
  });

  it("allows while under the cap", async () => {
    mockFindMany.mockResolvedValue(settings({ dailyCostCapCents: 100 }));
    mockAggregate.mockResolvedValue({ _sum: { costCents: 40 } });

    expect((await checkAiBudget(0)).allowed).toBe(true);
  });
});
