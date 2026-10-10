/**
 * pinMemory re-embeds what it writes (audit 2026-10-10, 05-M7).
 *
 * The tool upserts a pinned_user row; on update it rewrote `content` and
 * left the old vector in place, so semantic recall kept matching the text the
 * operator had replaced (and a tool-created pin was never embedded at all).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ upsert: vi.fn(), storeMemoryEmbedding: vi.fn() }));

vi.mock("@/lib/prisma", () => {
  const generic = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  });
  const brainMemory = { ...generic(), upsert: h.upsert };
  const prisma = new Proxy({}, {
    get: (_t, prop: string) =>
      prop === "brainMemory" ? brainMemory : prop.startsWith("$") ? () => Promise.resolve([]) : generic(),
  });
  return { prisma };
});
vi.mock("@/lib/brain/embedding-utils", () => ({ storeMemoryEmbedding: h.storeMemoryEmbedding }));

import { brainTools } from "@/lib/ai/tools/brain";

const ctx = { toolCallId: "t1", messages: [] } as never;

beforeEach(() => {
  vi.clearAllMocks();
  h.upsert.mockResolvedValue({ id: "pin-1" });
  h.storeMemoryEmbedding.mockResolvedValue(undefined);
});

describe("pinMemory · the vector follows the content", () => {
  it("re-embeds the pinned row with its new content", async () => {
    const out = (await brainTools.pinMemory.execute!(
      { content: "Shop closes at 4 on Saturdays now", key: "saturday-hours" },
      ctx,
    )) as { pinned: boolean; id: string };

    expect(out).toMatchObject({ pinned: true, id: "pin-1" });
    // POSITIVE CONTROL: the write itself happened with the new content.
    expect(h.upsert.mock.calls[0][0].update.content).toBe("Shop closes at 4 on Saturdays now");
    expect(h.storeMemoryEmbedding).toHaveBeenCalledWith(
      "pin-1",
      "[pinned_user] saturday-hours: Shop closes at 4 on Saturdays now",
    );
  });

  it("an embedding failure does not fail the pin", async () => {
    h.storeMemoryEmbedding.mockRejectedValue(new Error("provider down"));
    await expect(
      brainTools.pinMemory.execute!({ content: "x is y", key: "k" }, ctx),
    ).resolves.toMatchObject({ pinned: true });
  });
});
