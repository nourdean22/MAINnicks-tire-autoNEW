/**
 * vapi.todayCalls must keep unscored calls (eval_outcome NULL) INSIDE the date range.
 *
 * Drizzle's and() does not parenthesise its members, so a bare
 * "x != 'outbound' OR x IS NULL" member made the WHERE read
 * (date range AND not outbound) OR eval_outcome IS NULL, and every unscored
 * call of any date came back. This compiles the WHERE the router really hands
 * to the db with the real MySQL dialect; no database is touched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { resetVapiAdminReadCaches } from "./routers/vapi";

const captured: { where: unknown } = { where: undefined };

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.from = () => chain;
  chain.where = (w: unknown) => {
    captured.where = w;
    return chain;
  };
  chain.orderBy = () => chain;
  chain.limit = async () => [];
  return { ...actual, getDb: async () => chain };
});

function adminContext() {
  return {
    user: {
      id: 1,
      openId: "admin-user",
      email: "admin@nickstire.com",
      name: "Admin User",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as never;
}

/** The top-level text of a SQL string, with every parenthesised group blanked out. */
function topLevel(sqlText: string): string {
  // and() wraps the whole condition in one outer pair; look inside it.
  const inner = sqlText.startsWith("(") && sqlText.endsWith(")") ? sqlText.slice(1, -1) : sqlText;
  let depth = 0;
  let out = "";
  for (const ch of inner) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (depth === 0) out += ch;
  }
  return out;
}

beforeEach(() => {
  captured.where = undefined;
  resetVapiAdminReadCaches();
});

describe("vapi.todayCalls WHERE", () => {
  it("has no OR at the top level, so the date range binds every row", async () => {
    const { appRouter } = await import("./routers");
    const c = appRouter.createCaller(adminContext());
    await c.vapi.todayCalls({
      sinceISO: "2026-10-28T04:00:00.000Z",
      untilISO: "2026-10-29T03:59:59.000Z",
    });

    expect(captured.where).toBeDefined();
    const { sql: text } = new MySqlDialect().sqlToQuery(captured.where as never);
    // Positive control: the NULL-keeping clause is still there, just grouped.
    expect(text).toContain("IS NULL");
    expect(text).toContain("createdAt");
    expect(topLevel(text)).not.toMatch(/\sOR\s/i);
  }, 60_000);
});
