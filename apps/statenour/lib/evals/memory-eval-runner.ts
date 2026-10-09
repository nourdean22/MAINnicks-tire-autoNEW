/**
 * Memory-eval runner — pure scoring. No DB, no fs, no network.
 *
 * The caller (scripts/run-memory-evals.ts or the system route) reads grounding
 * docs from disk and passes them in as `sources`. This keeps the runner pure
 * and unit-testable, and guarantees it can never mutate state.
 */

import type {
  EvalOutcome,
  MemoryEval,
  MemoryEvalCategory,
  MemoryEvalRunResult,
} from "./memory-eval-types";

const lc = (s: string) => s.toLowerCase();

// -- Forbidden-claim negation scoping (2026-10-09, tightened after review) ---
// Until 2026-10-09 a forbidden term counted as "named, not claimed" when ANY
// negator appeared ANYWHERE in the answer. "Deploys run on Vercel. We no longer
// use Netlify." therefore passed with forbidden "vercel" (autoresearch audit
// ledger P5, open item 8). Bare "was " was also a negator, so any past-tense
// sentence anywhere cleared every claim.
//
// The first scoped rule (same day) still let 40+ asserting sentences through:
// any negation after the term ("Vercel does not charge for builds"), comma-joined
// clauses ("Netlify is not used, it deploys to Vercel"), cues about another noun
// ("Legacy routes run on Vercel", "migrated off Heroku to Vercel"). The rule is
// now an ALLOWLIST: an occurrence is negated only by one of the shapes below, so
// an unrecognised shape fails the answer. A spurious fail shows up in the
// report; a spurious pass hides a stale claim. The term is a claim if ANY of
// its occurrences is not negated.
//
// CLAUSES. Hard breaks: . ! ? before whitespace (closing quotes, brackets and
// markdown emphasis may sit between: `.)` `."` `.**`), newlines, `;`, `:` before
// whitespace, brackets, em/en dashes and a hyphen with whitespace on both sides.
// The dot in "glm-4.7" or "bdnick.info" and the "--" of a CLI flag are not
// breaks. A comma is a soft break: the pre-window stops at it, and the
// post-window crosses it only for a subject list. Contrastive words (but,
// however, although, though, whereas, while, except) cut both windows.
//
// PRE (tokens before the term, after the last comma):
//   - a negation particle (not, no, never, nor, n't, ...) at most K word tokens
//     before the term. Not a pseudo-negation ("not only", "no doubt", "don't
//     worry", "no problem", "No it ..."). Not a double negation: a retirement
//     verb between them makes a claim ("never stopped using Vercel"). Not across
//     and/or unless the term ends its clause as a list item ("don't use Netlify
//     or Vercel" is negated; "isn't used and Vercel hosts prod" is a claim);
//   - a past-tense retirement verb or phrase whose DIRECT OBJECT is the term:
//     only determiners or old/former/legacy may sit between, or a usage gerund
//     ("stopped using Vercel", "retired the legacy Vercel project", "instead of
//     Vercel", "migrated off Vercel"). A particle, nothing/nobody, or a hedge
//     (almost, nearly, if, unless, whether, should/would/could/... + have)
//     within K before it makes a claim ("haven't retired Vercel", "Nothing
//     replaced Vercel", "almost dropped Vercel", "should have retired Vercel");
//   - when the term is the last item of an object list ("no longer use X or
//     statenour-master", "retired X and Y"), up to two "item and/or/nor" pairs
//     are skipped and the cues are read from the first item;
//   - former / ex / legacy / old / previous directly before the term;
//   - formerly / previously / originally, or "used to <verb>", within K tokens
//     and with no now / currently / today / still between, and no move or
//     adoption verb between ("previously migrated to Vercel", "originally chose
//     Vercel" name it as the NEW host). "used to" after a be/get form means
//     accustomed or purpose ("got used to deploying on Vercel", "it's used to
//     deploy to Vercel"), not past use.
// POST (tokens after the term, same clause):
//   - an optional aux/adverb chain, then a retirement predicate ("is retired",
//     "has since been deprecated", "was replaced by", "was shut down", "is
//     history"), but not an active verb with an object ("Vercel deprecated
//     their API", "Vercel shut down our old API"). A modal ("will be retired",
//     "should be removed", "would have been retired"; "must have" excepted) or
//     a progressive "being" ("is being retired") makes it a claim: the term is
//     still current;
//   - a negation, then a USAGE word ("is not used", "is no longer in use",
//     "isn't running", "no longer exists"), or "is no more". Any other negated
//     predicate is a claim: "does not charge for builds", "is not retired",
//     "has not been shut down", "is not yet retired". A modal here stays
//     negated: "must not be used" and "can no longer be used" are the usual
//     readings;
//   - a subject list may come first ("Vercel, X and Y are retired"), but only
//     when the term opens its clause, and never an and-list before is/was/has;
//   - when the term opens its clause (only determiners before it, or after
//     the last and/or: "The X and Y branches", "... and the glm-4.7 default"),
//     one head noun may sit between it and an auxiliary or negation ("The
//     statenour-master branch is retired", "Venice primary routing was
//     retired"); two after a determiner ("The glm-4.7 default model was
//     dropped"). Never without the auxiliary ("Vercel hosts retired apps"), and
//     never two without a determiner ("Vercel says Heroku is retired").
// QUESTION: a clause that ends at `?` takes no PRE or POST cue ("Is Vercel
//   retired?", "Have we retired Vercel?"); only the answer in the next clause
//   can negate it (LABEL below).
// LABEL: a term that ends its clause at `:` `?` `(` or a dash takes the next
//   clause as its post-window ("Vercel: retired", "Vercel (deprecated) was the
//   old host", "Does it deploy to Vercel? No, it deploys via Railway").
// REASSERTION: after the term (label included), "but / however / yet / and /
//   a comma", optional pronoun or auxiliary, then "still" + anything but a
//   retirement word undoes the negation of that occurrence: "is deprecated and
//   still serves the site", "Vercel: retired, but it still hosts previews".
//   "Vercel is retired, but Railway still hosts prod" names a different
//   subject and stays negated; so does "is deprecated and still unused".
//
// K = 4 because a negator that scopes over an object sits in the same verb
// phrase, and the longest common shape in these answers puts it 4 word tokens
// out: "not [run] [on] [the] Vercel". A 5th token back usually belongs to an
// earlier clause: "We no longer use Netlify and deploy on Vercel" has "no" 7
// tokens out. Same idea as NegEx's fixed small window (Chapman et al. 2001).
//
// Each guard is pinned by a test in both directions. Known misses, pinned in
// tests/lib/evals/memory-eval-negation.test.ts so a fix flips them on purpose:
// false FAIL - any question that names the term, even one answered "No" ("Is
// Vercel still used? No."); a list after a comma ("do not use Netlify, Heroku,
// Fly or Vercel") or an aside ("We no longer, as of 2025, deploy to Vercel"); a
// negator more than K tokens out ("Never use prisma db push
// --accept-data-loss"); a negated predicate that is not a usage word ("Vercel
// is not the host"); a negative subject alone ("Nothing runs on Vercel"); a
// "still" that is not about the term ("is retired and still isn't used", "was
// retired and we still deploy from main"); a past passive purpose ("It was used
// to deploy to Vercel").
// False PASS - a particle within K over a non-usage verb ("Builds don't fail on
// Vercel", "We never had problems with Vercel"); a bracket label hides what
// follows the bracket ("Vercel (deprecated) still hosts prod"); a usage
// negation with a scope ("Vercel is not used by staging, only by prod"); a
// modal before a usage negation ("Vercel will no longer be used" reads as
// prescriptive); a compound noun whose head is not the term's referent ("The
// Vercel free tier was removed").

/** Max word tokens between a pre-window negation cue and the term (see above). */
export const NEGATION_WINDOW_TOKENS = 4;
/** POST subject list: at most this many extra items, each at most this many tokens. */
const MAX_CO_SUBJECTS = 3;
const MAX_CO_SUBJECT_TOKENS = 3;
/** Each window reads at most this many characters, so cost stays linear in the answer. */
const WINDOW_CHARS = 400;

const TOKEN_RX = /[a-z0-9]+(?:['./_-][a-z0-9]+)*|,/g;
/** May sit between . ! ? and the whitespace that ends a sentence. */
const SENTENCE_CLOSERS = "\"')]*_`\u201d";
/** A term that ends its clause at one of these takes the next clause as its post-window. */
const LABEL_BREAKS = new Set([":", "?", "(", "-"]);

const set = (words: string) => new Set(words.split(" "));
const CLAUSE_BREAKS = set("but however although though whereas while except");
/** May open a reassertion after the term ("is deprecated and still serves ..."). */
const REASSERT_OPENERS = new Set([...CLAUSE_BREAKS, ...set("and yet ,")]);
const NEGATION_WORDS = set(
  "not no never nor neither none without cannot isnt arent wasnt werent dont doesnt didnt wont cant hasnt havent hadnt",
);
/**
 * Negative subjects. Too loose to negate the term on their own ("Nothing beats
 * Vercel"), but before a retirement verb they make a double negation ("Nothing
 * replaced Vercel").
 */
const SUBJECT_NEGATORS = set("nothing nobody");
const LIST_CONJUNCTIONS = set("and or nor");
/** A particle followed by one of these is not a negator ("not only", "no doubt", "don't worry"). */
const PSEUDO_FOLLOWERS = set(
  "only just merely simply sure doubt question matter worries worry problem problems issue issues wonder forget",
);
/** "No" followed by a subject pronoun is an interjection ("No it deploys to Vercel"). */
const SUBJECT_PRONOUNS = set("it we they i he she you this that there");
/** Past-tense retirement verbs: negate the term when it is their direct object. */
const RETIREMENT_VERBS = set(
  "retired deprecated decommissioned discontinued sunset sunsetted removed replaced dropped stopped abandoned archived disabled deleted killed ditched quit ceased scrubbed purged eliminated banned forbidden prohibited disallowed",
);
/** Any form: a particle before one of these is a double negation ("did not stop using"). */
const RETIREMENT_ANY = new Set([
  ...RETIREMENT_VERBS,
  ...set("retire deprecate decommission discontinue remove replace drop stop abandon archive disable delete kill ditch cease ban forbid prohibit disallow"),
]);
/** POST heads: "Vercel is retired", "Vercel is history". */
const RETIREMENT_PREDICATES = new Set([...RETIREMENT_VERBS, ...set("obsolete defunct unused gone dead history legacy")]);
const HISTORICAL_ADJECTIVES = set("former ex legacy old previous erstwhile");
const HISTORICAL_ADVERBS = set("formerly previously originally");
const PRESENT_MARKERS = set("now currently today still");
/** After a historical adverb these name the term as the NEW host ("previously migrated to Vercel"). */
const MOVE_VERBS = set("migrated moved switched ported transitioned upgraded adopted chose picked");
/** Before "used to" these mean accustomed or purpose ("got used to", "is used to deploy"), not past use. */
const ACCUSTOM_LEADERS = set("getting become became becoming");
/** In the POST aux chain these make a retirement predicate future or hypothetical ("will be retired"). */
const MODALS = set("will would shall should can could may might must");
/** Within K before a past-tense retirement verb these make it hypothetical ("almost dropped", "if we replaced"). */
const HEDGES = set("almost nearly if unless whether");
const MODAL_PERFECT_RX = /^(?:will|would|shall|should|can|could|may|might)'ve$/;
/** May sit between a retirement verb and its direct object ("retired the legacy Vercel project"). */
const OBJECT_MODIFIERS = new Set([
  ...set("the a an our their its this that these those all both every whole entire"),
  ...HISTORICAL_ADJECTIVES,
]);
const USAGE_GERUNDS = set("using deploying hosting running relying paying shipping");
const GERUND_PREPOSITIONS = set("to on with via for through from");
/** Two-word retirement cues whose direct object is the term ("instead of Vercel"). */
const PRE_PHRASES = set(
  "instead_of rather_than moved_off migrated_off moved_away migrated_away moved_from migrated_from switched_from switched_away got_rid shut_down phased_out turned_off switched_off",
);
/** Optional third word of a PRE phrase ("moved away from", "got rid of"). */
const PHRASE_TAILS = set("from of");
const POST_PHRASES = set("shut_down phased_out turned_off switched_off");
/** After a negation in the post-window, only these say the term is out of use. */
const USAGE_WORDS = set(
  "used hosted deployed live active running supported maintained involved needed enabled current primary wired connected configured relevant around part exists exist available",
);
const BARE_NEGATION_TAILS = set("longer more anymore");
const BE_FORMS = set("is are was were be been being am s got gets get");
const AUXILIARIES = set(
  "is are was were be been being am s got gets get has have had does do did will would shall should can could may might must",
);
/** An and-list followed by one of these is not a plural subject ("Vercel and Heroku is ..."). */
const SINGULAR_AUX = set("is was has s");
const AUX_AND_ADVERBS = new Set([
  ...AUXILIARIES,
  ...set("now also currently since officially fully already long effectively entirely completely permanently both all still then recently actually basically essentially formally yet"),
]);
/** A retirement word followed by one of these is an ACTIVE verb with an object. */
const OBJECT_STARTERS = set("the a an its their our his her my your this that these those some any every it them us him me");
/** A bare (no be-form) retirement word still counts when followed by one of these. */
const RETIREMENT_FOLLOWERS = new Set([
  ...AUXILIARIES,
  ...set("in on since by with as for after before from at last ago earlier and or"),
]);
/** After an and/or list item, these mean the term ends its clause ("Netlify or Vercel anymore"). */
const LIST_TAIL_WORDS = set("anymore either too in on at for with since as from to via by");
/** May precede the first item of a subject list ("Both Vercel and Netlify are retired"). */
const SUBJECT_LEADERS = set("the both either");
/** May sit between a reassertion opener and "still" ("but it still ..."). */
const REASSERT_SKIP = set("it it's they they're we we're this that that's is are was were s has have does do");

const isNegationWord = (t: string) => NEGATION_WORDS.has(t) || t.endsWith("n't");
function isPseudoNegation(t: string, n1: string | undefined, n2: string | undefined): boolean {
  const n = n1 === "a" || n1 === "any" ? n2 : n1; // "not a problem", "without a doubt"
  return n !== undefined && (PSEUDO_FOLLOWERS.has(n) || (t === "no" && SUBJECT_PRONOUNS.has(n)));
}
const phrase = (a: string | undefined, b: string | undefined) => `${a}_${b}`;
const tokenize = (s: string): string[] => s.match(TOKEN_RX) ?? [];
const isBlank = (c: string | undefined) => c === undefined || /\s/.test(c);

type Break = readonly [start: number, end: number, kind: string];

/** Hard clause breaks in one linear pass (a regex here backtracked on long dot runs). */
function hardBreaks(s: string): Break[] {
  const out: Break[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "." || c === "!" || c === "?") {
      let j = i + 1;
      while (j < s.length && (s[j] === "." || s[j] === "!" || s[j] === "?")) j++;
      let k = j;
      while (k < s.length && SENTENCE_CLOSERS.includes(s[k])) k++;
      const ends = isBlank(s[k]);
      if (ends) out.push([i, k, s[j - 1] === "?" ? "?" : "."]);
      i = (ends ? k : j) - 1;
    } else if (c === "\n" || c === "\r" || c === ";") out.push([i, i + 1, ";"]);
    else if (c === ":" && isBlank(s[i + 1])) out.push([i, i + 1, ":"]);
    else if (c === "(" || c === "[") out.push([i, i + 1, "("]);
    else if (c === ")" || c === "]") out.push([i, i + 1, ")"]);
    else if (c === "\u2014" || c === "\u2013") out.push([i, i + 1, "-"]);
    else if (c === "-" && isBlank(s[i - 1])) {
      let j = i + 1;
      while (s[j] === "-") j++;
      if (isBlank(s[j])) out.push([i, j, "-"]); // " - " and " -- ", never "--flag"
      i = j - 1;
    }
  }
  return out;
}

/** Only determiners/old-adjectives, optionally after a usage gerund + preposition ("using", "deploying to"). */
function isDirectObject(gap: string[]): boolean {
  let g = gap;
  if (g.length > 0 && USAGE_GERUNDS.has(g[0])) {
    g = g.slice(1);
    if (g.length > 0 && GERUND_PREPOSITIONS.has(g[0])) g = g.slice(1);
  }
  return g.every((x) => OBJECT_MODIFIERS.has(x));
}

/**
 * Within K tokens before index `c` of `pre`: a real negation particle, a
 * negative subject, or a hedge (almost, if, should have, ...). Any of them
 * means the retirement verb at `c` did not happen.
 */
function particleBefore(pre: string[], c: number): boolean {
  for (let j = Math.max(0, c - NEGATION_WINDOW_TOKENS); j < c; j++) {
    const t = pre[j];
    if (SUBJECT_NEGATORS.has(t) || HEDGES.has(t)) return true;
    if (MODAL_PERFECT_RX.test(t) || (MODALS.has(t) && t !== "must" && pre[j + 1] === "have")) return true;
    if (isNegationWord(t) && !isPseudoNegation(t, pre[j + 1], pre[j + 2])) return true;
  }
  return false;
}

/** "be/get used to" means accustomed or purpose, not past use. */
const isAccustomLeader = (t: string | undefined) =>
  t !== undefined && (BE_FORMS.has(t) || ACCUSTOM_LEADERS.has(t) || /'(?:re|s|m)$/.test(t));

/**
 * Is the occurrence negated by a cue BEFORE it? `pre` = clause tokens up to the
 * term, already cut at the last comma or contrastive word. The nearest cue wins.
 */
function negatedBefore(pre: string[], termEndsList: boolean): boolean {
  for (let c = pre.length - 1; c >= 0; c--) {
    const w = pre[c];
    const dist = pre.length - c; // 1 = directly before the term
    const between = pre.slice(c + 1);
    if (isNegationWord(w)) {
      if (dist > NEGATION_WINDOW_TOKENS || isPseudoNegation(w, pre[c + 1], pre[c + 2])) continue;
      if (between.some((x) => RETIREMENT_ANY.has(x))) return false; // "never stopped using Vercel"
      if (!termEndsList && between.some((x) => x === "and" || x === "or")) continue; // "... and Vercel hosts prod"
      return true;
    }
    const isPhrase = PRE_PHRASES.has(phrase(w, pre[c + 1]));
    if (isPhrase || RETIREMENT_VERBS.has(w)) {
      let gap = isPhrase ? between.slice(1) : between;
      if (isPhrase && PHRASE_TAILS.has(gap[0])) gap = gap.slice(1);
      if (isDirectObject(gap)) return !particleBefore(pre, c); // "haven't retired Vercel" = claim
      continue;
    }
    if (HISTORICAL_ADJECTIVES.has(w) && dist === 1) return true;
    // "used to deploy to", not "used to Vercel" (dist), "got used to" or "it's used to deploy".
    const usedTo = w === "used" && pre[c + 1] === "to" && dist > 2 && !isAccustomLeader(pre[c - 1]);
    if (
      (usedTo || HISTORICAL_ADVERBS.has(w)) &&
      dist <= NEGATION_WINDOW_TOKENS &&
      !between.some((x) => PRESENT_MARKERS.has(x) || MOVE_VERBS.has(x)) // "previously migrated to Vercel"
    ) {
      return true;
    }
  }
  return false;
}

/** Index just past an and/or subject list ("and Netlify", ", X and Y"), else 0. */
function skipCoSubjects(seg: string[]): number {
  const isItem = (t: string) =>
    t !== "," && t !== "and" && t !== "or" && !AUX_AND_ADVERBS.has(t) && !isNegationWord(t) && !RETIREMENT_PREDICATES.has(t);
  let k = 0;
  for (let items = 0; items < MAX_CO_SUBJECTS; items++) {
    let j = k;
    let sep = false;
    while (seg[j] === ",") {
      j++;
      sep = true;
    }
    const conj = seg[j] === "and" || seg[j] === "or" ? seg[j] : undefined;
    if (conj) j++;
    if (!sep && !conj) break;
    let n = 0;
    while (n < MAX_CO_SUBJECT_TOKENS && j < seg.length && isItem(seg[j])) {
      j++;
      n++;
    }
    if (n === 0) break;
    k = j;
    // The conjunction closes the list. "X and Y is/was/has" is not a plural subject.
    if (conj) return conj === "and" && SINGULAR_AUX.has(seg[k]) ? 0 : k;
  }
  return 0; // a comma with no and/or ("Unlike Vercel, Netlify is ...") is not a list
}

const isHeadNoun = (t: string | undefined) =>
  t !== undefined && t !== "," && !AUX_AND_ADVERBS.has(t) && !isNegationWord(t) && !RETIREMENT_PREDICATES.has(t);

/**
 * Index past up to `max` head nouns at `k` ("branch" in "The statenour-master
 * branch is retired"), but only when an auxiliary or negation follows them.
 * "Vercel hosts retired apps" has no auxiliary, so "hosts" is not skipped, and
 * "Vercel says Heroku is retired" needs two (max is 1 without a determiner).
 */
function skipHeadNouns(seg: string[], k: number, max: number): number {
  for (let n = 1; n <= max && isHeadNoun(seg[k + n - 1]); n++) {
    const after = seg[k + n];
    if (after !== undefined && (AUXILIARIES.has(after) || isNegationWord(after))) return k + n;
  }
  return k;
}

/**
 * Is the occurrence negated by a predicate AFTER it? `post` = clause tokens
 * after the term. `headNouns` > 0 means the term opens its clause: a subject
 * list and up to that many head nouns may sit before the predicate.
 */
function negatedAfter(post: string[], headNouns: number): boolean {
  const cut = post.findIndex((t) => CLAUSE_BREAKS.has(t));
  const seg = cut === -1 ? post : post.slice(0, cut);
  let k = 0;
  if (headNouns > 0) k = skipHeadNouns(seg, skipCoSubjects(seg), headNouns);
  let passive = false;
  let pending = false; // "will be retired", "is being retired": not retired yet
  while (k < seg.length && AUX_AND_ADVERBS.has(seg[k])) {
    const t = seg[k];
    if (BE_FORMS.has(t)) passive = true;
    if (t === "being" || (MODALS.has(t) && !(t === "must" && seg[k + 1] === "have"))) pending = true;
    k++;
  }
  const head = seg[k];
  const next = seg[k + 1];
  if (head === undefined) return false;
  if (isNegationWord(head)) {
    let m = k + 1;
    if (head === "no" && seg[m] === "more") return seg[m + 1] === undefined || seg[m + 1] === ","; // "is no more"
    if (head === "no" && seg[m] === "longer") m++;
    while (m < seg.length && AUX_AND_ADVERBS.has(seg[m])) m++;
    return USAGE_WORDS.has(seg[m]) || (seg[m] === "in" && seg[m + 1] === "use"); // anything else is a claim
  }
  if (pending) return false; // a modal or progressive before a retirement head: still current
  if (POST_PHRASES.has(phrase(head, next))) return passive || !OBJECT_STARTERS.has(seg[k + 2]); // "shut down our API"
  if (!RETIREMENT_PREDICATES.has(head)) return false;
  if (next === undefined || next === ",") return true;
  if (OBJECT_STARTERS.has(next)) return false; // "Vercel deprecated their API"
  return passive || RETIREMENT_FOLLOWERS.has(next) || /^\d/.test(next); // "Vercel replaced Railway" = active verb
}

/** A label clause that is just a negation: "Vercel? No.", "Is it on Vercel? Not anymore." */
function isBareNegation(tokens: string[]): boolean {
  const comma = tokens.indexOf(",");
  const head = comma === -1 ? tokens : tokens.slice(0, comma);
  return head.length > 0 && isNegationWord(head[0]) && head.slice(1).every((x) => BARE_NEGATION_TAILS.has(x));
}

/**
 * "... but (it) still ...", "... and still ...", "Although X is retired, it
 * still ..." after the term. "still unused" / "still retired" is not one.
 */
function reasserted(post: string[]): boolean {
  for (let b = 0; b < post.length; b++) {
    if (!REASSERT_OPENERS.has(post[b])) continue;
    let j = b + 1;
    while (j < post.length && REASSERT_SKIP.has(post[j])) j++;
    if (post[j] === "still" && !RETIREMENT_PREDICATES.has(post[j + 1])) return true;
  }
  return false;
}

/**
 * One occurrence. `preAll`/`post` = hard-clause tokens around it; `label` = next
 * clause after a label break; `question` = the clause ends at `?`.
 */
function occurrenceNegated(preAll: string[], post: string[], label: string[] | null, question: boolean): boolean {
  let cut = -1;
  for (let j = preAll.length - 1; j >= 0; j--) {
    if (preAll[j] === "," || CLAUSE_BREAKS.has(preAll[j])) {
      cut = j;
      break;
    }
  }
  const pre = preAll.slice(cut + 1);
  const comma = post.indexOf(",");
  const postHead = comma === -1 ? post : post.slice(0, comma);
  const termEndsList =
    postHead.length === 0 || LIST_TAIL_WORDS.has(postHead[0]) || CLAUSE_BREAKS.has(postHead[0]);
  // The term as the last item of an object list ("no longer use codex/ollama-local
  // or statenour-master", "retired X and Y"): read the cues from the FIRST item.
  let listPre = pre;
  for (let n = 0; termEndsList && n < 2 && listPre.length >= 2; n++) {
    if (!LIST_CONJUNCTIONS.has(listPre[listPre.length - 1])) break;
    listPre = listPre.slice(0, -2);
  }
  // The term opens its clause: nothing but determiners before it, or after the
  // last and/or ("X was retired and the glm-4.7 default was dropped", "The
  // statenour-master and codex/ollama-local branches are retired").
  const leaders = pre.slice(Math.max(pre.lastIndexOf("and"), pre.lastIndexOf("or")) + 1);
  const headNouns = !leaders.every((x) => SUBJECT_LEADERS.has(x)) ? 0 : leaders.length > 0 ? 2 : 1;
  const negated =
    (!question && (negatedBefore(listPre, termEndsList) || negatedAfter(post, headNouns))) ||
    (label !== null && (isBareNegation(label) || negatedAfter(label, 0)));
  return negated && !reasserted(label === null ? post : [...post, ...label]);
}

/** Which expectedFacts are missing from `text` (case-insensitive substring). */
export function missingFacts(text: string, facts: string[]): string[] {
  const hay = lc(text);
  return facts.filter((f) => !hay.includes(lc(f)));
}

/**
 * Grade a TRUTH DOC: it just needs to TEACH the expected facts. Forbidden
 * claims are NOT applied — a truth doc legitimately names retired terms to
 * mark them retired.
 */
export function gradeDoc(ev: MemoryEval, docText: string): EvalOutcome {
  const missing = missingFacts(docText, ev.expectedFacts);
  return {
    id: ev.id,
    category: ev.category,
    severity: ev.severity,
    status: missing.length === 0 ? "pass" : "fail",
    source: "doc",
    missingFacts: missing,
    presentForbidden: [],
    note: missing.length ? `grounding doc ${ev.groundingDoc} missing fact(s)` : undefined,
  };
}

/**
 * Is a forbidden term asserted as a current claim? True when at least one
 * case-insensitive substring occurrence of `term` in `text` is NOT negated in
 * its own clause (rules in the block comment above). A blank term is never a
 * claim; validateDataset flags it. Linear in the length of `text`.
 */
export function forbiddenAsClaim(text: string, term: string): boolean {
  const norm = (s: string) => lc(s).replace(/[\u2018\u2019]/g, "'"); // same length: indices stay valid
  const hay = norm(text);
  const t = norm(term);
  if (!t.trim() || !hay.includes(t)) return false;
  const breaks = hardBreaks(hay);
  let p = 0; // breaks[0..p) end at or before the current occurrence
  for (let i = hay.indexOf(t); i !== -1; i = hay.indexOf(t, i + 1)) {
    const end = i + t.length;
    while (p < breaks.length && breaks[p][1] <= i) p++;
    let q = p;
    while (q < breaks.length && breaks[q][0] < end) q++; // a break inside the term does not end its clause
    const clauseStart = p > 0 ? breaks[p - 1][1] : 0;
    const clauseEnd = q < breaks.length ? breaks[q][0] : hay.length;
    const preAll = tokenize(hay.slice(Math.max(clauseStart, i - WINDOW_CHARS), i));
    const post = tokenize(hay.slice(end, Math.min(clauseEnd, end + WINDOW_CHARS)));
    const kind = q < breaks.length ? breaks[q][2] : "";
    let label: string[] | null = null;
    if (post.length === 0 && LABEL_BREAKS.has(kind)) {
      const from = breaks[q][1];
      const to = q + 1 < breaks.length ? breaks[q + 1][0] : hay.length;
      label = tokenize(hay.slice(from, Math.min(to, from + WINDOW_CHARS)));
    }
    if (!occurrenceNegated(preAll, post, label, kind === "?")) return true;
  }
  return false;
}

/**
 * Grade a free-form ANSWER (e.g. what Nick said). Must contain expectedFacts
 * AND must not assert any forbiddenClaim as current. This is the path a future
 * LLM-judge would feed; default runs use gradeDoc.
 */
export function gradeAnswer(ev: MemoryEval, answer: string): EvalOutcome {
  const missing = missingFacts(answer, ev.expectedFacts);
  const present = ev.forbiddenClaims.filter((c) => forbiddenAsClaim(answer, c));
  return {
    id: ev.id,
    category: ev.category,
    severity: ev.severity,
    status: missing.length === 0 && present.length === 0 ? "pass" : "fail",
    source: "answer",
    missingFacts: missing,
    presentForbidden: present,
  };
}

export interface RunOptions {
  /** repo-relative path -> file content, for groundingDoc evals. */
  sources?: Record<string, string>;
  /** eval id -> a candidate answer to grade (overrides doc grounding). */
  answers?: Record<string, string>;
}

/** Dataset validity — the CI guard. Returns human-readable issues ([] = ok). */
export function validateDataset(evals: MemoryEval[]): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const ev of evals) {
    if (seen.has(ev.id)) issues.push(`duplicate id: ${ev.id}`);
    seen.add(ev.id);
    if (!ev.id.trim()) issues.push("eval with empty id");
    if (!ev.question.trim()) issues.push(`${ev.id}: empty question`);
    if (ev.expectedFacts.length === 0) issues.push(`${ev.id}: no expectedFacts`);
    if (ev.expectedFacts.some((f) => !f.trim())) issues.push(`${ev.id}: blank expectedFact`);
    if (ev.forbiddenClaims.some((c) => !c.trim())) issues.push(`${ev.id}: blank forbiddenClaim`);
    if (ev.sourceHints.length === 0) issues.push(`${ev.id}: no sourceHints`);
  }
  return issues;
}

const EMPTY_BUCKET = () => ({ total: 0, passed: 0, failed: 0, manual: 0 });

/** Run the dataset. With no sources/answers, every eval is "manual". */
export function runMemoryEvals(evals: MemoryEval[], opts: RunOptions = {}): MemoryEvalRunResult {
  const { sources = {}, answers = {} } = opts;
  const results: EvalOutcome[] = [];

  for (const ev of evals) {
    if (answers[ev.id] != null) {
      results.push(gradeAnswer(ev, answers[ev.id]));
    } else if (ev.groundingDoc && sources[ev.groundingDoc] != null) {
      results.push(gradeDoc(ev, sources[ev.groundingDoc]));
    } else {
      results.push({
        id: ev.id,
        category: ev.category,
        severity: ev.severity,
        status: "manual",
        source: "none",
        missingFacts: [],
        presentForbidden: [],
        note: ev.groundingDoc ? `grounding doc not provided: ${ev.groundingDoc}` : "no grounding doc",
      });
    }
  }

  const byCategory: Record<string, ReturnType<typeof EMPTY_BUCKET>> = {};
  for (const r of results) {
    const cat = r.category as MemoryEvalCategory;
    byCategory[cat] ??= EMPTY_BUCKET();
    byCategory[cat].total++;
    if (r.status === "pass") byCategory[cat].passed++;
    else if (r.status === "fail") byCategory[cat].failed++;
    else byCategory[cat].manual++;
  }

  return {
    total: results.length,
    passed: results.filter((r) => r.status === "pass").length,
    failed: results.filter((r) => r.status === "fail").length,
    manual: results.filter((r) => r.status === "manual").length,
    criticalFailures: results.filter((r) => r.status === "fail" && r.severity === "critical"),
    byCategory,
    datasetIssues: validateDataset(evals),
    results,
  };
}
