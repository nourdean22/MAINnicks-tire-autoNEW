/**
 * vapi-quality-v2: an explicit walk-in invitation by the AGENT counts as a useful next step.
 *
 * Nour, 2026-10-18: "yes" to walk-in credit in the call score. The shop is first come, first
 * served, so a call where Nick invites the caller in is a good outcome. v1 could only see it
 * when the CALLER said "I'll swing by". The credit is the existing +20 next-step bucket, applied
 * once; address and hours stay measured fields beside the score and do not move it.
 *
 * The version bump is what keeps the daily "degraded" alert honest: the baseline compares only
 * rows scored with the same version, so the roughly 4-point rise cannot read as an improvement
 * against v1 rows, and a v1 row cannot hide a real v2 drop.
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import { disposeCall } from "@shared/callTaxonomy";
import { sliceBlock } from "../testUtils/sourceBlock";
import { vapiCallLogs } from "../../drizzle/schema";
import { classifyCall } from "../services/vapiCallClassifier";
import { qualityVersionLabel, qualityVersionLikePattern, scoreVapiQuality, VAPI_QUALITY_VERSION } from "../services/vapiMeasurement";
import { appendWalkInSuffix, UNMEASURED_WALK_IN, type WalkInCoverage } from "../services/vapiWalkInCoverage";

const AI = "AI: Nick's Tire and Auto, this is Nick.";

/** Fifteen classifier inputs taken from the existing classifier and speaker-attribution tests. */
const FIXTURES: Array<[string, Parameters<typeof classifyCall>[0]]> = [
  ["tool_only_alignment", { durationSeconds: 50, endedReason: "customer-ended-call", aiSummary: "Customer asked about an alignment.", transcript: `${AI}\nUser: Can you check my alignment price?`, reachedTool: true, convertedToLead: 1 }],
  ["lead_brakes", { durationSeconds: 50, endedReason: "customer-ended-call", aiSummary: "Customer requested service.", transcript: `${AI}\nUser: I need brake service.`, leadId: 11 }],
  ["callback_row_brakes", { durationSeconds: 50, endedReason: "customer-ended-call", aiSummary: "Customer requested service.", transcript: `${AI}\nUser: I need brake service.`, callbackId: 12 }],
  ["booking_brakes", { durationSeconds: 50, endedReason: "customer-ended-call", aiSummary: "Customer requested service.", transcript: `${AI}\nUser: I need brake service.`, bookingId: 13 }],
  ["caller_swings_by", { durationSeconds: 60, endedReason: "customer-ended-call", aiSummary: "Customer said they would come by today.", transcript: "AI: You can pull up today and we'll inspect it.\nUser: Ok, I'll swing by today then." }],
  ["agent_only_address", { durationSeconds: 60, endedReason: "customer-ended-call", aiSummary: "Customer was told to stop by Euclid Avenue.", transcript: "AI: Pull up today at 17625 Euclid Ave and we can inspect it." }],
  ["transfer", { durationSeconds: 45, endedReason: "assistant-forwarded-call", aiSummary: "Transferred to the front desk.", transcript: "I will transfer you now." }],
  ["silence_tech_failure", { durationSeconds: 15, endedReason: "silence-timed-out", aiSummary: "", transcript: "" }],
  ["four_second_hello", { durationSeconds: 4, endedReason: "customer-ended-call", aiSummary: "Caller ended.", transcript: "Hello?" }],
  ["one_second_empty", { durationSeconds: 1, endedReason: "customer-ended-call", aiSummary: "Ended immediately.", transcript: "" }],
  ["brakes_tool_pass", { durationSeconds: 75, endedReason: "customer-ended-call", aiSummary: "Customer asked about brakes and received a next step.", transcript: `${AI}\nUser: My brakes grind. Please tell me what to do next.`, reachedTool: true, successEvaluation: "pass", sentiment: "neutral" }],
  ["used_tires_size", { durationSeconds: 45, endedReason: "customer-ended-call", aiSummary: "Caller wants two used tires.", transcript: `${AI}\nUser: I need two used tires in 215/60R17 for my Honda.` }],
  ["callback_ask", { durationSeconds: 45, endedReason: "customer-ended-call", aiSummary: "Caller asked for a callback.", transcript: `${AI}\nUser: Can you have someone call me back about brakes?` }],
  ["hours_question", { durationSeconds: 45, endedReason: "customer-ended-call", aiSummary: "Caller asked about closing time.", transcript: `${AI}\nUser: What time do you close today?` }],
  ["brakes_no_next_step", { durationSeconds: 90, endedReason: "customer-ended-call", aiSummary: "Caller described a brake noise.", transcript: `${AI}\nUser: My brakes are grinding pretty bad when I stop.`, successEvaluation: "fail", sentiment: "negative" }],
];

type Snap = { outcome: string; speakerAttribution: string; intents: string[]; score: number | null; reasoning: string };
const R = (outcome: string, speaker: string, evidence: string, quality: number | null) =>
  `outcome=${outcome} · speaker=${speaker} · evidence=${evidence} · quality=${quality ?? "unavailable"} · quality_version=vapi-quality-v1`;
const S = (outcome: string, speakerAttribution: string, intents: string[], score: number | null, evidence: string): Snap =>
  ({ outcome, speakerAttribution, intents, score, reasoning: R(outcome, speakerAttribution, evidence, score) });

/**
 * Captured on origin/main 38301e01b (vapi-quality-v1) BEFORE any change in this job, by running
 * classifyCall over FIXTURES and printing the result. Not re-derived from the new code.
 */
const MAIN_SNAPSHOT: Record<string, Snap> = {
  tool_only_alignment: S("quote_or_inspection_intent", "transcript", ["diagnostics", "alignment", "pricing_question"], 90, "service_or_quote_intent_detected"),
  lead_brakes: S("hard_conversion", "transcript", ["brakes", "general_repair"], 90, "persisted_operational_record"),
  callback_row_brakes: S("hard_conversion", "transcript", ["brakes", "general_repair"], 95, "persisted_operational_record"),
  booking_brakes: S("hard_conversion", "transcript", ["brakes", "general_repair"], 90, "persisted_operational_record"),
  caller_swings_by: S("walk_in_directed", "transcript", [], 70, "walk_in_language_detected"),
  agent_only_address: S("abandoned_before_connect", "transcript", [], null, "ended_before_useful_connection"),
  transfer: S("human_handoff", "unavailable", [], 75, "transfer_attempted"),
  silence_tech_failure: S("tech_failure", "transcript", [], null, "technical_failure_signal"),
  four_second_hello: S("abandoned_before_connect", "unavailable", [], null, "ended_before_useful_connection"),
  one_second_empty: S("spam_or_wrong_number", "transcript", [], null, "spam_or_misdial_signal"),
  brakes_tool_pass: S("quote_or_inspection_intent", "transcript", ["brakes"], 95, "service_or_quote_intent_detected"),
  used_tires_size: S("tire_availability_intent", "transcript", ["used_tire", "tire_size_request"], 70, "tire_intent_detected"),
  callback_ask: S("callback_needed", "transcript", ["brakes"], 90, "callback_language_detected"),
  hours_question: S("resolved_info", "transcript", ["hours_location"], 90, "operational_information_request"),
  brakes_no_next_step: S("quote_or_inspection_intent", "transcript", ["brakes"], 45, "service_or_quote_intent_detected"),
};

/** Score with an agent invitation. Only the two calls with no other next step gain the +20. */
const INVITED_SCORE: Record<string, number | null> = {
  ...Object.fromEntries(Object.entries(MAIN_SNAPSHOT).map(([k, v]) => [k, v.score])),
  used_tires_size: 90,
  brakes_no_next_step: 65,
};

const INVITED: WalkInCoverage = { walkInInvited: true, addressAndHoursGiven: false };
const v2Reasoning = (snap: Snap, score: number | null) =>
  snap.reasoning
    .replace(`quality=${snap.score ?? "unavailable"} `, `quality=${score ?? "unavailable"} `)
    .replace("quality_version=vapi-quality-v1", "quality_version=vapi-quality-v2");

const dispose = (r: ReturnType<typeof classifyCall>) =>
  disposeCall({ outcome: r.outcome, speakerAttribution: r.speakerAttribution, hasCustomerSpeech: true, durationSeconds: 60, ageMinutes: 120, hasCapturedSpecifics: false });

/** No other next step: intent identified, greeted, productive duration. 35 + 10 + 20 + 5 = 70. */
const NO_NEXT_STEP = { isCustomerConversation: true, greeted: true, intentIdentified: true, usefulNextStep: false, durationSeconds: 60 } as const;
const BRAKES_ONLY = FIXTURES.find(([n]) => n === "used_tires_size")![1];
const HOURS = FIXTURES.find(([n]) => n === "hours_question")![1];

describe("T1 an agent walk-in invitation is worth exactly the +20 next-step credit", () => {
  it("scorer: 20 points above the same call without it", () => {
    const without = scoreVapiQuality(NO_NEXT_STEP).score!;
    expect(without).toBe(70);
    expect(scoreVapiQuality({ ...NO_NEXT_STEP, agentWalkInInvitation: true }).score).toBe(without + 20);
  });

  it("classifier: +20 whatever addressAndHoursGiven says", () => {
    const without = classifyCall(BRAKES_ONLY).score!;
    for (const addressAndHoursGiven of [true, false, null]) {
      expect(classifyCall({ ...BRAKES_ONLY, walkInCoverage: { walkInInvited: true, addressAndHoursGiven } }).score).toBe(without + 20);
    }
  });

  it("address and hours alone, with no invitation, give nothing", () => {
    const without = classifyCall(BRAKES_ONLY).score;
    expect(classifyCall({ ...BRAKES_ONLY, walkInCoverage: { walkInInvited: false, addressAndHoursGiven: true } }).score).toBe(without);
    expect(classifyCall({ ...BRAKES_ONLY, walkInCoverage: { walkInInvited: null, addressAndHoursGiven: true } }).score).toBe(without);
  });
});

describe("T2 false, UNMEASURED and absent coverage score exactly as v1 did", () => {
  for (const [name, input] of FIXTURES) {
    it(name, () => {
      const expected = MAIN_SNAPSHOT[name]!.score;
      expect(classifyCall(input).score).toBe(expected);
      expect(classifyCall({ ...input, walkInCoverage: { walkInInvited: false, addressAndHoursGiven: false } }).score).toBe(expected);
      expect(classifyCall({ ...input, walkInCoverage: UNMEASURED_WALK_IN }).score).toBe(expected);
      expect(classifyCall({ ...input, walkInCoverage: undefined }).score).toBe(expected);
    });
  }

  it("scorer: false and absent give nothing", () => {
    expect(scoreVapiQuality({ ...NO_NEXT_STEP, agentWalkInInvitation: false }).score).toBe(70);
    expect(scoreVapiQuality({ ...NO_NEXT_STEP, agentWalkInInvitation: undefined }).score).toBe(70);
  });
});

describe("T3 the credit is never applied twice", () => {
  it("scorer: usefulNextStep already true plus an invitation is still one +20", () => {
    const once = scoreVapiQuality({ ...NO_NEXT_STEP, usefulNextStep: true }).score;
    expect(once).toBe(90);
    expect(scoreVapiQuality({ ...NO_NEXT_STEP, usefulNextStep: true, agentWalkInInvitation: true }).score).toBe(once);
  });

  it("classifier: a resolved_info call (already a next step) does not move with an invitation", () => {
    expect(classifyCall({ ...HOURS, walkInCoverage: INVITED }).score).toBe(classifyCall(HOURS).score);
  });

  it("no clamp hides a double count: a call scoring under 80 without the credit", () => {
    const low = { isCustomerConversation: true, greeted: true, usefulNextStep: true, durationSeconds: 60 } as const; // 35+10+20+5 = 70
    expect(scoreVapiQuality(low).score).toBe(70);
    expect(scoreVapiQuality({ ...low, agentWalkInInvitation: true }).score).toBe(70);
  });
});

describe("T4 the evidence list says why", () => {
  it("names agent_walk_in_invitation when it was the sole reason", () => {
    const ev = scoreVapiQuality({ ...NO_NEXT_STEP, agentWalkInInvitation: true }).evidence;
    expect(ev).toContain("agent_walk_in_invitation");
    expect(ev).not.toContain("useful_next_step");
  });

  it("names useful_next_step only, when that already counted", () => {
    const ev = scoreVapiQuality({ ...NO_NEXT_STEP, usefulNextStep: true, agentWalkInInvitation: true }).evidence;
    expect(ev).toContain("useful_next_step");
    expect(ev).not.toContain("agent_walk_in_invitation");
  });

  it("names neither when there is no next step and no invitation", () => {
    const ev = scoreVapiQuality(NO_NEXT_STEP).evidence;
    expect(ev).not.toContain("useful_next_step");
    expect(ev).not.toContain("agent_walk_in_invitation");
  });

  it("classifier passes the evidence through", () => {
    expect(classifyCall({ ...BRAKES_ONLY, walkInCoverage: INVITED }).qualityEvidence).toContain("agent_walk_in_invitation");
    expect(classifyCall(BRAKES_ONLY).qualityEvidence).not.toContain("agent_walk_in_invitation");
  });
});

describe("T5 the version is vapi-quality-v2", () => {
  it("the constant", () => {
    expect(VAPI_QUALITY_VERSION).toBe("vapi-quality-v2");
  });

  it("reasoning of a scored call carries quality_version=vapi-quality-v2", () => {
    const r = classifyCall(HOURS);
    expect(r.reasoning).toContain("quality_version=vapi-quality-v2");
    expect(r.reasoning).not.toContain("vapi-quality-v1");
    expect(r.qualityVersion).toBe("vapi-quality-v2");
  });
});

describe("T6 a call with no score stays unscored whatever the coverage", () => {
  for (const name of ["agent_only_address", "silence_tech_failure", "four_second_hello", "one_second_empty"]) {
    it(name, () => {
      const input = FIXTURES.find(([n]) => n === name)![1];
      expect(classifyCall({ ...input, walkInCoverage: { walkInInvited: true, addressAndHoursGiven: true } }).score).toBeNull();
    });
  }

  it("scorer: not a conversation, or a technical failure, is null with an invitation", () => {
    expect(scoreVapiQuality({ isCustomerConversation: false, durationSeconds: 60, agentWalkInInvitation: true }).score).toBeNull();
    expect(scoreVapiQuality({ isCustomerConversation: true, technicalFailure: true, durationSeconds: 60, agentWalkInInvitation: true }).score).toBeNull();
  });
});

describe("T7 outcomes, speaker, intents, disposition and reasoning are unchanged (15 main fixtures)", () => {
  for (const [name, input] of FIXTURES) {
    it(name, () => {
      const snap = MAIN_SNAPSHOT[name]!;
      for (const [coverage, score] of [[undefined, snap.score], [INVITED, INVITED_SCORE[name]!]] as const) {
        const r = classifyCall({ ...input, walkInCoverage: coverage });
        expect(r.outcome).toBe(snap.outcome);
        expect(r.speakerAttribution).toBe(snap.speakerAttribution);
        expect(r.intents).toEqual(snap.intents);
        expect(r.score).toBe(score);
        // Byte-identical to main except the version token and, where the credit applied, the score.
        expect(r.reasoning).toBe(v2Reasoning(snap, score));
        const before = dispose({ ...r, outcome: snap.outcome as typeof r.outcome, speakerAttribution: snap.speakerAttribution as typeof r.speakerAttribution });
        expect(dispose(r)).toEqual(before);
      }
    });
  }
});

/** MySQL LIKE: `%` any run, `_` any one character. Enough to evaluate the baseline pattern in JS. */
const like = (value: string, pattern: string) =>
  new RegExp(`^${pattern.split("").map((c) => (c === "%" ? ".*" : c === "_" ? "." : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("")}$`, "s").test(value);

describe("T8 the degraded baseline counts only rows of the same quality version", () => {
  /** The exact expression the cron's baseline uses (its source text is pinned in the last test below). */
  const BASELINE_LINE = "sql`${vapiCallLogs.evalReasoning} LIKE ${qualityVersionLikePattern()}`,";
  const render = () => new MySqlDialect().sqlToQuery(sql`${vapiCallLogs.evalReasoning} LIKE ${qualityVersionLikePattern()}`);

  it("is a parameterised LIKE on eval_reasoning with the current version", () => {
    const rendered = render();
    expect(rendered.sql).toMatch(/`eval_reasoning`\s+like\s+\?/i);
    expect(rendered.sql).not.toContain("vapi-quality");
    expect(rendered.params).toEqual(["%quality_version=vapi-quality-v2%"]);
  });

  it("excludes a v1 row and keeps v2 rows, with and without the walk-in suffix", () => {
    const pattern = String(render().params[0]);
    const v1 = appendWalkInSuffix(MAIN_SNAPSHOT.hours_question!.reasoning, INVITED);
    const v2 = appendWalkInSuffix(classifyCall(HOURS).reasoning, INVITED);
    expect(like(v1, pattern)).toBe(false);
    expect(like(MAIN_SNAPSHOT.hours_question!.reasoning, pattern)).toBe(false);
    expect(like(v2, pattern)).toBe(true);
    expect(like(classifyCall(HOURS).reasoning, pattern)).toBe(true);
    // Positive control for the evaluator itself: a v1 pattern does match the v1 row.
    expect(like(v1, "%quality_version=vapi-quality-v1%")).toBe(true);
  });

  it("the cron's baseline query uses it beside the score and window conditions", () => {
    const cron = readFileSync(new URL("../cron/jobs/vapiCallEval.ts", import.meta.url), "utf8");
    const block = sliceBlock(cron, "avg(${vapiCallLogs.evalScore})", "baselineAverage = baseline", { label: "vapiCallEval.ts" });
    expect(block).toContain("isNotNull(vapiCallLogs.evalScore)");
    expect(block).toContain(BASELINE_LINE);
  });
});

describe("cron wiring: coverage computed once, before classifyCall, reused for the suffix", () => {
  const cron = readFileSync(new URL("../cron/jobs/vapiCallEval.ts", import.meta.url), "utf8");

  it("detectWalkInForDetail runs once and before classifyCall", () => {
    expect(cron.match(/detectWalkInForDetail\(/g)).toHaveLength(1);
    const detect = cron.indexOf("detectWalkInForDetail(detail)");
    expect(detect).toBeGreaterThan(-1); // a missing anchor (-1) would otherwise pass the order check
    expect(detect).toBeLessThan(cron.indexOf("classifyCall({"));
  });

  it("classifyCall receives the coverage and the suffix uses the same value", () => {
    expect(cron).toContain("walkInCoverage: walkIn,");
    expect(cron).toContain("appendWalkInSuffix(result.reasoning, result.score == null ? UNMEASURED_WALK_IN : walkIn)");
  });
});

describe("every writer of eval_score under the v2 label passes the coverage", () => {
  it("the classification backfill script scores with the walk-in coverage and writes the same suffix", () => {
    const script = readFileSync(new URL("../../scripts/maintenance/backfill-vapi-classification.ts", import.meta.url), "utf8");
    expect(script).toContain("walkIn = detectWalkInForDetail(detail);");
    expect(script).toContain("walkInCoverage: walkIn,");
    expect(script).toContain("appendWalkInSuffix(result.reasoning, result.score == null ? UNMEASURED_WALK_IN : walkIn)");
  });
});

describe("the voice scorecard labels the versions it averaged", () => {
  it("qualityVersionLabel: none, one, several", () => {
    expect(qualityVersionLabel(new Set())).toBeNull();
    expect(qualityVersionLabel(new Set(["vapi-quality-v2"]))).toBe("vapi-quality-v2");
    expect(qualityVersionLabel(new Set(["vapi-quality-v1", "vapi-quality-v2"]))).toBe("mixed");
  });

  it("revenueOps no longer hard-codes v1 over a window that may hold v2 rows", () => {
    const router = readFileSync(new URL("../routers/revenueOps.ts", import.meta.url), "utf8");
    expect(router).not.toContain("vapi-quality-v1");
    expect(router).toContain("version: qualityVersionLabel(qualityVersions)");
  });
});
