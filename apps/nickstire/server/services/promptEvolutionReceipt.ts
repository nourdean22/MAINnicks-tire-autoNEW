/**
 * Prompt-evolution receipt (2026-10-09) - one durable, redacted Reality Ledger
 * record per weekly prompt-evolution run.
 *
 * THE GAP IT CLOSES. cron/jobs/promptEvolutionWeekly.ts overwrote ONE
 * shop_settings kv key (prompt_evolution_latest) and sent Telegram. Nothing
 * reads that key, so Railway logs were the only history of what the loop
 * measured. Each run now also posts a `receptionist.prompt_experiment`
 * RealityEvent plus exactly ONE H2 EvidenceClaim resting on it (index 0),
 * through the EXISTING ledger client (evidenceLedger.ts) and keyed the way
 * cron/jobs/webExperimentResolve.ts keys its verdicts (bridgeKeys.ts,
 * ADR-0019). StateNour registers the type (lib/events/reality-event-registry.ts)
 * and /proof reads it back (recentPromptExperiments).
 *
 * WHAT THE RECEIPT CARRIES. Hashes, counts, gate statistics, model names, and
 * the optimizer's rationale AFTER the caller's redact(). Never a transcript,
 * caller text, a phone number or a full prompt. Every field is copied BY NAME,
 * so handing in a whole ReceptionistBaseline (it carries the full prompt) or a
 * GateVerdict (its regressedSeeds are call ids) cannot leak either.
 *
 * GRADE AND DISPOSITION. H2 = synthetic: an offline ghost replay, never a
 * served call. The gate that DECIDED a run is the first recorded gate, in
 * pipeline order (holdout, success cohort, confirmation), that did not pass.
 * Graded from that gate's reason, not from outcome-name substrings:
 *   inconclusive  FIRST: the deciding gate measured nothing
 *                 (evaluator-unavailable, underpowered, success-empty, or 0
 *                 comparable calls). promptEvolution.ts files a judge outage
 *                 on the holdout as outcome "rejected-holdout"; an outage must
 *                 never become a durable refutation.
 *   supported     accepted AND confirmed: a known candidate, promotionStage
 *                 offline_candidate, holdout AND sealed confirmation both
 *                 recorded, and every recorded gate passed. judgeConfirmation
 *                 passes only on "improved", so an accepted run whose
 *                 confirmation came back not-significant, underpowered,
 *                 evaluator-unavailable or regressed-seed is inconclusive -
 *                 the weekly cron sets offline_candidate for EVERY accepted
 *                 run, so the stage alone cannot guard this.
 *   refuted       a rejected-* outcome whose deciding gate is evidence
 *                 AGAINST the candidate (a regressed seed, a not-significant
 *                 holdout, a success-cohort veto on won calls), or
 *                 rejected-train (the one rejection with no gate type) when
 *                 the input records that a candidate WAS replayed on the train
 *                 cohort (candidates.trainScored > 0). A confirmation that is
 *                 merely not-significant is "unconfirmed": inconclusive.
 *   inconclusive  everything else, including an outcome or gate reason this
 *                 file has never heard of, and any rejection whose deciding
 *                 gate the receipt does not carry (rejected-success with no
 *                 success reading, rejected-holdout with no holdout): an
 *                 unmapped gate may have been an outage. rejected-train is
 *                 inconclusive too when every candidate broke a prompt
 *                 invariant before scoring (promptEvolution.ts: such a
 *                 candidate is never replayed, and an all-invalid run returns
 *                 rejected-train too) or when the input does not say.
 * A claim never says more than the event beside it can show. Its text names
 * the gate that decided, and states the bound in plain English: offline replay
 * on N paired calls (summed over the recorded gates; the train cohort for a
 * rejected-train run that replayed a candidate, "at most" the train cohort
 * when that is not recorded), not served to customers, business effect
 * unmeasured.
 *
 * THE LEDGER'S PII TRIPWIRE IS MIRRORED HERE, ON PURPOSE. StateNour's findPii
 * (apps/statenour/lib/services/reality-ledger.ts) refuses a whole event when
 * any string looks like a phone, email or VIN. Measured 2026-10-09 over
 * 200,000 random digests: the phone shape matches 1.4% of 16-hex ids, 2.5% of
 * 24-hex hashes and 1.4% of UUIDs by pure chance. A receipt carries five or six
 * of those, so about one weekly receipt in ten would be refused - and the door
 * answers HTTP 200 with the refusal in the body, which postToEvidenceLedger
 * counts as delivered. So, at build time, two rules:
 *   FREE TEXT (rationale, lane differences, tool and model names, outcome)
 *   passes untouched or is WITHHELD whole. It is never rewritten, so a phone
 *   inside it cannot ride out with underscores in it.
 *   ID FIELDS (experimentId, prompt/parent/behavior hashes, assistantId,
 *   object ids) in a strict digest shape - optional letters-only "prefix:",
 *   then pure hex of 16-64 chars or a canonical 8-4-4-4-12 UUID, with at least
 *   one a-f letter - that trip the shape by chance have their digit runs split with
 *   "_" (deterministic, so every copy of one id still matches). Any other
 *   tripping id is WITHHELD, so "2165550142" or "2165550142-abcd-ef01" never
 *   leaves. Residual, accepted: a phone glued to hex letters as PURE hex in an
 *   id field ("2165550142abcdef") is indistinguishable from a digest and is
 *   split, not withheld; only a caller mapping a phone into a hash field can
 *   produce it.
 * postPromptEvolutionReceipt then re-checks the finished receipt and refuses
 * to send - loudly, returning false - anything the ledger would still refuse.
 * The test file holds the independent oracle: it parses the regexes out of
 * StateNour's source at test time.
 *
 * Pure build, best-effort post: the ledger is a consumer of the shop's truth,
 * never a dependency of it (evidenceLedger.ts header).
 */
import { createHash } from "node:crypto";
import { createLogger } from "../lib/logger";
import { bridgeKey } from "./bridgeKeys";
import { postToEvidenceLedger, type EvidenceClaimInput, type RealityEventInput } from "./evidenceLedger";

const log = createLogger("prompt-evolution-receipt");

const EVENT_TYPE = "receptionist.prompt_experiment";
const WITHHELD = "[withheld: PII-shaped]";
const RATIONALE_MAX = 400;
const DIFFERENCE_MAX = 300;
const LIST_MAX = 20;

/**
 * One gate reading. promptEvolutionGate.ts GateVerdict satisfies it
 * structurally; a SuccessCohortVerdict maps in with pValue = pDegraded. Only
 * these fields are copied.
 */
export interface ReceiptGate {
  /**
   * holdout / confirmation (GateReason): improved | regressed-seed |
   * evaluator-unavailable | underpowered | not-significant.
   * success (SuccessCohortReason): preserved | success-regressed-seed |
   * success-new-violation | success-degraded | evaluator-unavailable |
   * success-empty | underpowered.
   */
  reason: string;
  pValue: number;
  bestPossibleP?: number;
  comparable: number;
  improved: number;
  worsened: number;
  tied: number;
}

/** A serving lane. receptionistBaseline.ts ReceptionistLane (toolNames) and ReplayLane (tools) both satisfy it. */
export interface ReceiptLane {
  provider?: string | null;
  model: string | null;
  temperature: number | null;
  maxTokens: number | null;
  toolNames?: readonly string[];
  tools?: readonly string[];
}

export type PreviousProposalStatus = "applied" | "not_applied" | "unknown";

/** Decoupled from EvolutionResult on purpose: the cron maps its run into this shape. */
export interface PromptEvolutionReceiptInput {
  /** ISO timestamp the run started. Becomes occurredAt/observedAt; its America/New_York date feeds experimentId. */
  runAt: string;
  baseline: {
    source: "live_provider" | "repository";
    assistantId?: string | null;
    /** Content id of the baseline prompt (receptionistBaseline.ts: sha256 hex, first 24). Never the prompt. */
    promptHash: string;
    providerBehaviorHash?: string | null;
    /** receptionistBaseline.ts PromptParity: identical | code_plus_lessons | diverged. */
    parity: string;
  };
  /** Absent/null when no candidate prompt was produced. */
  candidate?: { promptHash: string; parentHash: string; rationale: string } | null;
  /** Caller-text redaction, applied to the rationale before anything else touches it. */
  redact: (s: string) => string;
  lanes: { live?: ReceiptLane | null; replay: ReceiptLane; parity: boolean; differences: readonly string[] };
  cohorts: { train: number; holdout: number; confirm: number; success: number };
  /**
   * The optimizer's candidates this run. From EvolutionResult.candidateSummaries:
   * proposed = its length; trainScored = entries whose train !== "unscored" (a
   * candidate that broke a prompt invariant is never replayed). Absent/null =
   * not recorded: a rejected-train run then grades inconclusive, because the
   * event cannot show that any train comparison ran.
   */
  candidates?: { proposed: number; trainScored: number } | null;
  exclusions: { unresolvable: number; evaluatorUnavailable: number };
  /** null/absent = the run never reached that gate. */
  gates: { holdout: ReceiptGate | null; success?: ReceiptGate | null; confirmation?: ReceiptGate | null };
  /** EvolutionResult.outcome (accepted, rejected-holdout, baseline-clean, ...). Unknown values grade inconclusive. */
  outcome: string;
  promotionStage: "none" | "offline_candidate" | "offline_candidate_unconfirmed";
  evaluator: { judgeModel: string; optimizerModel: string; ghostModel: string; protocolVersion: string };
  usage: { durationMs: number; replays: number; judgeCalls?: number };
  previousProposal: { candidatePromptHash?: string | null; status: PreviousProposalStatus };
}

export interface PromptEvolutionReceipt {
  /** "prompt-evolution:" + 16 hex (digit runs "_"-split in the rare phone-shaped case). The id the ledger stores. */
  experimentId: string;
  event: RealityEventInput;
  claim: EvidenceClaimInput;
}

type Disposition = NonNullable<EvidenceClaimInput["disposition"]>;

// -- StateNour findPii, mirrored (reality-ledger.ts PII_KEY / PII_VALUE) --
const PII_KEY = /plate|customer_?id|customerId|phone|email|vin\b|last_?name|first_?name|full_?name|ssn|dob|date_?of_?birth|address/i;
const PII_VALUE: ReadonlyArray<readonly [RegExp, string]> = [
  [/[\w.+-]+@[\w-]+\.[\w.-]{2,}/, "email"],
  [/(?:^|[^\d])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/, "phone"],
  [/\b[A-HJ-NPR-Z0-9]{11}\d{6}\b/, "vin"],
];

function valueShape(s: string): string | null {
  for (const [re, reason] of PII_VALUE) if (re.test(s)) return reason;
  return null;
}

/** First key or string value the ledger would refuse, as a dotted path; null when clean. */
function piiShape(value: unknown, path = ""): { path: string; reason: string } | null {
  if (typeof value === "string") {
    const reason = valueShape(value);
    return reason ? { path: path || "(value)", reason: `value looks like ${reason}` } : null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = piiShape(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if (PII_KEY.test(k)) return { path: p, reason: "key looks like PII" };
      const hit = piiShape(v, p);
      if (hit) return hit;
    }
  }
  return null;
}

/** Free text: passed untouched or withheld whole. Never rewritten, so a phone inside it never leaves in any form. */
function ledgerSafe(s: string): string {
  return valueShape(s) ? WITHHELD : s;
}

/**
 * The digest shapes this pipeline names things with: optional letters-only
 * "prefix:", then pure hex of 16-64 chars (sha256 slices) or a canonical
 * 8-4-4-4-12 UUID (Vapi assistant ids), with at least one a-f letter. Loose
 * hex-and-dash runs ("2165550142-abcd-ef01"), a prefix carrying digits, and
 * bare digit strings (a 17-digit one is VIN-shaped) are NOT digests: they are
 * withheld, never split.
 */
const DIGEST_ID = /^(?:[a-z][a-z-]*:)?(?=[^:]*[a-f])(?:[0-9a-f]{16,64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * An ID field the ledger will accept. A strict digest that trips the phone
 * shape by chance has its digit runs split with "_"; anything else that trips
 * is withheld. Deterministic: one id always maps to one output, so every copy
 * of it (objects, payload, prose) still matches.
 */
function idSafe(s: string): string {
  if (!valueShape(s)) return s;
  if (DIGEST_ID.test(s)) {
    const split = s.replace(/\d{4}(?=\d)/g, "$&_");
    if (!valueShape(split)) return split;
  }
  return WITHHELD;
}

function idOrNull(v: string | null | undefined): string | null {
  return v === null || v === undefined ? null : idSafe(String(v));
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 3)}...`;
}

/** Check the WHOLE text first (so a clip cannot cut a phone into an unrecognisable fragment), then clip. */
function freeText(s: string, max: number): string {
  return clip(ledgerSafe(s), max);
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Every string through ledgerSafe, every non-finite number to null, undefined keys dropped. */
function scrub(value: unknown): Json {
  if (typeof value === "string") return ledgerSafe(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (v !== undefined) out[k] = scrub(v);
    return out;
  }
  return null;
}

/** America/New_York calendar date (repo rule: "today" is always the shop's day, never the server's). */
function shopDate(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * The ledger caps contractHash at 32 chars; a longer protocol version is
 * represented by its own digest. So is a PII-shaped one: contractHash is not
 * on findPii's list, so nothing downstream would stop it.
 */
function contractHashOf(protocolVersion: string): string {
  return protocolVersion.length > 0 && protocolVersion.length <= 32 && !valueShape(protocolVersion)
    ? protocolVersion
    : createHash("sha256").update(protocolVersion).digest("hex").slice(0, 32);
}

function gateOf(g: ReceiptGate | null | undefined) {
  if (!g) return null;
  return {
    reason: g.reason,
    pValue: g.pValue,
    bestPossibleP: g.bestPossibleP ?? null,
    comparable: g.comparable,
    improved: g.improved,
    worsened: g.worsened,
    tied: g.tied,
  };
}

function laneOf(l: ReceiptLane | null | undefined) {
  if (!l) return null;
  return {
    provider: l.provider ?? null,
    model: l.model,
    temperature: l.temperature,
    maxTokens: l.maxTokens,
    tools: [...(l.toolNames ?? l.tools ?? [])].slice(0, LIST_MAX).map((t) => freeText(String(t), 120)),
  };
}

function redactedRationale(raw: string, redact: (s: string) => string): string {
  let out: unknown;
  try {
    out = redact(String(raw ?? ""));
  } catch {
    return WITHHELD;
  }
  return typeof out === "string" ? freeText(out, RATIONALE_MAX) : WITHHELD;
}

type GateStage = "holdout" | "success" | "confirmation";
const GATE_ORDER: readonly GateStage[] = ["holdout", "success", "confirmation"];
/** The one reading each gate passes on (promptEvolutionGate.ts: accept = "improved"; veto = reason !== "preserved"). */
const PASS_REASON: Record<GateStage, string> = { holdout: "improved", success: "preserved", confirmation: "improved" };
/** Readings that measured nothing: a judge outage, a sample too small to ever reach alpha, an empty cohort. */
const NO_EVIDENCE_REASON: ReadonlySet<string> = new Set(["evaluator-unavailable", "underpowered", "success-empty"]);
/**
 * Readings that are evidence AGAINST the candidate, per gate. A confirmation
 * that is merely not-significant did not confirm; it did not refute.
 */
const AGAINST_REASON: Record<GateStage, ReadonlySet<string>> = {
  holdout: new Set(["regressed-seed", "not-significant"]),
  success: new Set(["success-regressed-seed", "success-new-violation", "success-degraded"]),
  confirmation: new Set(["regressed-seed"]),
};
/** Outcome-name fallback, read only when no recorded gate decided the run. */
const INCONCLUSIVE_OUTCOME = /underpowered|unavailable|budget|unconfirmed/;

type Decider = { stage: GateStage; gate: ReceiptGate };

function countOf(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function comparableOf(g: ReceiptGate): number {
  return countOf(g.comparable);
}

/** Candidates replayed on the train cohort, or null when the input does not say. */
function trainScoredOf(input: PromptEvolutionReceiptInput): number | null {
  const n = input.candidates?.trainScored;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** The first recorded gate, in pipeline order, that did not pass (or passed on nothing): the one that decided the run. */
function decidingGate(gates: PromptEvolutionReceiptInput["gates"]): Decider | null {
  for (const stage of GATE_ORDER) {
    const gate = gates[stage];
    if (gate && (gate.reason !== PASS_REASON[stage] || comparableOf(gate) === 0)) return { stage, gate };
  }
  return null;
}

function measuredNothing(g: ReceiptGate): boolean {
  return NO_EVIDENCE_REASON.has(g.reason) || comparableOf(g) === 0;
}

function dispositionFor(input: PromptEvolutionReceiptInput, outcome: string, decider: Decider | null): Disposition {
  // An outage / underpowered / empty reading can neither support nor refute,
  // whatever the outcome string says. Checked before any outcome name.
  if (decider && measuredNothing(decider.gate)) return "inconclusive";
  if (outcome === "accepted") {
    const { holdout, confirmation } = input.gates;
    return !decider && input.candidate && holdout && confirmation && input.promotionStage === "offline_candidate"
      ? "supported"
      : "inconclusive";
  }
  if (INCONCLUSIVE_OUTCOME.test(outcome) || !outcome.startsWith("rejected")) return "inconclusive";
  if (decider) return AGAINST_REASON[decider.stage].has(decider.gate.reason) ? "refuted" : "inconclusive";
  // No recorded gate decided this rejection. rejected-train is the one
  // rejection with no gate type: it refutes only when the event shows a train
  // comparison ran (a candidate was replayed and did not beat the baseline).
  // Any other rejection whose deciding gate is missing may have been an
  // outage the integrator did not map; a rejected-train where every candidate
  // broke an invariant (none replayed), or where that is not recorded, shows
  // no replay at all. Neither can refute. A train rejection never reaches a
  // gate, so a rejected-train carrying one is contradictory input: ungradable.
  const reachedAGate = GATE_ORDER.some((s) => input.gates[s]);
  return outcome === "rejected-train" && !reachedAGate && (trainScoredOf(input) ?? 0) > 0 ? "refuted" : "inconclusive";
}

/**
 * 8 chars of the LEDGER-SAFE id for prose: too short to hold a phone-shaped
 * run, long enough to find the row, and never a prefix of a value the payload
 * itself withheld.
 */
function short(hash: string): string {
  const safe = idSafe(String(hash));
  return safe === WITHHELD ? "(withheld)" : safe.slice(0, 8);
}

function fmtP(p: number): string {
  return Number.isFinite(p) ? p.toFixed(3) : "n/a";
}

function gateProse(g: ReceiptGate, unit: string): string {
  return `${ledgerSafe(String(g.reason))}: +${g.improved} -${g.worsened} =${g.tied} of ${g.comparable} ${unit}, p=${fmtP(g.pValue)}`;
}

const GATE_UNIT: Record<GateStage, string> = { holdout: "paired calls", success: "won calls", confirmation: "sealed calls" };

/** The result sentence when a recorded gate decided the run. */
function deciderSentence(label: string, base: string, outcome: string, holdoutPart: string, decider: Decider, disposition: Disposition): string {
  const { stage, gate } = decider;
  const reading = `${stage} ${gateProse(gate, GATE_UNIT[stage])}`;
  if (stage === "holdout") {
    // A regressed seed can sit beside an average improvement: name the regression, not a loss.
    const verdict = gate.reason === "regressed-seed" ? `broke a call that baseline prompt ${base} reliably handles` : `did not beat baseline prompt ${base}`;
    return disposition === "refuted"
      ? `${label} ${verdict} on the holdout (outcome ${outcome}; ${reading}).`
      : `${label} versus baseline prompt ${base} is inconclusive: the holdout could not rule on it (outcome ${outcome}; ${reading}).`;
  }
  const lead = holdoutPart
    ? `${label} beat baseline prompt ${base} on the holdout (${holdoutPart})`
    : `${label} versus baseline prompt ${base} (no holdout reading recorded)`;
  const cohort = stage === "success" ? "the success cohort of won calls" : "the sealed confirmation set";
  if (disposition === "refuted") {
    return stage === "success"
      ? `${lead} but was vetoed by ${cohort} (outcome ${outcome}; ${reading}).`
      : `${lead} but failed ${cohort} (outcome ${outcome}; ${reading}).`;
  }
  return measuredNothing(gate)
    ? `${lead} but ${cohort} could not rule on it (outcome ${outcome}; ${reading}).`
    : `${lead} but did not hold on ${cohort}, so it is unconfirmed (outcome ${outcome}; ${reading}).`;
}

/**
 * rejected-train has two producer paths (promptEvolution.ts): the best
 * train-scored candidate did not beat the baseline, or every candidate broke a
 * prompt invariant and none was replayed. Only the first is a comparison.
 */
function trainSentence(label: string, base: string, outcome: string, input: PromptEvolutionReceiptInput): string {
  const scored = trainScoredOf(input);
  if (scored === null) {
    return `${label} was rejected against baseline prompt ${base} before the holdout (outcome ${outcome}; whether any candidate was replayed on the train cohort is not recorded).`;
  }
  if (scored === 0) {
    return `No candidate receptionist prompt reached replay against baseline prompt ${base} (outcome ${outcome}; ${countOf(input.candidates?.proposed)} proposed, 0 replayed: a candidate that breaks a prompt invariant is never scored).`;
  }
  return `${label} did not beat baseline prompt ${base} on the train cohort (outcome ${outcome}; best of ${scored} replayed candidate(s); no holdout comparison ran).`;
}

function claimTextFor(input: PromptEvolutionReceiptInput, disposition: Disposition, outcome: string, decider: Decider | null): string {
  const base = short(input.baseline.promptHash);
  // EvolutionResult carries no prompt for a rejected candidate, so the integrator
  // may have no hash to pass: a candidate WAS tested, its id just is not recorded.
  const label = input.candidate ? `Candidate receptionist prompt ${short(input.candidate.promptHash)}` : "A candidate receptionist prompt (hash not recorded)";
  const holdout = input.gates.holdout ?? null;
  const recorded = GATE_ORDER.map((s) => input.gates[s] ?? null).filter((g): g is ReceiptGate => g !== null);
  const rejected = outcome.startsWith("rejected");
  const holdoutPart = holdout ? `holdout ${gateProse(holdout, GATE_UNIT.holdout)}` : "";

  let result: string;
  if (!input.candidate && recorded.length === 0 && !rejected && outcome !== "accepted") {
    result = `No candidate receptionist prompt was tested against baseline prompt ${base} (outcome ${outcome}).`;
  } else if (disposition === "supported") {
    const confirmation = input.gates.confirmation as ReceiptGate;
    result = `${label} beat baseline prompt ${base} (${holdoutPart}) and held on the sealed confirmation set (confirmation ${gateProse(confirmation, GATE_UNIT.confirmation)}).`;
  } else if (decider) {
    result = deciderSentence(label, base, outcome, holdoutPart, decider, disposition);
  } else if (holdout) {
    // Every recorded gate passed, yet the run did not end supported: say why.
    const why = [
      input.gates.confirmation ? null : "no sealed confirmation recorded",
      input.candidate ? null : "candidate hash not recorded",
      input.promotionStage === "offline_candidate" ? null : `promotion stage ${ledgerSafe(String(input.promotionStage))}`,
    ].filter((w): w is string => w !== null);
    result = rejected
      ? `${label} passed the holdout against baseline prompt ${base} (${holdoutPart}) but was rejected at a later gate this receipt does not record (outcome ${outcome}), so the receipt cannot grade that rejection.`
      : `${label} passed the holdout against baseline prompt ${base} (${holdoutPart}) but is not confirmed (outcome ${[outcome, ...why].join("; ")}).`;
  } else if (rejected) {
    result =
      outcome === "rejected-train"
        ? trainSentence(label, base, outcome, input)
        : `${label} was rejected against baseline prompt ${base}, but no gate reading is recorded, so the receipt cannot grade that rejection (outcome ${outcome}).`;
  } else {
    result = `${label} versus baseline prompt ${base} is inconclusive (outcome ${outcome}; no holdout comparison ran).`;
  }

  const gateCalls = recorded.reduce((n, g) => n + comparableOf(g), 0);
  let evidence = `${gateCalls} paired calls`;
  if (gateCalls === 0 && outcome === "rejected-train") {
    // Bounded by the train cohort only when a train comparison is recorded as having run.
    const scored = trainScoredOf(input);
    const trainCalls = countOf(input.cohorts.train);
    if (scored === null) evidence = `at most ${trainCalls} paired train calls`;
    else if (scored > 0) evidence = `${trainCalls} paired train calls`;
  }
  const bounds = [`Evidence bound: offline replay on ${evidence}, not served to customers, business effect unmeasured.`];
  if (input.baseline.source === "repository") bounds.push("The baseline was the repository prompt, not the prompt callers hear.");
  if (!input.lanes.parity) bounds.push(`The replay lane differs from the live lane in ${input.lanes.differences.length} recorded way(s).`);
  if (disposition === "supported") bounds.push("Applying it stays an operator edit plus Push Config.");
  return [result, ...bounds].join(" ");
}

/**
 * Pure: the event + claim for one run. Throws only on a runAt that is not a
 * timestamp (a programmer error - an evidence row with an invented time is
 * worse than none); the caller wraps build+post so the cron never fails here.
 */
export function buildPromptEvolutionReceipt(input: PromptEvolutionReceiptInput): PromptEvolutionReceipt {
  const t = new Date(input.runAt);
  if (Number.isNaN(t.getTime())) throw new TypeError(`prompt-evolution receipt: runAt is not a timestamp (${String(input.runAt).slice(0, 40)})`);
  const at = t.toISOString();
  const c = input.cohorts;

  const material = [
    input.baseline.promptHash,
    input.candidate?.promptHash ?? "",
    input.evaluator.protocolVersion,
    shopDate(at),
    `${c.train},${c.holdout},${c.confirm},${c.success}`,
  ].join("|");
  const experimentId = idSafe(`prompt-evolution:${createHash("sha256").update(material).digest("hex").slice(0, 16)}`);

  const outcome = ledgerSafe(String(input.outcome ?? "").trim().slice(0, 64) || "unknown");
  const decider = decidingGate(input.gates);
  const disposition = dispositionFor(input, outcome, decider);
  const contractHash = contractHashOf(input.evaluator.protocolVersion);

  // Id fields go through idSafe here; scrub() then treats every string as free text.
  const payload = scrub({
    outcome,
    promotionStage: input.promotionStage,
    runDate: shopDate(at),
    baseline: {
      source: input.baseline.source,
      assistantId: idOrNull(input.baseline.assistantId),
      promptHash: idSafe(String(input.baseline.promptHash)),
      providerBehaviorHash: idOrNull(input.baseline.providerBehaviorHash),
      parity: input.baseline.parity,
    },
    candidate: input.candidate
      ? {
          promptHash: idSafe(String(input.candidate.promptHash)),
          parentHash: idSafe(String(input.candidate.parentHash)),
          rationale: redactedRationale(input.candidate.rationale, input.redact),
        }
      : null,
    lanes: {
      live: laneOf(input.lanes.live),
      replay: laneOf(input.lanes.replay),
      parity: input.lanes.parity === true,
      differences: input.lanes.differences.slice(0, LIST_MAX).map((d) => freeText(String(d), DIFFERENCE_MAX)),
    },
    cohorts: { train: c.train, holdout: c.holdout, confirm: c.confirm, success: c.success },
    candidates: input.candidates ? { proposed: input.candidates.proposed, trainScored: input.candidates.trainScored } : null,
    exclusions: { unresolvable: input.exclusions.unresolvable, evaluatorUnavailable: input.exclusions.evaluatorUnavailable },
    gates: {
      holdout: gateOf(input.gates.holdout),
      success: gateOf(input.gates.success),
      confirmation: gateOf(input.gates.confirmation),
    },
    evaluator: {
      judgeModel: input.evaluator.judgeModel,
      optimizerModel: input.evaluator.optimizerModel,
      ghostModel: input.evaluator.ghostModel,
      protocolVersion: input.evaluator.protocolVersion,
    },
    usage: { durationMs: input.usage.durationMs, replays: input.usage.replays, judgeCalls: input.usage.judgeCalls ?? null },
    previousProposal: {
      candidatePromptHash: idOrNull(input.previousProposal.candidatePromptHash),
      status: input.previousProposal.status,
    },
    businessOutcomeEvidence: "not_measured_candidate_has_not_served",
  }) as Record<string, unknown>;

  const objects: RealityEventInput["objects"] = [
    { type: "experiment", id: experimentId },
    { type: "assistant_prompt", id: idSafe(String(input.baseline.promptHash)), role: "baseline" },
  ];
  if (input.candidate) objects.push({ type: "assistant_prompt", id: idSafe(String(input.candidate.promptHash)), role: "candidate" });

  const event: RealityEventInput = {
    eventType: EVENT_TYPE,
    eventVersion: 1,
    occurredAt: at,
    observedAt: at,
    correlationId: experimentId,
    retentionClass: "evidence",
    objects,
    source: { system: "nickstire", uri: "cron:prompt-evolution-weekly" },
    experiment: { experimentId, contractHash },
    quality: "derived",
    privacy: "internal",
    payload,
  };

  const claim: EvidenceClaimInput = {
    claimText: claimTextFor(input, disposition, outcome, decider),
    grade: "H2",
    hypothesisId: experimentId,
    contractHash,
    disposition,
    // Lineage: the claim rests on the event posted in the same batch (index 0).
    sourceEventIndexes: [0],
    createdBy: "cron",
  };

  return { experimentId, event, claim };
}

/** Injection point so tests need no network. Defaults to postToEvidenceLedger. */
export interface ReceiptPostDeps {
  post?: (
    body: { events?: RealityEventInput[]; claims?: EvidenceClaimInput[] },
    opts: { idempotencyKey?: string | null },
  ) => Promise<boolean>;
}

/**
 * Best-effort post of one receipt. Never throws; true only when the ledger
 * client reports delivery (a `{duplicate:true}` replay counts as delivered).
 *
 * Idempotency (ADR-0019 section 4): one fact per (experimentId, outcome,
 * disposition, what was measured). experimentId does not cover the gate
 * readings, so two same-day runs over the same cohorts share it. Keyed on the
 * outcome alone, a holdout OUTAGE (inconclusive) and a not-significant holdout
 * (refuted) - both outcome rejected-holdout - got one key, StateNour answered
 * the second with {duplicate:true}, and this returned true for a refutation
 * the ledger never stored. So the key also carries the claim's disposition and
 * an opaque digest of the recorded gate readings and candidate counts. A retry
 * of the same receipt (or a rebuild from the same input) carries the same key
 * and lands once; a re-run that measured anything different is a different
 * fact and is recorded, so replay nondeterminism stays visible.
 */
export async function postPromptEvolutionReceipt(receipt: PromptEvolutionReceipt, deps: ReceiptPostDeps = {}): Promise<boolean> {
  try {
    const { event, claim } = receipt;
    // The same fields StateNour's recordEvidenceBatch checks, in the same order.
    const leak =
      piiShape({
        payload: event.payload ?? {},
        objects: event.objects,
        sourceUri: event.source.uri ?? "",
        correlationId: event.correlationId ?? "",
        causationId: event.causationId ?? "",
      }) ?? piiShape({ claimText: claim.claimText });
    if (leak) {
      log.warn("prompt-evolution receipt not sent: the ledger would refuse it as PII-shaped", {
        experimentId: receipt.experimentId,
        field: leak.path,
        why: leak.reason,
      });
      return false;
    }
    const outcome = typeof event.payload?.outcome === "string" ? event.payload.outcome : "unknown";
    const disposition = claim.disposition ?? "inconclusive";
    const measured = JSON.stringify([event.payload?.gates ?? null, event.payload?.candidates ?? null]);
    // Null when a part breaks a key rule: the batch then goes unkeyed (the legacy write), never dropped.
    const idempotencyKey = bridgeKey(EVENT_TYPE, { opaque: receipt.experimentId }, outcome, disposition, { opaque: measured });
    const delivered = await (deps.post ?? postToEvidenceLedger)({ events: [event], claims: [claim] }, { idempotencyKey });
    log.info("prompt-evolution receipt", { experimentId: receipt.experimentId, outcome, disposition, delivered, keyed: idempotencyKey !== null });
    return delivered === true;
  } catch (err) {
    log.warn("prompt-evolution receipt post failed", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/**
 * Was the previous run's PROPOSED candidate applied? Pass the previous run's
 * accepted candidate hash (null/absent when it proposed nothing) and the hash
 * of the prompt the line serves now, both from the same hash function
 * (receptionistBaseline.ts: sha256 hex, first 24).
 *
 *   applied      the live prompt hashes to exactly the proposed candidate
 *   not_applied  the live prompt is NOT the proposed candidate - including a
 *                candidate applied with edits, or re-pushed with a different
 *                lessons block; read it as "not live verbatim"
 *   unknown      either hash is missing
 */
export function classifyPreviousProposal(
  previous: { candidatePromptHash?: string | null } | null | undefined,
  livePromptHash: string | null | undefined,
): PreviousProposalStatus {
  const proposed = previous?.candidatePromptHash?.trim().toLowerCase();
  const live = livePromptHash?.trim().toLowerCase();
  if (!proposed || !live) return "unknown";
  return proposed === live ? "applied" : "not_applied";
}
