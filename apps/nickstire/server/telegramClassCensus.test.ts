/**
 * Telegram class census (2026-11-07) · every Telegram send in server code names its class, or it is on a list that only shrinks.
 *
 * An unclassified send is an incident (telegram.ts DEFAULT_TELEGRAM_CLASS), so each one the code grows is a new
 * message Nour cannot mute or hold: 70 had piled up with no per-source count anywhere. This test parses every
 * non-test server file, finds each call of a Telegram sender, and counts the ones with no class argument.
 *
 * The allowance is a COUNT PER FILE, not a line number, so a sibling PR that shifts lines does not turn it red.
 * It is a ratchet in both directions: a new classless call fails (the message lists file:line), and a call
 * that gains a class also fails until the number below is lowered, so the total can only go down.
 * The scan itself is proven by a planted classless call (must fail) and a planted classed call (must pass).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/** Sender name -> index of its class argument. sendTelegramMessage(text, channel, cls) takes the channel first. */
const CLASS_ARG_INDEX: Record<string, number> = {
  sendTelegram: 1,
  sendTelegramResult: 1,
  sendTelegramMessage: 2,
  sendTelegramPhotoResult: 2,
  sendTelegramVideoResult: 2,
  sendTelegramDocumentResult: 2,
  sendTelegramMediaGroupResult: 1,
};

/**
 * Classless call sites per file that the 2026-11-07 clean-up did not touch: 54 in total, down from 70 that morning.
 * Lower a number (and drop the file at 0) when you classify one. Never raise one: classify the new send instead.
 */
const ALLOWED_CLASSLESS: Record<string, number> = {
  "admin-stats.ts": 1,
  "cron/jobs/cronSkipWatchdog.ts": 1,
  "cron/jobs/crudAutomation.ts": 1,
  "cron/jobs/dailyReelPost.ts": 1,
  "cron/jobs/intelligenceAutopilot.ts": 1,
  "cron/jobs/morningBrief.ts": 1,
  "cron/jobs/psychoProfileRefresh.ts": 1,
  "cron/jobs/smsGatewayHealthMonitor.ts": 2,
  "cron/jobs/vapiCallEval.ts": 2,
  "cron/jobs/vapiHarness.ts": 1,
  "cron/jobs/vapiLatencySync.ts": 1,
  "cron/observer.ts": 4,
  "cron/scheduler.ts": 3,
  "lib/health.ts": 1,
  "lib/timezoneAssert.ts": 1,
  "routers/dispatch.ts": 2,
  "routers/gatewayTire.ts": 3,
  "services/cameraHealthAlertPolicy.ts": 1,
  "services/costDetailCoverage.ts": 1,
  "services/emailCampaigns.ts": 1,
  "services/emergencyAlert.ts": 1,
  "services/eventBus.ts": 3,
  "services/failover.ts": 1,
  "services/feedbackLoop.ts": 1,
  "services/igAutopost.ts": 2,
  "services/nickIntelligence.ts": 2,
  "services/payments.ts": 1,
  "services/reelPipeline.ts": 1,
  "services/safetyMonitor.ts": 2,
  "services/shopDriverMirror.ts": 2,
  "services/telegram.ts": 5,
  "services/workOrderAutomation.ts": 2,
  "sms.ts": 1,
};

interface Site {
  file: string;
  line: number;
  sender: string;
}

function classlessCalls(file: string, src: string): { all: number; classless: Site[] } {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const classless: Site[] = [];
  let all = 0;
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      const idx = CLASS_ARG_INDEX[name];
      if (idx !== undefined) {
        all++;
        const spread = n.arguments.some(ts.isSpreadElement);
        if (n.arguments.length <= idx && !spread) {
          classless.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, sender: name });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { all, classless };
}

const SERVER = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "__fixtures__" || name === "__tests__") continue;
      out.push(...sourceFiles(p));
    } else if (/\.tsx?$/.test(name) && !/\.(test|d)\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

function censusOf(files: Array<{ rel: string; text: string }>) {
  const sites: Site[] = [];
  let calls = 0;
  for (const f of files) {
    const r = classlessCalls(f.rel, f.text);
    calls += r.all;
    sites.push(...r.classless);
  }
  return { calls, sites };
}

/** The ratchet: every complaint, as a readable line. Empty when the census is exactly at its allowance. */
function violations(sites: Site[], allowed: Record<string, number>): string[] {
  const byFile = new Map<string, Site[]>();
  for (const s of sites) byFile.set(s.file, [...(byFile.get(s.file) ?? []), s]);
  const out: string[] = [];
  for (const [file, list] of byFile) {
    const ok = allowed[file] ?? 0;
    if (list.length > ok) {
      out.push(`${file}: ${list.length} classless (allowed ${ok}) at ${list.map((s) => `${s.file}:${s.line} ${s.sender}()`).join(", ")} -> pass a class: incident | digest | approval | receipt | noise`);
    }
  }
  for (const [file, ok] of Object.entries(allowed)) {
    const have = byFile.get(file)?.length ?? 0;
    if (have < ok) out.push(`${file}: ${have} classless but ${ok} allowed -> lower ALLOWED_CLASSLESS["${file}"] to ${have}`);
  }
  return out;
}

const REAL = sourceFiles(SERVER).map((p) => ({ rel: p.slice(SERVER.length).replace(/\\/g, "/"), text: readFileSync(p, "utf8") }));

describe("the census scan sees what it scans", () => {
  it("reads the server tree and finds the known senders (an empty scan would pass everything)", () => {
    const { calls } = censusOf(REAL);
    expect(REAL.length).toBeGreaterThan(300);
    expect(calls).toBeGreaterThan(100);
  });

  it("counts a planted classless call (positive control)", () => {
    const planted = [{ rel: "planted.ts", text: 'await sendTelegram("something happened");' }];
    expect(censusOf(planted).sites).toEqual([{ file: "planted.ts", line: 1, sender: "sendTelegram" }]);
  });

  it("counts sendTelegramMessage(text, channel) as classless: the channel is not a class", () => {
    const planted = [{ rel: "planted.ts", text: 'await sendTelegramMessage("x", "critical");' }];
    expect(censusOf(planted).sites).toHaveLength(1);
  });

  it("counts a property call (an injected sender) too", () => {
    const planted = [{ rel: "planted.ts", text: 'await input.sendTelegram("x");' }];
    expect(censusOf(planted).sites).toHaveLength(1);
  });

  it("does not count a classed call (KEEP control)", () => {
    const planted = [
      { rel: "planted.ts", text: 'await sendTelegram("x", "digest");\nawait sendTelegramMessage("y", "critical", "receipt");\nawait sendTelegramResult(t, cls);' },
    ];
    expect(censusOf(planted)).toEqual({ calls: 3, sites: [] });
  });

  it("ignores a send that only a comment or a string mentions", () => {
    const planted = [{ rel: "planted.ts", text: '// await sendTelegram("x");\nconst s = "sendTelegram(\'y\')";' }];
    expect(censusOf(planted)).toEqual({ calls: 0, sites: [] });
  });
});

describe("every Telegram send names its class", () => {
  it("the real tree is exactly at its allowance (no new classless send, none left unrecorded)", () => {
    expect(violations(censusOf(REAL).sites, ALLOWED_CLASSLESS)).toEqual([]);
  });

  it("goes red when a classless call is injected into a file, and names the file and line", () => {
    const injected = [...REAL, { rel: "services/injectedByTest.ts", text: '\nawait sendTelegram("a new alert");' }];
    const found = violations(censusOf(injected).sites, ALLOWED_CLASSLESS);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("services/injectedByTest.ts:2");
  });

  it("goes red when a call gains a class but the allowance was not lowered", () => {
    const first = Object.keys(ALLOWED_CLASSLESS)[0];
    if (!first) return; // nothing allowed yet: the ratchet has no slack to test
    const looser = { ...ALLOWED_CLASSLESS, [first]: ALLOWED_CLASSLESS[first] + 1 };
    expect(violations(censusOf(REAL).sites, looser)).toEqual([expect.stringContaining(`lower ALLOWED_CLASSLESS["${first}"]`)]);
  });
});
