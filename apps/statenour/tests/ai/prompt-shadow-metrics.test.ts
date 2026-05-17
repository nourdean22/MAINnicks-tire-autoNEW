/**
 * v9.1.6 · Contract tests for shadow-metrics helpers.
 *
 * The Prisma path is mocked — what we're verifying:
 *   1. extractSections grabs every "## Heading" line
 *   2. computeShadowDelta produces the right counts when
 *      v1 / v2 share / diverge / are empty
 *   3. recordShadowDelta swallows DB errors (best-effort write)
 *   4. readShadowTrend projects rows to the public TrendPoint shape
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    systemMetric: {
      create: vi.fn((args: unknown) => args), // returns the args so $transaction sees a populated array
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  computeShadowDelta,
  extractSections,
  readShadowTrend,
  recordShadowDelta,
} from "@/lib/ai/prompt/v2/shadow-metrics";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("v9.1.6 · extractSections", () => {
  it("grabs every '## Heading' line", () => {
    const prompt = `# title
some text
## Section A
content
## Section B with spaces
more
not a heading
## Final section`;
    expect(extractSections(prompt)).toEqual([
      "Section A",
      "Section B with spaces",
      "Final section",
    ]);
  });

  it("returns [] when there are no ## headings", () => {
    expect(extractSections("just text\nno headings here")).toEqual([]);
  });
});

describe("v9.1.6 · computeShadowDelta", () => {
  it("computes the right counts when v1 and v2 fully agree", () => {
    const v1 = "## A\n## B\nbody";
    const v2 = "## A\n## B\nbody-v2";
    const d = computeShadowDelta(v1, v2, "v2", "full", "default");
    expect(d.sectionsInBoth).toBe(2);
    expect(d.sectionsOnlyInV1).toBe(0);
    expect(d.sectionsOnlyInV2).toBe(0);
    expect(d.charsV1).toBe(v1.length);
    expect(d.charsV2).toBe(v2.length);
    expect(d.charsDelta).toBe(v2.length - v1.length);
  });

  it("flags sections only in v1 + only in v2", () => {
    const v1 = "## A\n## B\n## C";
    const v2 = "## A\n## D";
    const d = computeShadowDelta(v1, v2, "v2", "full", "default");
    expect(d.sectionsOnlyInV1).toBe(2); // B, C
    expect(d.sectionsOnlyInV2).toBe(1); // D
    expect(d.sectionsInBoth).toBe(1); // A
  });

  it("returns 0% delta when v1 is empty (no division by zero)", () => {
    const d = computeShadowDelta("", "## A", "v2", "full", "default");
    expect(d.charsDeltaPct).toBe(0);
  });

  it("rounds delta-pct to one decimal place", () => {
    const v1 = "x".repeat(1000);
    const v2 = "x".repeat(1153); // +15.3%
    const d = computeShadowDelta(v1, v2, "v2", "full", "default");
    expect(d.charsDeltaPct).toBe(15.3);
  });
});

describe("v9.1.6 · recordShadowDelta", () => {
  it("calls $transaction with three create payloads", async () => {
    vi.mocked(prisma.$transaction).mockResolvedValue([] as unknown as []);
    await recordShadowDelta({
      charsV1: 1000,
      charsV2: 1100,
      charsDelta: 100,
      charsDeltaPct: 10,
      sectionsOnlyInV1: 2,
      sectionsOnlyInV2: 1,
      sectionsInBoth: 5,
      tier: "full",
      slot: "default",
      builderVersion: "v2",
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const args = vi.mocked(prisma.$transaction).mock.calls[0]?.[0];
    expect(Array.isArray(args)).toBe(true);
    expect((args as unknown[]).length).toBe(3);
  });

  it("swallows DB errors silently (best-effort write)", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(new Error("db down"));
    // Should not throw.
    await expect(
      recordShadowDelta({
        charsV1: 0,
        charsV2: 0,
        charsDelta: 0,
        charsDeltaPct: 0,
        sectionsOnlyInV1: 0,
        sectionsOnlyInV2: 0,
        sectionsInBoth: 0,
        tier: "full",
        slot: "default",
        builderVersion: "v2",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("v9.1.6 · readShadowTrend", () => {
  it("projects raw rows to the public TrendPoint shape", async () => {
    const now = new Date();
    vi.mocked(prisma.systemMetric.findMany).mockResolvedValue([
      {
        id: "m1",
        value: 12.5,
        tags: { tier: "full", slot: "default" },
        createdAt: now,
      } as unknown as never,
    ]);

    const out = await readShadowTrend(7);
    expect(out.charsDelta[0]?.id).toBe("m1");
    expect(out.charsDelta[0]?.value).toBe(12.5);
    expect(out.charsDelta[0]?.createdAt).toBe(now.toISOString());
    expect(out.charsDelta[0]?.tags.tier).toBe("full");
  });

  it("queries 3 metrics in parallel", async () => {
    vi.mocked(prisma.systemMetric.findMany).mockResolvedValue(
      [] as unknown as never,
    );
    await readShadowTrend(7);
    expect(prisma.systemMetric.findMany).toHaveBeenCalledTimes(3);
  });
});
