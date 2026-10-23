/**
 * The opportunity worklist, server side (2026-10-23, PR 3256 review).
 *
 * Four things the Opportunities tab needs from the server, each found by review:
 *
 *  1. TWO TRANSITIONS, TWO RECEIPTS. attempted -> attempted is legal, so two taps
 *     both pass the state guard. The old code read receipts_json, appended in JS and
 *     wrote the whole array back: the second write erased the first receipt while
 *     attempts still counted both. The receipt is now appended inside the one UPDATE.
 *  2. THE WINDOW IS CUT IN THE RIGHT ORDER. `order: "worklist"` puts untouched rows
 *     first and the newest first BEFORE the LIMIT. Sorting only on the client, after
 *     a LIMIT 500 by updated_at, hides old untouched rows once live rows pass 500.
 *  3. AGE IS COMPUTED IN SQL, in shop days (America/New_York). A driver-parsed TiDB
 *     DATETIME comes back shifted on an ET host (apps/nickstire/AGENTS.md, Time), so the
 *     client no longer subtracts dates.
 *  4. A WAITING CUSTOMER IS ALWAYS IN THE CONVERSATION LIST. humanPendingSummary can
 *     count a customer whose thread is not among the newest conversations; the list is
 *     ordered open-human-pending first, inside its cap.
 *
 * The fake DB understands exactly two things about receipts_json: an UPDATE that
 * appends in SQL, and an UPDATE that overwrites with a JS-built array. It lets the
 * race run for real: both transitions read the same stale snapshot, as two concurrent
 * requests do.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";

let executed: string[] = [];
let stored: Array<Record<string, unknown>> = [];
let attemptsStored = 0;
let listRows: Array<Record<string, unknown>> = [];

const dialect = new MySqlDialect();
/** The statement exactly as the driver would receive it: `?` placeholders, whitespace collapsed. */
const render = (q: unknown) => {
  const { sql: text, params: bound } = dialect.sqlToQuery(q as SQL);
  return { text: text.replace(/\s+/g, " ").trim(), bound };
};

const STALE_ROW = {
  id: "11111111-2222-4333-8444-555555555555",
  source_type: "missed_call",
  source_id: "call-1",
  customer_phone: "2165550100",
  data_quality: "verified",
  urgency: "today",
  recommended_action: "Call back",
  reason: "missed",
  state: "attempted",
  attempts: 1,
  consent_ok: 1,
  receipts_json: "[]",
  created_at: "2026-10-20 12:00:00",
  updated_at: "2026-10-20 12:00:00",
};

const fakeDb = {
  execute: async (q: unknown) => {
    const { text, bound } = render(q);
    executed.push(text);
    if (text.includes("SELECT * FROM revenue_opportunities WHERE id =")) return [[STALE_ROW]];
    if (text.includes("UPDATE revenue_opportunities")) {
      // bound: [state, receipt json, attempts bump, owner, due_at, consent, id, expected state]
      const receipt = bound.find((x) => typeof x === "string" && x.startsWith('{"at"')) as string | undefined;
      const overwrite = bound.find((x) => typeof x === "string" && x.startsWith('[{"at"')) as string | undefined;
      if (text.includes("JSON_ARRAY_APPEND") && receipt) stored.push(JSON.parse(receipt));
      else if (overwrite) stored = JSON.parse(overwrite);
      attemptsStored += Number(bound[2]); // NaN if the bump is missing: the assertion then fails loudly
      return [{ affectedRows: 1 }];
    }
    if (text.includes("FROM revenue_opportunities")) return [listRows];
    return [[]];
  },
};

// The vi.mock registry is shared by every file in the serial run (apps/nickstire/AGENTS.md, Test hygiene).
// A partial factory here would hand a LATER file that imports ./db for anything but these two
// getters `undefined`, so keep every real export and override only the two we need, and drop the
// mock when this file is done.
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDb: async () => fakeDb,
  getDbTyped: async () => fakeDb,
}));

import { listOpportunities, transitionOpportunity } from "./services/opportunityQueue";

afterAll(() => {
  vi.doUnmock("./db");
});

beforeEach(() => {
  executed = [];
  stored = [];
  attemptsStored = 0;
  listRows = [];
});

describe("transitionOpportunity appends its receipt inside the UPDATE", () => {
  it("two concurrent attempted -> attempted taps both leave a receipt", async () => {
    const id = STALE_ROW.id;
    // Run one after the other: the fake hands BOTH the same stale snapshot (receipts []), which is
    // exactly what two overlapping requests read. (Promise.all made the second call's mocked
    // dynamic import of ./db resolve to nothing, a harness artifact.)
    const a = await transitionOpportunity({ id, to: "attempted", by: "crew-a", note: "called" });
    const b = await transitionOpportunity({ id, to: "attempted", by: "crew-b", note: "texted" });
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(stored.map((r) => r.note).sort()).toEqual(["called", "texted"]);
    expect(attemptsStored).toBe(2);
  });

  it("the UPDATE appends in SQL and never writes back an array it read", async () => {
    await transitionOpportunity({ id: STALE_ROW.id, to: "attempted", by: "crew", note: "called" });
    const update = executed.find((t) => t.includes("UPDATE revenue_opportunities"))!;
    expect(update).toContain("receipts_json = JSON_ARRAY_APPEND(COALESCE(receipts_json, JSON_ARRAY()), '$', CAST(? AS JSON))");
    expect(update).toMatch(/attempts = attempts \+ \?/);
    expect(update).toMatch(/WHERE id = \? AND state = \?$/);
    expect(update).not.toMatch(/receipts_json = \?/);
  });

  it("a first receipt on a row whose receipts_json is NULL still lands (COALESCE)", async () => {
    await transitionOpportunity({ id: STALE_ROW.id, to: "dismissed", by: "crew", note: "not a customer" });
    expect(executed.find((t) => t.includes("UPDATE revenue_opportunities"))).toContain("COALESCE(receipts_json, JSON_ARRAY())");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ by: "crew", from: "attempted", to: "dismissed", note: "not a customer" });
  });
});

describe("listOpportunities orders the window before it cuts it", () => {
  it('order "worklist" sorts untouched rows first, then newest created, BEFORE the LIMIT', async () => {
    await listOpportunities({ states: ["new", "attempted"], limit: 500, order: "worklist" });
    const select = executed.find((t) => t.includes("FROM revenue_opportunities"))!;
    expect(select).toMatch(/ORDER BY \(attempts = 0\) DESC, created_at DESC LIMIT/);
    expect(select).not.toContain("ORDER BY updated_at");
  });

  it("without the option the order is unchanged (updated_at DESC), with and without states", async () => {
    await listOpportunities({ states: ["new"], limit: 50 });
    await listOpportunities({ limit: 50 });
    const selects = executed.filter((t) => t.includes("FROM revenue_opportunities"));
    expect(selects).toHaveLength(2);
    for (const s of selects) {
      expect(s).toContain("ORDER BY updated_at DESC LIMIT");
      expect(s).not.toContain("attempts = 0");
    }
  });

  it('the worklist order also applies when no state filter is given', async () => {
    await listOpportunities({ limit: 10, order: "worklist" });
    expect(executed.find((t) => t.includes("FROM revenue_opportunities"))).toMatch(/ORDER BY \(attempts = 0\) DESC, created_at DESC LIMIT/);
  });

  it("the router passes the option through and the tab asks for it", () => {
    const router = readFileSync(resolve(process.cwd(), "server/routers/opportunityQueue.ts"), "utf8");
    expect(router).toMatch(/order:\s*z\.enum\(\["worklist"\]\)\.optional\(\)/);
    expect(router).toMatch(/order:\s*input\?\.order/);
    const tab = readFileSync(resolve(process.cwd(), "client/src/pages/admin/OpportunitiesSection.tsx"), "utf8");
    expect(tab).toMatch(/order:\s*"worklist"/);
  });
});

describe("age is computed in SQL, in shop days", () => {
  it("selects a DATEDIFF of two America/New_York conversions as age_days", async () => {
    await listOpportunities({ limit: 5 });
    const select = executed.find((t) => t.includes("FROM revenue_opportunities"))!;
    expect(select).toContain("DATEDIFF(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', 'America/New_York'), CONVERT_TZ(created_at, '+00:00', 'America/New_York')) AS age_days");
  });

  it("the row carries ageDays as a number, and null (unknown) when SQL could not compute it", async () => {
    listRows = [{ ...STALE_ROW, age_days: "3" }, { ...STALE_ROW, id: "22222222-2222-4333-8444-555555555555", age_days: null }, { ...STALE_ROW, id: "33333333-2222-4333-8444-555555555555" }];
    const { items } = await listOpportunities({ limit: 5 });
    expect(items.map((i) => i.ageDays)).toEqual([3, null, null]);
  });
});

describe("a transition refuses a row that is no longer in the state the operator saw", () => {
  // The row in the fake is `attempted`. A client that rendered it as `new` is looking at a stale
  // row: another admin moved it, and a dismissal confirmed on the stale label would be recorded
  // with a note that is false for the current state.
  it("refuses with the conflict text and writes nothing when `from` differs from the state just read", async () => {
    const r = await transitionOpportunity({ id: STALE_ROW.id, from: "new", to: "dismissed", by: "crew", note: "not a customer" });
    expect(r).toEqual({ ok: false, error: "conflict: state changed concurrently" });
    expect(executed.some((t) => t.includes("UPDATE revenue_opportunities"))).toBe(false);
    expect(stored).toHaveLength(0);
  });

  it("proceeds when `from` matches (positive control: the guard is not a blanket refusal)", async () => {
    const r = await transitionOpportunity({ id: STALE_ROW.id, from: "attempted", to: "attempted", by: "crew", note: "called" });
    expect(r).toEqual({ ok: true });
    expect(stored).toHaveLength(1);
  });

  it("is optional: a caller that sends no `from` behaves as before", async () => {
    const r = await transitionOpportunity({ id: STALE_ROW.id, to: "dismissed", by: "crew", note: "not actionable" });
    expect(r).toEqual({ ok: true });
  });

  it("the router accepts `from` as a state and passes it through", () => {
    const router = readFileSync(resolve(process.cwd(), "server/routers/opportunityQueue.ts"), "utf8");
    expect(router).toMatch(/from:\s*stateSchema\.optional\(\)/);
    expect(router).toMatch(/from:\s*input\.from/);
  });
});

describe("the conversation list reaches the waiting-first query through its helper", () => {
  it("getConversations in db.ts calls selectConversationsWaitingFirst", () => {
    const db = readFileSync(resolve(process.cwd(), "server/db.ts"), "utf8");
    const fn = db.slice(db.indexOf("export async function getConversations"));
    expect(fn.indexOf("selectConversationsWaitingFirst(")).toBeGreaterThan(-1);
    expect(fn.indexOf("selectConversationsWaitingFirst(")).toBeLessThan(fn.indexOf("\n}\n"));
  });
});
