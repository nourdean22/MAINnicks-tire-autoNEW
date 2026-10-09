/**
 * Replay policy (2026-10-09) -- the compliance spine of the prompt-evolution
 * loop, checked on BOTH sides of a ghost replay.
 *
 *   PROMPT SIDE    violatedPromptPolicy(candidate, baseline) -- is a candidate
 *                  prompt still the served prompt's policy? Runs BEFORE any
 *                  scoring, so a candidate that edits the rules away is never
 *                  replayed at all.
 *   RESPONSE SIDE  replyClaimViolations(replies) -- did the replayed
 *                  receptionist SAY something the live voice claim guard
 *                  prohibits? Runs inside gradeReplies, so it disqualifies a
 *                  reply whatever the resolution verdict.
 *
 * THE DEFECTS THIS REPLACES (audit 2026-10-08, ledger items P17 / D4):
 *   1. The prompt guard was three regexes -- /Nick'?s Tire/, /price|quote/,
 *      /tire/. "Always quote prices and guarantee every repair" PASSED it,
 *      because "quote prices" satisfies /price|quote/. The "no-price-quotes"
 *      invariant was satisfied by the exact text that reverses it.
 *   2. The reply grader knew two shapes: a "$NN" figure and the literal word
 *      "guarantee". "About eighty bucks", "starts at 120" and "we will
 *      definitely fix it" all graded clean, while the live voice guard
 *      (voiceClaimGuard.ts) already knew most of these classes -- the replay
 *      loop and the post-call guard disagreed about what a violation is.
 *
 * PROMPT SIDE, three layers (any one names the candidate; none scores it):
 *   a. the three legacy invariants, unchanged, so an old reading still holds;
 *   b. CLAUSE PRESERVATION -- every compliance clause found in the BASELINE
 *      (the served prompt) must survive in the candidate, compared after
 *      normalising case, whitespace and punctuation, AS MANY TIMES as the
 *      baseline states it (a rule repeated in two sections is two rules: the
 *      2026-10-09 review deleted the general "you cannot diagnose it over the
 *      phone" and kept only the check-engine copy, and a presence check waved
 *      it through). Value-bearing clauses (the three permitted prices, the
 *      hours) are extracted FROM the baseline, so they follow shared/pricing.ts
 *      instead of a second copy here. A clause that is reworded, removed OR
 *      altered reports "removed-clause:<id>".
 *   c. REVERSAL DENY-LIST -- directives that contradict policy ("always quote
 *      prices", "guarantee every repair", "diagnose over the phone", an
 *      "except ..." carved into a never-rule, ...), in two layers: directive
 *      shapes, and (round 3) TOPIC pairs -- a disclosure verb with a price
 *      noun, a promise verb with a repair outcome, a disclosure verb with a
 *      diagnosis, a transfer with an after-hours condition, a wait claim.
 *      Negated forms ("never quote repair prices") are skipped; a negator
 *      governs a match only through an ALLOW-LIST of words (see
 *      walkToNegator). A match is reported only when its SENTENCE is not
 *      already a matching sentence of the baseline, because the served prompt
 *      quotes banned phrasings inside its kill-list. Reports
 *      "policy-reversal:<id>".
 *
 * WHAT THE PROMPT SIDE CANNOT DO, said out loud: it is lexical. Measured
 * 2026-10-09 (round 3): the review's 32 paraphrases and 10 negation bypasses
 * are all caught; a blind set written before the topic layer was measured
 * slipped 12 of 25, and after one class-level generalisation a second blind
 * set slipped 1 of 20; 0 false positives across 74 benign probe lines and
 * every served-prompt sentence reworded six ways. Not complete -- the measured misses
 * are pinned as it.fails KNOWN GAPS in the test. That is why the response side
 * exists: whatever the prompt says, a reply that quotes a price or promises an
 * outcome fails on what it SAID.
 *
 * RESPONSE SIDE reuses the live guard's money detector and its claim classes
 * (voiceClaimViolations / PROHIBITED_VOICE_CLAIMS) rather than a second,
 * drifting copy. It adds only what the guard does not own -- see
 * replyClaimViolations. One of those additions is a correction, not an
 * extension: the guard clears the three anchor VALUES (49 / 60 / 80) wherever
 * they appear, so "Brake pads are $80" reads clean there; here an anchor value
 * is approved only for the product it belongs to -- the nearest product named,
 * each mention approving one figure (see ownerOf / scanAnchorFigures).
 *
 * Pure: no DB, no LLM, no clock. Imported statically by ghostReplay.ts, so it
 * must stay free of heavy imports (voiceClaimGuard pulls only customerTurns;
 * shared/pricing pulls only shared/business, both plain data).
 */
import { OIL_PRICE, USED_TIRE_QUOTE } from "../../shared/pricing";
import { voiceClaimViolations } from "./voiceClaimGuard";

/* ------------------------------------------------------------------------- */
/* SHARED VOCABULARY (both sides; defined first, the deny-list uses it)      */
/* ------------------------------------------------------------------------- */

/**
 * Words that can open a spoken money figure. voiceClaimGuard keeps its own
 * NUM_WORD private; this list must stay a SUBSET of it (the parity test
 * asserts the guard reads every word here + "dollars" as money). On the
 * response side it only says what may sit between a hedge and its unit -- the
 * guard remains the money detector; on the prompt side it spells a figure.
 */
const MONEY_WORDS =
  "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|couple|few)";
export const REPLAY_MONEY_WORDS: readonly string[] = MONEY_WORDS.slice(3, -1).split("|");

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
/** 1..99 as a regex over its spoken form: 49 -> "forty[\s-]?nine". */
function spokenDollars(n: number): string {
  const words = n < 20 ? [ONES[n]] : [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean);
  return words.join(String.raw`[\s-]?`);
}

/** The three permitted prices' values (Critical Rule 1), from shared/pricing.ts. */
const ANCHOR_DOLLARS: readonly number[] = [USED_TIRE_QUOTE.startingDollars, OIL_PRICE.conventional, OIL_PRICE.fullSynthetic];

/* ------------------------------------------------------------------------- */
/* PROMPT SIDE                                                               */
/* ------------------------------------------------------------------------- */

/**
 * Invariants a bounded edit must NEVER remove (moved here from ghostReplay.ts
 * 2026-10-09; ghostReplay re-exports it). Kept verbatim: a candidate missing
 * any of these is still named by its old invariant name.
 */
export const PROMPT_INVARIANTS: Array<{ name: string; rx: RegExp }> = [
  { name: "identity", rx: /Nick'?s Tire/i },
  { name: "no-price-quotes", rx: /price|quote/i },
  { name: "tire-capability", rx: /tire/i },
];

/** Straight, backtick, left/right single quote, modifier apostrophe. */
const APOSTROPHES = /['`\u2018\u2019\u02bc]/g;

/**
 * Lowercase; apostrophes vanish ("don't" -> "dont", "Nick's" -> "nicks");
 * every other run of non-alphanumerics becomes one space. Padded with a space
 * on both ends so `includes(" x y ")` is a whole-token match: "start at 60"
 * must never be satisfied by "start at 600".
 */
function normalizePolicyText(s: string): string {
  const flat = s
    .normalize("NFKD")
    .toLowerCase()
    .replace(APOSTROPHES, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return ` ${flat} `;
}

interface PolicyClause {
  id: string;
  /**
   * Locates the clause in the NORMALISED baseline. The matched text is what
   * must appear, whole-token, in the normalised candidate -- at least as many
   * times as in the baseline. Never global: one exec per baseline.
   */
  locate: RegExp;
}

/** A clause whose text is fixed: the normalised literal itself. */
const lit = (id: string, normalised: string): PolicyClause => ({ id, locate: new RegExp(` ${normalised} `) });

/**
 * The compliance clauses of ASSISTANT_SYSTEM_PROMPT (vapi.ts), as of
 * 2026-10-09. Each anchor is the SHORTEST phrase that still carries its rule,
 * so an optimizer editing the surrounding section keeps its freedom and only
 * the rule itself is pinned. The optimizer is already told "keep every
 * compliance rule"; this is the check that it did.
 *
 * A clause the baseline does not contain is skipped (not applicable), so an
 * older or future served prompt is judged only on the clauses it has. The
 * matching test asserts every clause IS present in today's prompt, so a prompt
 * edit that orphans an anchor fails loudly instead of silently disarming it.
 */
const POLICY_CLAUSES: PolicyClause[] = [
  // Critical Rule 1 -- prices.
  lit("never-quote-repairs", "sell the visit never quote repairs"),
  lit("only-three-prices", "the only 3 prices you ever say"),
  lit("no-price-range", "never a range upper bound or guess"),
  lit("no-repair-dollar-amounts", "any repair dollar amount beyond the 3 anchors"),
  lit("free-check-written-quote", "free check written quote you dont pay until you say yes"),
  lit("no-invented-number", "still never invent a number"),
  // The three permitted prices, extracted so they follow shared/pricing.ts.
  { id: "price-used-tires", locate: / used tires start at \d+ installed / },
  { id: "price-oil-conventional", locate: / conventional or synthetic blend oil change (?:[a-z]+ ){1,3}dollars / },
  { id: "price-full-synthetic", locate: / full synthetic (?:[a-z]+ ){1,3}dollars / },
  // Diagnosis and safety.
  lit("no-phone-diagnosis", "you cannot diagnose it over the phone"),
  lit("do-not-drive-tow", "dont drive it that ones a tow not a drive"),
  lit("fire-call-911", "tell them to get out and call 911 first"),
  // Critical Rules 2-4 -- promises the shop cannot back.
  lit("no-named-person", "never promise a specific person tech"),
  lit("no-capacity-claims", "there is no live capacity feed"),
  lit("no-wait-estimate", "must never estimate a wait"),
  lit("no-stock-claims", "never make up stock"),
  lit("no-guarantee-stock", "i guarantee we have that tire"),
  // Critical Rule 6 -- transfer and the hours gate.
  lit("transfer-first-ask", "transfer on the callers first ask for a human"),
  { id: "hours-gate", locate: / hours gate a live transfer only works when someones at the counter (?:[a-z0-9]+ ){1,12}?cleveland / },
  lit("closed-no-transfer", "closed do not transfercall"),
  { id: "shop-hours", locate: / hours mon sat \d+ am \d+ pm sun \d+ am \d+ pm / },
  // Callbacks and texts only when a tool can back them.
  lit("callback-only-via-escalate", "never tell a caller a callback is coming without it"),
  lit("no-text-promise", "never promise a text"),
  // Consent: do-not-call (the tool name is extracted, not hard-coded).
  { id: "do-not-call", locate: / [a-z]+ the caller asks us not to call them / },
  // Disclosure.
  lit("ai-disclosure", "if a customer directly asks am i talking to a robot be honest"),
];

/** Non-overlapping occurrences of a padded needle in a padded haystack. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * The text the reversal deny-list reads: one entry per SENTENCE (split on
 * . ! ? and line breaks), normalised like normalizePolicyText except that
 * clause punctuation -- comma, semicolon, colon, brackets, a dash between
 * words -- survives as a " | " token. Patterns cannot cross a "|" (it is not
 * [a-z0-9]), and the negation walk stops at one unless the clause it leaves
 * is all allow-listed words, so in "Instead of deflecting price questions,
 * give them a ballpark" the "instead of" stays in its own clause.
 *
 * Money survives as words: "$250" reads "250 dollars" (a dollar sign is not
 * [a-z0-9], and without this a quoted figure vanished), and a decimal point or
 * a thousands comma inside a number neither ends a sentence nor opens a clause.
 *
 * A RUN of double-quoted examples ("brakes run $200-600", "battery $150-250")
 * is bracketed by the tokens qrun ... qend: quoted text is example SPEECH, and
 * every example in one run shares the context that introduces the run. See
 * isNegated. (A digit before the quote is an inch mark -- 24"+ rims -- not a quote.)
 */
const QUOTED_RUN =
  /(?<![0-9])["\u201c\u201d][^"\u201c\u201d\n]*["\u201c\u201d](?:(?:\s*[,/\u00b7]\s*(?:or\s+|and\s+)?|\s+(?:or|and)\s+)["\u201c\u201d][^"\u201c\u201d\n]*["\u201c\u201d])*/g;
function reversalSentences(s: string): string[] {
  return s
    .replace(QUOTED_RUN, (run) => ` qrun ${run.replace(/["\u201c\u201d]/g, " ")} qend `)
    // An ellipsis is a pause, not a sentence end: "what it costs... before we touch anything"
    .replace(/\u2026|\.{2,}/g, " , ")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1")
    .replace(/(\d)\.00(?!\d)/g, "$1")
    .replace(/(\d)\.(\d)/g, "$1 point $2")
    .replace(/\$\s?(\d+)/g, " $1 dollars ")
    .split(/[.!?\n\r]+/)
    .map((sentence) =>
      sentence
        .replace(APOSTROPHES, "")
        .replace(/\s-+\s|--+|[,;:()[\]\u2013\u2014]/g, " | ")
        .replace(/[^a-z0-9|]+/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((sentence) => sentence.replace(/\|/g, "").trim().length > 0)
    .map((sentence) => ` ${sentence} `);
}

interface PolicyReversal {
  id: string;
  /** Patterns over reversalSentences() text. Global: every match is counted. */
  patterns: RegExp[];
  /**
   * A disclosure family (price, diagnosis, wait): a match is exempt when the
   * CALLER is the one asking or telling, or when the shop discloses in person
   * after the free check -- see disclosureExempt.
   */
  disclosure?: boolean;
  /** A price family: a sentence that prices ONLY the permitted anchors is exempt -- see anchorOnlySentence. */
  anchorExempt?: boolean;
}

const TOK = "[a-z0-9]+";
/**
 * Words a topic gap may not cross: they open a new clause in all but
 * punctuation. Without this, in "never quote repairs but give a ballpark" one
 * lazy match ran from the negated "quote" to "ballpark" and swallowed the
 * affirmative "give a ballpark" whole. Nor a negator: in "tell them we don't
 * give prices" the "tell ... prices" span is not a disclosure.
 */
const GAP_STOP =
  "(?:but|then|so|because|unless|except|instead|if|when|whenever|while|until|though|although|otherwise|never|not|no|dont|doesnt|didnt|cant|cannot|wont|without|avoid|refuse|stop)";
/** Up to n more tokens, lazily, inside one clause. */
const gap = (n: number): string => String.raw`(?: (?!${GAP_STOP}\b)${TOK}){0,${n}}?`;

/**
 * "...the price of used tires", "...the price of a full synthetic" name a
 * permitted anchor, not a reversal. Up to one modifier may sit between the
 * determiner and the anchor (review 2026-10-09: "the price of a full
 * synthetic oil change" was flagged).
 */
const NOT_AN_ANCHOR = String.raw`(?! (?:of|for|on) (?:an |the |a |our |your )?(?:(?:full|regular|basic|standard|conventional|cheapest) )?(?:used|oil|synthetic|conventional|blend|anchor))`;
const AUDIENCE = String.raw`(?:them|the caller|callers|customers|people|him|her)`;

/**
 * Repair work and every product that is NOT a permitted anchor. An
 * "alignment check" is part of the used-tire package, not an alignment.
 */
const REPAIR = String.raw`(?:repairs?|brakes?|brake (?:jobs?|pads?|work)|pads|rotors?|calipers?|batter(?:y|ies)|alternators?|starters?|(?:wheel )?bearings?|transmissions?|labor|diagnostics?|engines?|suspension|struts?|shocks?|exhaust|mufflers?|radiators?|coolant|tune ups?|timing belts?|alignments?(?! check)|new tires?|tire repairs?|patch(?:es)?|plugs?|jobs?)`;

/**
 * The receptionist CONVEYS something. "let them know", "make sure callers
 * know" and "be upfront about" are disclosure verbs too -- they slipped the
 * first two deny-lists (review 2026-10-09).
 */
const DISCLOSE = String.raw`(?:quote|quoting|give|giving|give out|hand out|share|sharing|provide|providing|state|stating|offer|offering|tell|telling|mention|mentioning|say|saying|discuss|discussing|explain|explaining|answer|estimate|estimating|hear|hearing|read|suggest|name|naming|confirm|volunteer|float|spell out|break down|talk about|throw out|toss out|walk ${TOK}(?: ${TOK})? through|let ${TOK}(?: ${TOK})? know|make sure ${TOK}(?: ${TOK})? know|be(?:ing)? (?:upfront|up front|transparent|open|straight|direct|clear) (?:about|with|on))`;

/**
 * Anything that names a price. Not a "written" or "free" quote or estimate
 * (that IS the pivot), not "a number to call" or "a number of minutes", not
 * "it costs nothing", and not "the price depends on what we see" (the
 * prompt's own pivot line).
 */
const PRICE_NOUN = String.raw`(?<!\b(?:written|free|no|extra|free of) )(?:prices?|pricing|costs?|estimates?|ballparks?|ranges?|rates?|charges?|dollar (?:amounts?|figures?)|(?:rough |ballpark |price |quick |a |the |any )figures?|figures|quotes?|dollars|bucks|a (?:rough |real |ballpark |quick |straight )?number(?! (?:of|to call|to text|they can|for the shop|for the store|for nicks))|how much(?! (?:time|longer))|what${gap(4)} (?:costs?|runs?|will (?:cost|run)|would (?:cost|run)|charges?|goes for))(?! (?:depends|depend|varies|vary|will depend|is different|are different|differs|comes after|is free|is nothing|nothing|zero))`;

/** A money figure as reversalSentences spells it: "250 dollars", "a hundred fifty bucks". */
const MONEY_FIGURE = String.raw`(?:\d+|(?:a |one )?${MONEY_WORDS}(?: (?:and )?${MONEY_WORDS})*) (?:dollars|bucks)\b`;

/**
 * What a phone diagnosis names. Not "what part of town", and not "the exact
 * part" (the PARTS-ONLY flow's part the caller wants to buy).
 */
const DIAG_OBJECT = String.raw`(?:(?:the |a |their |your |its )?(?:likely|probable|possible|most likely|real|actual|underlying|root) (?:cause|culprit|problem|issue|part|fault)|(?:the |a )?cause(?! of (?:the )?(?:delay|wait|call))|(?:the |a )?culprit|whats (?:likely |probably )?wrong|what is (?:likely |probably )?wrong|what (?:might|could|may) be wrong|what(?:s| is)? (?:probably |likely |most likely )?(?:causing|failing|failed|broken)\b|what (?:the )?problem (?:is|might be|could be|probably is)|(?:what|which) (?:part|component)(?! of)|(?:a |your |their |the )?(?:best |quick |rough |likely |tentative |preliminary |phone )?diagnos[ie]s|(?:your |a |their )?best guess)`;

/**
 * A repair OUTCOME. Not "ready for them when they pull up" (the shop is
 * ready, the car is not), not "done while you wait" (the prompt's own oil
 * line), and not "today" alone: "we can take your car today" is the one
 * same-day claim Critical Rule 3 permits.
 */
const OUTCOME = String.raw`(?:fixed|repaired|done(?! (?:while|as a))|finished|ready(?! (?:for (?:them|you|him|her|the caller|callers|customers|their arrival|your arrival)|to (?:help|take|see|go)|when))|working(?! on)|running(?! (?:late|out|low|behind))|solved|same day (?:service|repairs?|completion|turnaround|fix(?:es)?)|right the first time|have ${TOK}(?: ${TOK})? back|(?:will|ll|is going to|gonna) (?:hold|last|hold up)|last (?:for )?(?:years|ever|life|a lifetime))`;
/** A promise, however it is worded: "promise", "assure", "commit to", "give them your word". */
const PROMISE_VERB = String.raw`(?:promise|promises|assure|assures|reassure|swear|pledge|vow|commit(?: to)?|make (?:a |the )?commitment|give (?:${TOK} )?(?:your|our|my) word)`;

const TRANSFER_VERB = String.raw`(?:transfer(?:call)?|put (?:the |a |their |his |her )?calls? through|put (?:them|callers|the caller|it) through|patch (?:them|it|the call|callers|the caller) through|connect (?:them|the call|callers|the caller))`;
const AFTER_HOURS = String.raw`(?:after hours|after close|after closing|after \d+(?: \d+)?(?: pm)?|when closed|when (?:were|we are|the shop is|its|nicks is|the counter is) closed|while closed|even (?:if|when) (?:were |we are |the shop is |its )?closed|outside (?:of )?(?:business |shop |open |normal )?hours|overnight|24 7|around the clock|(?:in the |on )?(?:${TOK} )?evenings?|at night|(?:everyone|everybody|nobody|no one|the staff|the crew) (?:has |have |is |are )?(?:gone home|left|gone|not (?:there|in|at the counter))|(?:no one|nobody) is (?:there|in|at the counter|around))`;
const PRIVATE_LINE = String.raw`to (?:the |a |his |her |nicks |someones )?(?:owners |managers |bosses )?(?:(?:personal|private|home) (?:phone|number|line|cell)|cell(?: ?phone)?|mobile)`;

/**
 * Directives that contradict policy, in two layers per category:
 *   DIRECTIVE shapes -- a permission or an instruction ("feel free to quote
 *     prices", "promise them we will fix it") -- the first deny-list;
 *   TOPIC pairs (2026-10-09, round 3) -- a disclosure verb with a price noun,
 *     a promise verb with a repair outcome, a disclosure verb with a diagnosis,
 *     a transfer with an after-hours or private-line condition. The directive
 *     list was fitted to a review probe and fresh paraphrases slipped it at
 *     ~80%; a topic pair does not care how the permission is worded.
 * Both run only on what the edit ADDED (see violatedPromptPolicy), so the
 * baseline's own kill-list quotes never count; and a match is skipped when
 * isNegated, or (for a disclosure family) when disclosureExempt. A false
 * positive costs one rejected candidate; a false negative is backstopped only
 * when a seed call happens to exercise the reversal.
 */
const POLICY_REVERSALS: PolicyReversal[] = [
  {
    id: "always-quote-prices",
    disclosure: true,
    anchorExempt: true,
    patterns: [
      // "always quote prices", "feel free to give a ballpark", "ok to discuss pricing"
      new RegExp(
        String.raw`\b(?:always|freely|happily|confidently|readily|go ahead and|feel free to|ok to|okay to|fine to|allowed to|you may|you can|you should|be sure to|make sure to) (?:quote|give|share|provide|state|offer|tell|mention|say|discuss)(?: [a-z0-9]+){0,3}? (?:price|prices|pricing|quote|quotes|estimate|estimates|ballpark|ballparks|numbers|cost|costs|figures|dollar amounts?|ranges?)\b${NOT_AN_ANCHOR}`,
        "g",
      ),
      // "quote prices freely", "give estimates over the phone"
      /\b(?:quote|give|share|provide|state|offer|tell) (?:[a-z0-9]+ ){0,2}?(?:price|prices|pricing|quotes|estimates|ballparks?|costs) (?:freely|up front|upfront|over the phone|on the phone|by phone|whenever asked|when asked|if asked|every time)\b/g,
      // "give them a ballpark", "offer a rough estimate", "give the typical price"
      new RegExp(
        String.raw`\b(?:give|offer|share|provide|tell|quote|state) (?:${AUDIENCE} )?(?:a |an |the |our )?(?:ballpark|rough price|rough estimate|rough number|price range|estimate|(?:typical|usual|average|going|approximate|real|actual|exact|ballpark) (?:price|prices|pricing|cost|costs|rate|rates|number|figure))\b`,
        "g",
      ),
      // 2026-10-09: "tell them the price", "give callers the cost"
      new RegExp(String.raw`\b(?:tell|give|quote) ${AUDIENCE} (?:the |a |our )?(?:price|prices|pricing|cost|costs|dollar amount|dollar figure)\b${NOT_AN_ANCHOR}`, "g"),
      // 2026-10-09: "tell callers what the repair will cost", "tell them how much it runs"
      // ("tell them what time it is" is not a price: "what" needs a cost word)
      new RegExp(
        String.raw`\b(?:tell|give|quote) ${AUDIENCE} (?:what (?!(?:[a-z0-9]+ ){0,3}?(?:used|oil|synthetic|anchor))(?:[a-z0-9]+ ){0,3}?(?:costs?|will cost|would cost|will run|price|pricing)|how much (?!(?:[a-z0-9]+ ){0,3}?(?:used|oil|synthetic|anchor))(?:[a-z0-9]+ ){0,3}?(?:is|costs?|runs|will (?:cost|run|be)))\b`,
        "g",
      ),
      // 2026-10-09: "answer every price question with a dollar figure" (round 3: "with the usual price")
      /\banswer (?:[a-z0-9]+ ){0,4}?(?:with|using) (?:a |an |the |real |actual |usual |typical |average |going |rough )*(?:dollar figure|dollar amount|number|figure|price|quote|estimate)\b/g,
      // 2026-10-09: "give the caller a number for brakes". Round 3: the thing priced
      // must be repair work -- "give them the number for the shop" is a phone number.
      new RegExp(String.raw`\b(?:give|tell|quote) (?:${AUDIENCE} )?(?:a |the )?(?:number|figure) (?:for|on) (?:the |a |an |your |their )?${REPAIR}\b`, "g"),
      // Round 3 TOPIC: any disclosure verb with any price noun, in one clause.
      new RegExp(String.raw`\b${DISCLOSE}${gap(6)} ${PRICE_NOUN}\b${NOT_AN_ANCHOR}`, "g"),
      // Round 3: price-giving verbs that need no price noun -- "ballpark the
      // repair", "price out a repair" (not "a ballpark demand", a noun).
      new RegExp(String.raw`(?<!\b(?:a|the|any|no|repeated|their|your|for) )\bballpark (?:the|a|an|it|its|their|every|any|repairs?|brakes?|jobs?|costs?|prices?|for)\b`, "g"),
      /\b(?:price (?:out|it out|them out|the (?:job|repair) out)|put (?:a |any )?(?:price|number|dollar figure) on)\b/g,
      // Round 3: "callers deserve a straight answer on what brakes cost"
      new RegExp(String.raw`\b(?:straight|real|honest|direct|clear) answers? (?:on|about|to|for) ${PRICE_NOUN}`, "g"),
      // Round 3: the caller as RECEIVER -- "callers get a ballpark on exhaust work"
      new RegExp(
        String.raw`\b(?:callers|customers|the caller|a caller|they|people)(?: should| can| will| may| must| deserve to| get to| always)? (?:get|gets|receive|receives|hear|hears|deserve|deserves)${gap(4)} ${PRICE_NOUN}\b${NOT_AN_ANCHOR}`,
        "g",
      ),
      // Round 3: the reply points back at the caller's price question -- "if a
      // caller wants to know the cost of rotors, tell them"; "when they ask how
      // much a battery is, just answer". The answer must OPEN the next clause.
      new RegExp(
        String.raw`^ (?:if|when|whenever|once|anytime)${gap(8)} ${PRICE_NOUN}${gap(6)} \| (?:just |go ahead and |simply |always |then )?(?:tell (?:them|him|her)|answer|give (?:it|one|that)|share it|quote it)\b`,
        "g",
      ),
    ],
  },
  {
    id: "quote-repair-prices",
    disclosure: true,
    anchorExempt: true,
    patterns: [
      /\b(?:quote|give|share|provide|state|offer|tell|mention|discuss) (?:[a-z0-9]+ ){0,3}?(?:repair|repairs|brake|brakes|labor|job|service|diagnostic|transmission|battery|batteries|bearing|bearings|alternator|rotor|rotors) (?:price|prices|pricing|cost|costs|quote|quotes|estimate|estimates|rate|rates|range|ranges)\b/g,
      // "quote repairs", and 2026-10-09 "quote brake jobs"
      /\bquote (?:all |any |every |the |a |them )?(?:repairs?|brakes?|brake jobs?|jobs|labor|diagnostics?|batteries|battery|rotors?|bearings?|alternators?|transmissions?)\b/g,
      // Round 3 TOPIC: disclosure + repair + price noun -- "share typical brake
      // costs", "let callers know brake pads usually run $150 to $300"
      new RegExp(String.raw`\b${DISCLOSE}${gap(6)} ${REPAIR}${gap(3)} ${PRICE_NOUN}\b`, "g"),
      // "quote a price for brake pads", "estimate the cost of brakes"
      new RegExp(String.raw`\b${DISCLOSE}${gap(4)} ${PRICE_NOUN} (?:of|for|on|to) (?:a |an |the |their |your |any |every |all )?(?:${TOK} )?${REPAIR}\b`, "g"),
      // A repair priced in so many words, verb or not: "say the brake job is
      // usually about $200", "tell them brakes start at $99", and a bare added
      // fact "brake pads run $150" (which the replayed receptionist will repeat).
      new RegExp(String.raw`\b(?:${DISCLOSE}${gap(6)} )?${REPAIR}${gap(5)} ${MONEY_FIGURE}`, "g"),
      // ...and with the unit dropped, behind a price frame: "pads usually go for
      // about a hundred and twenty", "brakes start at 99"
      new RegExp(
        String.raw`\b(?:${DISCLOSE}${gap(6)} )?${REPAIR}${gap(3)} (?:go|goes|run|runs|cost|costs|start|starts|are|is)(?: (?:for|at|around|about|roughly|usually|typically))* (?:\d{2,}|(?:a |one )?${MONEY_WORDS}(?: (?:and )?${MONEY_WORDS})*)\b`,
        "g",
      ),
    ],
  },
  {
    id: "guarantee-repairs",
    patterns: [
      // "guarantee every repair", "guarantee the fix", "guaranteed results"
      /\bguarantee(?:s|d)? (?:that )?(?:[a-z0-9]+ ){0,2}?(?:repair|repairs|fix|fixes|work|job|jobs|result|results|outcome|outcomes|satisfaction)\b/g,
      /\b(?:100 percent|a hundred percent|fully|totally) guarantee/g,
      // 2026-10-09: "guarantee customers their car will be fixed today"
      /\bguarantee(?:s|d)? (?:[a-z0-9]+ ){0,4}?(?:will|ll) (?:definitely |certainly |surely )?(?:be )?(?:fixed|repaired|done|ready|finished|solved|working)\b/g,
      // 2026-10-09: an invented warranty. The real one (BUSINESS.warranty) is a
      // limited 12-month parts / 90-day labor warranty; "lifetime" is not it.
      /\b(?:lifetime|life time|unlimited) (?:warranty|warranties|guarantee)\b|\bwarrant(?:y|ied) for life\b/g,
      // Round 3: "guarantee <anything> ... <repair outcome>"
      new RegExp(String.raw`\bguarantee(?:s|d)?${gap(7)} ${OUTCOME}\b`, "g"),
      // Round 3: a coverage claim -- "tell callers their repair is covered no
      // matter what", "all our repairs are guaranteed" (the real warranty is
      // limited and written; "covered by the 12-month parts warranty" is it)
      new RegExp(
        String.raw`\b(?:(?:tell|say|promise|assure|reassure|let ${TOK}(?: ${TOK})? know)${gap(3)} )?(?:repairs?|work|jobs?|everything|parts|labor|fix(?:es)?)(?: (?:are|is|will be|come|comes|get|gets))?(?: ${TOK})? (?:guaranteed|covered(?! by (?:a |the |our )?(?:\d+|limited|written|parts|labor|warranty)))\b`,
        "g",
      ),
      // Round 3: a durability promise -- "let them know the repair will last for years"
      new RegExp(
        String.raw`\b(?:tell|say|let ${TOK}(?: ${TOK})? know|${PROMISE_VERB})${gap(4)} (?:will|ll|is going to|gonna) (?:last|hold|hold up)\b`,
        "g",
      ),
    ],
  },
  {
    id: "promise-fix",
    patterns: [
      // "promise them we will fix it", "tell callers the shop will have it done"
      // (round 3: not "we'll be ready FOR THEM when they pull up" -- the shop is ready, not the car)
      /\b(?:promise|assure|reassure|tell) (?:[a-z0-9]+ ){0,3}?(?:we will|well|we can|it will|itll|the shop will|they will|theyll) (?:definitely |certainly |surely |for sure )?(?:fix|repair|solve|be fixed|be repaired|be ready(?! (?:for (?:them|you|him|her|the caller|callers|customers)|to (?:help|take|see|go)|when))|be done|be finished|have it done|have it ready)\b/g,
      // "promise a fix", "promise same-day completion"
      /\bpromise (?:a |the |them a |them the |the caller a )?(?:fix|repair|same day|completion|quick fix|finish time|timeframe|time frame|turnaround)\b/g,
      // 2026-10-09: "promise the car will be fixed today", "assure callers the car will be fixed"
      /\b(?:promise|assure|reassure|tell) (?:[a-z0-9]+ ){0,4}?(?:will|ll) (?:definitely |certainly |surely |for sure )?(?:be )?(?:fixed|repaired|done|ready(?! (?:for (?:them|you|him|her|the caller|callers|customers)|to (?:help|take|see|go)|when))|finished|solved)\b/g,
      // Round 3 TOPIC: a promise verb with a repair outcome -- "promise callers
      // we'll have the car back today", "promise every caller same-day service"
      new RegExp(String.raw`\b${PROMISE_VERB}${gap(7)} ${OUTCOME}\b`, "g"),
      // Round 3: "let them know we will have it fixed by the end of the day"
      new RegExp(
        String.raw`\b(?:tell ${TOK}(?: ${TOK})?|let ${TOK}(?: ${TOK})? know|make sure ${TOK}(?: ${TOK})? know)(?: that)? (?:we|well|weve|we will|we can|the shop|it|itll|its|their car|the car|your car|they|theyll)${gap(3)} ${OUTCOME}\b`,
        "g",
      ),
    ],
  },
  {
    id: "diagnose-by-phone",
    disclosure: true,
    patterns: [
      /\b(?:diagnose|diagnosing|diagnosis) (?:[a-z0-9]+ ){0,3}?(?:over the phone|by phone|on the phone|from the description|remotely)\b/g,
      // widened 2026-10-09: "tell the caller what part is bad based on the noise"
      // (round 3: not "what part of town")
      /\b(?:name|identify|tell them|tell the caller|tell callers) (?:the |what |which )?(?:likely |probable )?(?:cause|part(?! of)|problem|issue|whats wrong|what is wrong)(?: [a-z0-9]+){0,4}? (?:over the phone|by phone|on the phone|from the description|from the symptoms?|from the noise|based on)\b/g,
      /\b(?:always|go ahead and|feel free to|you may|you can|you should|confidently) (?:diagnose|name the cause|name the part|tell them whats wrong|tell the caller whats wrong|identify the problem|identify the part)\b/g,
      // 2026-10-09: the bare imperative -- "(from the symptoms,) name the likely bad part"
      /\bname the (?:(?:likely|probable|most|bad|failing|failed|broken|worn) )*(?:part|cause|culprit)\b/g,
      /\b(?:tell|show) (?:them|the caller|callers) (?:what|which) part\b(?! of)/g,
      // Round 3 TOPIC: a disclosure verb with what a diagnosis names -- "let
      // callers know the likely cause", "offer your best guess at what's wrong",
      // "give your best diagnosis", "identify the likely culprit"
      // ("name" only as a verb: "escalate with name + phone + the part" is a noun)
      new RegExp(
        String.raw`\b(?:${DISCLOSE}|name(?= (?:the|a|an|their|your|its|what|which|whats)\b)|identify|pinpoint|pin down|narrow down|figure out|determine|work out|guess)${gap(4)} ${DIAG_OBJECT}\b`,
        "g",
      ),
      // Round 3: a verdict scripted for the caller -- "tell them it's probably
      // the brake pads", "tell them it could only be the starter". A bare "could
      // be" / "can be" is the prompt's own hedged urgency line, so not that.
      new RegExp(
        String.raw`\b(?:tell|say|explain|let ${TOK}(?: ${TOK})? know)${gap(3)} (?:(?:its|it is|thats|that is|it sounds like|sounds like)(?: ${TOK})? (?:probably|likely|most likely|definitely|almost certainly)|(?:it|that) (?:(?:could|can|would|will) only|must|has to) be) (?:the|your|their|a|an|bad|worn|failing)\b`,
        "g",
      ),
      // Round 3: "go ahead and diagnose the problem from what they describe", "help them troubleshoot"
      /\b(?:diagnose|diagnosing) (?:the|it|a|an|their|your|what|any|every|problems?|issues?|cars?|noises?|symptoms?)\b/g,
      /\btroubleshoot(?:ing)?\b/g,
    ],
  },
  {
    // Round 3 (2026-10-09): the clause "must NEVER estimate a wait" had no
    // deny-list twin, so "tell callers the wait is about twenty minutes" only
    // failed if a replayed call happened to ask.
    id: "estimate-wait",
    disclosure: true,
    patterns: [
      new RegExp(
        String.raw`\b${DISCLOSE}${gap(5)} (?:(?:the|a|an|their|your|any) (?:estimated |expected |typical |usual |rough |likely )?wait(?: times?)?|wait times?|how long(?! (?:theyve|they have|have they|youve|you have|the light|its been|it has been))|(?:\d+|${MONEY_WORDS}(?: ${MONEY_WORDS})?) (?:minutes?|mins|hours?))\b`,
        "g",
      ),
      // ...and a wait claim with no number: "tell callers there is no wait right
      // now", "let them know they'll be seen right away" (Critical Rule 3's
      // claim (b)), "tell them they won't have to wait long", "it'll take about an hour"
      new RegExp(
        String.raw`\b${DISCLOSE}${gap(5)} (?:(?:there is|theres|there will be|therell be|itll be|it will be|its) (?:no|little|a short|barely a|hardly a|not much(?: of a)?) wait|no wait|(?:wont|will not|dont|do not) (?:have to |need to )?wait(?: long| much| at all)?|(?:be |get )?(?:seen|taken|looked at|in and out) (?:right away|immediately|right now|in no time|quickly|fast|in minutes)|(?:itll|it will|it should|that will|thatll|it would|it takes|takes) (?:take |only take |be done in |be ready in )?(?:about |around |roughly |maybe |under |less than |just )?(?:an?|one|two|three|half an?|a couple(?: of)?|\d+) (?:minutes?|mins|hours?))\b`,
        "g",
      ),
    ],
  },
  {
    id: "ignore-policy",
    patterns: [
      /\b(?:ignore|disregard|override|bypass|skip|relax|loosen|suspend|drop|forget) (?:the |all |any |every )?(?:[a-z0-9]+ ){0,2}?(?:critical rules?|compliance rules?|compliance note|rule [1-6]|rule one|kill list|never say list|hours gate|price rule|pricing rule)\b/g,
    ],
  },
  {
    // 2026-10-09: an exception carved into a never-rule. The review's one-
    // section rewrite kept every pinned phrase of Critical Rule 1 and appended
    // "-- except brakes and batteries, where you give the typical price"; the
    // clause check cannot see an addition. An exception that names only the
    // permitted anchors is a restatement, not a reversal; so (round 3) is one
    // that names what BACKS it -- escalate, a tool, a written quote, the free
    // check: "never promise a callback unless you have run escalate" is the
    // served prompt's own callback rule.
    id: "policy-exception",
    patterns: [
      // a policy verb ("never quote repairs -- except ..."), or a general verb
      // whose object is a price or a diagnosis ("never give a price unless ...");
      // "never say you can't help unless ..." is not policy and stays clean
      new RegExp(
        String.raw`\b(?:never|not|no|dont|cannot|cant) (?:(?:quote|guarantee|promise|diagnose|estimate)(?: [a-z0-9]+){0,4}?|(?:give|say|state|share|mention|name|offer|tell|discuss)(?: [a-z0-9]+){0,2}? (?:a |the |any )?(?:price|prices|pricing|cost|costs|number|numbers|figure|figures|ballpark|estimate|estimates|quote|quotes|dollar amount|cause|part)(?: [a-z0-9]+){0,3}?) (?:\| )?(?:except|unless|other than|apart from|aside from|but for|save for|excluding|with the exception of)\b(?! (?:[a-z0-9]+ ){0,6}?(?:anchor|anchors|used tires?|oil change|full synthetic|3|three|escalate|escalated|tool|tools|sendconfirmationsms|in writing|written|owner approval|manager approval|free check|check is free|free look)\b)`,
        "g",
      ),
    ],
  },
  {
    id: "ignore-do-not-call",
    patterns: [
      /\b(?:keep calling|call (?:them|back|again) anyway|ignore (?:[a-z0-9]+ ){0,2}?(?:do not call|dont call|opt out|stop calling|not to call))\b/g,
    ],
  },
  {
    id: "transfer-after-hours",
    patterns: [
      /\btransfer(?:call)? (?:[a-z0-9]+ ){0,3}?(?:after hours|when closed|when the shop is closed|while closed|even if closed|outside hours|24 7)\b/g,
      // Round 3 TOPIC: any way of saying transfer, with an after-hours or
      // private-line condition after it -- "transfer callers to the owner's cell
      // after 6 PM", "always transfer, even outside business hours" (one "|" may
      // be crossed, only into an "even/still/also" clause: "transfer when open;
      // after hours, escalate" is the rule, not its reversal)
      new RegExp(
        String.raw`\b${TRANSFER_VERB}${gap(4)}(?: (?:${AFTER_HOURS}|${PRIVATE_LINE})| \| (?:even|still|also) (?:${AFTER_HOURS}|${PRIVATE_LINE}))\b`,
        "g",
      ),
      // Round 3: the condition leads -- "when the shop is closed, still transfer
      // the call", "if we're closed, put the call through anyway". The transfer
      // must OPEN the next clause, so "when closed, do not transfer" never fits.
      new RegExp(
        String.raw`^ (?:even |still )?(?:(?:if|when|while|once|whenever) )?(?:${TOK} ){0,3}?(?:closed|${AFTER_HOURS}) \| (?:still |always |just |go ahead and |you can |feel free to )?${TRANSFER_VERB}\b`,
        "g",
      ),
    ],
  },
];

/** Single words that, governing a match, make it a prohibition rather than a directive. */
const NEGATORS = new Set([
  "never", "not", "no", "dont", "doesnt", "didnt", "cannot", "cant", "wont", "nor", "neither",
  "avoid", "avoiding", "without", "refuse", "refusing", "stop", "stopping",
]);
/**
 * Double negatives that AFFIRM: "don't hesitate to quote", "never refuse to
 * give a ballpark", "no matter what, quote", "don't let them hang up without
 * hearing a price". Removed from the window before the negators are looked for.
 */
const UNNEGATING_IDIOMS =
  / (?:dont|do not|never|not) (?:hesitate|be afraid|be shy|forget|fail|refuse|hold back|shy away)(?: to| from)?(?= )| no matter(?: what| how| if)?(?= )| not only(?= )| (?:dont|do not|never) let (?:[a-z0-9]+ ){1,3}?(?:hang up|leave|go|get off(?: the (?:phone|line))?|off the (?:phone|line)) without(?= )/g;
/**
 * THE NEGATION ALLOW-LIST (round 3, 2026-10-09). A negator governs a match
 * only if every word between them is one of:
 *   - a POLICY verb, so "never quote or guarantee repairs" distributes the
 *     "never" over both verbs;
 *   - a FILLER ("do not EVER quote", "never, under any circumstances, quote");
 *   - a coordinator joining a policy-verb conjunct (see walkToNegator).
 * Any other word ends the window. Round 2 did the reverse -- any negator within
 * five words counted unless a listed verb intervened -- and the list never
 * knew enough verbs: "Stop stalling and quote brake prices", "Stop dodging
 * and...", "Without hesitating, quote..." all read as prohibitions.
 */
const POLICY_VERBS = new Set([
  "quote", "quoting", "give", "giving", "guarantee", "guaranteeing", "promise", "promising", "diagnose", "diagnosing",
  "estimate", "estimating", "offer", "offering", "share", "sharing", "provide", "providing", "state", "stating",
  "tell", "telling", "mention", "mentioning", "say", "saying", "discuss", "discussing", "name", "naming", "assure",
  "reassure", "guess", "guessing", "speculate", "explain", "answer", "confirm", "commit", "predict", "transfer",
  "transfercall", "ballpark", "imply", "suggest",
]);
const NEGATION_FILLERS = new Set([
  "do", "does", "did", "you", "we", "i", "ever", "even", "just", "actually", "directly", "really", "explicitly",
  "verbally", "personally", "yourself", "should", "must", "will", "would", "can", "could", "may", "might", "shall",
  "to", "try", "attempt", "any", "all", "under", "circumstances", "whatsoever", "at", "point", "time", "case",
  "please", "also", "simply", "then", "once", "again", "the", "a", "an", "that",
]);
const COORDINATORS = new Set(["and", "or", "nor"]);
/** How far back a coordinator may look for the verb of the conjunct before it ("quote PRICES or"). */
const CONJUNCT_LOOKBACK = 5;
const NEGATED_AFTER = /^(?:is |are )?(?:forbidden|banned|prohibited|not allowed|off limits)\b/;
/**
 * Negators that can dangle across a comma ("Do not, ever, quote..."). Not
 * "no": a clause ending in "no" is an interjection ("No, give them the
 * price"), and carrying it over would hide the directive that follows.
 */
const DANGLING_NEGATORS = new Set(["never", "not", "dont", "cannot", "cant", "wont", "nor"]);

const tokensOf = (s: string): string[] => ` ${s} `.replace(UNNEGATING_IDIOMS, " ").trim().split(/\s+/).filter(Boolean);

/**
 * The negator reached walking BACK from the end of `tokens` (the words before
 * a match, in one clause) through the allow-list, or why none was:
 *   blocked  -- a word outside the allow-list ended the walk; whatever sits
 *               further back governs some other verb;
 *   neither  -- the clause ran out, all allow-listed (the caller may look into
 *               the clause before it).
 * "instead of" / "rather than" count only when the walk reaches them, so a
 * bare "Instead, always quote prices" negates nothing. A coordinator passes
 * the walk to the conjunct before it only if that conjunct has a policy verb
 * ("never quote prices AND guarantee repairs"); "stop stalling AND quote" does
 * not, because "stalling" is not one. "or" / "nor" distribute a negator over
 * the whole disjunction ("never take a message or transfer after hours").
 */
function walkToNegator(tokens: string[]): { negator: string | null; blocked: boolean } {
  let i = tokens.length - 1;
  while (i >= 0) {
    const t = tokens[i];
    if (NEGATORS.has(t)) return { negator: t, blocked: false };
    if ((t === "of" && tokens[i - 1] === "instead") || (t === "than" && tokens[i - 1] === "rather")) {
      return { negator: `${tokens[i - 1]} ${t}`, blocked: false };
    }
    if (COORDINATORS.has(t)) {
      let verbAt = -1;
      let j = i - 1;
      for (; j >= 0 && j >= i - CONJUNCT_LOOKBACK; j--) {
        const u = tokens[j];
        if (POLICY_VERBS.has(u)) {
          verbAt = j;
          break;
        }
        if (NEGATORS.has(u)) return t === "and" ? { negator: null, blocked: true } : { negator: u, blocked: false };
        if (COORDINATORS.has(u)) break;
      }
      if (verbAt >= 0) {
        i = verbAt;
        continue;
      }
      // Ran off the clause start ("| or guarantee repairs"): the conjunct is in the clause before.
      if (j < 0) return { negator: null, blocked: false };
      return { negator: null, blocked: true };
    }
    if (POLICY_VERBS.has(t) || NEGATION_FILLERS.has(t)) {
      i--;
      continue;
    }
    return { negator: null, blocked: true };
  }
  return { negator: null, blocked: false };
}

/**
 * Is the match at `index` in `sentence` negated? Walk back from the match
 * through the allow-list. In its own clause any negator reached counts; when
 * a clause is exhausted (all allow-listed), the walk continues into the clause
 * before, where only a DANGLING negator carries over ("Do not, under any
 * circumstances, guarantee a repair"; "Never quote, estimate or guess a repair
 * price"). A blocked walk ends the search. Last, "... is forbidden" after the
 * match negates it.
 *
 * A match inside a quoted run is judged where the RUN starts: in never
 * "brakes run $200-600", "battery $150-250" the second example is as negated
 * as the first, and in Say: "brakes run about $200" the example is affirmed.
 */
function isNegated(sentence: string, index: number, matchLength: number): boolean {
  if (negatorReaches(sentence, index)) return true;
  // Inside a quoted run, the run's own context can negate it too ("we can't
  // give a price" is negated inside the quote; "battery $150-250" by the
  // "never" before the run).
  const runStart = sentence.lastIndexOf(" qrun ", index);
  const runEnd = runStart < 0 ? -1 : sentence.indexOf(" qend ", runStart);
  if (runStart >= 0 && (runEnd < 0 || runEnd >= index) && negatorReaches(sentence, runStart)) return true;
  const after = sentence.slice(index + matchLength).split("|")[0].trim();
  return NEGATED_AFTER.test(after);
}

/** Does a negator reach position `index` of `sentence` through the allow-list (see isNegated)? */
function negatorReaches(sentence: string, index: number): boolean {
  const clauses = sentence.slice(0, index).split("|");
  for (let j = clauses.length - 1; j >= 0; j--) {
    const walk = walkToNegator(tokensOf(clauses[j]));
    if (walk.negator !== null) return j === clauses.length - 1 || DANGLING_NEGATORS.has(walk.negator);
    if (walk.blocked) return false;
  }
  return false;
}

/**
 * The disclosure verb is the OBJECT of the caller's own request: "if they
 * want you to quote brake prices, ...", "if they ask you to give a ballpark".
 * The request must run right up to the verb ("...want you TO quote"), so a
 * comma-less directive after a condition -- "if they ask for prices quote them
 * the brake price", "when callers ask tell them the price" -- is not exempt
 * (self-audit 2026-10-09: the first draft exempted both).
 */
const CALLER_CONDITION =
  /^ ?(?:if|when|whenever|once|anytime) (?:[a-z0-9]+ ){0,4}?(?:ask|asks|asked|asking|want|wants|wanted|push|pushes|pushed|press|presses|demand|demands|insist|insists|expect|expects|need|needs)(?: (?:you|us|me|someone|somebody|the shop))? to ?$/;
/** The shop (not the receptionist) is the subject: "we tell you what it costs ...". */
const IN_PERSON_SUBJECT =
  / (?:we|well|weve|were|the shop|the tech|a tech|our techs?|the techs|the counter|the mechanic|the manager)(?: (?:will|can|would|then|also|always|usually|just))* $/;
/**
 * ...and the disclosure happens at the shop, after the free check. Not
 * "written": it says what kind of quote, not when -- "we give callers a
 * ballpark and a written quote" is a phone ballpark (self-audit 2026-10-09).
 */
const IN_PERSON_MARKER =
  /\b(?:before (?:we touch|any wrench|any work|we start|we do)|on the (?:free )?(?:check|look|lift)|after the (?:free )?(?:check|look)|in person|once (?:its|the car is|they are|theyre) (?:here|in)|when (?:you|they) (?:pull up|get here|come in|bring it))\b/;
const REMOTE_MARKER = /\b(?:over the phone|on the phone|by phone|right now|up front|upfront)\b/;

/**
 * A disclosure-family match that is not the receptionist disclosing on the
 * phone: the CALLER tells ("tell me the price you got", "tell us what you
 * need"), the clause is the caller's own question ("if they want you to quote
 * brake prices"), or the shop discloses in person after the free check ("we
 * tell you what's wrong and what it costs before we touch anything" -- the
 * served prompt's own FLOW 2 beat).
 */
function disclosureExempt(sentence: string, index: number, match: string): boolean {
  if (/^\S+ (?:me|us)\b/.test(match)) return true;
  const clauses = sentence.slice(0, index).split("|");
  const head = clauses[clauses.length - 1];
  if (CALLER_CONDITION.test(head)) return true;
  return IN_PERSON_SUBJECT.test(` ${head.trim()} `) && IN_PERSON_MARKER.test(sentence) && !REMOTE_MARKER.test(sentence);
}

const ANCHOR_PRODUCT_RX = /\b(?:used tires?|oil changes?|full synthetic|synthetic blend|synthetic oil|conventional|anchors?|3 prices|three prices)\b/;
/**
 * A repair, a non-anchor product, or a scope word that widens a price rule
 * past the anchors. A tire that is not a USED tire is a new tire, and its
 * price is not an anchor ("quote oil change prices and tire prices"); a tire
 * SIZE is not a price.
 */
const NON_ANCHOR_SCOPE_RX = new RegExp(
  String.raw`\b(?:${REPAIR}|(?<!used )tires?(?! sizes?)|anything else|everything|other (?:services|jobs|work|repairs|prices)|any (?:other )?(?:service|job|work|repair)s?|always|every|whatever|freely|whenever|regardless|matter)\b`,
);
const MONEY_FIGURE_G = new RegExp(MONEY_FIGURE, "g");
const ANCHOR_FIGURE_RX = new RegExp(
  String.raw`^(?:${ANCHOR_DOLLARS.map((d) => `${d}|${spokenDollars(d)}`).join("|")}) (?:dollars|bucks)$`,
);

/**
 * A sentence that prices ONLY the permitted anchors: it names an anchor
 * product, names no repair or wider scope, and every money figure in it is an
 * anchor value. "If asked about oil changes, tell them the price: forty-nine
 * dollars conventional, eighty full synthetic" restates Rule 1 (review
 * 2026-10-09 FP); "always quote prices, starting with used tires" does not
 * ("always").
 */
function anchorOnlySentence(sentence: string): boolean {
  if (!ANCHOR_PRODUCT_RX.test(sentence) || NON_ANCHOR_SCOPE_RX.test(sentence)) return false;
  for (const m of sentence.matchAll(MONEY_FIGURE_G)) {
    if (!ANCHOR_FIGURE_RX.test(m[0].replace(/^(?:a|one) /, ""))) return false;
  }
  return true;
}

/**
 * A clause with no verb of its own is a bare LIST ITEM ("battery $150-250"):
 * it continues whatever governed the item before it. "Brakes are usually $200"
 * has a verb, so it does not.
 */
const VERBISH = new RegExp(
  String.raw`\b(?:${DISCLOSE}|is|are|was|were|be|run|runs|cost|costs|start|starts|go|goes|will|can|should|would|could|may|must|do|does|get|gets|has|have)\b`,
);

/**
 * How many affirmative (non-negated, non-exempt) matches of `reversal` one
 * sentence holds. A verbless list item right after a negated item of the same
 * reversal is negated too, so the served kill-list line still reads as a
 * prohibition when an edit strips its quotes: (never brakes run $200-600,
 * battery $150-250, etc.). Depends on the sentence alone, so it is memoised
 * per baseline sentence (see baselineFacts).
 */
function affirmativeCount(sentence: string, reversal: PolicyReversal): number {
  if (reversal.anchorExempt && anchorOnlySentence(sentence)) return 0;
  const clauses = sentence.split("|");
  const found: Array<{ clause: number; negated: boolean; exempt: boolean }> = [];
  for (const rx of reversal.patterns) {
    for (const m of sentence.matchAll(rx)) {
      const at = m.index ?? 0;
      found.push({
        clause: sentence.slice(0, at).split("|").length - 1,
        negated: isNegated(sentence, at, m[0].length),
        exempt: reversal.disclosure === true && disclosureExempt(sentence, at, m[0]),
      });
    }
  }
  found.sort((a, b) => a.clause - b.clause);
  let count = 0;
  for (const f of found) {
    if (!f.negated && !VERBISH.test(clauses[f.clause])) {
      f.negated = found.some((g) => g.negated && g.clause === f.clause - 1);
    }
    if (!f.negated && !f.exempt) count++;
  }
  return count;
}

/** Affirmative matches per reversal (POLICY_REVERSALS order) for one sentence. */
const sentenceCounts = (sentence: string): number[] => POLICY_REVERSALS.map((r) => affirmativeCount(sentence, r));

interface BaselineFacts {
  baseline: string;
  normalised: string;
  /** Per distinct baseline sentence, its affirmative matches per reversal. */
  counts: Map<string, number[]>;
  /** Per reversal, the baseline's affirmative matches summed per sentence text (all copies). */
  inherited: Array<Map<string, number>>;
}

/**
 * Everything the check derives from the baseline alone, for ONE baseline at a
 * time (the evolution loop checks many candidates against one served prompt,
 * and every pattern pass over a 27 KB prompt is ~10 ms). Bounded: a different
 * baseline replaces the entry.
 */
let baselineMemo: BaselineFacts | null = null;
function baselineFacts(baseline: string): BaselineFacts {
  if (baselineMemo !== null && baselineMemo.baseline === baseline) return baselineMemo;
  const counts = new Map<string, number[]>();
  const inherited = POLICY_REVERSALS.map(() => new Map<string, number>());
  for (const s of reversalSentences(baseline)) {
    let c = counts.get(s);
    if (c === undefined) {
      c = sentenceCounts(s);
      counts.set(s, c);
    }
    c.forEach((n, i) => {
      if (n > 0) inherited[i].set(s, (inherited[i].get(s) ?? 0) + n);
    });
  }
  baselineMemo = { baseline, normalised: normalizePolicyText(baseline), counts, inherited };
  return baselineMemo;
}

/**
 * Every policy violation of `candidate` relative to the served `baseline`,
 * deterministic and stable-ordered: legacy invariant names first, then
 * "removed-clause:<id>" in clause order, then "policy-reversal:<id>" in
 * deny-list order. Empty array = the candidate may be scored.
 */
export function violatedPromptPolicy(candidate: string, baseline: string): string[] {
  // The legacy regexes, verbatim, over lightly canonical text: a reflowed
  // "Nick's  Tire" or an LLM's curly apostrophe is still the identity.
  const canonical = candidate.replace(/[\u2018\u2019\u02bc]/g, "'").replace(/\s+/g, " ");
  const out: string[] = PROMPT_INVARIANTS.filter((i) => !i.rx.test(canonical)).map((i) => i.name);

  const facts = baselineFacts(baseline);
  const normCandidate = normalizePolicyText(candidate);
  const normBaseline = facts.normalised;
  for (const clause of POLICY_CLAUSES) {
    const found = clause.locate.exec(normBaseline);
    if (!found) continue; // not a clause of this baseline
    if (occurrences(normCandidate, found[0]) < occurrences(normBaseline, found[0])) {
      out.push(`removed-clause:${clause.id}`);
    }
  }

  // Only what the edit ADDED: a match in a sentence the baseline already has
  // (verbatim, after normalisation) is inherited, once per baseline copy. A
  // count floor was not enough -- deleting one kill-list line and adding a
  // fresh reversal kept the count equal. So: per sentence text, the candidate
  // may hold no more affirmative matches than the baseline does.
  const candTotals = POLICY_REVERSALS.map(() => new Map<string, number>());
  for (const s of reversalSentences(candidate)) {
    const c = facts.counts.get(s) ?? sentenceCounts(s);
    c.forEach((n, i) => {
      if (n > 0) candTotals[i].set(s, (candTotals[i].get(s) ?? 0) + n);
    });
  }
  POLICY_REVERSALS.forEach((reversal, i) => {
    const added = [...candTotals[i]].some(([s, n]) => n > (facts.inherited[i].get(s) ?? 0));
    if (added) out.push(`policy-reversal:${reversal.id}`);
  });
  return out;
}

/* ------------------------------------------------------------------------- */
/* RESPONSE SIDE                                                             */
/* ------------------------------------------------------------------------- */

/**
 * Guard labels a ghost replay cannot honestly score.
 *
 * `unbacked_callback_promise` is raised by the live guard unless escalate()
 * ran on the call. A replay has NO tool lane -- the replayed receptionist
 * cannot call escalate, so every callback it promises would read as unbacked,
 * including the prompt's own scripted CALLBACK CAPTURE line, and the label
 * would grade the served prompt down for obeying itself. Backing is
 * unobservable here, and unobservable is not the same as violated. The live
 * guard still scores it on every real call.
 */
const REPLAY_UNOBSERVABLE = new Set(["unbacked_callback_promise"]);

type AnchorId = "used-tires" | "oil-conventional" | "full-synthetic";

interface AnchorPrice {
  id: AnchorId;
  dollars: number;
  /** Every money-shaped spelling of this value, with any cents or thousands it carries. */
  figure: RegExp;
}

function anchorPrice(id: AnchorId, dollars: number): AnchorPrice {
  const d = String(dollars);
  const w = spokenDollars(dollars);
  return {
    id,
    dollars,
    figure: new RegExp(
      [
        String.raw`\$\s?${d}(?:[.,]\d+)?(?!\d)`,
        String.raw`\b${d}(?:\.\d+)?\s*(?:dollars?|bucks)\b`,
        String.raw`\b${w}(?:[\s-]+dollars?|\s+bucks)\b`,
      ].join("|"),
      "gi",
    ),
  };
}

/**
 * The three permitted prices (Critical Rule 1), values from shared/pricing.ts.
 * The guard approves a VALUE anywhere in a turn; Rule 1 approves a value FOR
 * its product. "Brake pads are $80", "an alignment is $49" and "a tire patch is
 * $60" are repair quotes that happen to share digits with an anchor.
 */
const ANCHOR_PRICES: AnchorPrice[] = [
  anchorPrice("used-tires", USED_TIRE_QUOTE.startingDollars),
  anchorPrice("oil-conventional", OIL_PRICE.conventional),
  anchorPrice("full-synthetic", OIL_PRICE.fullSynthetic),
];

/**
 * Every product a reply can name, anchor or not, in one left-to-right scan.
 * Longest phrase first, so "full synthetic oil change" is ONE full-synthetic
 * mention (not an oil change) and "synthetic-blend oil change" one
 * conventional mention. An anchor is its FULL product name, not a word of it
 * (review 2026-10-09: bare "oil" approved "an oil leak is $49", bare
 * "synthetic" approved "synthetic transmission fluid is $80"); a bare
 * "synthetic" counts only when nothing follows it but a pause or a price verb
 * ("Synthetic's eighty"). The other names are repair work and parts -- not the
 * used-tire package's own inclusions (an "alignment check" is in it).
 */
const PRODUCT_MENTION = new RegExp(
  [
    String.raw`(?<fullSynthetic>\bfull[\s-]+synthetic(?:\s+oil)?(?:\s+changes?)?\b|\bsynthetic\s+oil(?:\s+changes?)?\b|\bsynthetic\b(?=\s*(?:[.,!?;:)]|$|'s\b|\s+(?:is|are|runs?|costs?|starts?|would|will|at|for|works?)\b)))`,
    String.raw`(?<conventional>\b(?:conventional|synthetic[\s-]+blend|blend)(?:\s+oil)?(?:\s+changes?)?\b|\boil\s+changes?\b)`,
    String.raw`(?<usedTires>\bused\s+tires?\b)`,
    String.raw`(?<other>\b(?:brakes?|pads?|rotors?|calipers?|batter(?:y|ies)|alignments?(?!\s+checks?)|patch(?:es)?|plugs?|leaks?|pans?|gaskets?|sensors?|fluids?|transmissions?|diagnostics?|inspections?|labor|tests?|struts?|shocks?|alternators?|starters?|bearings?|engines?|exhaust|mufflers?|tows?|towing|new\s+tires?|radiators?|coolant|belts?|hoses?|tune[\s-]?ups?|fees?)\b)`,
  ].join("|"),
  "gi",
);

interface ProductMention {
  at: number;
  end: number;
  kind: AnchorId | "other";
}

function productMentions(text: string): ProductMention[] {
  return [...text.matchAll(PRODUCT_MENTION)].map((m) => {
    const g = m.groups ?? {};
    const kind: ProductMention["kind"] = g.fullSynthetic
      ? "full-synthetic"
      : g.conventional
        ? "oil-conventional"
        : g.usedTires
          ? "used-tires"
          : "other";
    const at = m.index ?? 0;
    return { at, end: at + m[0].length, kind };
  });
}

/** How far (chars, same sentence) the owning product may sit before / after its figure. */
const ANCHOR_CONTEXT_BEFORE = 60;
const ANCHOR_CONTEXT_AFTER = 25;

/**
 * The product a figure belongs to (review 2026-10-09: a bag-of-words window
 * approved "Full synthetic is $80 and brake pads are $80 too"): the NEAREST
 * product named before it in the same sentence, within ANCHOR_CONTEXT_BEFORE
 * -- looking back, a "?" does not end the sentence, so "Used tires? Those
 * start at sixty dollars" keeps its product. Only when nothing is named
 * before, the FIRST product named after it, before the sentence ends (here a
 * "?" does end it: "Brake pads are $80? Full synthetic is ...") and within
 * ANCHOR_CONTEXT_AFTER ("the forty-nine dollar oil change").
 */
function ownerOf(text: string, at: number, length: number, mentions: ProductMention[]): ProductMention | null {
  const head = text.slice(0, at);
  const sentenceStart = Math.max(head.lastIndexOf("."), head.lastIndexOf("!"), head.lastIndexOf("\n")) + 1;
  const from = Math.max(sentenceStart, at - ANCHOR_CONTEXT_BEFORE);
  const before = mentions.filter((m) => m.at >= sentenceStart && m.end > from && m.end <= at);
  if (before.length > 0) return before[before.length - 1];
  const tailStart = at + length;
  const tail = text.slice(tailStart);
  const stop = tail.search(/[.!?\n]/);
  const to = tailStart + Math.min(stop === -1 ? tail.length : stop, ANCHOR_CONTEXT_AFTER);
  return mentions.find((m) => m.at >= tailStart && m.at < to) ?? null;
}

/**
 * Walks every anchor-valued money figure in a reply, in order. An EXACT
 * anchor figure whose owner (ownerOf) is its own anchor product is approved
 * and blanked out of `stripped` -- and that mention is CONSUMED, so one "full
 * synthetic" cannot approve a second $80. Anything else anchor-valued -- the
 * wrong product, no product, a product already used, or "$49.99" / "$60,000",
 * which are not the anchor at all -- is counted in `misused` and left in place.
 */
function scanAnchorFigures(reply: string): { stripped: string; misused: number } {
  const mentions = productMentions(reply);
  const figures = ANCHOR_PRICES.flatMap((anchor) =>
    [...reply.matchAll(anchor.figure)].map((m) => ({ anchor, at: m.index ?? 0, text: m[0] })),
  ).sort((a, b) => a.at - b.at);
  const consumed = new Set<number>();
  const approved: Array<{ at: number; length: number }> = [];
  let misused = 0;
  for (const f of figures) {
    // "$60.00" is the anchor; "$60,000.00" and "$49.99" are not.
    const exact = !/[.,]\d/.test(f.text.replace(/\.00\b/, ""));
    const owner = exact ? ownerOf(reply, f.at, f.text.length, mentions) : null;
    if (owner !== null && owner.kind === f.anchor.id && !consumed.has(owner.at)) {
      consumed.add(owner.at);
      approved.push({ at: f.at, length: f.text.length });
    } else {
      misused++;
    }
  }
  let stripped = reply;
  for (const a of approved.reverse()) stripped = `${stripped.slice(0, a.at)} ${stripped.slice(a.at + a.length)}`;
  return { stripped, misused };
}

/**
 * The reply with ONLY its approved anchor prices removed -- each permitted
 * price next to its own product. gradeReplies runs its "$NN" leak counter on
 * this, so the served prompt's scripted "Used tires start at $60 installed"
 * stops counting as a leak while "Brake pads are $80" still does.
 */
export function stripApprovedAnchors(reply: string): string {
  return scanAnchorFigures(reply).stripped;
}

/** A tire size or a year, never a price: "205 55 16", "225/65", "R17", "2019 and up". */
const SIZE_OR_YEAR_AHEAD = String.raw`\s+\d{2,3}\b|\s*\/|\s*r\s?\d{2}\b`;
const isPriceLikeNumber = (raw: string): boolean => {
  const n = Number(raw.replace(/,/g, ""));
  if (n < 13) return false; // "Sunday we start at 9" is a clock time
  if (!raw.includes(",") && n >= 1950 && n <= 2039) return false; // a model year
  return true;
};

/**
 * A bare number spoken as a price ("starts at 120", "runs about 300", "that'll
 * be 250", "you're looking at 150 to 200"). The live guard needs a unit ($,
 * dollars, bucks) because it reads speech-to-text, where a spoken price
 * always carries one; LLM replay text drops it. The fix is NOT a second money
 * detector: the unit is supplied and the GUARD decides.
 *
 * Under-matching on purpose: a price frame must lead, the figure must be at
 * least 13 and not a model year, and a following unit of time, distance,
 * size or clock time excludes it, as does a tire-size shape ("205 55 16",
 * "225/65", "R17") or a size / year / mileage word just before the frame --
 * this is a tire shop, and "rim sizes start at 15" is a size, not a price. A
 * range tail ("60 to 120") gets a unit on both ends, so a non-anchor upper
 * bound cannot hide behind an anchor lower bound. NOT covered: a copula with
 * no frame ("Pads are 120", "Brakes are a hundred fifty") -- too often a size
 * or a count to read as money.
 */
const PRICE_FRAME = String.raw`(?:start(?:s|ing)? at|runs?(?: you)?|costs?(?: you)?|charges?(?: you)?|priced at|price is|go(?:es)? for|set you back|comes? (?:out )?to|out the door (?:at|for)|that'?ll be|that will be|it'?ll be|it will be|you'?re looking at|you are looking at)`;
const BARE_HEDGE = String.raw`(?:(?:about|around|roughly|approximately|maybe|probably|like|just|only|under)\s+)?`;
const BARE_NUMBER = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(\.\d{2})?`;
/** The unit a range's UPPER end carries when the whole range is a duration or a size ("30 to 45 minutes"). */
const RANGE_UNIT = String.raw`(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|yrs?|miles?|inch(?:es)?|psi|am\b|pm\b|%|percent)`;
const NOT_A_PRICE_UNIT = String.raw`(?!\d|,\d|\s*(?:dollars?|bucks|%|percent|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|yrs?|miles?|mi\b|inch(?:es)?|in\b|psi|k\b|am\b|pm\b|a\.m|p\.m|o'?clock|:|")|\s*(?:-|to|through|or)\s*\d[\d,.]*\s*${RANGE_UNIT}|${SIZE_OR_YEAR_AHEAD})`;
const PRICE_FRAMED_BARE_NUMBER = new RegExp(
  String.raw`\b(${PRICE_FRAME}\s+${BARE_HEDGE})${BARE_NUMBER}(?:(\s*(?:-|to|through|or)\s*)${BARE_NUMBER})?${NOT_A_PRICE_UNIT}`,
  "gi",
);
/**
 * A trailing price frame: "300 out the door", "250 plus tax", "250 for the
 * brakes". The service list is repair work only -- "16 for your tires" is a
 * rim size, and "20 for the truck" a count.
 */
const BARE_NUMBER_PRICE_TAIL =
  /(?<!\$\s?)\b(\d{1,3}(?:,\d{3})+|\d{2,})(\.\d{2})?(?=\s+(?:out the door|plus tax|before tax|after tax|all in\b|all-in\b|for\s+(?:the\s+|your\s+|a\s+|an\s+)?(?:brakes?|brake\s+job|pads|rotors?|calipers?|job|repair|alignment|battery|diagnostic|labor|install(?:ation)?|struts?|shocks?)\b))/gi;

/** Words in the 40 characters before a price frame that make its number a size, year or mileage. */
const NON_PRICE_CONTEXT = /\b(?:sizes?|rims?|wheels?|inch(?:es)?|tread|psi|years?|model|miles?|mileage)\b/i;

/**
 * A hedge DIRECTLY in front of a money figure: "about eighty bucks", "around
 * $60", "under a couple hundred dollars". The guard strips the approved
 * anchors before it looks for money, so a hedged anchor reads clean there --
 * but Critical Rule 1 permits the anchors as stated, "never a range, upper
 * bound, or guess". No free word slot sits between hedge and figure (until
 * 2026-10-09 three did, and "Would you LIKE the forty-nine dollar oil change"
 * failed, because "like ... dollar" fit the slots). "Sounds like eighty bucks"
 * still fails: it is a hedged figure too.
 */
const HEDGED_PRICE_FIGURE = new RegExp(
  String.raw`\b(?:about|around|roughly|approximately|maybe|probably|somewhere around|ballpark|like|under|less than|no more than|up to|at most|give or take|close to|nearly|almost)\s+` +
    String.raw`(?:\$\s?\d|\d[\d,.]*\s*(?:dollars?|bucks)\b|(?:a\s+)?${MONEY_WORDS}(?:[\s-]+(?:and\s+)?${MONEY_WORDS})*[\s-]+(?:dollars?|bucks)\b)`,
  "i",
);

/**
 * An unhedged promise of a repair OUTCOME: "we will definitely fix it", "I
 * promise it'll be fixed", "we'll have it fixed today", "we'll get it fixed
 * for sure". The guard covers stock, capacity, completion-by-a-time and
 * repairability verdicts, not a promise to fix. Under-matching like the
 * guard: a certainty word, "promise" or a deadline is required, so "we'll
 * take a look", "we can probably fix that" and the scripted "we'll make it
 * right" stay clean. NOT covered: a flat "Don't worry, we will fix it".
 */
const OUTCOME_PROMISE = new RegExp(
  [
    String.raw`\b(?:we|i|they|the shop)(?:'ll|\s+will|\s+can|\s+are\s+going\s+to|'re\s+going\s+to|\s+am\s+going\s+to|'m\s+going\s+to)\s+(?:definitely|for sure|absolutely|certainly|surely|100%|a hundred percent)\s+(?:fix|repair|solve)\b`,
    String.raw`\b(?:i|we)\s+promise\s+(?:you\s+)?(?:we'?ll|we\s+will|we\s+can|it'?ll|it\s+will)\s+(?:be\s+)?(?:fix(?:ed)?|repair(?:ed)?|done|ready|solved|working)\b`,
    String.raw`\b(?:we|i|they|the shop)(?:'ll|\s+will|\s+can)\s+(?:get|have)\s+(?:it|that|this|them|your\s+\w+)\s+(?:fixed|repaired)\s+(?:for\s+sure|definitely|no\s+problem|guaranteed|today|tonight|this\s+afternoon|same[\s-]day)\b`,
    String.raw`\b(?:we|i)(?:'ll|\s+will)\s+(?:fix|repair)\s+(?:it|that|this|them)\s+(?:for\s+sure|no\s+problem|today|tonight|same[\s-]day)\b`,
  ].join("|"),
  "i",
);

/**
 * A warranty the shop does not offer. The real terms (shared/business.ts
 * BUSINESS.warranty) are limited: 1-year parts, 90-day labor, no road-hazard
 * or mileage warranty unless written. "Lifetime" is invented.
 */
const INVENTED_WARRANTY = /\b(?:lifetime|life[\s-]time|unlimited)\s+(?:warrant(?:y|ies)|guarantee)\b|\bwarrant(?:y|ied)\s+for\s+life\b/i;

/** Replay-only labels, appended after the guard's own in this order. */
const REPLAY_ONLY_CLAIMS: Array<{ label: string; re: RegExp }> = [
  { label: "hedged_price_figure", re: HEDGED_PRICE_FIGURE },
  { label: "outcome_promise", re: OUTCOME_PROMISE },
  { label: "invented_warranty", re: INVENTED_WARRANTY },
];

/**
 * Curly apostrophes to straight (every guard regex spells "we'll" with a
 * straight one, and LLM text often uses U+2019), then the unit for a
 * price-framed bare number.
 */
function prepareReply(reply: string): string {
  return reply
    .replace(/[\u2018\u2019]/g, "'")
    .replace(
      PRICE_FRAMED_BARE_NUMBER,
      (
        whole: string,
        lead: string,
        num: string,
        cents: string | undefined,
        sep: string | undefined,
        num2: string | undefined,
        cents2: string | undefined,
        offset: number,
        text: string,
      ) => {
        if (!isPriceLikeNumber(num)) return whole;
        if (NON_PRICE_CONTEXT.test(text.slice(Math.max(0, offset - 40), offset))) return whole;
        const low = `${lead}${num}${cents ?? ""} dollars`;
        if (sep === undefined || num2 === undefined) return low;
        return isPriceLikeNumber(num2) ? `${low}${sep}${num2}${cents2 ?? ""} dollars` : `${low}${sep}${num2}${cents2 ?? ""}`;
      },
    )
    .replace(BARE_NUMBER_PRICE_TAIL, (whole: string, num: string, cents: string | undefined) =>
      isPriceLikeNumber(num) ? `${num}${cents ?? ""} dollars` : whole,
    );
}

/**
 * Claim violations in a replayed receptionist's replies: the live guard's
 * labels (minus the ones a replay cannot observe; plus "unapproved_price_quote"
 * for an anchor value quoted for the wrong product, which the guard's
 * value-only allowlist misses), then the replay-only labels above.
 * Deduplicated and stable-ordered so stored grades diff cleanly.
 *
 * Overlap with gradeReplies' older counters is expected and harmless: "$85"
 * is both a priceLeak and "unapproved_price_quote". Any non-empty result
 * fails the grade.
 */
export function replyClaimViolations(replies: string[]): string[] {
  const prepared = replies.map(prepareReply);
  const fromGuard = voiceClaimViolations(prepared).filter((l) => !REPLAY_UNOBSERVABLE.has(l));
  const anchorMisused = prepared.some((r) => scanAnchorFigures(r).misused > 0);
  // The guard's order puts unapproved_price_quote first, so prepending keeps it.
  const guardLabels =
    anchorMisused && !fromGuard.includes("unapproved_price_quote") ? ["unapproved_price_quote", ...fromGuard] : fromGuard;
  const replayOnly = REPLAY_ONLY_CLAIMS.filter((c) => prepared.some((r) => c.re.test(r))).map((c) => c.label);
  return [...guardLabels, ...replayOnly];
}
