/**
 * Telegram alert cleanup (2026-10-21) · the alerts that were wrong by the shop's truth, or redundant, are gone.
 *
 * Shop truth (Nour): an invoice is a CLOSED job; an estimate that never became an invoice means the customer
 * walked; money is collected on a separate register, so this system cannot know paid or unpaid. Every alert
 * that read invoices.paymentStatus = pending as "unpaid" or as "an estimate" told him something false, and the
 * 2-hourly auto-actions repeated what other alerts already said.
 *
 * Two kinds of check: a scan of server source (comments stripped) for the removed alert texts, with a planted
 * positive and a KEEP control so an empty scan cannot pass; and behaviour checks that call the code.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sends: [] as Array<{ text: string; cls: string }>,
  sms: 0,
  memories: [] as string[],
  exec: (_text: string): unknown[] => [],
}));

vi.mock("./services/telegram", async (importOriginal) => {
  const record = (text: string, cls?: string) => h.sends.push({ text, cls: cls ?? "incident" });
  return {
    ...(await importOriginal<typeof import("./services/telegram")>()),
    sendTelegram: vi.fn(async (text: string, cls?: string) => (record(text, cls), true)),
    sendTelegramResult: vi.fn(async (text: string, cls?: string) => (record(text, cls), { status: "delivered" })),
    sendTelegramMessage: vi.fn(async (text: string, _ch?: string, cls?: string) => (record(text, cls), true)),
    alertAfterHours: vi.fn(async (r: { type: string }) => (record(`AFTER-HOURS ${r.type.toUpperCase()}`), true)),
  };
});
vi.mock("./services/smsOrchestrator", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/smsOrchestrator")>()),
  orchestrateSms: vi.fn(async () => {
    h.sms++;
    return { sent: true };
  }),
}));
vi.mock("./services/nickMemory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/nickMemory")>()),
  remember: vi.fn(async (m: { content: string }) => {
    h.memories.push(m.content);
  }),
}));
vi.mock("./services/intelligenceEngines", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/intelligenceEngines")>()),
  generateFullIntelligenceReport: vi.fn(async () => ({
    forecast: { month: { soFar: 4000, onPace: false, target: 20000 } },
    leadScores: [],
    crossSell: null,
    declined: null,
    walkAwayEstimates: null,
  })),
}));
function chain() {
  const c: Record<string, unknown> = {};
  for (const m of ["where", "orderBy", "limit", "groupBy"]) c[m] = () => c;
  c.then = (res: (v: unknown) => unknown) => Promise.resolve([{ count: 0 }]).then(res);
  return c;
}
const fakeDb = {
  execute: async () => [h.exec(""), []],
  select: () => ({ from: () => chain() }),
};
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: async () => fakeDb,
}));

import { getJobCadences, runTierJobHandlerUnlocked } from "./cron/scheduler";
import { handleAfterHoursCapture } from "./services/afterHours";
import { runDailyBackup } from "./services/dbBackup";
import { crossReconcileInvoices } from "./services/dataPipelines";
import { pushInvoice } from "./services/shopDriverSync";

const SERVER = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "__fixtures__") continue;
      out.push(...sourceFiles(p));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
/** Source with block comments and whole-line // comments removed (MENTION IS NOT ASSERTION). */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}
/** The client lane removes the collections worklist (invoices.unpaidList + this service) in its own PR. */
const OTHER_LANE = new Set(["services/collectionsWindow.ts"]);
const FILES = sourceFiles(SERVER)
  .map((p) => ({ rel: p.slice(SERVER.length).replace(/\\/g, "/"), text: stripComments(readFileSync(p, "utf8")) }))
  .filter((f) => !OTHER_LANE.has(f.rel));

function hits(needle: string, files = FILES): string[] {
  return files.filter((f) => f.text.includes(needle)).map((f) => f.rel);
}

/** Alert texts that are gone: wrong by the shop's truth (invoice = unpaid, or a pending invoice = an estimate). */
const WRONG_BY_SHOP_TRUTH = [
  "STALE ESTIMATES", // #48 stale-estimate-alert
  "INVOICE AGING", // #127 AUTO-ACTION 9
  "unpaid invoices", // #119 line, #86
  "UNPAID CONCENTRATION", // #131
  "PAYMENT-STATUS CHECK", // #131
  "Unpaid invoices total", // #135
  "invoices pending >", // #135, nour-os-query attention_needed
  "invoices unpaid >", // statenourSync attentionAlerts
  "DECLINED ESTIMATES", // #18 line
  "pendingPayments", // getShopPulse field with no reader
  "Payment: ${invoice", // #140 pushInvoice line
];
/** Alert texts that are gone: redundant, or a repeating reminder. */
const REDUNDANT = [
  "AUTO-ACTION: Walk Rate", // #120
  "GREAT DAY!", // #121
  "Slow day alert", // #122
  "estimate leads need follow-up", // #123
  "Revenue anomaly detected", // #124
  "callbacks waiting!", // #125
  "NICK EVENING DEBRIEF", // #126
  "Proactive Check", // #119
  "📉 Revenue pacing", // #103
  "🔥 Revenue pacing", // #104
  "TODAY'S WINS", // #118
  "SEO FORENSIC", // #29
  "SEO RANKING DROPS", // #53
  "SEO WINS", // #65
  "AFTER-HOURS ${", // #79 alertAfterHours
];

describe("the source scan sees what it scans", () => {
  it("reads the server tree (an empty scan would pass everything)", () => {
    expect(FILES.length).toBeGreaterThan(300);
  });
  it("finds a planted removed text (positive control)", () => {
    const planted = [{ rel: "planted.ts", text: 'await sendTelegram(`💰 INVOICE AGING ALERT`);' }];
    expect(hits("INVOICE AGING", planted)).toEqual(["planted.ts"]);
  });
  it("ignores a removed text that only a comment mentions", () => {
    expect(stripComments("// STALE ESTIMATES was removed\n/* INVOICE AGING */\nconst a = 1;")).not.toMatch(/STALE|AGING/);
  });
  it("still finds alerts that stay (KEEP control)", () => {
    expect(hits("PROMISE RISK")).toEqual(["cron/scheduler.ts"]);
    expect(hits("NICK AI ESCALATION")).toEqual(["services/nickIntelligence.ts"]);
    expect(hits("CAPACITY ALERT")).toEqual(["services/nickIntelligence.ts"]);
  });
});

describe("REMOVE: wrong by the shop's truth", () => {
  it.each(WRONG_BY_SHOP_TRUTH)("no server code carries %s", (needle) => {
    expect(hits(needle)).toEqual([]);
  });
});

describe("REMOVE: redundant or repeating", () => {
  it.each(REDUNDANT)("no server code carries %s", (needle) => {
    expect(hits(needle)).toEqual([]);
  });
});

describe("removed cron jobs are not scheduled", () => {
  it.each(["stale-estimate-alert", "pricing-intelligence", "nick-intelligence", "seo-forensic", "daily-wins-digest"])(
    "%s is gone",
    (name) => {
      expect(getJobCadences().has(name)).toBe(false);
    },
  );
  it("the jobs that stay are still scheduled (control)", () => {
    for (const name of ["promise-risk-check", "nick-auto-actions", "churn-detection", "full-intelligence-digest", "gsc-pipeline"]) {
      expect(getJobCadences().has(name)).toBe(true);
    }
  });
});

describe("behaviour", () => {
  beforeEach(() => {
    h.sends.length = 0;
    h.sms = 0;
    h.memories.length = 0;
    h.exec = () => [];
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("#79 an after-hours lead gets its auto-SMS and no second Telegram (the bus already alerted)", async () => {
    vi.setSystemTime(new Date("2026-10-21T06:30:00Z")); // 02:30 ET, closed
    await expect(handleAfterHoursCapture({ name: "Ann", phone: "2165550101", type: "lead" })).resolves.toBe(true);
    expect(h.sms).toBe(1);
    expect(h.sends).toEqual([]);
  });

  it("#88 a backup whose archive landed sends no Telegram", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await runDailyBackup();
    expect(h.sends).toEqual([]);
  });

  it("#88 a backup whose archive FAILED still pages, with the failure text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 401, statusText: "Unauthorized" })));
    await runDailyBackup().catch(() => undefined);
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0].text).toContain("ARCHIVE FAILED");
    expect(h.sends[0].text).toContain("401");
  });

  it("#86 an old pending invoice raises no reconciliation alert", async () => {
    vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
    h.exec = () => [{ invoiceNumber: "B-1", totalAmount: 25_000, invoiceDate: "2026-10-16", paymentStatus: "pending", source: "manual" }];
    await crossReconcileInvoices();
    expect(h.sends).toEqual([]);
  });

  it("#86 a $0 invoice still alerts, without a paid/pending split", async () => {
    vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
    h.exec = () => [{ invoiceNumber: "B-2", totalAmount: 0, invoiceDate: "2026-10-20", paymentStatus: "paid", source: "shopdriver" }];
    await crossReconcileInvoices();
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0].text).toContain("$0 invoices");
    expect(h.sends[0].text).not.toMatch(/pending|paid/);
    expect(h.memories.join(" ")).not.toMatch(/pending|paid/);
  });

  it("#140 the invoice push no longer prints a payment status", async () => {
    await pushInvoice({
      invoiceNumber: "B-3", customerName: "Bo", customerPhone: "2165550102", laborCost: 1, partsCost: 2, taxAmount: 0,
      totalAmount: 3, paymentStatus: "pending", paymentMethod: "cash",
    });
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0].text).not.toMatch(/Payment:|pending/);
  });

  it("#54 the daily intelligence digest is no longer sent, its memory still is", async () => {
    getJobCadences();
    await runTierJobHandlerUnlocked("full-intelligence-digest");
    expect(h.sends).toEqual([]);
    expect(h.memories.some((m) => m.includes("Revenue"))).toBe(true);
  });
});

describe("#138 the ALG mirror alert keeps its 2 h cooldown during a long outage", () => {
  it("no failure count bypasses the cooldown", () => {
    const src = stripComments(readFileSync(join(SERVER, "services/shopDriverMirror.ts"), "utf8"));
    const body = src.slice(src.indexOf("async function sendMirrorAlert"), src.indexOf("async function sendMirrorAlert") + 600);
    expect(body).toMatch(/ALERT_COOLDOWN_MS\) return;/);
    expect(body).not.toMatch(/consecutiveFailures/);
  });
});
