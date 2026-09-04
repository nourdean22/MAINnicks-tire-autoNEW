import { beforeEach, describe, expect, it, vi } from "vitest";

const { aiGenerationCount } = vi.hoisted(() => ({
  aiGenerationCount: vi.fn(),
}));

const emptyModel = new Proxy({}, {
  get: (_target, property) => {
    if (property === "count") return vi.fn().mockResolvedValue(0);
    if (property === "findFirst") return vi.fn().mockResolvedValue(null);
    return vi.fn().mockResolvedValue([]);
  },
});

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({
    aiGeneration: { count: aiGenerationCount },
    $queryRaw: vi.fn().mockResolvedValue([]),
  }, {
    get: (target, property) => property in target
      ? target[property as keyof typeof target]
      : emptyModel,
  }),
}));

vi.mock("@/lib/utils/cache", () => ({
  cached: <T,>(_key: string, _ttlSeconds: number, load: () => Promise<T>) => load(),
}));

import { buildCommandCenterState } from "@/lib/ai/context/command-center-state";

describe("command-center health read truth", () => {
  beforeEach(() => {
    aiGenerationCount.mockReset().mockRejectedValue(new Error("database unavailable"));
  });

  it("records the source when the AI health query fails", async () => {
    const state = await buildCommandCenterState();

    expect(state.systemHealth.unavailableSources).toContain("ai-generations");
    expect(aiGenerationCount).toHaveBeenCalled();
  });
});
