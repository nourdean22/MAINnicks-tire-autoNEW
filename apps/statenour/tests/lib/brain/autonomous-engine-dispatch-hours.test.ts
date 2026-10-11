/**
 * Every autonomous rule's ET-hour gate must meet an hour its dispatcher fires.
 *
 * THE DEFECT (audit 2026-10-10, reliability F4 / backend F3). The engine's only
 * scheduled caller was the evening mega fan-out, 03:00 UTC = 22:00/23:00 ET,
 * while the rules gate on daytime ET hours: workout 15-17, stale leads 9-16,
 * midweek Wed 12, Friday revenue 14, overconfidence 8-10, morning brief 7.
 * Seven rules could never fire, and daily_score_reminder (19-22) fired only in
 * EST months. jobs.ts claimed "one evening pass matches the rules' ET-hour
 * gates"; nothing checked the claim.
 *
 * This test derives the dispatcher's hours from the code that dispatches
 * (whichever of the hourly tick or EVENING_JOBS names the route, with that
 * function's own cron), then drives every rule's REAL trigger at each of those
 * hours across one EDT week and one EST week with data that would make it
 * fire. A rule that never yields an item is a rule the schedule cannot reach.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

const { queryNick } = vi.hoisted(() => ({ queryNick: vi.fn() }));

vi.mock("@/lib/nickstire/query", async (orig) => ({
  readBridge: (await orig<typeof import("@/lib/nickstire/query")>()).readBridge, queryNick, queryNickBatch: vi.fn(async () => ({})) }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn() }));
vi.mock("@/lib/services/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember: vi.fn() } }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
// Every read returns the state that makes its rule want to act.
vi.mock("@/lib/prisma", () => {
  const row = () => ({ id: 7, title: "t", description: "d", createdAt: new Date(Date.now() - 4 * 86_400_000) });
  return {
    prisma: {
      decisionReplay: { findMany: vi.fn(async () => [{ ...row(), id: "r1" }]) },
      commitment: { findMany: vi.fn(async () => [row()]) },
      masteryDecision: { findMany: vi.fn(async () => [row()]) },
      autonomousAction: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
      brainMemory: {
        findUnique: vi.fn(async () => null),
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => [{ id: "m1", content: "c", seenCount: 9, confidence: 0.9 }]),
      },
      task: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => [{ title: "read", streakCount: 30, lastCompletedAt: new Date() }]),
        count: vi.fn(async () => 50),
      },
    },
  };
});

import { EVENING_JOBS } from "@/lib/inngest/jobs";
import {
  listRuleNames,
  __ruleTriggerForTest,
  CUSTOMER_FACING_RULES,
  inCustomerHoursET,
} from "@/lib/brain/autonomous-engine";
import { hourET } from "@/lib/utils/datetime";

const ROUTE = "/api/cron/autonomous-engine";
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const TICK = stripComments(readFileSync("lib/inngest/functions/automation-engine.ts", "utf8"));
const MEGA = stripComments(readFileSync("lib/inngest/functions/mega-fanout.ts", "utf8"));

/** UTC hours named by a 5-field cron's hour field. */
function cronHours(cron: string): number[] {
  const field = cron.trim().split(/\s+/)[1] ?? "";
  if (field === "*") return Array.from({ length: 24 }, (_, i) => i);
  const step = /^\*\/(\d+)$/.exec(field);
  if (step) return Array.from({ length: 24 }, (_, i) => i).filter((h) => h % Number(step[1]) === 0);
  return field.split(",").map(Number);
}

/** The UTC hours at which the engine's route is actually dispatched. */
function dispatchHoursUTC(): number[] {
  if (TICK.includes(`"${ROUTE}"`)) {
    const cron = /cron:\s*"([^"]+)"/.exec(TICK)?.[1];
    return cron ? cronHours(cron) : [];
  }
  if (EVENING_JOBS.includes(ROUTE)) {
    const cron = /cron:\s*"([^"]+)"\s*\},\s*\{\s*event:\s*"mega\/fire\.evening"/.exec(MEGA)?.[1];
    return cron ? cronHours(cron) : [];
  }
  return [];
}

function bridge(query: string, filters: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    quotes_pending: { quotes: [{ quoteNumber: "Q1", customerEmail: "a@b.c", grandTotal: 1 }], count: 20, bookedCount: 18 },
    bookings_status: { bookings: [{ id: "b1", createdAt: new Date().toISOString() }] },
    leads_urgent: { count: 3 },
    // from === to is the overconfidence gate (a big yesterday); a range is the
    // Friday pace check (a tiny month, so it is behind).
    revenue_range: { totalDollars: filters.from === filters.to ? 5000 : 1 },
  };
  return { data: data[query] ?? null };
}

/** For each rule, the ET hours at which it yields an item at some dispatch hour in the week starting `sundayUTC`. */
async function rulesReachedInWeek(sundayUTC: string, hours: number[]): Promise<Map<string, Set<number>>> {
  const reached = new Map<string, Set<number>>();
  const start = new Date(sundayUTC).getTime();
  for (let day = 0; day < 7; day++) {
    for (const hour of hours) {
      vi.setSystemTime(new Date(start + day * 86_400_000 + hour * 3_600_000 + 30_000));
      for (const { name } of listRuleNames()) {
        // Same skip the rule loop applies: customer-facing rules are quiet outside 08-20 ET.
        if (CUSTOMER_FACING_RULES.includes(name) && !inCustomerHoursET()) continue;
        const items = await __ruleTriggerForTest(name)!();
        if (items.length > 0) {
          if (!reached.has(name)) reached.set(name, new Set());
          reached.get(name)!.add(hourET());
        }
      }
    }
  }
  return reached;
}

beforeEach(() => {
  vi.useFakeTimers();
  queryNick.mockReset().mockImplementation(async (q: string, f?: Record<string, unknown>) => bridge(q, f));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("autonomous engine · dispatch schedule reaches every rule", () => {
  it("is dispatched hourly by the automation-engine tick, not once a night", () => {
    expect(EVENING_JOBS).not.toContain(ROUTE);
    expect(dispatchHoursUTC()).toHaveLength(24);
  });

  it("the morning brief belongs to the Inngest morning-brief pair, not a rule", () => {
    expect(listRuleNames().map((r) => r.name)).not.toContain("morning_brief_push");
  });

  // Weeks chosen so their Friday is not the 1st (the pace check needs a complete day).
  it.each([
    ["EDT", "2026-07-12T00:00:00Z"],
    ["EST", "2026-01-11T00:00:00Z"],
  ])("every rule's ET gate meets a dispatch hour (%s week)", async (_label, sunday) => {
    const reached = await rulesReachedInWeek(sunday, dispatchHoursUTC());
    const unreachable = listRuleNames().map((r) => r.name).filter((n) => !reached.has(n));
    expect(unreachable, "rules the dispatcher can never fire").toEqual([]);
    // An operator-only Telegram rule keeps its whole own window: quiet hours
    // apply to customer-facing rules only.
    expect([...(reached.get("daily_score_reminder") ?? [])].sort((a, b) => a - b)).toEqual([19, 20, 21, 22]);
    // ...and a customer-facing rule is never reached outside 08-20 ET.
    for (const h of reached.get("auto_followup_expired_quote") ?? []) expect(h >= 8 && h < 20).toBe(true);
  });
});
