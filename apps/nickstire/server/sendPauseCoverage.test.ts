/**
 * Every env-armed customer-facing send flag is held by a runtime pause (C5.5).
 *
 * Source-shape canary in the style of featureFlagReaders.test.ts. The behaviour
 * of each hold is pinned in the lane's own test; this file pins the WIRING:
 *   1. each sender file reads its flag with the exact comparison sendPause's
 *      envArmed uses (so the status card cannot disagree with the code),
 *   2. it calls sendPauseHoldReason("<lane>") BEFORE its provider call,
 *   3. no new FEATURE_* / *_SEND / ENABLE_CUSTOMER_* env send flag appears
 *      without a row here (reel publishing is publishingKillSwitch's job),
 *   4. the status read has its admin procedure.
 * The planted-defect controls run the same check on a copy with the gate removed
 * or moved after the provider call, and must report it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SEND_PAUSE_LANES, type SendPauseLane } from "./services/sendPause";

const SERVER = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (rel: string) => readFileSync(join(SERVER, rel), "utf8");

type Gate = { file: string; lane: SendPauseLane; flag?: string; provider: RegExp };

const GATES: Gate[] = [
  { file: "services/vapi.ts", lane: "voice_outbound", provider: /vapiFetch\("\/call"/ },
  // The manual follow-up door passes actor "operator" (fails open on an unreadable switch only).
  { file: "cron/jobs/voiceRecovery.ts", lane: "voice_outbound", flag: "FEATURE_VOICE_RECOVERY", provider: /placeVapiOutboundCall\(\{/ },
  { file: "cron/jobs/confirmationCalls.ts", lane: "voice_outbound", flag: "FEATURE_CONFIRMATION_CALLS", provider: /placeVapiOutboundCall\(\{/ },
  { file: "cron/jobs/followupCadence.ts", lane: "voice_outbound", flag: "FEATURE_FOLLOWUP_CADENCE", provider: /placeVapiOutboundCall\(\{/ },
  { file: "services/customerMessageTemplates.ts", lane: "customer_confirmations", flag: "ENABLE_CUSTOMER_CONFIRMATIONS", provider: /await sendSms\(/ },
  { file: "cron/jobs/declinedWorkRecovery.ts", lane: "declined_recovery", flag: "FEATURE_DECLINED_RECOVERY", provider: /await sendSms\(/ },
  { file: "services/weatherIntelligence.ts", lane: "weather_sms", flag: "WEATHER_SMS_SEND", provider: /await sendSms\(/ },
  { file: "cron/jobs/missedCallRecovery.ts", lane: "missed_call_recovery", flag: "MISSED_CALL_RECOVERY_SEND", provider: /orchestrateSms\(\{/ },
];

/** Problems with one gate in one source text; [] = wired. Pure, so the controls can feed it a broken copy. */
function gateProblems(src: string, g: Gate): string[] {
  const out: string[] = [];
  // declinedWorkRecovery reads its flag through recoverySendsEnabled(env) as env.FLAG.
  if (g.flag) {
    const value = SEND_PAUSE_LANES[g.lane].envFlags.find(([n]) => n === g.flag)?.[1];
    if (value === undefined) out.push(`${g.flag} is not in SEND_PAUSE_LANES.${g.lane}.envFlags`);
    else if (!new RegExp(`env\\.${g.flag}\\s*[!=]==\\s*"${value}"`).test(src)) out.push(`${g.file} does not compare ${g.flag} with exactly "${value}"`);
  }
  const gate = src.search(new RegExp(`sendPauseHoldReason\\("${g.lane}"[,)]`));
  const provider = src.search(g.provider);
  if (gate < 0) out.push(`${g.file} never calls sendPauseHoldReason("${g.lane}")`);
  if (provider < 0) out.push(`${g.file}: provider call ${g.provider} not found (pattern stale?)`);
  if (gate >= 0 && provider >= 0 && gate > provider) out.push(`${g.file}: the pause is checked AFTER the provider call`);
  return out;
}

function serverSources(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) serverSources(p, acc);
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) acc.push(p);
  }
  return acc;
}

describe("send pause coverage", () => {
  it.each(GATES.map((g) => [g.file, g] as const))("%s holds on its lane before the provider call", (_f, g) => {
    expect(gateProblems(read(g.file), g)).toEqual([]);
  });

  it("every lane has at least one gate, and every lane env flag has a sender gate", () => {
    for (const [lane, def] of Object.entries(SEND_PAUSE_LANES)) {
      expect(GATES.some((g) => g.lane === lane), lane).toBe(true);
      for (const [flag] of def.envFlags) expect(GATES.some((g) => g.flag === flag), flag).toBe(true);
    }
  });

  it("no env send flag exists without a row here (reel publishing is publishingKillSwitch's)", () => {
    const shape = /process\.env\.((?:FEATURE_[A-Z_]+)|(?:[A-Z_]+_SEND)|(?:ENABLE_CUSTOMER_[A-Z_]+))\s*[!=]==\s*"/g;
    const found = new Set<string>();
    for (const p of serverSources(SERVER)) for (const m of readFileSync(p, "utf8").matchAll(shape)) found.add(m[1]);
    // Positive control: the scan sees the known flags, so an empty result cannot pass.
    for (const flag of ["FEATURE_VOICE_RECOVERY", "ENABLE_CUSTOMER_CONFIRMATIONS", "WEATHER_SMS_SEND", "MISSED_CALL_RECOVERY_SEND"]) {
      expect(found.has(flag), `scan did not see ${flag}`).toBe(true);
    }
    const known = new Set(Object.values(SEND_PAUSE_LANES).flatMap((d) => d.envFlags.map(([n]) => n as string)));
    expect([...found].filter((f) => !known.has(f)), "env send flag(s) with no send_pause lane").toEqual([]);
    expect(read("services/socialPublish.ts")).toMatch(/publishingKillSwitch/);
  });

  it("only the manual follow-up door passes actor operator; no cron does", () => {
    expect(read("routers/vapi.ts")).toMatch(/lane: "followup_manual",\s*actor: "operator"/);
    for (const f of ["cron/jobs/voiceRecovery.ts", "cron/jobs/confirmationCalls.ts", "cron/jobs/followupCadence.ts"]) {
      expect(read(f), f).not.toMatch(/actor:\s*"operator"|sendPauseHoldReason\([^)]*"operator"/);
    }
    expect(read("services/vapi.ts")).toMatch(/sendPauseHoldReason\("voice_outbound", params\.actor \?\? "automated"\)/);
  });

  it("the status read has its admin procedure (assert the consumer of readSendSwitchesStatus)", () => {
    const src = read("routers/instagramAdmin.ts");
    expect(src).toMatch(/sendSwitchesStatus:\s*adminProcedure\.query\(/);
    expect(src).toMatch(/readSendSwitchesStatus\(\)/);
  });
});

describe("send pause coverage · planted defects are caught", () => {
  const g = GATES.find((x) => x.file === "services/weatherIntelligence.ts")!;
  const src = read(g.file);
  // /g: since round 2 the lane checks at its start gate AND before each send; removing one leaves it wired.
  const gateLine = /^.*sendPauseHoldReason\("weather_sms"\).*$/gm;

  it("CONTROL: the real file passes", () => {
    expect(gateProblems(src, g)).toEqual([]);
  });

  it("removing the gate call goes red", () => {
    expect(gateProblems(src.replace(gateLine, ""), g)).toContain(`${g.file} never calls sendPauseHoldReason("weather_sms")`);
  });

  it("moving the gate after the provider call goes red", () => {
    const line = src.match(gateLine)![0];
    const moved = src.replace(gateLine, "").replace(/await sendSms\(/, (m) => `${m}0);\n${line}\n(`);
    expect(gateProblems(moved, g)).toContain(`${g.file}: the pause is checked AFTER the provider call`);
  });

  it("a loose env comparison goes red", () => {
    const loose = src.replace(/process\.env\.WEATHER_SMS_SEND !== "1"/, 'process.env.WEATHER_SMS_SEND !== "true"');
    expect(gateProblems(loose, g)).toContain(`${g.file} does not compare WEATHER_SMS_SEND with exactly "1"`);
  });
});
