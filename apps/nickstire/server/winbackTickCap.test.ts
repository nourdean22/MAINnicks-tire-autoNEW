/**
 * One winback tick sends at most 25 texts, oldest due first (audit 2026-11-07: prod sent 80 in one tick on
 * 11-01 and 11-05, against LIMIT 50 per tick). The rest stay `pending` and go on later ticks of the same day.
 * The pending-sends SELECT is rendered by drizzle's real MySqlDialect and asserted as the database sees it.
 */
import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const dialect = new MySqlDialect();
const rendered: string[] = [];

vi.mock("./db", () => ({
  getDb: async () => ({
    execute: async (q: unknown) => {
      rendered.push(dialect.sqlToQuery(q as never).sql);
      return [[]];
    },
  }),
}));
vi.mock("./sms", () => ({ isShopGatewayReachable: async () => true }));

describe("winback tick cap", () => {
  it("the pending-sends read takes 25 rows, oldest scheduled first", async () => {
    const { processWinbackPending } = await import("./services/winbackProcessor");
    const r = await processWinbackPending();
    expect(r.details).toBe("No pending winback sends");
    const pending = rendered.filter((s) => /FROM winback_sends ws/.test(s));
    expect(pending, "the pending-sends SELECT ran").toHaveLength(1);
    expect(pending[0]).toMatch(/ORDER BY ws\.scheduledAt, ws\.id\s+LIMIT 25\s*$/);
  });
});
