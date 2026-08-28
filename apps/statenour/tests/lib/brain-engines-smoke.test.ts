/**
 * tests/lib/brain-engines-smoke.test.ts
 *
 * Shape/smoke tests for the four brain engines that are 100%
 * DB-dominated — no inline helpers to extract, but the return-type
 * contracts still need to be locked down so a refactor can't silently
 * change what /system/gaps + the HQ signal surface consume.
 *
 * Strategy: mock `@/lib/prisma` to return empty arrays for every
 * model. Each engine should handle the empty-DB case gracefully
 * (no throws, well-shaped empty return). That alone catches:
 *   · broken destructuring after schema rename
 *   · missing try/catch that would 500 the route
 *   · return-type drift (e.g. someone returns an object when an array
 *     is expected and /system/gaps crashes)
 *
 * Plus a few hand-picked ExpectedShape assertions per engine so the
 * public contract can't silently change.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma BEFORE the imports happen so every engine that loads
// it sees the stub. Each model method returns an empty array / null.
vi.mock("@/lib/prisma", () => {
  const emptyFn = async () => [];
  const nullFn = async () => null;
  const zeroFn = async () => 0;
  const makeModel = () => ({
    findMany: emptyFn,
    findFirst: nullFn,
    findUnique: nullFn,
    count: zeroFn,
    groupBy: emptyFn,
    aggregate: async () => ({ _count: { id: 0 } }),
  });
  return {
    prisma: new Proxy(
      {},
      {
        get: () => makeModel(),
      },
    ),
  };
});

// The memory manager + embedding util are used by some engines for
// persistence. Stub to no-op.
vi.mock("@/lib/brain/memory-manager", () => ({
  brainMemory: {
    remember: async () => ({}),
    recall: async () => [],
    reinforce: async () => ({}),
    contradict: async () => ({}),
    confirm: async () => ({}),
    forget: async () => {},
  },
}));

vi.mock("@/lib/brain/embedding-utils", () => ({
  storeMemoryEmbedding: async () => {},
}));

describe("blind-spot-detector", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an empty array when the DB has no data", async () => {
    const { detectBlindSpots } = await import("@/lib/brain/blind-spot-detector");
    const result = await detectBlindSpots();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});

describe("wisdom-distiller", () => {
  beforeEach(() => vi.clearAllMocks());

  it("distillWisdom returns an array", async () => {
    const { distillWisdom } = await import("@/lib/brain/wisdom-distiller");
    const result = await distillWisdom();
    expect(Array.isArray(result)).toBe(true);
  });

  it("validateWisdom returns an object with expected shape", async () => {
    const { validateWisdom } = await import("@/lib/brain/wisdom-distiller");
    const result = await validateWisdom();
    expect(typeof result).toBe("object");
    expect(result).not.toBeNull();
  });

  it("getWisdomContext returns string", async () => {
    const { getWisdomContext } = await import("@/lib/brain/wisdom-distiller");
    const ctx = await getWisdomContext();
    expect(typeof ctx).toBe("string");
  });
});

describe("teaching-moments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("findTeachingMoments returns array gracefully on empty DB", async () => {
    const { findTeachingMoments } = await import(
      "@/lib/brain/teaching-moments"
    );
    const result = await findTeachingMoments();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it("getTeachingMomentsContext returns string", async () => {
    const { getTeachingMomentsContext } = await import(
      "@/lib/brain/teaching-moments"
    );
    const ctx = await getTeachingMomentsContext();
    expect(typeof ctx).toBe("string");
  });
});

describe("counter-intuitive", () => {
  beforeEach(() => vi.clearAllMocks());

  it("findCounterIntuitive returns array gracefully", async () => {
    const { findCounterIntuitive } = await import(
      "@/lib/brain/counter-intuitive"
    );
    const result = await findCounterIntuitive();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});

describe("attention-tracker (full pipeline)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("analyzeAttentionPatterns returns a well-shaped profile", async () => {
    const { analyzeAttentionPatterns } = await import(
      "@/lib/brain/attention-tracker"
    );
    const profile = await analyzeAttentionPatterns();
    expect(profile).toHaveProperty("topTopics");
    expect(profile).toHaveProperty("neglectedDomains");
    expect(profile).toHaveProperty("focusScore");
    expect(profile).toHaveProperty("depthAnalysis");
    expect(profile).toHaveProperty("attentionVelocity");
    expect(Array.isArray(profile.topTopics)).toBe(true);
    expect(typeof profile.focusScore).toBe("number");
  });
});

describe("correlation-finder (full pipeline)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("findCorrelations returns array on empty DB", async () => {
    const { findCorrelations } = await import(
      "@/lib/brain/correlation-finder"
    );
    const result = await findCorrelations();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});
