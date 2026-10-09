/**
 * Prompt-evolution receipt (2026-10-09): the durable, redacted Reality Ledger
 * record each weekly run posts (promptEvolutionReceipt.ts).
 *
 * THE ORACLE IS STATENOUR'S OWN RULE, NOT A COPY. The ledger refuses an event
 * whose payload/objects/sourceUri/correlationId/causationId, or a claim whose
 * text, holds a PII-shaped key or value (apps/statenour/lib/services/
 * reality-ledger.ts findPii). This file does not import StateNour code: it
 * READS that source at test time and parses PII_KEY and PII_VALUE out of it,
 * so a rule change over there is a rule change here. If the file moves or the
 * literals change shape, the parse fails loudly instead of testing nothing.
 *
 * Positive controls first: the oracle flags a planted phone, email and PII key;
 * a raw phone-shaped hex digest trips it; then the built receipt does not.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bridgeKey } from "./bridgeKeys";
import {
  buildPromptEvolutionReceipt,
  classifyPreviousProposal,
  postPromptEvolutionReceipt,
  type PromptEvolutionReceipt,
  type PromptEvolutionReceiptInput,
  type ReceiptGate,
} from "./promptEvolutionReceipt";
import {
  judgeConfirmation,
  judgeHoldout,
  judgeSuccessCohort,
  type GateVerdict,
  type SeedTrials,
  type SuccessCohortVerdict,
} from "./promptEvolutionGate";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEDGER_SOURCE = readFileSync(join(HERE, "..", "..", "..", "statenour", "lib", "services", "reality-ledger.ts"), "utf8");
const MODULE_SOURCE = readFileSync(join(HERE, "promptEvolutionReceipt.ts"), "utf8");

// -- The oracle: StateNour's findPii, parsed from its source --
function literal(text: string): RegExp {
  const m = /^\/(.+)\/([a-z]*)$/.exec(text.trim());
  if (!m) throw new Error(`not a regex literal: ${text}`);
  return new RegExp(m[1], m[2]);
}
const keyMatch = /const PII_KEY = (\/.+\/[a-z]*);/.exec(LEDGER_SOURCE);
const valueBlock = /const PII_VALUE[^=]*= \[([\s\S]*?)\n\];/.exec(LEDGER_SOURCE);
if (!keyMatch || !valueBlock) throw new Error("could not parse PII_KEY / PII_VALUE out of statenour reality-ledger.ts");
const ORACLE_KEY = literal(keyMatch[1]);
const ORACLE_VALUES = [...valueBlock[1].matchAll(/\[(\/.+\/[a-z]*), "(\w+)"\]/g)].map((m) => [literal(m[1]), m[2]] as const);

function oracleFindPii(value: unknown, path = ""): { path: string; reason: string } | null {
  if (typeof value === "string") {
    for (const [re, reason] of ORACLE_VALUES) if (re.test(value)) return { path: path || "(value)", reason: `value looks like ${reason}` };
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = oracleFindPii(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if (ORACLE_KEY.test(k)) return { path: p, reason: "key looks like PII" };
      const hit = oracleFindPii(v, p);
      if (hit) return hit;
    }
  }
  return null;
}

/** Exactly the fields recordEvidenceBatch hands to findPii, event then claim. */
function ledgerWouldRefuse(r: PromptEvolutionReceipt) {
  return (
    oracleFindPii({
      payload: r.event.payload ?? {},
      objects: r.event.objects,
      sourceUri: r.event.source.uri ?? "",
      correlationId: r.event.correlationId ?? "",
      causationId: r.event.causationId ?? "",
    }) ?? oracleFindPii({ claimText: r.claim.claimText })
  );
}

// -- Fixtures --
const HASH_A = "a1b2c3d4e5f6a7b8c9d0e1f2";
const HASH_B = "0f1e2d3c4b5a69788796a5b4";
/** 24 hex with an exactly-10-digit run: the shape the ledger reads as a phone. */
const PHONE_SHAPED_HASH = "c0ffee4071234567beefcafe";
const ASSISTANT = "3c9e2f4a-7b1d-4e8a-9c2f-5d6e7f8a9b0c";
const FICTION_PHONE = "216-555-0142";
const WITHHELD = "[withheld: PII-shaped]";

const HOLDOUT_REJECT: ReceiptGate = { reason: "not-significant", pValue: 0.344, bestPossibleP: 0.000244, comparable: 12, improved: 3, worsened: 1, tied: 8 };
const HOLDOUT_ACCEPT: ReceiptGate = { reason: "improved", pValue: 0.012, bestPossibleP: 0.000244, comparable: 12, improved: 6, worsened: 0, tied: 6 };
const CONFIRM_PASS: ReceiptGate = { reason: "improved", pValue: 0.031, comparable: 6, improved: 5, worsened: 0, tied: 1 };
/** The shape judgeHoldout returns when the judge lane was down: nothing comparable. */
const OUTAGE_HOLDOUT: ReceiptGate = { reason: "evaluator-unavailable", pValue: 1, bestPossibleP: 1, comparable: 0, improved: 0, worsened: 0, tied: 0 };
const OUTAGE_CONFIRM: ReceiptGate = { ...OUTAGE_HOLDOUT };
/** A success-cohort verdict mapped in (pValue = pDegraded). */
const SUCCESS_PRESERVED: ReceiptGate = { reason: "preserved", pValue: 1, bestPossibleP: 0.0039, comparable: 8, improved: 0, worsened: 0, tied: 8 };
const SUCCESS_OUTAGE: ReceiptGate = { reason: "evaluator-unavailable", pValue: 1, bestPossibleP: 0.031, comparable: 5, improved: 0, worsened: 0, tied: 5 };

function baseInput(over: Partial<PromptEvolutionReceiptInput> = {}): PromptEvolutionReceiptInput {
  return {
    runAt: "2026-10-12T13:33:00.000Z",
    baseline: { source: "live_provider", assistantId: ASSISTANT, promptHash: HASH_A, providerBehaviorHash: "9a8b7c6d5e4f3a2b1c0d9e8f", parity: "code_plus_lessons" },
    candidate: { promptHash: HASH_B, parentHash: HASH_A, rationale: "Ask what the caller needs before naming a tire size." },
    redact: (s) => s,
    lanes: {
      live: { provider: "openai", model: "gpt-4o", temperature: 0.4, maxTokens: 250, toolNames: ["bookAppointment", "transferCall"] },
      replay: { model: "deepseek-v4-pro", temperature: 0, maxTokens: 700, tools: [] },
      parity: false,
      differences: [
        "model: live openai/gpt-4o vs replay deepseek-v4-pro",
        "temperature: live 0.4 vs replay 0",
        "maxTokens: live 250 vs replay 700",
        "tools: live 2 (bookAppointment, transferCall) vs replay 0 (none)",
      ],
    },
    cohorts: { train: 18, holdout: 12, confirm: 0, success: 0 },
    candidates: { proposed: 3, trainScored: 3 },
    exclusions: { unresolvable: 1, evaluatorUnavailable: 0 },
    gates: { holdout: HOLDOUT_REJECT },
    outcome: "rejected-holdout",
    promotionStage: "none",
    evaluator: { judgeModel: "gpt-oss:120b", optimizerModel: "gpt-oss:120b", ghostModel: "deepseek-v4-pro", protocolVersion: "pe-2026-10-09" },
    usage: { durationMs: 118618, replays: 125, judgeCalls: 40 },
    previousProposal: { candidatePromptHash: null, status: "unknown" },
    ...over,
  };
}

const payloadOf = (r: PromptEvolutionReceipt) => r.event.payload as Record<string, any>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the oracle itself (positive controls)", () => {
  it("parsed all three StateNour value rules and the key rule", () => {
    expect(ORACLE_VALUES.map(([, name]) => name)).toEqual(["email", "phone", "vin"]);
    expect(ORACLE_KEY.test("customerPhone")).toBe(true);
  });

  it("flags a planted phone, email and PII-named key, and passes clean data", () => {
    expect(oracleFindPii({ payload: { note: `call ${FICTION_PHONE}` } })?.reason).toBe("value looks like phone");
    expect(oracleFindPii({ payload: { note: "x@example.com" } })?.reason).toBe("value looks like email");
    expect(oracleFindPii({ payload: { nested: { customerPhone: "n/a" } } })?.path).toBe("payload.nested.customerPhone");
    expect(oracleFindPii({ payload: { promptHash: HASH_A, outcome: "accepted" } })).toBeNull();
  });

  it("the raw phone-shaped digest fixture really trips the ledger (the hazard is real)", () => {
    expect(oracleFindPii(PHONE_SHAPED_HASH)?.reason).toBe("value looks like phone");
  });

  it("the module's private mirror is byte-identical to StateNour's current rules", () => {
    expect(MODULE_SOURCE).toContain(`/${ORACLE_KEY.source}/${ORACLE_KEY.flags}`);
    for (const [re] of ORACLE_VALUES) expect(MODULE_SOURCE).toContain(`/${re.source}/${re.flags}`);
  });
});

describe("buildPromptEvolutionReceipt: the event", () => {
  it("builds the registered envelope with experiment, baseline and candidate objects", () => {
    const r = buildPromptEvolutionReceipt(baseInput());
    expect(r.event).toMatchObject({
      eventType: "receptionist.prompt_experiment",
      eventVersion: 1,
      occurredAt: "2026-10-12T13:33:00.000Z",
      observedAt: "2026-10-12T13:33:00.000Z",
      correlationId: r.experimentId,
      retentionClass: "evidence",
      source: { system: "nickstire", uri: "cron:prompt-evolution-weekly" },
      experiment: { experimentId: r.experimentId, contractHash: "pe-2026-10-09" },
      quality: "derived",
      privacy: "internal",
    });
    expect(r.event.objects).toEqual([
      { type: "experiment", id: r.experimentId },
      { type: "assistant_prompt", id: HASH_A, role: "baseline" },
      { type: "assistant_prompt", id: HASH_B, role: "candidate" },
    ]);
    const p = payloadOf(r);
    expect(p.outcome).toBe("rejected-holdout");
    expect(p.promotionStage).toBe("none");
    expect(p.cohorts).toEqual({ train: 18, holdout: 12, confirm: 0, success: 0 });
    expect(p.gates.holdout).toEqual({ reason: "not-significant", pValue: 0.344, bestPossibleP: 0.000244, comparable: 12, improved: 3, worsened: 1, tied: 8 });
    expect(p.gates.success).toBeNull();
    expect(p.gates.confirmation).toBeNull();
    expect(p.lanes.parity).toBe(false);
    expect(p.lanes.differences).toHaveLength(4);
    expect(p.businessOutcomeEvidence).toBe("not_measured_candidate_has_not_served");
  });

  it("without a candidate there is no candidate object and the claim says nothing was tested", () => {
    const r = buildPromptEvolutionReceipt(baseInput({ candidate: null, gates: { holdout: null }, outcome: "baseline-clean" }));
    expect(r.event.objects.map((o) => o.role ?? o.type)).toEqual(["experiment", "baseline"]);
    expect(payloadOf(r).candidate).toBeNull();
    expect(r.claim.claimText).toContain("No candidate receptionist prompt was tested");
    expect(r.claim.claimText).toContain("offline replay on 0 paired calls");
  });

  it("stays inside the ledger's zod limits (lengths, counts, ISO time)", () => {
    const long = buildPromptEvolutionReceipt(baseInput({ evaluator: { ...baseInput().evaluator, protocolVersion: "prompt-evolution protocol v3 with sealed confirmation" } }));
    for (const r of [buildPromptEvolutionReceipt(baseInput()), long]) {
      expect(r.event.eventType).toMatch(/^[a-z0-9_.]{3,80}$/);
      expect(r.event.objects.length).toBeGreaterThanOrEqual(1);
      expect(r.event.objects.length).toBeLessThanOrEqual(20);
      for (const o of r.event.objects) {
        expect(o.id.length).toBeLessThanOrEqual(200);
        expect(o.type.length).toBeLessThanOrEqual(40);
      }
      expect(r.event.correlationId!.length).toBeLessThanOrEqual(160);
      expect(r.event.experiment!.experimentId.length).toBeLessThanOrEqual(120);
      expect(r.event.experiment!.contractHash!.length).toBeLessThanOrEqual(32);
      expect(r.event.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(r.claim.claimText.length).toBeGreaterThanOrEqual(5);
      expect(r.claim.claimText.length).toBeLessThanOrEqual(4000);
      expect((payloadOf(r).outcome as string).length).toBeLessThanOrEqual(64);
    }
    expect(long.event.experiment!.contractHash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("refuses a runAt that is not a timestamp (no invented evidence time)", () => {
    expect(() => buildPromptEvolutionReceipt(baseInput({ runAt: "last monday" }))).toThrow(TypeError);
  });
});

describe("experimentId is deterministic", () => {
  it("is prompt-evolution: + the first 16 hex of sha256(baseline|candidate|protocol|ET date|cohorts)", () => {
    const expected = createHash("sha256").update([HASH_A, HASH_B, "pe-2026-10-09", "2026-10-12", "18,12,0,0"].join("|")).digest("hex").slice(0, 16);
    expect(buildPromptEvolutionReceipt(baseInput()).experimentId).toBe(`prompt-evolution:${expected}`);
  });

  it("is identical across rebuilds and across the same shop day, different on any input change", () => {
    const id = (over: Partial<PromptEvolutionReceiptInput>) => buildPromptEvolutionReceipt(baseInput(over)).experimentId;
    const base = id({});
    expect(id({})).toBe(base);
    expect(buildPromptEvolutionReceipt(baseInput())).toEqual(buildPromptEvolutionReceipt(baseInput()));
    // 02:00Z on the 13th is 22:00 on the 12th in Cleveland: the same shop day.
    expect(id({ runAt: "2026-10-13T02:00:00.000Z" })).toBe(base);
    expect(id({ runAt: "2026-10-13T13:33:00.000Z" })).not.toBe(base);
    expect(id({ cohorts: { train: 18, holdout: 12, confirm: 6, success: 0 } })).not.toBe(base);
    expect(id({ candidate: null })).not.toBe(base);
    expect(id({ baseline: { ...baseInput().baseline, promptHash: "f".repeat(24) } })).not.toBe(base);
    expect(id({ evaluator: { ...baseInput().evaluator, protocolVersion: "pe-2026-10-16" } })).not.toBe(base);
  });
});

describe("one H2 claim per run, disposition by outcome", () => {
  const cases: Array<[string, PromptEvolutionReceiptInput["promotionStage"], Partial<PromptEvolutionReceiptInput["gates"]>, string]> = [
    ["accepted", "offline_candidate", { holdout: HOLDOUT_ACCEPT, confirmation: CONFIRM_PASS }, "supported"],
    ["accepted", "offline_candidate_unconfirmed", { holdout: HOLDOUT_ACCEPT, confirmation: CONFIRM_PASS }, "inconclusive"],
    ["accepted", "offline_candidate", { holdout: HOLDOUT_ACCEPT }, "inconclusive"],
    ["accepted", "offline_candidate", { holdout: HOLDOUT_ACCEPT, confirmation: { ...CONFIRM_PASS, reason: "regressed-seed" } }, "inconclusive"],
    ["accepted", "none", { holdout: HOLDOUT_ACCEPT, confirmation: CONFIRM_PASS }, "inconclusive"],
    ["rejected-holdout", "none", { holdout: HOLDOUT_REJECT }, "refuted"],
    ["rejected-regression", "none", { holdout: { ...HOLDOUT_REJECT, reason: "regressed-seed" } }, "refuted"],
    // rejected-train with a train comparison recorded (baseInput: 3 of 3 candidates replayed).
    ["rejected-train", "none", { holdout: null }, "refuted"],
    // A rejection whose deciding gate is NOT recorded cannot refute: the unmapped
    // gate may have been an outage. Only rejected-train has no gate type.
    ["rejected-success", "none", { holdout: HOLDOUT_ACCEPT }, "inconclusive"],
    ["rejected-holdout", "none", { holdout: null }, "inconclusive"],
    ["rejected-regression", "none", { holdout: null }, "inconclusive"],
    ["rejected-holdout", "none", { holdout: HOLDOUT_ACCEPT }, "inconclusive"],
    // Contradictory: a train rejection never reaches a gate. Text says "cannot grade"; so must the disposition.
    ["rejected-train", "none", { holdout: HOLDOUT_ACCEPT }, "inconclusive"],
    ["rejected-underpowered", "none", { holdout: { ...HOLDOUT_REJECT, reason: "underpowered" } }, "inconclusive"],
    ["baseline-clean", "none", { holdout: null }, "inconclusive"],
    ["no-candidates", "none", { holdout: null }, "inconclusive"],
    // The producer's REAL outage path: promptEvolution.ts:411-414 files a holdout
    // GateReason "evaluator-unavailable" as outcome "rejected-holdout".
    ["rejected-holdout", "none", { holdout: OUTAGE_HOLDOUT }, "inconclusive"],
    ["rejected-holdout", "none", { holdout: { ...HOLDOUT_REJECT, reason: "underpowered" } }, "inconclusive"],
    ["rejected-holdout", "none", { holdout: { ...HOLDOUT_REJECT, reason: "a-reason-nobody-wrote-yet" } }, "inconclusive"],
    // Accepted is supported only when CONFIRMED: judgeConfirmation passes on "improved" alone,
    // and the cron sets offline_candidate for every accepted run (promptEvolutionWeekly.ts:74).
    ["accepted", "offline_candidate", { holdout: HOLDOUT_ACCEPT, confirmation: { ...CONFIRM_PASS, reason: "not-significant", pValue: 0.4 } }, "inconclusive"],
    ["accepted", "offline_candidate", { holdout: HOLDOUT_ACCEPT, confirmation: { ...CONFIRM_PASS, reason: "underpowered" } }, "inconclusive"],
    ["accepted", "offline_candidate", { holdout: HOLDOUT_ACCEPT, confirmation: OUTAGE_CONFIRM }, "inconclusive"],
    ["accepted", "offline_candidate", { holdout: HOLDOUT_ACCEPT, confirmation: { ...CONFIRM_PASS, comparable: 0, improved: 0, tied: 0 } }, "inconclusive"],
    ["accepted", "offline_candidate", { holdout: null, confirmation: CONFIRM_PASS }, "inconclusive"],
    ["accepted", "offline_candidate", { holdout: HOLDOUT_ACCEPT, success: SUCCESS_PRESERVED, confirmation: CONFIRM_PASS }, "supported"],
    ["accepted", "offline_candidate", { holdout: HOLDOUT_ACCEPT, success: SUCCESS_OUTAGE, confirmation: CONFIRM_PASS }, "inconclusive"],
    // Success cohort: a veto on won calls refutes; an outage or an empty cohort cannot.
    ["rejected-success", "none", { holdout: HOLDOUT_ACCEPT, success: { ...SUCCESS_PRESERVED, reason: "success-new-violation" } }, "refuted"],
    ["rejected-success", "none", { holdout: HOLDOUT_ACCEPT, success: { ...SUCCESS_PRESERVED, reason: "success-regressed-seed" } }, "refuted"],
    ["rejected-success", "none", { holdout: HOLDOUT_ACCEPT, success: { ...SUCCESS_PRESERVED, reason: "success-degraded", pValue: 0.01 } }, "refuted"],
    ["rejected-success", "none", { holdout: HOLDOUT_ACCEPT, success: SUCCESS_OUTAGE }, "inconclusive"],
    ["rejected-success", "none", { holdout: HOLDOUT_ACCEPT, success: { ...SUCCESS_PRESERVED, reason: "success-empty", comparable: 0, tied: 0 } }, "inconclusive"],
    // A confirmation rejection is graded from its gate: only a regression refutes.
    ["rejected-confirmation", "none", { holdout: HOLDOUT_ACCEPT, confirmation: { ...CONFIRM_PASS, reason: "regressed-seed" } }, "refuted"],
    ["rejected-confirmation", "none", { holdout: HOLDOUT_ACCEPT, confirmation: { ...CONFIRM_PASS, reason: "not-significant", pValue: 0.4 } }, "inconclusive"],
    ["rejected-confirmation", "none", { holdout: HOLDOUT_ACCEPT, confirmation: OUTAGE_CONFIRM }, "inconclusive"],
    ["rejected-confirmation", "none", { holdout: HOLDOUT_ACCEPT }, "inconclusive"],
    // Hypothetical outcome names (not emitted today): the name fallback keeps them inconclusive.
    ["evaluator-unavailable", "none", { holdout: null }, "inconclusive"],
    ["rejected-evaluator-unavailable", "none", { holdout: HOLDOUT_REJECT }, "inconclusive"],
    ["budget-exhausted", "none", { holdout: null }, "inconclusive"],
    ["accepted-unconfirmed", "offline_candidate_unconfirmed", { holdout: HOLDOUT_ACCEPT }, "inconclusive"],
    ["an-outcome-nobody-wrote-yet", "none", { holdout: null }, "inconclusive"],
  ];

  it.each(cases)("%s (stage %s) -> %s", (outcome, promotionStage, gates, expected) => {
    const r = buildPromptEvolutionReceipt(baseInput({ outcome, promotionStage, gates: { holdout: null, ...gates } }));
    expect(r.claim).toMatchObject({
      grade: "H2",
      disposition: expected,
      sourceEventIndexes: [0],
      createdBy: "cron",
      hypothesisId: r.experimentId,
      contractHash: "pe-2026-10-09",
    });
    expect(r.claim.claimText).toContain("not served to customers, business effect unmeasured");
    expect(ledgerWouldRefuse(r)).toBeNull();
  });

  it("states the bound in plain English with the paired-call count", () => {
    const supported = buildPromptEvolutionReceipt(
      baseInput({ outcome: "accepted", promotionStage: "offline_candidate", gates: { holdout: HOLDOUT_ACCEPT, confirmation: CONFIRM_PASS } }),
    ).claim.claimText;
    expect(supported).toContain("Candidate receptionist prompt 0f1e2d3c beat baseline prompt a1b2c3d4");
    expect(supported).toContain("held on the sealed confirmation set");
    // 12 holdout + 6 sealed confirmation calls: the bound counts every gate the claim rests on.
    expect(supported).toContain("Evidence bound: offline replay on 18 paired calls, not served to customers, business effect unmeasured.");
    expect(supported).toContain("Push Config");
    const refuted = buildPromptEvolutionReceipt(baseInput()).claim.claimText;
    expect(refuted).toContain("did not beat baseline prompt a1b2c3d4");
    expect(refuted).toContain("p=0.344");
    expect(refuted).toContain("The replay lane differs from the live lane in 4 recorded way(s).");
    expect(refuted).not.toContain("Push Config");
  });

  it("names a repository baseline as not the prompt callers hear", () => {
    const r = buildPromptEvolutionReceipt(baseInput({ baseline: { ...baseInput().baseline, source: "repository", assistantId: null } }));
    expect(r.claim.claimText).toContain("The baseline was the repository prompt, not the prompt callers hear.");
  });
});

describe("the claim text names the gate that decided", () => {
  const text = (over: Partial<PromptEvolutionReceiptInput>) => buildPromptEvolutionReceipt(baseInput(over)).claim;

  it("a rejected candidate with no recorded hash was still TESTED: never 'no candidate was tested'", () => {
    const c = text({ candidate: null, outcome: "rejected-holdout", gates: { holdout: HOLDOUT_REJECT } });
    expect(c.disposition).toBe("refuted");
    expect(c.claimText).toContain("A candidate receptionist prompt (hash not recorded) did not beat baseline prompt a1b2c3d4 on the holdout");
    expect(c.claimText).not.toContain("No candidate receptionist prompt was tested");
    expect(c.claimText).toContain("offline replay on 12 paired calls");
  });

  it("accepted with no candidate hash is never supported, and says why", () => {
    const c = text({ candidate: null, outcome: "accepted", promotionStage: "offline_candidate", gates: { holdout: HOLDOUT_ACCEPT, confirmation: CONFIRM_PASS } });
    expect(c.disposition).toBe("inconclusive");
    expect(c.claimText).toContain("but is not confirmed (outcome accepted; candidate hash not recorded)");
    expect(c.claimText).not.toContain("Push Config");
  });

  it("an outage on the holdout reads as 'could not rule', never 'did not beat'", () => {
    const c = text({ outcome: "rejected-holdout", gates: { holdout: OUTAGE_HOLDOUT } });
    expect(c.claimText).toContain("is inconclusive: the holdout could not rule on it (outcome rejected-holdout; holdout evaluator-unavailable");
    expect(c.claimText).not.toContain("did not beat");
    expect(c.claimText).toContain("offline replay on 0 paired calls");
  });

  it("a refutation must rest on compared calls: an against-reading over 0 calls is inconclusive", () => {
    // Not a shape judgeHoldout emits today (0 comparable is underpowered or an
    // outage there); a hand-mapped or zeroed gate must still not refute on nothing.
    for (const reason of ["not-significant", "regressed-seed"]) {
      const holdout: ReceiptGate = { reason, pValue: 1, bestPossibleP: 1, comparable: 0, improved: 0, worsened: 0, tied: 0 };
      const c = text({ outcome: reason === "regressed-seed" ? "rejected-regression" : "rejected-holdout", gates: { holdout } });
      expect(c.disposition).toBe("inconclusive");
      expect(c.claimText).toContain("could not rule on it");
    }
    // Control: the same readings over 12 calls do refute.
    expect(text({ outcome: "rejected-holdout", gates: { holdout: HOLDOUT_REJECT } }).disposition).toBe("refuted");
  });

  it("rejected-success names the success-cohort veto and the holdout it passed", () => {
    const c = text({ outcome: "rejected-success", gates: { holdout: HOLDOUT_ACCEPT, success: { ...SUCCESS_PRESERVED, reason: "success-new-violation" } } });
    expect(c.claimText).toContain("Candidate receptionist prompt 0f1e2d3c beat baseline prompt a1b2c3d4 on the holdout (holdout improved");
    expect(c.claimText).toContain("but was vetoed by the success cohort of won calls (outcome rejected-success; success success-new-violation: +0 -0 =8 of 8 won calls");
    expect(c.claimText).not.toContain("did not beat");
    expect(c.claimText).toContain("offline replay on 20 paired calls"); // 12 holdout + 8 won
  });

  it("a success-cohort outage says the cohort could not rule", () => {
    const c = text({ outcome: "rejected-success", gates: { holdout: HOLDOUT_ACCEPT, success: SUCCESS_OUTAGE } });
    expect(c.claimText).toContain("but the success cohort of won calls could not rule on it");
  });

  it("rejected-train with candidates replayed on train rests on the train cohort, not on '0 paired calls'", () => {
    const c = text({ outcome: "rejected-train", gates: { holdout: null } });
    expect(c.disposition).toBe("refuted");
    expect(c.claimText).toContain(
      "did not beat baseline prompt a1b2c3d4 on the train cohort (outcome rejected-train; best of 3 replayed candidate(s); no holdout comparison ran)",
    );
    expect(c.claimText).toContain("offline replay on 18 paired train calls");
    expect(c.claimText).not.toContain("0 paired calls");
  });

  it("break it: rejected-train where every candidate broke an invariant claims no train comparison", () => {
    // promptEvolution.ts: an invariant-violating candidate is never scored, and
    // an all-invalid run returns rejected-train like a real train loss.
    const input = baseInput({ candidate: null, outcome: "rejected-train", gates: { holdout: null }, candidates: { proposed: 3, trainScored: 0 } });
    const r = buildPromptEvolutionReceipt(input);
    expect(r.claim.disposition).toBe("inconclusive");
    expect(r.claim.claimText).toContain(
      "No candidate receptionist prompt reached replay against baseline prompt a1b2c3d4 (outcome rejected-train; 3 proposed, 0 replayed",
    );
    expect(r.claim.claimText).not.toContain("did not beat");
    expect(r.claim.claimText).not.toContain("train calls");
    expect(r.claim.claimText).toContain("offline replay on 0 paired calls");
    expect(payloadOf(r).candidates).toEqual({ proposed: 3, trainScored: 0 });
    expect(ledgerWouldRefuse(r)).toBeNull();
  });

  it("rejected-train with the candidate counts not recorded uses wording that holds on both paths", () => {
    for (const candidates of [null, undefined, { proposed: 3, trainScored: Number.NaN }]) {
      const c = text({ candidate: null, outcome: "rejected-train", gates: { holdout: null }, candidates });
      expect(c.disposition).toBe("inconclusive");
      expect(c.claimText).toContain(
        "A candidate receptionist prompt (hash not recorded) was rejected against baseline prompt a1b2c3d4 before the holdout (outcome rejected-train; whether any candidate was replayed on the train cohort is not recorded)",
      );
      expect(c.claimText).not.toContain("did not beat");
      expect(c.claimText).toContain("offline replay on at most 18 paired train calls");
    }
  });

  it("a rejection whose deciding gate is missing says the receipt cannot grade it", () => {
    const later = text({ outcome: "rejected-success", gates: { holdout: HOLDOUT_ACCEPT } });
    expect(later.disposition).toBe("inconclusive");
    expect(later.claimText).toContain("but was rejected at a later gate this receipt does not record (outcome rejected-success), so the receipt cannot grade that rejection");
    const none = text({ outcome: "rejected-holdout", gates: { holdout: null } });
    expect(none.disposition).toBe("inconclusive");
    expect(none.claimText).toContain("but no gate reading is recorded, so the receipt cannot grade that rejection (outcome rejected-holdout)");
    expect(none.claimText).toContain("offline replay on 0 paired calls");
    // Control: the same outcome WITH its gate recorded still refutes.
    expect(text({ outcome: "rejected-success", gates: { holdout: HOLDOUT_ACCEPT, success: { ...SUCCESS_PRESERVED, reason: "success-new-violation" } } }).disposition).toBe("refuted");
  });

  it("a confirmation that did not confirm never says 'held on the sealed confirmation set'", () => {
    for (const confirmation of [{ ...CONFIRM_PASS, reason: "not-significant", pValue: 0.4 }, OUTAGE_CONFIRM]) {
      const c = text({ outcome: "accepted", promotionStage: "offline_candidate", gates: { holdout: HOLDOUT_ACCEPT, confirmation } });
      expect(c.disposition).toBe("inconclusive");
      expect(c.claimText).not.toContain("held on the sealed confirmation set");
      expect(c.claimText).not.toContain("Push Config");
    }
    const unconfirmed = text({
      outcome: "accepted",
      promotionStage: "offline_candidate",
      gates: { holdout: HOLDOUT_ACCEPT, confirmation: { ...CONFIRM_PASS, reason: "not-significant", pValue: 0.4 } },
    });
    expect(unconfirmed.claimText).toContain("but did not hold on the sealed confirmation set, so it is unconfirmed");
  });

  it("a holdout regression is named as a broken call, not as a loss", () => {
    const c = text({ outcome: "rejected-regression", gates: { holdout: { ...HOLDOUT_ACCEPT, reason: "regressed-seed", worsened: 1, tied: 5 } } });
    expect(c.disposition).toBe("refuted");
    expect(c.claimText).toContain("broke a call that baseline prompt a1b2c3d4 reliably handles on the holdout (outcome rejected-regression; holdout regressed-seed");
    expect(c.claimText).not.toContain("did not beat");
  });

  it("a confirmation regression refutes and says it failed the sealed set", () => {
    const c = text({ outcome: "rejected-confirmation", gates: { holdout: HOLDOUT_ACCEPT, confirmation: { ...CONFIRM_PASS, reason: "regressed-seed" } } });
    expect(c.disposition).toBe("refuted");
    expect(c.claimText).toContain("but failed the sealed confirmation set (outcome rejected-confirmation; confirmation regressed-seed");
  });
});

describe("producer vocabulary: gates built by the REAL promptEvolutionGate", () => {
  // Fixtures go through judgeHoldout / judgeConfirmation / judgeSuccessCohort
  // themselves, so every reason here is one the gate can actually emit.
  const seed = (id: string, passes: boolean[], over: Partial<SeedTrials> = {}): SeedTrials => ({
    id,
    passes,
    unresolvable: false,
    evaluatorUnavailable: false,
    violations: passes.map(() => false),
    ...over,
  });
  const T3 = [true, true, true];
  const F3 = [false, false, false];
  const ids = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}`);
  /** 12 seeds: the baseline fails 6, the candidate fixes them; `mutate` edits the arms. */
  function holdoutArms(mutate: (b: SeedTrials[], c: SeedTrials[]) => void = () => undefined) {
    const b = ids(12, "h").map((id, i) => seed(id, i < 6 ? F3 : T3));
    const c = ids(12, "h").map((id) => seed(id, T3));
    mutate(b, c);
    return [b, c] as const;
  }
  const asGate = (v: GateVerdict): ReceiptGate => v; // GateVerdict satisfies ReceiptGate structurally
  const successGate = (v: SuccessCohortVerdict): ReceiptGate => ({
    reason: v.reason,
    pValue: v.pDegraded,
    bestPossibleP: v.bestPossibleP,
    comparable: v.comparable,
    improved: v.improved,
    worsened: v.worsened,
    tied: v.tied,
  });
  /** promptEvolution.ts:402-414, verbatim in effect. */
  const producerOutcome = (g: GateVerdict) =>
    g.accept ? "accepted" : g.reason === "regressed-seed" ? "rejected-regression" : g.reason === "underpowered" ? "rejected-underpowered" : "rejected-holdout";
  /** promptEvolutionWeekly.ts:74. */
  const cronStage = (outcome: string) => (outcome === "accepted" ? "offline_candidate" : "none") as PromptEvolutionReceiptInput["promotionStage"];

  const holdoutCases: Array<[string, () => readonly [SeedTrials[], SeedTrials[]], string, string, string]> = [
    ["judge outage on 4 of 12 baseline seeds", () => holdoutArms((b) => b.slice(6, 10).forEach((s) => (s.evaluatorUnavailable = true))), "evaluator-unavailable", "rejected-holdout", "inconclusive"],
    ["4 seeds only", () => holdoutArms((b, c) => (b.splice(4), c.splice(4))), "underpowered", "rejected-underpowered", "inconclusive"],
    ["2 fixed, 1 slipped", () => holdoutArms((b, c) => {
      for (let i = 2; i < 6; i++) c[i].passes = F3;
      b[6].passes = [true, true, false];
      c[6].passes = [true, false, false];
    }), "not-significant", "rejected-holdout", "refuted"],
    ["one reliably-won call broken", () => holdoutArms((_b, c) => (c[11].passes = F3)), "regressed-seed", "rejected-regression", "refuted"],
  ];

  it.each(holdoutCases)("holdout: %s -> %s -> %s -> %s", (_name, arms, reason, outcome, disposition) => {
    const verdict = judgeHoldout(...arms());
    expect(verdict.reason).toBe(reason); // positive control: the real gate emitted it
    expect(producerOutcome(verdict)).toBe(outcome);
    const r = buildPromptEvolutionReceipt(baseInput({ outcome, promotionStage: cronStage(outcome), gates: { holdout: asGate(verdict) } }));
    expect(r.claim.disposition).toBe(disposition);
    expect(ledgerWouldRefuse(r)).toBeNull();
  });

  const confirmationCases: Array<[string, () => readonly [SeedTrials[], SeedTrials[]], string, string]> = [
    ["confirmed", () => holdoutArms(), "improved", "supported"],
    ["2 fixed, 1 slipped", holdoutCases[2][1], "not-significant", "inconclusive"],
    ["4 seeds only", holdoutCases[1][1], "underpowered", "inconclusive"],
    ["judge outage", holdoutCases[0][1], "evaluator-unavailable", "inconclusive"],
    ["one reliably-won call broken", holdoutCases[3][1], "regressed-seed", "inconclusive"],
  ];

  it.each(confirmationCases)("accepted + confirmation %s (%s) under the cron's stage rule -> %s", (_name, arms, reason, disposition) => {
    const holdout = judgeHoldout(...holdoutArms());
    expect(holdout.reason).toBe("improved");
    const confirmation = judgeConfirmation(...arms());
    expect(confirmation.reason).toBe(reason);
    const outcome = producerOutcome(holdout);
    const r = buildPromptEvolutionReceipt(
      baseInput({ outcome, promotionStage: cronStage(outcome), gates: { holdout: asGate(holdout), confirmation: asGate(confirmation) } }),
    );
    expect(r.claim.disposition).toBe(disposition);
    expect(r.claim.claimText.includes("held on the sealed confirmation set")).toBe(disposition === "supported");
  });

  const successCases: Array<[string, () => readonly [SeedTrials[], SeedTrials[]], string, string, string]> = [
    ["identical", () => [ids(8, "w").map((id) => seed(id, T3)), ids(8, "w").map((id) => seed(id, T3))], "preserved", "accepted", "supported"],
    ["a new price leak", () => [ids(8, "w").map((id) => seed(id, T3)), ids(8, "w").map((id, i) => seed(id, T3, { violations: [i === 0, false, false] }))], "success-new-violation", "rejected-success", "refuted"],
    ["judge outage on 3 of 8", () => [ids(8, "w").map((id, i) => seed(id, T3, { evaluatorUnavailable: i < 3 })), ids(8, "w").map((id) => seed(id, T3))], "evaluator-unavailable", "rejected-success", "inconclusive"],
    ["empty cohort", () => [[], []], "success-empty", "rejected-success", "inconclusive"],
  ];

  it.each(successCases)("success cohort %s (%s) as %s -> %s", (_name, arms, reason, outcome, disposition) => {
    const holdout = judgeHoldout(...holdoutArms());
    const success = judgeSuccessCohort(...arms());
    expect(success.reason).toBe(reason);
    const confirmation = outcome === "accepted" ? judgeConfirmation(...holdoutArms()) : null;
    const r = buildPromptEvolutionReceipt(
      baseInput({ outcome, promotionStage: cronStage(outcome), gates: { holdout: asGate(holdout), success: successGate(success), confirmation: confirmation && asGate(confirmation) } }),
    );
    expect(r.claim.disposition).toBe(disposition);
    expect(ledgerWouldRefuse(r)).toBeNull();
  });
});

describe("no PII, no transcripts, no full prompts reach the ledger", () => {
  it("the built receipt passes StateNour's findPii on every field it checks", () => {
    expect(ledgerWouldRefuse(buildPromptEvolutionReceipt(baseInput()))).toBeNull();
  });

  it("copies by name: a full prompt, candidate prompt or call ids riding on the inputs never leave", () => {
    const FULL_PROMPT = "You are the receptionist for the shop. FULL-PROMPT-SENTINEL";
    const baseline = { ...baseInput().baseline, prompt: FULL_PROMPT, liveLane: { model: "x" } };
    const candidate = { promptHash: HASH_B, parentHash: HASH_A, rationale: "one edit", prompt: `${FULL_PROMPT} CANDIDATE` };
    const holdout = { ...HOLDOUT_ACCEPT, regressedSeeds: ["CALL-ID-SENTINEL-1"], baseline: { passes: 1, trials: 3 } };
    const r = buildPromptEvolutionReceipt(baseInput({ baseline, candidate, gates: { holdout } }));
    const wire = JSON.stringify(r);
    expect(wire).not.toContain("FULL-PROMPT-SENTINEL");
    expect(wire).not.toContain("CALL-ID-SENTINEL");
    expect(Object.keys(payloadOf(r).baseline).sort()).toEqual(["assistantId", "parity", "promptHash", "providerBehaviorHash", "source"]);
    expect(Object.keys(payloadOf(r).gates.holdout).sort()).toEqual(["bestPossibleP", "comparable", "improved", "pValue", "reason", "tied", "worsened"]);
  });

  it("applies redact() to the rationale before it lands", () => {
    const raw = `Caller said "my number is ${FICTION_PHONE}, call me back" so ask the need first.`;
    const redact = vi.fn((s: string) => s.replace(/"[^"]*"/g, "[caller text]"));
    const r = buildPromptEvolutionReceipt(baseInput({ candidate: { promptHash: HASH_B, parentHash: HASH_A, rationale: raw }, redact }));
    expect(redact).toHaveBeenCalledWith(raw);
    expect(payloadOf(r).candidate.rationale).toBe("Caller said [caller text] so ask the need first.");
    expect(JSON.stringify(r)).not.toContain(FICTION_PHONE);
    expect(ledgerWouldRefuse(r)).toBeNull();
  });

  it("break it: a redact() that misses a phone withholds the rationale instead of losing the receipt", () => {
    const raw = `Caller asked us to call ${FICTION_PHONE} back.`;
    expect(oracleFindPii(raw)).not.toBeNull(); // positive control: the raw text would be refused
    const r = buildPromptEvolutionReceipt(baseInput({ candidate: { promptHash: HASH_B, parentHash: HASH_A, rationale: raw }, redact: (s) => s }));
    expect(payloadOf(r).candidate.rationale).toBe(WITHHELD);
    expect(ledgerWouldRefuse(r)).toBeNull();
  });

  it("a redact() that throws withholds the rationale and the build still succeeds", () => {
    const r = buildPromptEvolutionReceipt(
      baseInput({
        redact: () => {
          throw new Error("redaction model down");
        },
      }),
    );
    expect(payloadOf(r).candidate.rationale).toBe(WITHHELD);
  });

  it("a phone-shaped digest is split consistently, so the receipt lands and every copy still matches", () => {
    const r = buildPromptEvolutionReceipt(
      baseInput({
        baseline: { ...baseInput().baseline, promptHash: PHONE_SHAPED_HASH },
        candidate: { promptHash: HASH_B, parentHash: PHONE_SHAPED_HASH, rationale: "one edit" },
      }),
    );
    const safe = "c0ffee4071_2345_67beefcafe";
    expect(r.event.objects[1].id).toBe(safe);
    expect(payloadOf(r).baseline.promptHash).toBe(safe);
    expect(payloadOf(r).candidate.parentHash).toBe(safe);
    expect(ledgerWouldRefuse(r)).toBeNull();
  });

  it("a phone mapped into an id field is withheld, never obfuscated - even when long enough to look like an id", () => {
    // The 17-char form is digits and dashes only: splitting its runs WOULD pass
    // the ledger, which is exactly why an id must also carry a hex letter.
    // A digit-carrying "prefix:" is not a digest prefix either. A bare 17-digit id
    // is VIN-shaped and carries no hex letter, so it is withheld, not split.
    for (const assistantId of ["2165550142", "2165550142-000000", "x2165550142:abcdef0123456789", "12345678901234567"]) {
      expect(oracleFindPii(assistantId)).not.toBeNull(); // positive control
      const r = buildPromptEvolutionReceipt(baseInput({ baseline: { ...baseInput().baseline, assistantId } }));
      expect(payloadOf(r).baseline.assistantId).toBe(WITHHELD);
      expect(JSON.stringify(r)).not.toMatch(/2165_?5501_?42|1234_5678_9012/);
      expect(ledgerWouldRefuse(r)).toBeNull();
    }
    // Mapped into the prompt hash, it is withheld in the objects AND in the claim prose.
    const r = buildPromptEvolutionReceipt(baseInput({ baseline: { ...baseInput().baseline, promptHash: "2165550142" } }));
    expect(r.event.objects[1].id).toBe(WITHHELD);
    expect(r.claim.claimText).toContain("baseline prompt (withheld)");
    expect(r.claim.claimText).not.toContain("21655501");
    expect(ledgerWouldRefuse(r)).toBeNull();
  });

  it("break it: a phone glued to hex letters in FREE TEXT or a loose id is withheld, never split", async () => {
    const GLUED = ["2165550142deadbeef", "2165550142abcdef", "2165550142abcdef0123", "2165550142-abcd-ef01"];
    for (const g of GLUED) expect(oracleFindPii(g)?.reason).toBe("value looks like phone"); // positive control
    const r = buildPromptEvolutionReceipt(
      baseInput({
        baseline: { ...baseInput().baseline, assistantId: GLUED[3] },
        candidate: { promptHash: HASH_B, parentHash: HASH_A, rationale: GLUED[0] },
        lanes: {
          ...baseInput().lanes,
          live: { provider: "openai", model: "gpt-4o", temperature: 0.4, maxTokens: 250, toolNames: [GLUED[1], "bookAppointment"] },
          differences: [GLUED[2], "temperature: live 0.4 vs replay 0"],
        },
      }),
    );
    const p = payloadOf(r);
    expect(p.candidate.rationale).toBe(WITHHELD);
    expect(p.lanes.live.tools).toEqual([WITHHELD, "bookAppointment"]);
    expect(p.lanes.differences).toEqual([WITHHELD, "temperature: live 0.4 vs replay 0"]);
    expect(p.baseline.assistantId).toBe(WITHHELD);
    expect(JSON.stringify(r)).not.toMatch(/2165_?5501_?42/);
    expect(ledgerWouldRefuse(r)).toBeNull();
    const post = vi.fn(async () => true);
    expect(await postPromptEvolutionReceipt(r, { post })).toBe(true); // the rest of the receipt still lands
  });

  it("break it: a phone-shaped model name, provider, gate reason or protocol version is withheld field by field and the receipt still lands", async () => {
    const input = baseInput({
      evaluator: { judgeModel: FICTION_PHONE, optimizerModel: "gpt-oss:120b", ghostModel: FICTION_PHONE, protocolVersion: FICTION_PHONE },
      gates: { holdout: { ...HOLDOUT_REJECT, reason: FICTION_PHONE } },
      lanes: { ...baseInput().lanes, live: { provider: FICTION_PHONE, model: FICTION_PHONE, temperature: 0.4, maxTokens: 250, toolNames: [] } },
    });
    expect(oracleFindPii(input.evaluator)?.reason).toBe("value looks like phone"); // positive control
    const r = buildPromptEvolutionReceipt(input);
    const p = payloadOf(r);
    expect(p.evaluator).toEqual({ judgeModel: WITHHELD, optimizerModel: "gpt-oss:120b", ghostModel: WITHHELD, protocolVersion: WITHHELD });
    expect(p.gates.holdout.reason).toBe(WITHHELD);
    expect(p.gates.holdout.comparable).toBe(12); // the reading's numbers still land
    expect(p.lanes.live.provider).toBe(WITHHELD);
    expect(p.lanes.live.model).toBe(WITHHELD);
    expect(p.lanes.replay.model).toBe("deepseek-v4-pro");
    // contractHash is not on findPii's list: a phone-shaped protocol version must not ride out there either.
    expect(r.event.experiment!.contractHash).toMatch(/^[0-9a-f]{32}$/);
    expect(r.claim.contractHash).toBe(r.event.experiment!.contractHash);
    expect(JSON.stringify(r)).not.toContain(FICTION_PHONE);
    expect(ledgerWouldRefuse(r)).toBeNull();
    const post = vi.fn(async () => true);
    expect(await postPromptEvolutionReceipt(r, { post })).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("a canonical UUID with a chance phone-shaped run is still split, not lost", () => {
    const uuid = "3c9e2f4a-7b1d-4e8a-9c2f-4071234567ab";
    expect(oracleFindPii(uuid)?.reason).toBe("value looks like phone"); // positive control
    const r = buildPromptEvolutionReceipt(baseInput({ baseline: { ...baseInput().baseline, assistantId: uuid } }));
    expect(payloadOf(r).baseline.assistantId).toBe("3c9e2f4a-7b1d-4e8a-9c2f-4071_2345_67ab");
    expect(ledgerWouldRefuse(r)).toBeNull();
  });

  it("sweep: of 2,000 random digest receipts, the raw ids trip the ledger sometimes and the built receipts never", () => {
    let rawTrips = 0;
    let verbatim = 0;
    for (let i = 0; i < 2000; i++) {
      const h = createHash("sha256").update(`sweep-${i}`).digest("hex");
      const promptHash = h.slice(0, 24);
      const assistantId = `${h.slice(24, 32)}-${h.slice(32, 36)}-4${h.slice(37, 40)}-a${h.slice(41, 44)}-${h.slice(44, 56)}`;
      if (oracleFindPii([promptHash, assistantId])) rawTrips++;
      const r = buildPromptEvolutionReceipt(baseInput({ baseline: { ...baseInput().baseline, promptHash, assistantId } }));
      expect(ledgerWouldRefuse(r)).toBeNull();
      if (!oracleFindPii(promptHash)) {
        expect(r.event.objects[1].id).toBe(promptHash); // clean ids are never rewritten
        verbatim++;
      }
    }
    expect(rawTrips).toBeGreaterThan(20); // ~4% expected: the instrument saw the hazard
    expect(verbatim).toBeGreaterThan(1900);
  });
});

describe("postPromptEvolutionReceipt", () => {
  /** experimentId and the measured readings as 16 letters each; outcome and disposition in the clear. */
  const KEY_SHAPE = /^v1:receptionist\.prompt_experiment:[a-p]{16}:rejected-holdout:refuted:[a-p]{16}$/;

  it("posts one event and one claim under a stable, letters-only idempotency key", async () => {
    const post = vi.fn(async () => true);
    const first = buildPromptEvolutionReceipt(baseInput());
    const retry = buildPromptEvolutionReceipt(baseInput());
    expect(await postPromptEvolutionReceipt(first, { post })).toBe(true);
    expect(await postPromptEvolutionReceipt(retry, { post })).toBe(true);
    expect(post).toHaveBeenCalledTimes(2);
    const [body, opts] = post.mock.calls[0] as unknown as [{ events: unknown[]; claims: unknown[] }, { idempotencyKey: string }];
    expect(body).toEqual({ events: [first.event], claims: [first.claim] });
    expect(opts.idempotencyKey).toMatch(KEY_SHAPE);
    expect((post.mock.calls[1] as unknown as [unknown, { idempotencyKey: string }])[1].idempotencyKey).toBe(opts.idempotencyKey);
    // A retry after a JSON round trip (an outbox replay) still carries the same key.
    expect(await postPromptEvolutionReceipt(JSON.parse(JSON.stringify(first)), { post })).toBe(true);
    expect((post.mock.calls[2] as unknown as [unknown, { idempotencyKey: string }])[1].idempotencyKey).toBe(opts.idempotencyKey);
  });

  const keyOf = async (r: PromptEvolutionReceipt) => {
    const post = vi.fn(async (_body: unknown, _opts: { idempotencyKey?: string | null }) => true);
    await postPromptEvolutionReceipt(r, { post });
    return post.mock.calls[0][1].idempotencyKey;
  };

  it("a different outcome for the same experiment is a different fact (new key)", async () => {
    expect(await keyOf(buildPromptEvolutionReceipt(baseInput()))).not.toBe(
      await keyOf(buildPromptEvolutionReceipt(baseInput({ outcome: "rejected-underpowered" }))),
    );
  });

  it("break it: two same-day runs sharing experimentId AND outcome but measuring different things get different keys", async () => {
    // EvolutionResult carries no hash for a rejected candidate, so both runs share
    // baseline, protocol, shop day and cohorts - and therefore experimentId.
    const outage = buildPromptEvolutionReceipt(baseInput({ candidate: null, outcome: "rejected-holdout", gates: { holdout: OUTAGE_HOLDOUT } }));
    const loss = buildPromptEvolutionReceipt(baseInput({ candidate: null, outcome: "rejected-holdout", gates: { holdout: HOLDOUT_REJECT } }));
    expect(outage.experimentId).toBe(loss.experimentId);
    expect(payloadOf(outage).outcome).toBe(payloadOf(loss).outcome);
    expect([outage.claim.disposition, loss.claim.disposition]).toEqual(["inconclusive", "refuted"]);
    // Positive control: the old (experimentId, outcome) key collides, so the
    // ledger's {duplicate:true} would have dropped the refutation.
    const oldKey = (r: PromptEvolutionReceipt) => bridgeKey("receptionist.prompt_experiment", { opaque: r.experimentId }, String(payloadOf(r).outcome));
    expect(oldKey(outage)).toBe(oldKey(loss));
    expect(await keyOf(outage)).not.toBe(await keyOf(loss));

    // Same disposition too: two success-cohort vetoes for different reasons are two readings.
    const veto = (reason: string) =>
      buildPromptEvolutionReceipt(baseInput({ outcome: "rejected-success", gates: { holdout: HOLDOUT_ACCEPT, success: { ...SUCCESS_PRESERVED, reason } } }));
    const [a, b] = [veto("success-new-violation"), veto("success-regressed-seed")];
    expect([a.claim.disposition, b.claim.disposition]).toEqual(["refuted", "refuted"]);
    expect(await keyOf(a)).not.toBe(await keyOf(b));

    // rejected-train has no gate readings: the candidate counts are what it measured,
    // so two refutations over different replayed sets are two facts.
    const train = (trainScored: number) =>
      buildPromptEvolutionReceipt(baseInput({ candidate: null, outcome: "rejected-train", gates: { holdout: null }, candidates: { proposed: 3, trainScored } }));
    expect([train(3).claim.disposition, train(2).claim.disposition]).toEqual(["refuted", "refuted"]);
    expect(await keyOf(train(3))).not.toBe(await keyOf(train(2)));
    expect(await keyOf(train(3))).not.toBe(await keyOf(train(0)));

    // Control: a rebuild from the same input is the same fact.
    expect(await keyOf(buildPromptEvolutionReceipt(baseInput({ candidate: null, gates: { holdout: HOLDOUT_REJECT } })))).toBe(await keyOf(loss));
  });

  it("default path: reaches the real ledger client with the Idempotency-Key header", async () => {
    vi.stubEnv("STATENOUR_SYNC_URL", "https://statenour.example");
    vi.stubEnv("STATENOUR_SYNC_KEY", "k-canary");
    const fetchSpy = vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const r = buildPromptEvolutionReceipt(baseInput());
    expect(await postPromptEvolutionReceipt(r)).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://statenour.example/api/sync/evidence");
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toMatch(KEY_SHAPE);
    const sent = JSON.parse(String(init.body));
    expect(sent.events[0].eventType).toBe("receptionist.prompt_experiment");
    expect(sent.claims).toHaveLength(1);
  });

  it("returns false, never throws, when the post fails in any way", async () => {
    const r = buildPromptEvolutionReceipt(baseInput());
    expect(await postPromptEvolutionReceipt(r, { post: async () => false })).toBe(false);
    expect(
      await postPromptEvolutionReceipt(r, {
        post: async () => {
          throw new Error("socket hang up");
        },
      }),
    ).toBe(false);
    expect(await postPromptEvolutionReceipt(null as unknown as PromptEvolutionReceipt)).toBe(false);

    vi.stubEnv("STATENOUR_SYNC_URL", "");
    vi.stubEnv("STATENOUR_SYNC_KEY", "");
    expect(await postPromptEvolutionReceipt(r)).toBe(false); // unconfigured

    vi.stubEnv("STATENOUR_SYNC_URL", "https://statenour.example");
    vi.stubEnv("STATENOUR_SYNC_KEY", "k");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    expect(await postPromptEvolutionReceipt(r)).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))));
    expect(await postPromptEvolutionReceipt(r)).toBe(false);
  });

  it("break it: a receipt tampered into PII shape is refused locally and never sent", async () => {
    const post = vi.fn(async () => true);
    const clean = buildPromptEvolutionReceipt(baseInput());
    const phone = structuredClone(clean);
    (phone.event.payload as Record<string, any>).candidate.rationale = `call ${FICTION_PHONE}`;
    const piiKey = structuredClone(clean);
    (piiKey.event.payload as Record<string, any>).customerPhone = "n/a";
    const claimText = structuredClone(clean);
    claimText.claim.claimText = `Reached the caller at ${FICTION_PHONE}.`;
    for (const tampered of [phone, piiKey, claimText]) {
      expect(ledgerWouldRefuse(tampered)).not.toBeNull(); // the ledger would refuse it
      expect(await postPromptEvolutionReceipt(tampered, { post })).toBe(false);
    }
    expect(post).not.toHaveBeenCalled();
    expect(await postPromptEvolutionReceipt(clean, { post })).toBe(true); // the unbroken receipt still goes
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe("classifyPreviousProposal", () => {
  it("applied when the live prompt hashes to the proposed candidate (case and whitespace ignored)", () => {
    expect(classifyPreviousProposal({ candidatePromptHash: HASH_B }, HASH_B)).toBe("applied");
    expect(classifyPreviousProposal({ candidatePromptHash: ` ${HASH_B.toUpperCase()} ` }, HASH_B)).toBe("applied");
  });

  it("not_applied when the live prompt is something else", () => {
    expect(classifyPreviousProposal({ candidatePromptHash: HASH_B }, HASH_A)).toBe("not_applied");
  });

  it("unknown when either side is missing", () => {
    expect(classifyPreviousProposal(null, HASH_A)).toBe("unknown");
    expect(classifyPreviousProposal(undefined, HASH_A)).toBe("unknown");
    expect(classifyPreviousProposal({}, HASH_A)).toBe("unknown");
    expect(classifyPreviousProposal({ candidatePromptHash: "" }, HASH_A)).toBe("unknown");
    expect(classifyPreviousProposal({ candidatePromptHash: HASH_B }, null)).toBe("unknown");
    expect(classifyPreviousProposal({ candidatePromptHash: HASH_B }, "  ")).toBe("unknown");
  });
});
