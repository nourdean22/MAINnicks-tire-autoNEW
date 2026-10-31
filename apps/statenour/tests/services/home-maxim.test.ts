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

import { MAXIM_QUERY_INPUT, getHomeMaxim, keepHomeMaxim, skipHomeMaxim } from "@/lib/services/home-maxim";
import { MAXIM_POOL } from "@/lib/wisdom/maxim-pool";
import { MAXIM_TAGS } from "@/lib/wisdom/maxims";

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
      source: "home:maxim-keep", // MAXIM_KEEP_SOURCE: the prompt pin query leaves these out
      label: MAXIM_POOL[0]!.source,
    });
  });

  it("Skip upserts a maxim_skip row that expires in 30 days", async () => {
    const res = await skipHomeMaxim(id, NOW);
    expect(res.ok).toBe(true);
    const arg = (h.upsert.mock.calls[0] as unknown as [{ where: unknown; create: { expiresAt: Date }; update: unknown }])[0];
    expect(arg.where).toEqual({ category_key: { category: "maxim_skip", key: id } });
    expect(arg.create.expiresAt.getTime() - NOW.getTime()).toBe(30 * 86_400_000);
    // A second Skip renews the window from now, and revives a soft-deleted marker.
    const update = arg.update as { expiresAt: Date; deletedAt: null };
    expect(update.expiresAt.getTime() - NOW.getTime()).toBe(30 * 86_400_000);
    expect(update.deletedAt).toBeNull();
  });

  it("an id that is not in the pool writes nothing", async () => {
    expect(await keepHomeMaxim("nope:1")).toEqual({ ok: false });
    expect(await skipHomeMaxim("nope:1", NOW)).toEqual({ ok: false });
    expect(h.createPin).not.toHaveBeenCalled();
    expect(h.upsert).not.toHaveBeenCalled();
  });
});

describe("operator.maxim input (MAXIM_QUERY_INPUT)", () => {
  it("takes known tags only, at most one of each, and a bounded step", () => {
    expect(MAXIM_QUERY_INPUT.safeParse({ step: 0, tags: ["customers", "money"] }).success).toBe(true);
    expect(MAXIM_QUERY_INPUT.safeParse({ step: 0, tags: ["smith"] }).success).toBe(false);
    // One more than the tag list (it was a literal 12, which went stale when people W3 added "boundaries").
    expect(MAXIM_QUERY_INPUT.safeParse({ step: 0, tags: Array(MAXIM_TAGS.length + 1).fill("money") }).success).toBe(false);
    expect(MAXIM_QUERY_INPUT.safeParse({ step: -1, tags: [] }).success).toBe(false);
    expect(MAXIM_QUERY_INPUT.safeParse({ step: 10_001, tags: [] }).success).toBe(false);
    expect(MAXIM_QUERY_INPUT.safeParse({ step: 1.5, tags: [] }).success).toBe(false);
    expect(MAXIM_QUERY_INPUT.safeParse({ step: 0, tags: [], require: "decisions" }).success).toBe(true);
    expect(MAXIM_QUERY_INPUT.safeParse({ step: 0, tags: [], require: "smith" }).success).toBe(false);
  });

  it("drops a headline sent as context: the text never reaches the service", () => {
    const parsed = MAXIM_QUERY_INPUT.parse({ step: 0, tags: [], context: "Call Mrs Smith about the brake estimate" });
    expect(parsed).toEqual({ step: 0, tags: [] });
  });
});
