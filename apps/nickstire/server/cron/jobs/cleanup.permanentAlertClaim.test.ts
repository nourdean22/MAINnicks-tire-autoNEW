/**
 * Codex review on #3185: sendOncePerStateEver claims with a fixed fired_for so an unanswered urgent review
 * alerts once for good, but cleanupOldData pruned every cron_alerts_fired row by fired_at, so after 90 days
 * the claim vanished and the next daily run sent the same alert again. The 90-day prune must skip that claim.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("../../db", () => ({
  getDb: async () => ({
    execute: h.execute,
    delete: () => ({ where: async () => [{ affectedRows: 0 }] }),
  }),
}));
vi.mock("../../lib/jobQueue", () => ({ jobQueue: { cleanup: () => 0 } }));
vi.mock("../../lib/cache", () => ({ cleanupMemCache: () => 0 }));
vi.mock("../../lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { cleanupOldData } from "./cleanup";
import { EVER_FIRED_FOR } from "../../services/alertClaim";

type Chunk = { value?: string[] } | string | number;
const chunksOf = (q: unknown): Chunk[] => (q as { queryChunks: Chunk[] }).queryChunks;
const textOf = (q: unknown) =>
  chunksOf(q)
    .map((c) => (c && typeof c === "object" && Array.isArray(c.value) ? c.value.join("") : "?"))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
const paramsOf = (q: unknown) => chunksOf(q).filter((c) => typeof c === "string" || typeof c === "number");

describe("cleanupOldData · cron_alerts_fired", () => {
  beforeEach(() => {
    h.execute.mockReset().mockResolvedValue([{ affectedRows: 0 }, []]);
  });

  it("prunes per-day claims past 90 days and never the once-for-good claim", async () => {
    await cleanupOldData();
    const calls = h.execute.mock.calls.map((c) => c[0]).filter((q) => /cron_alerts_fired/.test(textOf(q)));
    expect(calls).toHaveLength(1);
    expect(textOf(calls[0])).toBe(
      "DELETE FROM cron_alerts_fired WHERE fired_at < (NOW() - INTERVAL 90 DAY) AND fired_for <> ?",
    );
    expect(paramsOf(calls[0])).toEqual([EVER_FIRED_FOR]);
    expect(EVER_FIRED_FOR).toBe("1970-01-01");
  });
});
