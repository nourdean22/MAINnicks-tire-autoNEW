/**
 * tests/brain/memory-valid-from-at-write.test.ts · 2026-09-08 (Brain plan, Wave 2)
 *
 * The as-of recall reads valid_from / valid_until; production had 0 rows carrying
 * either. A new row written through remember() now starts its interval.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    count: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: mocks.brainMemory, $queryRawUnsafe: vi.fn(async () => []) } }));
vi.mock("@/lib/brain/embedding-utils", () => ({ storeMemoryEmbedding: vi.fn(async () => undefined), getEmbedding: vi.fn(async () => []) }));

import { brainMemory } from "@/lib/brain/memory-manager";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.brainMemory.findUnique.mockResolvedValue(null);
  mocks.brainMemory.findMany.mockResolvedValue([]);
  mocks.brainMemory.count.mockResolvedValue(0);
  mocks.brainMemory.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "mem_new", ...data }));
});

describe("remember() — validity at write", () => {
  it("a NEW row carries validFrom = now and no validUntil", async () => {
    const before = Date.now();
    await brainMemory.remember("preference", "runs_on_tuesdays", "I run on Tuesdays", "user_save");
    const creates = mocks.brainMemory.create.mock.calls.map((c) => c[0].data as Record<string, unknown>);
    const row = creates.find((d) => d.category !== "memory_gateway_shadow");
    expect(row, "the memory row itself was created").toBeTruthy();
    expect(row!.validFrom).toBeInstanceOf(Date);
    expect((row!.validFrom as Date).getTime()).toBeGreaterThanOrEqual(before - 5);
    expect(row!.validUntil).toBeUndefined();
  });
});
