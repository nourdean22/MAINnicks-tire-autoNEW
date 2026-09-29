/**
 * Q-12 phase 1b · cleanupOldData prunes ONLY bridge_outbox shadow rows older
 * than 14 days, and an unapplied 0137 is not a failure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ execute: vi.fn(), warn: vi.fn() }));

vi.mock("../../db", () => ({
  getDb: async () => ({
    execute: h.execute,
    delete: () => ({ where: async () => [{ affectedRows: 0 }] }),
  }),
}));
vi.mock("../../lib/jobQueue", () => ({ jobQueue: { cleanup: () => 0 } }));
vi.mock("../../lib/cache", () => ({ cleanupMemCache: () => 0 }));
vi.mock("../../lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: h.warn, error: vi.fn(), debug: vi.fn() }),
}));

import { cleanupOldData } from "./cleanup";

function sqlText(q: unknown): string {
  return (q as { queryChunks: unknown[] }).queryChunks
    .map((c) => (c && typeof c === "object" && Array.isArray((c as { value?: unknown }).value) ? (c as { value: string[] }).value.join("") : "?"))
    .join("");
}

const outboxCalls = () => h.execute.mock.calls.map((c) => sqlText(c[0])).filter((t) => /bridge_outbox/.test(t));

describe("cleanupOldData · bridge_outbox shadow rows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.execute.mockResolvedValue([{ affectedRows: 3 }, []]);
  });

  it("deletes shadow rows past 14 days, and nothing else", async () => {
    await cleanupOldData();
    const calls = outboxCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].replace(/\s+/g, " ").trim()).toBe(
      "DELETE FROM bridge_outbox WHERE status = 'shadow' AND created_at < (NOW() - INTERVAL 14 DAY)",
    );
  });

  it("treats a missing table (0137 not applied) as nothing to prune, not a failure", async () => {
    h.execute.mockImplementation(async (q: unknown) => {
      if (/bridge_outbox/.test(sqlText(q))) {
        throw Object.assign(new Error("Table 'nick.bridge_outbox' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
      }
      return [{ affectedRows: 0 }, []];
    });
    await cleanupOldData();
    expect(JSON.stringify(h.warn.mock.calls)).not.toMatch(/bridge_outbox/);
  });
});
