/**
 * scripts/harvest-repair-signals.ts — the operator-repair flywheel (2026-09-22).
 *
 * WHY THIS IS NOT A DUPLICATE OF THE TWO HARVESTERS BESIDE IT.
 *
 * `harvest-eval-corpus.ts` mines four signals (dismissed IntelligenceOutcome
 * rows, `chat_claim_warn` rows, failed tool calls, noise-verdict Discover
 * rows). `harvest-persona-traces.ts` mines low `reply_judgment` persona
 * scores. Every one of those five is THE SYSTEM GRADING ITSELF: a verifier
 * that fired, a judge that scored low, a tool that threw.
 *
 * None of them reads the strongest signal in the corpus — the operator saying
 * the answer was wrong, in their own words, in the next message.
 *
 * That asymmetry is the whole point. A judge that MISSED a failure cannot
 * harvest it; a verifier that did not fire leaves no row. Operator repair
 * language is the positive control for the other five lanes: it finds the
 * failures the self-grading lanes are structurally blind to. When this miner
 * surfaces a turn that `reply_judgment` scored highly, that pair is worth more
 * than either signal alone — it is a measured judge miss.
 *
 * The flywheel: operator repairs a reply -> harvested here -> operator curates
 * criteria -> promoted into tests/eval/scenarios/ -> replayed as regression
 * armor. Same terminal shape as the persona flywheel, different intake.
 *
 * READ-ONLY BY CONSTRUCTION — findMany only, pinned by the same source-scan
 * contract as its two siblings (tests/eval/harvest-repair-signals.test.ts).
 *
 * OUTPUT IS GITIGNORED AND STAYS THAT WAY. Candidates carry verbatim operator
 * conversation content — by construction this miner selects the turns where
 * the operator was annoyed, which is the most sensitive slice of the corpus.
 * `eval-datasets/` is in .gitignore (line 87). Nothing here uploads anywhere.
 * Review before promoting any candidate into the committed corpus.
 *
 * Usage (from apps/statenour):
 *   pnpm harvest:repairs                 # -> eval-datasets/repair-signal-candidates.json
 *   pnpm harvest:repairs --days 90 --out eval-datasets/other.json   # --out must stay inside eval-datasets/
 *   pnpm harvest:repairs --self-test     # no DB · proves the matcher fires AND abstains
 */

import { loadEnvConfig } from "@next/env";
import Module from "node:module";

/**
 * Both side effects live in a function, not at module scope, so importing this
 * file to unit-test `classifyRepair` mutates nothing global.
 *
 * This is a repeat defect in this repo, fixed the same way in
 * scripts/always-on-audit.ts:65 — a module-scope `Module._load` patch and a
 * `loadEnvConfig` call leak across vitest workers, which share a PROCESS
 * between test FILES, and surface as a timeout in an unrelated suite.
 *
 * `server-only` is a tripwire package whose entry throws by design; only
 * Next's bundler rewrites it to a no-op, so under plain tsx it fires. ESM
 * hoists static `import` above every statement, so anything reaching it must
 * load dynamically inside main(), AFTER this has run.
 */
function installScriptEnvironment(): void {
  loadEnvConfig(process.cwd());
  const cjs = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const original = cjs._load;
  cjs._load = (request, parent, isMain) => {
    if (request === "server-only") return {};
    return original(request, parent, isMain);
  };
}

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

// ── Failure taxonomy ─────────────────────────────────────────────────────

/**
 * What the operator was correcting. Deliberately about the SHAPE of the
 * failure, not its topic — a topic taxonomy would need re-cutting every time
 * the business changes; a failure-shape taxonomy is stable because it
 * describes the agent, not the domain.
 */
export const REPAIR_CLASSES = [
  "FALSE_COMPLETION", // claimed done; state says otherwise
  "REPETITION", // said or recommended this already
  "NO_TOOL", // answered from priors when a tool existed
  "WRONG_TOOL", // reached for the wrong capability
  "STALE_DATA", // answered from something out of date
  "MEMORY_MISS", // forgot a fact the operator had supplied
  "INSTRUCTION_MISS", // did not do what was actually asked
  "UNDER_RESEARCH", // stopped at the first plausible answer
  "GENERIC", // technically responsive, substantively empty
  "OVERCOACHING", // unrequested advice / moralising
] as const;
export type RepairClass = (typeof REPAIR_CLASSES)[number];

/**
 * Confidence that the message is a repair AT ALL, independent of its class.
 *
 * ⚠ THE TIERS ARE THE POINT, AND COLLAPSING THEM WOULD MAKE THIS INSTRUMENT
 * LIE. "You told me that already" is a repair with near-certainty. A bare
 * "no" is a repair only in context — and "no" appears inside ordinary prose
 * constantly ("no rush", "no, Tuesday works"). A flat regex over both would
 * report a match rate dominated by the weak tier and read as if the agent
 * fails constantly. Report tiers separately or do not report a rate.
 */
export type RepairTier = "strong" | "medium" | "weak";

interface RepairPattern {
  tier: RepairTier;
  failureClass: RepairClass;
  pattern: RegExp;
  /** Short label for the report, so a match is explainable without re-reading the regex. */
  label: string;
}

/**
 * Ordered most-specific first: the first match wins, so a message containing
 * both "you already told me" and "no" classifies as the strong signal.
 */
export const REPAIR_PATTERNS: readonly RepairPattern[] = [
  // ── strong · the operator names the failure explicitly ──
  {
    tier: "strong",
    failureClass: "REPETITION",
    label: "already-said",
    // ⚠ THE SUBJECT PRONOUN IS LOAD-BEARING, caught by the self-test on first
    // run. REPETITION and MEMORY_MISS are distinguished ONLY by direction:
    // "YOU already told ME" is the agent repeating itself; "I already told
    // YOU" is the agent forgetting what the operator said. An earlier draft
    // read `already (told|said|...) (me|you)` with no subject anchor and
    // swallowed both — which would have filed every memory-miss under
    // repetition and made the corpus look like it measured the operator's
    // loudest complaint while actually hiding a different failure inside it.
    // A bare `same X again` was dropped after the first production run matched
    // "telling myself the same thing again" — the operator narrating his
    // own habit. Every surviving alternative requires SECOND-PERSON attribution
    // (what Nick gave) or an explicit don't-want-again complaint, which is how
    // the one real repetition failure in the corpus was actually phrased:
    // "I don't just want animated book summaries again".
    pattern:
      /\b(you (told|said|gave|recommended|showed|mentioned) (me )?(that|this|it|the same)? ?(already|again|twice|before)|(you|u) already (told|said|gave|recommended|showed) me|(you|u) (sent|gave|showed|recommended) (me )?the same|(don'?t|dont|do not) (just )?want .{0,40}\bagain\b|stop recommending)\b/i,
  },
  {
    tier: "strong",
    failureClass: "FALSE_COMPLETION",
    label: "claimed-but-didnt",
    pattern:
      /\b(you (didn'?t|did not|never) (actually )?(do|make|create|add|send|run|fix|update|change|save)|that (already )?happened|it'?s not (there|done|saved|created)|nothing (happened|changed)|no you didn'?t|you claim(ed)? you did)\b/i,
  },
  {
    tier: "strong",
    failureClass: "INSTRUCTION_MISS",
    label: "not-what-i-said",
    pattern:
      /\b(that'?s not what i (said|asked|meant|wanted)|i (said|asked for|told you) .{0,40}\bnot\b|that'?s not (what|the) .{0,20}i)\b/i,
  },
  {
    tier: "strong",
    failureClass: "NO_TOOL",
    label: "why-no-tool",
    pattern:
      /\b(why (didn'?t|did not|don'?t) you (search|look|check|use|call|read|fetch)|you have a tool|use the tool|actually (search|look it up|check)|did you (even )?(search|check|look))\b/i,
  },
  {
    tier: "strong",
    failureClass: "MEMORY_MISS",
    label: "i-already-told-you",
    // ⚠ `i told you` WITHOUT an adverb is NARRATION, not repair — measured, not
    // guessed. In the first production run (2,795 operator messages) the bare
    // form matched a travel anecdote ("like I told you after the trip, we went
    // back"), a delivery complaint ("I told you I'm getting impatient") and a
    // health-status update: 5 of 6 MEMORY_MISS hits were the operator telling
    // a STORY. This operator talks to Nick
    // conversationally, so second-person past-tense is ordinary speech here.
    // `already` / `just` are what turn it into a complaint. `remember?` was
    // dropped for the same reason — it is as often rhetorical as accusatory.
    pattern:
      /\b(i (already|just) (told|said to|said) you|you (forgot|don'?t remember)|as i (already )?said)\b/i,
  },

  // ── medium · unambiguous dissatisfaction, class inferred ──
  {
    tier: "medium",
    failureClass: "STALE_DATA",
    label: "out-of-date",
    pattern:
      /\b(that'?s (out ?of ?date|outdated|old|stale)|that changed|not (current|up to date)|check (again|the latest)|as of when)\b/i,
  },
  {
    tier: "medium",
    failureClass: "OVERCOACHING",
    label: "stop-lecturing",
    pattern:
      /\b(stop (lecturing|preaching|telling me|explaining)|i didn'?t ask for (advice|a lecture)|spare me|don'?t moralize|quit the (preamble|lecture))\b/i,
  },
  {
    tier: "medium",
    failureClass: "UNDER_RESEARCH",
    label: "go-deeper",
    // ⚠⚠ THE BIGGEST MEASURED DEFECT IN THE FIRST DRAFT, AND IT POINTED THE
    // WRONG WAY. `go deeper` / `dig deeper` / `keep going` are CONTINUATION —
    // this operator says them when engaged and satisfied ("loving this, let's
    // keep going", "keep going, more like this"). Harvesting
    // them as failures would have built a regression corpus out of turns where
    // Nick did WELL, and every test derived from it would encode the inverse
    // of the intended lesson. A high-recall matcher is not merely noisy here;
    // it is sign-flipped. Only phrasings that JUDGE the reply survive.
    pattern:
      /\b(that'?s (shallow|surface|lazy|thin)|try again|try harder|you (barely|hardly) |is that (really )?(it|all)\b|look harder|nothing i don'?t (already )?know|tell me something i don'?t know)\b/i,
  },
  {
    tier: "medium",
    failureClass: "GENERIC",
    label: "too-generic",
    // `do better` must be SECOND person. "like I know I can do better…" is the
    // operator about himself, and it was a matched candidate in the first run.
    pattern:
      /\b(that'?s (too )?(generic|vague|useless|obvious|boilerplate)|be (more )?specific|say something real|that says nothing|(you|u) (can|could|need to|gotta) do better|do better than that)\b/i,
  },
  {
    tier: "medium",
    failureClass: "WRONG_TOOL",
    label: "wrong-capability",
    pattern:
      /\b(wrong tool|why did you (use|call)|that'?s the wrong (one|tool|source)|you used the wrong)\b/i,
  },

  // ── weak · only meaningful as a SHORT standalone reply ──
  // Guarded by isShortReply() at the call site, never matched inside prose.
  {
    tier: "weak",
    failureClass: "GENERIC",
    label: "terse-rejection",
    pattern: /^(no+\.?|nope\.?|wrong\.?|nah\.?|incorrect\.?|bad\.?|ugh\.?|\?+)$/i,
  },
];

/**
 * A weak-tier pattern is only consulted for short standalone messages.
 *
 * 40 chars is a judgement call, stated rather than hidden: long enough for
 * "no, that's not it" and short enough to exclude a paragraph that merely
 * contains the word. The weak tier is reported separately precisely because
 * this threshold is arbitrary and its precision is unproven.
 */
const SHORT_REPLY_MAX_CHARS = 40;

export function isShortReply(text: string): boolean {
  return text.trim().length <= SHORT_REPLY_MAX_CHARS;
}

/**
 * Medium-tier patterns match CONTENT words ("be more specific", "generic"),
 * so a long pasted document trips them by coincidence. The only medium-tier
 * false positive left after the 2026-09-22 precision pass was exactly that: a
 * ~3,000-char "Forensic Brand Style Blueprint" the operator pasted IN, scored
 * as though he were complaining about it.
 *
 * A repair is a short corrective utterance. Content is not. Strong-tier
 * patterns are exempt because they require explicit second-person accusation,
 * which a pasted document does not contain by accident.
 */
const MEDIUM_MAX_CHARS = 600;

export function isPlausibleRepairLength(text: string): boolean {
  return text.trim().length <= MEDIUM_MAX_CHARS;
}

export interface RepairMatch {
  tier: RepairTier;
  failureClass: RepairClass;
  label: string;
}

/**
 * Classify one operator message. Returns null when it is not a repair.
 *
 * Pure and exported so the matcher can be tested — and so `--self-test` can
 * prove it fires AND abstains without touching the database. A matcher that
 * matches everything is exactly as broken as one that matches nothing, and
 * only the abstain half of that pair catches the first failure.
 */
/**
 * Reply-side reclassification — the half the operator's words cannot carry.
 *
 * Drafting the first 32 repair scenarios (2026-09-22) showed that the
 * operator's characteristic repair is a bare "try again", which the
 * operator-side classifier can only file as generic UNDER_RESEARCH. Read
 * beside the REPLY it repairs, two of those were the dominant real patterns:
 *
 *   · the reply DECLARED A TOOL UNAVAILABLE and stopped ("Web search is
 *     unavailable", "no tool attached this turn", "GitHub tools aren't
 *     attached") — a NO_TOOL failure the operator answers with "try again",
 *     never with "why didn't you search";
 *   · the reply carried the production VERIFIER BANNER for a fabricated action
 *     claim ("[VERIFIER · … claimed actions … but no matching tool call
 *     fired") — a FALSE_COMPLETION the operator answers with "try again",
 *     never with "you didn't do it".
 *
 * FALSE_COMPLETION and NO_TOOL both scored ZERO in the first production run
 * because the operator does not phrase them. The reply does. So a generic
 * repair is re-read against the reply's opening, and only a generic one — an
 * operator who DID name the failure is believed over the reply.
 */
export const VERIFIER_BANNER = /^\s*\[VERIFIER\b/i;
// ⚠ The first cut had a bare `search (is|isn't|…)` alternative and matched
// "web search IS AVAILABLE this turn" and "web search is alive" — the opposite
// of unavailability — plus "search isn't PULLING the right results", which is
// noise, not absence. Measured on the second production run: 3 of 13 NO_TOOL
// hits were availability statements and 1 was noise. A negation must be part
// of the phrase, never inferred from the verb.
export const TOOL_UNAVAILABLE_REPLY =
  /\b((web )?search (is )?(unavailable|not available|down|disabled|isn'?t available|is not available)|no (web )?search (this session|available|this turn)|tools? (aren'?t|are not|isn'?t|not) (attached|available)|(can'?t|cannot|unable to) (search|reach|access) the (web|repo|internet)|no tool attached|api key was reported as leaked)\b/i;

/** The response as it was before the verifier prepended its banner. Module-private: an export whose only importer is a test is what the orphan gate exists to catch; the replay test proves it through reclassifyByReply. */
function originalOfBannered(replyText: string): string {
  const marker = "_Original response (unverified):_";
  const i = replyText.indexOf(marker);
  return i >= 0 ? replyText.slice(i + marker.length) : replyText;
}

/**
 * ⚠ A BANNER IS NOT EVIDENCE ON ITS OWN. Classified 2026-09-22
 * (docs/audits/claim-banner-classification-2026-09-22.md): of 41 banners in
 * 60 days, 32 were English false positives — the verb belonged to the
 * operator, a third party, a quote, a UI noun or an offer — and EVERY
 * banner-then-retry pair in that corpus was one of the 32. So the banner
 * promotes a repair only when `stillFlagged` (today's detector, replayed on
 * the original text) agrees; without a replay the harvest cannot tell a
 * fabrication from a false alarm and does not promote. The retracted pair
 * keeps its generic class and gains a label so the summary counts it.
 */
export function reclassifyByReply(
  hit: RepairMatch,
  replyText: string | null,
  stillFlagged?: (original: string) => boolean,
): RepairMatch {
  if (!replyText) return hit;
  const generic = hit.failureClass === "GENERIC" || hit.failureClass === "UNDER_RESEARCH";
  if (!generic) return hit;
  if (VERIFIER_BANNER.test(replyText)) {
    if (!stillFlagged || !stillFlagged(originalOfBannered(replyText))) {
      return { ...hit, label: `${hit.label}·verifier-banner-retracted` };
    }
    return { tier: "strong", failureClass: "FALSE_COMPLETION", label: "verifier-banner-then-retry" };
  }
  if (TOOL_UNAVAILABLE_REPLY.test(replyText.slice(0, 600))) {
    return { tier: "strong", failureClass: "NO_TOOL", label: "tool-unavailable-then-retry" };
  }
  return hit;
}

export function classifyRepair(text: string): RepairMatch | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;
  const short = isShortReply(trimmed);
  const plausibleLength = isPlausibleRepairLength(trimmed);
  for (const p of REPAIR_PATTERNS) {
    if (p.tier === "weak" && !short) continue;
    if (p.tier === "medium" && !plausibleLength) continue;
    if (p.pattern.test(trimmed)) {
      return { tier: p.tier, failureClass: p.failureClass, label: p.label };
    }
  }
  return null;
}

// ── Self-test · the positive control ─────────────────────────────────────

/**
 * Per `.claude/skills/positive-control-first`: a miner that returns zero is
 * indistinguishable from a miner that is broken, and "0 repairs found" is the
 * single most likely wrong answer this script can give. These fixtures make
 * the two distinguishable BEFORE any query runs.
 *
 * Both directions are asserted. MUST_MATCH proves the patterns fire;
 * MUST_ABSTAIN proves they are not merely matching prose — it contains the
 * literal weak-tier tokens ("no", "wrong") inside ordinary sentences.
 */
const MUST_MATCH: ReadonlyArray<[string, RepairClass]> = [
  ["you told me that already", "REPETITION"],
  ["stop recommending the same book", "REPETITION"],
  ["you didn't actually create the task", "FALSE_COMPLETION"],
  ["it's not there", "FALSE_COMPLETION"],
  ["that's not what I asked", "INSTRUCTION_MISS"],
  ["why didn't you search for it", "NO_TOOL"],
  ["did you even check", "NO_TOOL"],
  ["I already told you that", "MEMORY_MISS"],
  ["that's outdated", "STALE_DATA"],
  ["stop lecturing me", "OVERCOACHING"],
  ["that's shallow", "UNDER_RESEARCH"],
  ["that's too generic", "GENERIC"],
  ["you can do better than that", "GENERIC"],
  ["wrong tool", "WRONG_TOOL"],
  ["no", "GENERIC"],
  ["nope", "GENERIC"],
  // ── True positives from the 2026-09-22 production run ──
  // The one genuine repetition complaint in 2,795 messages. The first draft
  // matched it under MEMORY_MISS, which is why class assertions exist here.
  // The four generic repair phrasings are kept as spoken (they name no person,
  // place or private fact); the one that referred to a person is replaced by
  // a same-shape stand-in (review on #2480).
  ["I don't just want animated book summaries again", "REPETITION"],
  ["U aren't telling me anything I don't know already, try again", "UNDER_RESEARCH"],
  ["check again and give me a new list", "STALE_DATA"],
  ["the supplier changed, i just told you that", "MEMORY_MISS"],
  ["That's not what I asked for", "INSTRUCTION_MISS"],
];

const MUST_ABSTAIN: readonly string[] = [
  // Contains "no" — the weak tier must not reach inside prose.
  "no rush on this, whenever you get to it is fine",
  "there's no way we can fit that in before Friday, so let's push it",
  // Contains "wrong" as ordinary content, not a verdict on the reply.
  "the customer said the wrong tire size was on the invoice",
  // Ordinary approval and ordinary follow-up questions.
  "perfect, thanks",
  "what's the status on the Euclid Ave bay",
  "can you pull the numbers for last week",
  // Past-tense narration that merely resembles a complaint.
  "I told the supplier we needed them by Tuesday",

  // ── Measured false positives from the 2026-09-22 production run.
  // Every line below stands in for a candidate the first draft emitted from
  // real conversation, read by hand, and judged wrong. Precision was ~44% on
  // the tier labelled "near-certain" and ~20% on medium. They live here so the
  // same mistakes cannot return silently — the miner's own regression armor.
  //
  // SYNTHETIC BY RULE (review on #2480, 2026-09-22): the originals were the
  // operator's verbatim words and several carried personal content. Each line
  // keeps the SHAPE that fooled the matcher — the trigger phrase, the person,
  // the tense — with the private specifics replaced. A fixture that dropped
  // the trigger would pass trivially and guard nothing; these keep it.

  // CONTINUATION, not complaint. The sign-flip class: said while satisfied.
  // "dig deeper" and a bare "do better" were MUST_MATCH in the first draft —
  // they are here now because the corpus disagreed with that hypothesis, and
  // the fixtures follow the measurement rather than the other way round.
  "dig deeper",
  "do better",
  "Loving this so far, let's keep going and zoom in on the second point.",
  "Keep going, this is exactly the kind of thing I wanted.",
  "Go deeper on the second option.",
  "I keep going back to this, but also let's make the header darker and switch the theme.",
  // First-person narration — this operator converses, so past-tense
  // second-person address is ordinary speech, not correction.
  "OK so yesterday, like I told you after the trip, we went back to the shop.",
  "If the part hasn't shipped by Friday, I told you I'm getting impatient.",
  "Yeah, I feel a lot better about the numbers than I did this morning.",
  "Actually, let's keep exploring options I'd never find on my own.",
  // Self-directed "do better" / "same thing again" — about himself, not Nick.
  "like I know I can do better and all I can think about is the next quarter.",
  "Then two minutes later I'm telling myself the same thing again and eventually I forget.",
  // A pasted document, not a repair. Medium-tier patterns match content words,
  // so length is the discriminator — this was the last surviving medium-tier
  // false positive in the 2026-09-22 production run.
  "Nick's Tire & Auto: Forensic Brand Style Blueprint. Executive Summary. This document provides a forensic analysis of the brand, and every section should be more specific about voice, palette and typography so the guidance is generic enough to reuse across campaigns while remaining recognisably the shop's own. "
  + "Padding to exceed the six-hundred character medium-tier ceiling. ".repeat(6),
];

function runSelfTest(): number {
  let failures = 0;
  for (const [text, expected] of MUST_MATCH) {
    const hit = classifyRepair(text);
    if (!hit) {
      console.log(`  MISS  expected ${expected.padEnd(17)} got NOTHING   · "${text}"`);
      failures += 1;
    } else if (hit.failureClass !== expected) {
      console.log(
        `  CLASS expected ${expected.padEnd(17)} got ${hit.failureClass.padEnd(17)} · "${text}"`,
      );
      failures += 1;
    }
  }
  for (const text of MUST_ABSTAIN) {
    const hit = classifyRepair(text);
    if (hit) {
      console.log(
        `  FALSE+ expected NOTHING got ${hit.failureClass} (${hit.label}) · "${text}"`,
      );
      failures += 1;
    }
  }
  const total = MUST_MATCH.length + MUST_ABSTAIN.length;
  console.log(
    failures === 0
      ? `  OK · ${total}/${total} controls passed (${MUST_MATCH.length} fire, ${MUST_ABSTAIN.length} abstain)`
      : `  FAILED · ${failures}/${total} controls wrong`,
  );
  return failures;
}

// ── Candidate shape ──────────────────────────────────────────────────────

export interface RepairCandidate {
  id: string;
  failureClass: RepairClass;
  tier: RepairTier;
  label: string;
  conversationId: string;
  /** The assistant turn the operator was repairing. Null when none precedes it. */
  assistantMessageId: string | null;
  assistantPreview: string | null;
  assistantModel: string | null;
  /** The operator's repair, verbatim. */
  repairMessageId: string;
  repairText: string;
  repairedAt: string;
  /** Seconds between the reply and the repair — a fast repair is a stronger signal. */
  latencySeconds: number | null;
}

interface SourceReport {
  source: string;
  ok: boolean;
  error: string | null;
  /** Rows the source returned BEFORE matching — the denominator. */
  scanned: number;
}

interface HarvestReport {
  ranAt: string;
  windowDays: number;
  degraded: boolean;
  sources: SourceReport[];
  /** Total operator messages scanned. The denominator for every rate below. */
  operatorMessagesScanned: number;
  matchedByTier: Record<RepairTier, number>;
  matchedByClass: Record<string, number>;
  /** Matches with no preceding assistant turn — cannot become a scenario. */
  unpairable: number;
  candidates: RepairCandidate[];
}

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

/**
 * The only directory this script may write to. `.gitignore:87` ignores it, and
 * every candidate carries a conversation id plus verbatim operator and
 * assistant text — the most sensitive slice of the corpus by construction.
 */
export const HARVEST_OUT_DIR = "eval-datasets";
export const DEFAULT_OUT_PATH = `${HARVEST_OUT_DIR}/repair-signal-candidates.json`;

/**
 * Resolve `--out` and REFUSE anything outside eval-datasets/ (review on #2480):
 * the header's own example used to be `--out other.json`, accepted verbatim,
 * which put real conversation text in a TRACKED location one `git add` away
 * from a commit. Traversal (`eval-datasets/../x.json`), the directory itself
 * and absolute paths elsewhere are all refused; the default is always inside.
 */
export function resolveOutPath(raw: string | null, cwd: string = process.cwd()): string {
  const target = resolve(cwd, raw ?? DEFAULT_OUT_PATH);
  const rel = relative(resolve(cwd, HARVEST_OUT_DIR), target);
  const first = rel.split(/[\\/]/)[0];
  if (rel === "" || first === ".." || isAbsolute(rel)) {
    throw new Error(
      `--out must resolve inside ${HARVEST_OUT_DIR}/ (gitignored; the output carries verbatim conversation text): got "${raw}"`,
    );
  }
  return target;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  if (process.argv.includes("--self-test")) {
    console.log("\nharvest:repairs · self-test (no DB)\n");
    const failures = runSelfTest();
    process.exit(failures === 0 ? 0 : 1);
  }

  // After the self-test early-exit: --self-test touches no env and no DB.
  installScriptEnvironment();

  const windowDays = Number(arg("--days") ?? 120);
  const outPath = resolveOutPath(arg("--out"));

  console.log(`\nharvest:repairs · window ${windowDays}d`);
  console.log("=".repeat(60));

  // Self-test ALWAYS runs before a real harvest. If the matcher is broken,
  // the harvest's zero is meaningless and must not be written to disk as if
  // it were a reading.
  console.log("\npositive control:");
  if (runSelfTest() !== 0) {
    console.error("\nmatcher self-test FAILED — refusing to harvest, a zero would be unreadable.");
    process.exit(1);
  }

  // Loaded here, not at module scope: static imports hoist above the
  // server-only stub installed at the top of this file.
  const { prisma } = await import("@/lib/prisma");
  // Today's detector, replayed on the original text with no tool calls (the
  // banner turns that matter never fired one). A banner alone does not promote.
  const { detectActionClaimsWithoutTools } = await import("@/lib/ai/chat/action-claim-detector");
  const stillFlagged = (original: string) => detectActionClaimsWithoutTools(original, []).length > 0;
  let bannersRetracted = 0;

  const since = new Date(Date.now() - windowDays * 86_400_000);
  const sources: SourceReport[] = [];
  let rows: Array<{
    id: string;
    conversationId: string;
    role: string;
    content: string;
    model: string | null;
    createdAt: Date;
  }> = [];

  try {
    rows = await prisma.chatMessage.findMany({
      where: { createdAt: { gte: since } },
      select: {
        id: true,
        conversationId: true,
        role: true,
        content: true,
        model: true,
        createdAt: true,
      },
      orderBy: [{ conversationId: "asc" }, { createdAt: "asc" }],
    });
    sources.push({ source: "chat_messages", ok: true, error: null, scanned: rows.length });
  } catch (e) {
    // Fail LOUD and name the source, exactly as recall-corpus-builder does.
    // An unreachable table must never be indistinguishable from a clean corpus.
    sources.push({
      source: "chat_messages",
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      scanned: 0,
    });
  }

  const candidates: RepairCandidate[] = [];
  const matchedByTier: Record<RepairTier, number> = { strong: 0, medium: 0, weak: 0 };
  const matchedByClass: Record<string, number> = {};
  let operatorMessagesScanned = 0;
  let unpairable = 0;

  // rows are ordered by (conversationId, createdAt), so the previous row in
  // the SAME conversation is the turn a repair is repairing. Ordering by
  // createdAt alone would interleave conversations and pair a repair with a
  // stranger's reply.
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.role !== "user") continue;
    operatorMessagesScanned += 1;

    const operatorHit = classifyRepair(row.content);
    if (!operatorHit) continue;

    const prev = i > 0 ? rows[i - 1] : null;
    const paired =
      prev && prev.conversationId === row.conversationId && prev.role === "assistant"
        ? prev
        : null;
    if (!paired) unpairable += 1;

    // The reply can name a failure the operator's "try again" does not.
    const hit = reclassifyByReply(operatorHit, paired?.content ?? null, stillFlagged);
    if (hit.label.endsWith("verifier-banner-retracted")) bannersRetracted += 1;
    matchedByTier[hit.tier] += 1;
    matchedByClass[hit.failureClass] = (matchedByClass[hit.failureClass] ?? 0) + 1;

    candidates.push({
      id: `repair-${hit.failureClass.toLowerCase()}-${row.id.slice(-8)}`,
      failureClass: hit.failureClass,
      tier: hit.tier,
      label: hit.label,
      conversationId: row.conversationId,
      assistantMessageId: paired?.id ?? null,
      assistantPreview: paired ? paired.content.slice(0, 2000) : null,
      assistantModel: paired?.model ?? null,
      repairMessageId: row.id,
      repairText: row.content.slice(0, 2000),
      repairedAt: row.createdAt.toISOString(),
      latencySeconds: paired
        ? Math.round((row.createdAt.getTime() - paired.createdAt.getTime()) / 1000)
        : null,
    });
  }

  const degraded = sources.some((s) => !s.ok);
  const report: HarvestReport = {
    ranAt: new Date().toISOString(),
    windowDays,
    degraded,
    sources,
    operatorMessagesScanned,
    matchedByTier,
    matchedByClass,
    unpairable,
    candidates,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  // ── Report · every rate carries its denominator ──
  const totalMatched = matchedByTier.strong + matchedByTier.medium + matchedByTier.weak;
  console.log(`\noperator messages scanned:  ${operatorMessagesScanned}`);
  if (operatorMessagesScanned === 0) {
    console.log("repair rate:                 NO DATA (denominator is zero)");
  } else {
    const pct = (n: number) => `${((n / operatorMessagesScanned) * 100).toFixed(2)}%`;
    console.log(`matched (all tiers):        ${totalMatched}  ${pct(totalMatched)}`);
    console.log(`  strong:                   ${matchedByTier.strong}  ${pct(matchedByTier.strong)}`);
    console.log(`  banners retracted by replay: ${bannersRetracted}  (kept generic — a banner alone is not evidence)`);
    console.log(`  medium:                   ${matchedByTier.medium}  ${pct(matchedByTier.medium)}`);
    console.log(`  weak (short-reply only):  ${matchedByTier.weak}  ${pct(matchedByTier.weak)}`);
  }
  console.log(`unpairable (no prior reply): ${unpairable}`);
  console.log("\nby failure class:");
  for (const [k, v] of Object.entries(matchedByClass).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(18)} ${v}`);
  }
  console.log(`\nwrote ${candidates.length} candidates -> ${outPath}`);

  if (degraded) {
    console.error("\nDEGRADED — a source failed; this run is not a reading:");
    for (const s of sources.filter((x) => !x.ok)) console.error(`  · ${s.source}: ${s.error}`);
    // Non-zero for the same reason harvest-eval-corpus exits non-zero:
    // a stopped flywheel must not read as a healthy one.
    process.exit(1);
  }
}

/**
 * Only run when invoked directly. Without this, importing the file to unit-test
 * `classifyRepair` would execute main() — which queries production.
 */
const entry = (process.argv[1] ?? "").replace(/\\/g, "/");
if (entry.endsWith("scripts/harvest-repair-signals.ts")) {
  main().catch((e) => {
    console.error("harvest:repairs crashed:", e);
    process.exit(1);
  });
}
