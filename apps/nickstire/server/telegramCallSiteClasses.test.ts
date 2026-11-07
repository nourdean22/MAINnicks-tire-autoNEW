/**
 * Telegram alert diet · which class each classified sender carries.
 *
 * The class decides what Nour can mute, so a wrong class is a wrong promise: a draft that needs his yes filed
 * as a receipt is held by default and he never sees it. This table pins the class of every classified
 * sendTelegram call site by parsing the source (a call's second argument), plus one behavioural check on the
 * live feed. Incident is the default for an unclassified send, so sites that are incidents need no row unless
 * a reviewer decided it (db.ts DVI decision).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import ts from "typescript";

type Row = readonly [file: string, anchor: string, cls: "digest" | "receipt" | "approval" | "incident"];

const TABLE: Row[] = [
  // digests
  ["cron/jobs/morningBrief.ts", "briefText", "digest"],
  ["services/liveFeed.ts", "sendTelegram(text", "digest"],
  ["cron/jobs/weeklyRevenueDigest.ts", "sendTelegramResult(text", "digest"],
  ["cron/jobs/weeklyGscDigest.ts", "sendTelegramResult(text", "digest"],
  ["cron/jobs/intelligenceAutopilot.ts", "INTELLIGENCE AUTOPILOT", "digest"],
  ["cron/jobs/intelligenceAutopilot.ts", "ALG DISCOVERY", "digest"],
  ["services/closedLoop.ts", "summary.join", "digest"],
  ["cron/jobs/monteCarloForecast.ts", "lines.join", "digest"],
  ["cron/jobs/inventoryDemandForecast.ts", "lines.join", "digest"],
  ["cron/jobs/chatFaqPipeline.ts", "TOP CHAT QUESTIONS", "digest"],
  ["cron/jobs/promptEvolutionWeekly.ts", "sendTelegram(summary", "digest"],
  ["cron/jobs/agenticAuditor.ts", "lines.join", "digest"],
  ["services/dbBackup.ts", "DIGEST ARCHIVE FAILED", "digest"],
  ["cron/jobs/vapiCallEval.ts", "DAILY MEASUREMENT", "digest"],
  ["cron/jobs/contentExperimentResolve.ts", "sendTelegram(line", "digest"],
  ["cron/jobs/webExperimentResolve.ts", "sendTelegram(line", "digest"],
  ["services/gbpAutoPost.ts", "sendTelegram(recap", "digest"],
  ["services/gbpAutoPost.ts", "sendTelegram(photoNudge", "digest"],
  ["services/feedbackLoop.ts", "Proactive (from memory)", "digest"],
  ["services/dataPipelines.ts", "GATEWAY TIRE PRICE CHANGES", "digest"],
  ["services/dataPipelines.ts", "STALE TIRE ORDERS", "digest"],
  ["services/dataPipelines.ts", "TIRE DELIVERY CHECK", "digest"],
  ["services/dataPipelines.ts", "INVOICE RECONCILIATION", "digest"],
  ["services/dataPipelines.ts", "TIRE STOCK ALERT", "digest"],
  ["cron/jobs/crudAutomation.ts", "LOW STOCK ALERT", "digest"],
  ["cron/jobs/missedCallRecovery.ts", "SHADOW", "digest"],
  ["cron/scheduler.ts", "Big day building", "digest"],
  ["cron/scheduler.ts", "PROMISE RISK", "digest"],
  // receipts
  ["cron/jobs/crudAutomation.ts", "NO-SHOW", "receipt"],
  ["cron/jobs/psychoProfileRefresh.ts", "PSYCHO PROFILE REFRESH", "receipt"], // 2026-10-21: a system receipt
  ["cron/jobs/crudAutomation.ts", "REFERRAL LOOP", "receipt"],
  ["cron/jobs/crudAutomation.ts", "VIP RECOGNITION", "receipt"],
  ["cron/jobs/crudAutomation.ts", "auto-escalated", "receipt"],
  ["services/emailCampaigns.ts", "emails sent automatically", "receipt"],
  ["cron/jobs/declinedWorkRecovery.ts", "DECLINED WORK RECOVERY:", "receipt"],
  ["cron/jobs/missedCallRecovery.ts", "Recovery — sent", "receipt"],
  ["services/workOrderAutomation.ts", "AUTO CAMPAIGN", "receipt"],
  ["services/winbackProcessor.ts", "WINBACK AUTO", "receipt"],
  ["services/eventBus.ts", "JOB COMPLETED:", "receipt"],
  ["services/eventBus.ts", "PAYMENT:", "receipt"],
  ["routers/booking.ts", "UPSELL added", "receipt"],
  ["routers/gatewayTire.ts", "TIRES SHIPPING", "receipt"],
  ["routers/gatewayTire.ts", "INSTALLED —", "receipt"],
  // 2026-11-07 clean-up: "this happened" messages that asked nothing of Nour
  ["services/eventBus.ts", "Source: ${source}${message}", "receipt"], // the non-urgent NEW LEAD (web leads also surface on the Today board)
  ["services/shopDriverSync.ts", "Create in ShopDriver NOW", "receipt"], // invoice mirrored to admin
  ["services/shopDriverSync.ts", "Create estimate in ShopDriver", "receipt"], // estimate mirrored to admin
  ["services/igAutopost.ts", "DRYRUN, not posted", "receipt"], // PREVIEW
  ["services/igAutopost.ts", "Nothing was generated, so nothing was spent", "receipt"], // HELD by the daily cap, before generating
  ["services/igAutopost.ts", "The draft cleared its eval gate and was NOT posted", "receipt"], // HELD by the daily cap
  // ...and the ones that stay incidents, pinned explicitly so the clean-up cannot swallow them
  ["services/eventBus.ts", "HIGH-URGENCY LEAD", "incident"],
  ["services/eventBus.ts", "NEW BOOKING from", "incident"], // manager ruling 2026-11-07: rare, a customer waits
  ["services/shopDriverSync.ts", "Create work order in ShopDriver NOW", "incident"], // manager ruling: a paid online order needs a work order
  ["services/igAutopost.ts", "BLOCKED BY THE INDEPENDENT JUDGE", "incident"],
  ["services/igAutopost.ts", "deliberately NOT posted", "incident"], // STOPPED
  // approvals: a draft that needs Nour's yes must never be held by default
  ["services/gbpAutoPost.ts", "GBP POST", "approval"],
  ["_core/bridge-routes.ts", "Win-back campaign DRAFTED", "approval"],
  ["cron/jobs/crudAutomation.ts", "AUTO-CONTENT", "approval"], // review: an article draft waits for review
  // incidents decided by review
  ["db.ts", "DVI decision", "incident"], // review: a customer's approval or question is time-sensitive
];

const ROOT = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function classArgOf(file: string, anchor: string): string | null {
  const src = readFileSync(ROOT + file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const hits: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      (n.expression.text === "sendTelegram" || n.expression.text === "sendTelegramResult") &&
      n.getText(sf).includes(anchor)
    ) {
      hits.push(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (hits.length !== 1) throw new Error(`${file}: "${anchor}" matched ${hits.length} calls`);
  const arg = hits[0].arguments[1];
  return arg && ts.isStringLiteral(arg) ? arg.text : null;
}

describe("classified Telegram senders", () => {
  it.each(TABLE)("%s · %s is %s", (file, anchor, cls) => {
    expect(classArgOf(file, anchor)).toBe(cls);
  });
});

describe("IG AUTOPOST LIVE message", () => {
  // notifyPosted runs after a post that failed on a network too, so a flat "receipt" would hide a failed post.
  // The class is a condition, which the table above (string literals) cannot pin: read the argument itself.
  it("is a receipt only when both networks posted, an incident when either failed", () => {
    const src = readFileSync(ROOT + "services/igAutopost.ts", "utf8");
    const sf = ts.createSourceFile("igAutopost.ts", src, ts.ScriptTarget.Latest, true);
    const hits: ts.CallExpression[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "sendTelegram" && n.getText(sf).includes("posted ${meta.ig.postId")) hits.push(n);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(hits).toHaveLength(1);
    const arg = hits[0].arguments[1];
    expect(arg && ts.isConditionalExpression(arg)).toBe(true);
    const cond = arg as ts.ConditionalExpression;
    expect(cond.condition.getText(sf)).toBe("meta.ig.success && meta.fb.success");
    expect([cond.whenTrue, cond.whenFalse].map((e) => (ts.isStringLiteral(e) ? e.text : null))).toEqual(["receipt", "incident"]);
  });
});

describe("live feed", () => {
  it("is a digest: live_telegram_feed stays the only gate for an installation that already enabled it", async () => {
    const sent: Array<[string, string | undefined]> = [];
    vi.resetModules();
    vi.doMock("./services/featureFlags", () => ({ isEnabled: async () => true }));
    vi.doMock("./services/telegram", () => ({
      sendTelegram: async (text: string, cls?: string) => {
        sent.push([text, cls]);
        return true;
      },
    }));
    const { notifyClosedJob } = await import("./services/liveFeed");
    await notifyClosedJob({ customerName: "Ann Test", totalAmount: 300, service: "Brakes" });
    vi.doUnmock("./services/featureFlags");
    vi.doUnmock("./services/telegram");
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every(([, cls]) => cls === "digest")).toBe(true);
  });
});
