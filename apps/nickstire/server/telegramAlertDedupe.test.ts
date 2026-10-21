/**
 * Telegram alert cleanup (2026-10-21) · the alerts that stay stop repeating.
 *
 * Each of these used to re-send the same message every tick (2 h or 15 min) while nothing changed. Now each
 * claims a cron_alerts_fired row first (services/alertClaim.ts): an incident sends once per Cleveland day per
 * state (sendOncePerState); a reminder about a persisting business state sends once per state for good
 * (sendOncePerStateEver). The fake db implements INSERT IGNORE (a repeat pair affects 0 rows), so the claim
 * SQL and the dedupe decision both run; only the clock, the transport and the data are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";

const h = vi.hoisted(() => ({
  sends: [] as Array<{ text: string; cls: string }>,
  claims: new Set<string>(),
  tables: {} as Record<string, unknown[]>,
  exec: (_text: string): unknown[] => [],
  selectThrows: false,
  memAlerts: [] as string[],
  atRisk: [] as Array<{ name: string; phone: string; lastVisit: string; daysSince: number }>,
  load: { techs: [] as Array<Record<string, unknown>>, bays: [] as Array<Record<string, unknown>> },
}));

vi.mock("./services/telegram", async (importOriginal) => {
  const record = (text: string, cls?: string) => h.sends.push({ text, cls: cls ?? "incident" });
  return {
    ...(await importOriginal<typeof import("./services/telegram")>()),
    sendTelegram: vi.fn(async (text: string, cls?: string) => (record(text, cls), true)),
    sendTelegramResult: vi.fn(async (text: string, cls?: string) => (record(text, cls), { status: "delivered" })),
    sendTelegramMessage: vi.fn(async (text: string, _ch?: string, cls?: string) => (record(text, cls), true)),
    alertVendorDown: vi.fn(async (vendor: string) => (record(`VENDOR DOWN: ${vendor}`), true)),
    alertVendorRecovered: vi.fn(async (vendor: string) => (record(`VENDOR RECOVERED: ${vendor}`), true)),
  };
});
vi.mock("./services/featureFlags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/featureFlags")>()),
  isEnabled: vi.fn(async () => true),
}));
vi.mock("./services/nickMemory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/nickMemory")>()),
  recall: vi.fn(async () => []),
  remember: vi.fn(async () => undefined),
  decayMemories: vi.fn(async () => 0),
  getProactiveMemoryAlerts: vi.fn(async () => h.memAlerts),
}));
vi.mock("./services/customerIntelligence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/customerIntelligence")>()),
  analyzeCustomers: vi.fn(async () => ({ atRiskCustomers: h.atRisk, lapsedCustomers: 4, lostCustomers: 2, retentionRate: 61, activeCustomers: 50, totalCustomers: 60 })),
  getCustomerActionPlan: vi.fn(async () => ""),
}));
vi.mock("./services/workOrderAutomation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/workOrderAutomation")>()),
  enrollInDripCampaign: vi.fn(async () => undefined),
}));
vi.mock("./services/dispatch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/dispatch")>()),
  getDispatchLoad: vi.fn(async () => h.load),
}));
vi.mock("./services/intelligenceEngines", async (importOriginal) => {
  const off = async () => {
    throw new Error("engine not under test");
  };
  return {
    ...(await importOriginal<typeof import("./services/intelligenceEngines")>()),
    forecastRevenue: vi.fn(async () => ({ month: { soFar: 0 }, today: { soFar: 0 } })),
    scoreLeads: off,
    generateCrossSellRecommendations: off,
    predictCustomerLTV: off,
    predictChurn: off,
    analyzeBottlenecks: off,
    analyzeDeclinedWork: off,
  };
});
vi.mock("./services/costDetailCoverage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/costDetailCoverage")>()),
  checkCostDetailCoverage: vi.fn(async () => ({ reading: null })),
}));
vi.mock("./services/winbackProcessor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/winbackProcessor")>()),
  processWinbackPending: vi.fn(async () => ({ recordsProcessed: 0, details: "" })),
}));

/** Text chunks and bound string params of a drizzle sql`` template. */
function sqlParts(query: unknown): { text: string; params: string[] } {
  const chunks = ((query as { queryChunks?: unknown[] }).queryChunks ?? []) as unknown[];
  let text = "";
  const params: string[] = [];
  for (const c of chunks) {
    if (typeof c === "string") params.push(c);
    else if (c && typeof c === "object" && "value" in c) text += (c as { value: string[] }).value.join("");
  }
  return { text, params };
}
function chain(rows: () => unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["where", "orderBy", "limit", "groupBy", "leftJoin", "innerJoin", "offset"]) c[m] = () => c;
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(rows).then(res, rej);
  return c;
}
const fakeDb = {
  select: () => ({
    from: (t: Parameters<typeof getTableName>[0]) => {
      if (h.selectThrows) throw new Error("query exploded");
      return chain(() => h.tables[getTableName(t)] ?? []);
    },
  }),
  execute: async (query: unknown) => {
    const { text, params } = sqlParts(query);
    if (/DELETE FROM cron_alerts_fired/i.test(text)) {
      h.claims.delete(`${params[0]}|${params[1]}`);
      return [{ affectedRows: 1 }];
    }
    if (/INSERT IGNORE INTO cron_alerts_fired/i.test(text)) {
      const k = `${params[0]}|${params[1]}`;
      if (h.claims.has(k)) return [{ affectedRows: 0 }];
      h.claims.add(k);
      return [{ affectedRows: 1 }];
    }
    return [h.exec(text), []];
  },
};
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: async () => fakeDb,
}));

import { runAutoActions, sendEscalationAlerts } from "./services/nickIntelligence";
import { detectOverdueWorkOrders } from "./services/workOrderAutomation";
import { pollGatewayOrderStatuses } from "./services/dataPipelines";
import { getDashboardStats } from "./admin-stats";
import { sendUrgentBrief } from "./cron/jobs/morningBrief";
import { runFullSafetyCheck } from "./services/safetyMonitor";
import { dispatchVendorHealthSnapshot } from "./nour-os-bridge";
import { recordEventOccurrence, runFeedbackCycle } from "./services/feedbackLoop";
import { runIntelligenceAutopilot } from "./cron/jobs/intelligenceAutopilot";
import { getJobCadences, runTierJobHandlerUnlocked } from "./cron/scheduler";

const TUE_1030_ET = "2026-10-20T14:30:00Z";
const WED_1030_ET = "2026-10-21T14:30:00Z";
const at = (iso: string) => vi.setSystemTime(new Date(iso));
const sent = (marker: string) => h.sends.filter((s) => s.text.includes(marker));
const hoursAgo = (n: number) => new Date(Date.now() - n * 3600_000);

beforeEach(() => {
  getJobCadences();
  vi.useFakeTimers({ toFake: ["Date"] });
  at(TUE_1030_ET);
  h.sends.length = 0;
  h.claims.clear();
  h.tables = {};
  h.exec = () => [];
  h.selectThrows = false;
  h.memAlerts = [];
  h.atRisk = [];
  h.load = { techs: [], bays: [] };
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("NICK AI ESCALATION (#129): once per set of escalated items, ever", () => {
  beforeEach(() => {
    h.tables.leads = [{ id: 11, name: "Ann", phone: "2165550101", createdAt: hoursAgo(5) }];
  });
  it("sends the first time (KEEP: the escalation still fires)", async () => {
    await sendEscalationAlerts();
    expect(sent("NICK AI ESCALATION")).toHaveLength(1);
  });
  it("does not re-send the same items on the next tick or the next day", async () => {
    await sendEscalationAlerts();
    await sendEscalationAlerts();
    at(WED_1030_ET);
    await sendEscalationAlerts();
    expect(sent("NICK AI ESCALATION")).toHaveLength(1);
  });
  it("a new escalated item is a new state and sends once", async () => {
    await sendEscalationAlerts();
    h.tables.leads = [...h.tables.leads, { id: 12, name: "Bo", phone: "2165550102", createdAt: hoursAgo(6) }];
    await sendEscalationAlerts();
    await sendEscalationAlerts();
    expect(sent("NICK AI ESCALATION")).toHaveLength(2);
  });
});

describe("OVERDUE WORK ORDERS (#147): once per ET day per set of work orders", () => {
  it("sends once for the same overdue set, again on a new set", async () => {
    h.tables.work_orders = [{ id: 5, orderNumber: "WO-5", status: "in_progress", serviceDescription: "Brakes", promisedAt: hoursAgo(3), assignedTech: null }];
    await detectOverdueWorkOrders();
    await detectOverdueWorkOrders();
    expect(sent("OVERDUE WORK ORDERS")).toHaveLength(1);
    h.tables.work_orders = [...h.tables.work_orders, { id: 6, orderNumber: "WO-6", status: "in_progress", serviceDescription: "Tires", promisedAt: hoursAgo(1), assignedTech: null }];
    await detectOverdueWorkOrders();
    expect(sent("OVERDUE WORK ORDERS")).toHaveLength(2);
  });
});

describe("STALE TIRE ORDERS / TIRE DELIVERY CHECK (#84, #85): once per ET day per set of orders", () => {
  it("each sends once across repeated 15-minute ticks", async () => {
    const base = { customerName: "Cy", customerPhone: "x", tireBrand: "B", tireModel: "M", tireSize: "225/65R17", quantity: 4 };
    h.tables.tire_orders = [
      { id: 1, orderNumber: "T-1", status: "received", createdAt: hoursAgo(72), ...base },
      { id: 2, orderNumber: "T-2", status: "ordered", createdAt: hoursAgo(96), ...base },
    ];
    await pollGatewayOrderStatuses();
    await pollGatewayOrderStatuses();
    await pollGatewayOrderStatuses();
    expect(sent("STALE TIRE ORDERS")).toHaveLength(1);
    expect(sent("TIRE DELIVERY CHECK")).toHaveLength(1);
  });
});

describe("dashboard stats pipeline FAILED (#1): once per ET day per error", () => {
  it("every failing dashboard load no longer pages", async () => {
    h.selectThrows = true;
    await getDashboardStats();
    await getDashboardStats();
    await getDashboardStats();
    expect(sent("stats pipeline FAILED")).toHaveLength(1);
  });
});

describe("NICK AI ALERT from StateNour drift (#25): once per ET day per reason and details", () => {
  it("repeats are claimed, a different drift sends", async () => {
    await sendUrgentBrief("Statenour Drift Alert", "revenue drift");
    await sendUrgentBrief("Statenour Drift Alert", "revenue drift");
    expect(sent("NICK AI ALERT")).toHaveLength(1);
    await sendUrgentBrief("Statenour Drift Alert", "lead drift");
    expect(sent("NICK AI ALERT")).toHaveLength(2);
  });
});

describe("SAFETY CRITICAL / SAFETY CHECK (#134, #135): once per ET day per set of lines", () => {
  beforeEach(() => {
    h.exec = (text) => {
      if (/FROM review_pipeline/.test(text) && /rating/.test(text)) return [{ cnt: 3 }];
      if (/confirmedAt IS NULL/.test(text)) return [{ cnt: 2 }];
      return [];
    };
  });
  it("both send on the first run (KEEP: a critical still pages)", async () => {
    await runFullSafetyCheck();
    expect(sent("SAFETY CRITICAL")).toHaveLength(1);
    expect(sent("SAFETY CHECK")).toHaveLength(1);
  });
  it("the same criticals and warnings do not re-send every 2 hours", async () => {
    await runFullSafetyCheck();
    await runFullSafetyCheck();
    await runFullSafetyCheck();
    expect(sent("SAFETY CRITICAL")).toHaveLength(1);
    expect(sent("SAFETY CHECK")).toHaveLength(1);
  });
  it("a warning whose count drifts is the same state (digits stripped)", async () => {
    await runFullSafetyCheck();
    h.exec = (text) => {
      if (/FROM review_pipeline/.test(text) && /rating/.test(text)) return [{ cnt: 3 }];
      if (/confirmedAt IS NULL/.test(text)) return [{ cnt: 7 }];
      return [];
    };
    await runFullSafetyCheck();
    expect(sent("SAFETY CHECK")).toHaveLength(1);
  });
  it("sends again on the next Cleveland day", async () => {
    await runFullSafetyCheck();
    at(WED_1030_ET);
    await runFullSafetyCheck();
    expect(sent("SAFETY CRITICAL")).toHaveLength(2);
  });
});

describe("DAILY CHURN CHECK (#52): once per set of at-risk customers, ever", () => {
  it("the same ten customers do not page every day; a changed set does", async () => {
    h.atRisk = [{ name: "Dee", phone: "2165550199", lastVisit: "2026-05-01", daysSince: 170 }];
    await runTierJobHandlerUnlocked("churn-detection");
    at(WED_1030_ET);
    await runTierJobHandlerUnlocked("churn-detection");
    expect(sent("DAILY CHURN CHECK")).toHaveLength(1);
    h.atRisk = [...h.atRisk, { name: "Eve", phone: "2165550198", lastVisit: "2026-05-02", daysSince: 169 }];
    await runTierJobHandlerUnlocked("churn-detection");
    expect(sent("DAILY CHURN CHECK")).toHaveLength(2);
  });
});

describe("VENDOR DOWN / RECOVERED (#62, #63): pages only on a real outage", () => {
  const snap = (status: "healthy" | "degraded" | "down") => [{ vendor: "twilio", status, checks: [{ name: "ping", passed: status === "healthy", latencyMs: 5, error: status === "healthy" ? undefined : "HTTP 503" }] }];
  it("healthy -> degraded -> healthy sends nothing", async () => {
    await dispatchVendorHealthSnapshot(snap("healthy"));
    await dispatchVendorHealthSnapshot(snap("degraded"));
    await dispatchVendorHealthSnapshot(snap("healthy"));
    expect(sent("VENDOR")).toHaveLength(0);
  });
  it("healthy -> down pages once (KEEP), down -> healthy says recovered", async () => {
    await dispatchVendorHealthSnapshot(snap("healthy"));
    await dispatchVendorHealthSnapshot(snap("down"));
    await dispatchVendorHealthSnapshot(snap("healthy"));
    expect(sent("VENDOR DOWN")).toHaveLength(1);
    expect(sent("VENDOR RECOVERED")).toHaveLength(1);
  });
  it("a vendor flapping down twice in one day pages once and recovers once", async () => {
    for (const s of ["healthy", "down", "healthy", "down", "healthy"] as const) await dispatchVendorHealthSnapshot(snap(s));
    expect(sent("VENDOR DOWN")).toHaveLength(1);
    expect(sent("VENDOR RECOVERED")).toHaveLength(1);
  });
});

describe("Event anomaly HIGH / Proactive from memory (#101, #102): once per ET day per state", () => {
  it("repeated feedback cycles with the same anomaly and memory lines send each once", async () => {
    recordEventOccurrence("lead_captured_test");
    h.memAlerts = ["Tuesday is slow: post a special"];
    await runFeedbackCycle();
    await runFeedbackCycle();
    expect(sent("Event anomaly detected")).toHaveLength(1);
    expect(sent("Proactive (from memory)")).toHaveLength(1);
  });
});

describe("CAPACITY ALERT (#128): once per ET day", () => {
  it("all bays empty on two ticks sends once", async () => {
    h.load = { techs: [{ clockedIn: true }], bays: [{ occupied: false }, { occupied: false }] };
    await runAutoActions();
    await runAutoActions();
    expect(sent("CAPACITY ALERT")).toHaveLength(1);
  });
});

describe("INTELLIGENCE AUTOPILOT digest (#18) and REVENUE EMERGENCY (#17)", () => {
  it("the digest sends once per ET day for the same kinds of lines; the emergency once per month", async () => {
    await runIntelligenceAutopilot();
    await runIntelligenceAutopilot();
    expect(sent("INTELLIGENCE AUTOPILOT")).toHaveLength(1);
    expect(sent("REVENUE EMERGENCY")).toHaveLength(1);
    at(WED_1030_ET);
    await runIntelligenceAutopilot();
    expect(sent("INTELLIGENCE AUTOPILOT")).toHaveLength(2);
    expect(sent("REVENUE EMERGENCY")).toHaveLength(1);
  });
});
