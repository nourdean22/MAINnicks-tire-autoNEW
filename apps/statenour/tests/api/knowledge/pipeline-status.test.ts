/**
 * CANARY · GET /api/knowledge/pipeline-status · the server half of "an unread
 * count is not zero".
 *
 * The route already got the HARD part right: it refuses to assert
 * `gateUnreachable` unless every input is present, because asserting alarm
 * from missing data is the same lie as asserting health from it. What it then
 * did was hand the consumer a `promotableNow` of 0 manufactured by `?? 0` on
 * a REJECTED groupBy — so the surface printed a measured-looking zero on the
 * one path where nothing had been measured at all.
 *
 * Each read is wrapped in `Promise.allSettled`, so a rejection here is the
 * real production shape (Neon quota exhaustion, a dropped connection), not a
 * contrived one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  groupBy: vi.fn(),
  aggregate: vi.fn(),
  claimCount: vi.fn(),
  memoryCount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    intelligenceClaim: {
      groupBy: mocks.groupBy,
      aggregate: mocks.aggregate,
      count: mocks.claimCount,
    },
    brainMemory: { count: mocks.memoryCount },
    apiRequestLog: { create: vi.fn().mockResolvedValue({}) },
    errorLog: { create: vi.fn().mockResolvedValue({}) },
  },
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn().mockReturnValue(0),
}));

import { GET } from "@/app/api/knowledge/pipeline-status/route";

interface PipelinePayload {
  totalClaims: number | null;
  promotableNow: number | null;
  gateUnreachable: boolean;
  degraded: string[];
}

async function read(): Promise<PipelinePayload> {
  const res = await GET(new Request("http://localhost/api/knowledge/pipeline-status"));
  const body = (await res.json()) as { ok: boolean; data: PipelinePayload };
  expect(body.ok).toBe(true);
  return body.data;
}

describe("CANARY · pipeline-status never invents a promotable count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.aggregate.mockResolvedValue({ _max: { verificationScore: 0.58 } });
    mocks.claimCount.mockResolvedValue(893);
    mocks.memoryCount.mockResolvedValue(0);
  });

  it("BREAKS: a rejected status groupBy yields null, not 0", async () => {
    mocks.groupBy.mockRejectedValue(new Error("Database compute quota exhausted."));

    const data = await read();

    expect(data.promotableNow).toBeNull();
    // The refusal to alarm from missing data is intact — that part was never
    // the bug, and a "fix" that flipped it would be the inverted lie.
    expect(data.gateUnreachable).toBe(false);
    // ...and the failure is disclosed, so the consumer's quiet branch has
    // something true to render.
    expect(data.degraded).toContain("status_counts");
  });

  it("positive control: a successful groupBy with no source_supported row is a real 0", async () => {
    mocks.groupBy.mockResolvedValue([
      { status: "unverified", _count: { _all: 876 } },
      { status: "weak_support", _count: { _all: 17 } },
    ]);

    const data = await read();

    expect(data.promotableNow).toBe(0);
    expect(data.degraded).toEqual([]);
    // 893 claims, best score 0.58, gate 0.75, zero promotable — the measured
    // dead end the whole surface was built for. It must still fire.
    expect(data.gateUnreachable).toBe(true);
  });

  it("positive control: a real promotable count passes through unchanged", async () => {
    mocks.groupBy.mockResolvedValue([
      { status: "source_supported", _count: { _all: 4 } },
      { status: "unverified", _count: { _all: 876 } },
    ]);

    const data = await read();

    expect(data.promotableNow).toBe(4);
    expect(data.gateUnreachable).toBe(false);
  });

  it("a rejected CLAIM TOTAL is reported too, and does not fabricate a count", async () => {
    mocks.groupBy.mockResolvedValue([{ status: "unverified", _count: { _all: 876 } }]);
    mocks.claimCount.mockRejectedValue(new Error("connection terminated"));

    const data = await read();

    expect(data.totalClaims).toBeNull();
    expect(data.degraded).toContain("claim_total");
    expect(data.gateUnreachable).toBe(false);
  });
});
