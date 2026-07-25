/**
 * human_pending state machine tests (ROS-058, 2026-07-25).
 *
 * The contract: a customer message whose reply awaits an operator is a DURABLE
 * HUMAN OBLIGATION with an SLA — it closes only when a human replies, or when
 * a human explicitly says no reply is needed. It can never again read as
 * "handled" merely because the AI chose not to auto-send.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const executed: string[] = [];
let affectedRows = 0;
let selectRows: unknown[] = [];

vi.mock("./db", () => ({
  getDb: async () => ({
    execute: async (q: { queryChunks?: unknown } | string) => {
      const text = typeof q === "string" ? q : JSON.stringify(q);
      executed.push(text);
      if (/SELECT/i.test(text)) return [selectRows, []];
      return [{ affectedRows }, []];
    },
  }),
  getDbTyped: async () => null,
}));

import {
  HUMAN_SLA_MS,
  humanPendingSummary,
  resolveHumanPendingForConversation,
} from "./services/smsResponseJobs";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

beforeEach(() => {
  executed.length = 0;
  affectedRows = 0;
  selectRows = [];
});

describe("resolution — only human actions close the obligation", () => {
  it("targets ONLY human_pending rows of the conversation and returns the closed count", async () => {
    affectedRows = 2;
    const closed = await resolveHumanPendingForConversation(42, "human_replied");
    expect(closed).toBe(2);
    const update = executed.find((q) => /UPDATE/i.test(q))!;
    expect(update).toMatch(/human_pending/);
    expect(update).toMatch(/human_replied/);
  });

  it("no-reply-needed is a distinct, auditable resolution", async () => {
    affectedRows = 1;
    const closed = await resolveHumanPendingForConversation(7, "no_reply_required");
    expect(closed).toBe(1);
    expect(executed.find((q) => /UPDATE/i.test(q))).toMatch(/no_reply_required/);
  });
});

describe("the summary tells the truth", () => {
  it("returns counts + SLA overdue + oldest wait", async () => {
    selectRows = [{ humanPending: "3", overdue: "1", oldestWaitingMinutes: "47" }];
    const s = await humanPendingSummary();
    expect(s).toEqual({ humanPending: 3, overdue: 1, oldestWaitingMinutes: 47 });
  });

  it("an empty queue reports zero with a null oldest — a real zero, from a real read", async () => {
    selectRows = [{ humanPending: 0, overdue: 0, oldestWaitingMinutes: null }];
    const s = await humanPendingSummary();
    expect(s).toEqual({ humanPending: 0, overdue: 0, oldestWaitingMinutes: null });
  });
});

describe("the state machine wiring (source pins)", () => {
  it("a human_pending job gets the SLA as its dueAt", () => {
    const s = read("server/services/smsResponseJobs.ts");
    expect(s).toMatch(/dueAt: new Date\(Date\.now\(\) \+ HUMAN_SLA_MS\)/);
    expect(HUMAN_SLA_MS).toBe(30 * 60_000);
  });

  it("the claim guards never re-orchestrate a human_pending job", () => {
    const s = read("server/services/smsResponseJobs.ts");
    for (const m of s.matchAll(/WHERE[^;]*status = 'pending' AND dueAt <= NOW\(\)/g)) {
      expect(m[0]).not.toMatch(/human_pending/);
    }
  });

  it("the operator send path resolves obligations as human_replied", () => {
    const s = read("server/routers/smsConversations.ts");
    expect(s).toMatch(/resolveHumanPendingForConversation\(conversation\.id, "human_replied"\)/);
  });

  it("markNoReplyNeeded exists and is audited", () => {
    const s = read("server/routers/smsConversations.ts");
    expect(s).toMatch(/markNoReplyNeeded: adminProcedure/);
    expect(s).toMatch(/no_reply_required/);
  });

  it("the schema enum and migration 0097 carry the three new states", () => {
    const schema = read("drizzle/schema.ts");
    expect(schema).toMatch(/"human_pending", "human_replied", "no_reply_required"/);
    const mig = read("drizzle/0097_response_jobs_human_pending.sql");
    expect(mig).toMatch(/MODIFY COLUMN status ENUM\('pending','processing','responded','suppressed','failed','dead','human_pending','human_replied','no_reply_required'\)/);
    const journal = read("drizzle/meta/_journal.json");
    expect(journal).toContain("0097_response_jobs_human_pending");
  });

  it("the admin renders UNKNOWN on a failed count — never quiet, never zero", () => {
    const s = read("client/src/pages/admin/outreach/SmsOrchestratorSection.tsx");
    expect(s).toMatch(/NEEDS-REPLY COUNT UNKNOWN/);
    expect(s).toMatch(/humanPendingSummary\.useQuery/);
    expect(s).toMatch(/past the 30-min SLA/);
  });
});
