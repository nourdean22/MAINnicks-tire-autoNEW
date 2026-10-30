/**
 * lib/services/home-maxim.ts: the read leaves out live Skip markers, Keep pins through the pin service, and
 * Skip writes a 30-day expiring maxim_skip row (an upsert, so a second tap only renews it).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findMany: vi.fn(async () => [] as { key: string }[]),
  upsert: vi.fn(async () => ({})),
  createPin: vi.fn(async () => ({ pin: {}, created: true })),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: { findMany: h.findMany, upsert: h.upsert } } }));
vi.mock("@/lib/services/pins", () => ({ createPin: h.createPin }));

import { getHomeMaxim, keepHomeMaxim, skipHomeMaxim } from "@/lib/services/home-maxim";
import { MAXIM_POOL } from "@/lib/wisdom/maxim-pool";

const NOW = new Date("2026-10-29T21:00:00-04:00");

beforeEach(() => {
  h.findMany.mockReset().mockResolvedValue([]);
  h.upsert.mockClear();
  h.createPin.mockClear();
});

describe("getHomeMaxim", () => {
  it("reads only live Skip markers and never returns a skipped maxim", async () => {
    const first = (await getHomeMaxim({ step: 0, now: NOW }))!;
    h.findMany.mockResolvedValue([{ key: first.id }]);
    const after = (await getHomeMaxim({ step: 0, now: NOW }))!;
    expect(after.id).not.toBe(first.id);
    expect(after.total).toBe(MAXIM_POOL.length - 1);
    const where = (h.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({ category: "maxim_skip", deletedAt: null, expiresAt: { gt: NOW } });
  });

  it("a failed Skip read throws: no maxim, never a skipped one shown by mistake", async () => {
    h.findMany.mockImplementation(async () => {
      throw new Error("db down");
    });
    await expect(getHomeMaxim({ step: 0, now: NOW })).rejects.toThrow("db down");
  });
});

describe("Keep and Skip", () => {
  const id = MAXIM_POOL[0]!.id;

  it("Keep pins the text with its source through the pin service", async () => {
    expect(await keepHomeMaxim(id)).toEqual({ ok: true });
    expect(h.createPin).toHaveBeenCalledWith({
      content: `${MAXIM_POOL[0]!.text} (${MAXIM_POOL[0]!.source})`,
      source: "home:maxim-keep",
      label: MAXIM_POOL[0]!.source,
    });
  });

  it("Skip upserts a maxim_skip row that expires in 30 days", async () => {
    const res = await skipHomeMaxim(id, NOW);
    expect(res.ok).toBe(true);
    const arg = (h.upsert.mock.calls[0] as unknown as [{ where: unknown; create: { expiresAt: Date }; update: unknown }])[0];
    expect(arg.where).toEqual({ category_key: { category: "maxim_skip", key: id } });
    expect(arg.create.expiresAt.getTime() - NOW.getTime()).toBe(30 * 86_400_000);
    expect(arg.update).toMatchObject({ deletedAt: null });
  });

  it("an id that is not in the pool writes nothing", async () => {
    expect(await keepHomeMaxim("nope:1")).toEqual({ ok: false });
    expect(await skipHomeMaxim("nope:1", NOW)).toEqual({ ok: false });
    expect(h.createPin).not.toHaveBeenCalled();
    expect(h.upsert).not.toHaveBeenCalled();
  });
});
