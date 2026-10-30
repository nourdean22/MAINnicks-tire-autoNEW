/**
 * createPin on a pin that already exists by key (2026-10-30, PR 3366 review): re-pinning a deleted or
 * superseded pin makes it live again. Before, the update kept deletedAt and supersededById, so the caller
 * (Home's Keep, the chat pin) said "pinned" while listPins and the prompt both skipped the row.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "pin-1", ...args.data })),
  create: vi.fn(async () => ({ id: "pin-new" })),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: { findUnique: h.findUnique, update: h.update, create: h.create } } }));
vi.mock("@/lib/brain/embedding-utils", () => ({ storeMemoryEmbedding: async () => {} }));
vi.mock("@/lib/db/soft-delete", () => ({ softDelete: async () => ({ ok: true, noop: false }) }));
vi.mock("@/lib/db/entity-audit", () => ({ logCreate: () => {}, logUpdate: () => {}, stripNoise: (x: unknown) => x }));

import { createPin } from "@/lib/services/pins";

beforeEach(() => {
  h.findUnique.mockReset();
  h.update.mockClear();
  h.create.mockClear();
});

describe("createPin re-pin", () => {
  it("a deleted, superseded pin comes back live", async () => {
    h.findUnique.mockResolvedValue({ id: "pin-1", seenCount: 2, deletedAt: new Date(), supersededById: "pin-0" });
    const res = await createPin({ content: "Hire slow. (Naval)", source: "home:maxim-keep" });
    expect(res.created).toBe(false);
    const data = (h.update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data.deletedAt).toBeNull();
    expect(data.supersededById).toBeNull();
    expect(data.seenCount).toBe(3);
  });

  it("a new pin is created, not updated", async () => {
    h.findUnique.mockResolvedValue(null);
    expect((await createPin({ content: "Hire slow. (Naval)" })).created).toBe(true);
    expect(h.update).not.toHaveBeenCalled();
  });
});
