/**
 * Creative fingerprint — semantic novelty without an embedding call.
 *
 * THE DEFECT. The autopost lane's novelty guard compares `conceptKey` against
 * the last 30 posts, and novelty carries weight 0.1 in the caption rubric. So:
 *
 *   "cleveland-pothole-alignment"   and   "pothole-steering-problem"
 *
 * score as fully distinct. They are the same post. The reel lane is better —
 * `contentTopicMiner.isNearDuplicate` does word-overlap at 0.6, which tolerates
 * rewording — but overlap still only sees WORDS. "What potholes do to your
 * alignment" and "Why your steering changed after that pothole" share almost no
 * long words and are creative twins.
 *
 * ★ WHY NOT EMBEDDINGS. Cosine similarity would catch those two, and it would
 * answer "0.83 similar" — a number nobody can act on. This returns WHICH
 * dimension collided, so the caller can say "same subject, same claim shape,
 * vary the angle" and the generator has somewhere to go. It also costs zero API
 * calls on a lane pinned to a single funded provider, and stays pure and
 * testable. If a real embedding lane ever exists, this stays useful as the
 * explainer on top of it.
 *
 * The dimensions are the ones a creative brief actually varies. Two pieces are
 * COUSINS when they share a subject AND a claim shape — that pair is what makes
 * an audience feel they have seen this before, regardless of wording.
 */

/** What the piece is physically about. */
export type Subject = string;

/**
 * The rhetorical move. This is the axis that matters most: the same subject
 * with a different claim shape reads as a genuinely new piece, while the same
 * claim shape on a different subject reads as a format the page runs.
 */
export type ClaimShape =
  | "hidden_cause"      // the thing you blame is not the thing at fault
  | "myth_bust"         // a widely-held belief is wrong
  | "cost_of_waiting"   // ignoring it gets more expensive
  | "symptom_decode"    // one symptom, several possible causes
  | "refusal"           // what we will NOT sell you
  | "comparison"        // A vs B
  | "how_it_works"      // mechanism explainer
  | "unclassified";

export interface Fingerprint {
  /**
   * EVERY subject the piece touches, not just the first match.
   *
   * A single-subject fingerprint was the first design and it was wrong: "What
   * potholes do to your alignment" and "Why your steering changed after that
   * pothole" are the twins this module exists to catch, and a first-match-wins
   * lookup resolved one to `alignment` and the other to `pothole` — so the
   * headline case scored as fully novel. Content is legitimately about more
   * than one thing; the overlap between subject SETS is the real signal.
   */
  subjects: Subject[];
  /** Convenience: the most specific subject, for display. Never used for scoring. */
  subject: Subject;
  claimShape: ClaimShape;
  /** Long content words, for a secondary overlap tiebreak. */
  tokens: string[];
}

/**
 * Subject vocabulary. Ordered longest-phrase-first so "control arm" wins over
 * "arm" and "wheel bearing" over "wheel" — a shorter alias matching first would
 * collapse distinct subjects into one and suppress legitimate variety.
 */
const SUBJECTS: ReadonlyArray<readonly [Subject, RegExp]> = [
  ["control arm", /\bcontrol arm/i],
  ["wheel bearing", /\b(wheel bearing|hub bearing|hub or bearing)/i],
  ["catalytic converter", /\bcatalytic|\bcat converter/i],
  ["oxygen sensor", /\b(oxygen sensor|o2 sensor)/i],
  ["tie rod", /\btie rod/i],
  ["ball joint", /\bball joint/i],
  ["strut", /\b(strut|shock absorber|shocks)\b/i],
  ["alignment", /\balign/i],
  ["tire wear", /\b(tread|tire wear|bald|wear pattern)/i],
  ["tire pressure", /\b(psi|tire pressure|tpms|inflat)/i],
  ["brakes", /\b(brake|rotor|caliper|brake pad)/i],
  ["water pump", /\bwater pump/i],
  ["radiator", /\b(radiator|coolant|overheat)/i],
  ["alternator", /\b(alternator|battery|charging system)/i],
  ["check engine", /\b(check engine|engine light|obd|scan tool)/i],
  ["pothole", /\bpothole/i],
  ["road salt", /\b(road salt|salt|rust|corros)/i],
  ["exhaust", /\b(exhaust|muffler)/i],
  ["suspension", /\bsuspension/i],
  ["tires", /\btire|\btyre/i],
];

/**
 * Claim-shape cues. Order matters here too — a piece that is BOTH a myth-bust
 * and a hidden-cause is classified by whichever cue is more specific, and
 * hidden_cause is checked first because "it is not the X, it is the Y" is the
 * stronger creative signature.
 */
const CLAIM_SHAPES: ReadonlyArray<readonly [ClaimShape, RegExp]> = [
  // hidden_cause covers BOTH directions of the same move: "the thing you blame
  // is not at fault", and "this event caused a symptom you did not connect to
  // it". The consequence form was missing at first and it cost the module its
  // headline case — "What potholes do to your alignment" and "Why your steering
  // changed after that pothole" both scored `unclassified`, so the twins this
  // exists to catch reached only 0.45 on subject alone.
  ["hidden_cause", /\b(is ?n[o']?t (always |necessarily )?(the|why|your)|not the (real )?(cause|problem)|might not be|blame|actually the|the real (cause|reason)|behind it|what .{0,20}\bdo(es)? to\b|(changed|shifted|started|showed up) (right )?after)/i],
  ["refusal", /\b(we (wo|will) ?n[o']?t|refuse|before we sell|we do ?n[o']?t sell|won'?t sell|tell you when)/i],
  ["myth_bust", /\b(myth|does ?n[o']?t (fix|mean|help)|wo ?n[o']?t fix|misconception|everybody thinks|common belief|false)/i],
  ["cost_of_waiting", /\b(cheap repair|expensive|costs? more|waiting|ignore[ds]?|puts? off|later|becomes? the)/i],
  ["comparison", /\b( vs\.? | versus |compared to|difference between|which one)/i],
  ["symptom_decode", /\b(one (sound|noise|symptom)|three (different|possible)|could mean|what that (sound|noise)|symptom)/i],
  ["how_it_works", /\b(what (a|an|your) .* (actually )?does|how (it|a|an) works|never been shown|what it is)/i],
];

const STOP = new Set(["this","that","your","with","from","what","when","have","been","they","then","than","into","just","only","does","doesn","about","after","before","which","their","there","would","could","should","every","other","some","more","most","also","because","while"]);

export function fingerprint(text: string): Fingerprint {
  const s = (text || "").toLowerCase();
  const subjects = SUBJECTS.filter(([, re]) => re.test(s)).map(([name]) => name);
  const claimShape = CLAIM_SHAPES.find(([, re]) => re.test(s))?.[0] ?? "unclassified";
  // Stem trailing plurals: "pothole" and "potholes" are the same idea, and an
  // unstemmed overlap check scored them as sharing nothing.
  const tokens = Array.from(
    new Set(
      s
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 4 && !STOP.has(w))
        .map((w) => (/[^s]s$/.test(w) ? w.slice(0, -1) : w)),
    ),
  );
  // SUBJECTS is ordered most-specific-first, so the first hit is the best label.
  return { subjects, subject: subjects[0] ?? "unclassified", claimShape, tokens };
}

export interface NoveltyVerdict {
  /** 0 = wholly new, 1 = the same piece. */
  similarity: number;
  /** True when this should not be produced as-is. */
  isCousin: boolean;
  /** Which dimensions collided — this is the actionable part. */
  collisions: string[];
  /** Concrete axes to change, in the order most likely to help. */
  suggestions: string[];
  /** The prior it most resembles, for the operator queue. */
  nearest?: string;
}

const ALL_SHAPES: ClaimShape[] = ["hidden_cause","myth_bust","cost_of_waiting","symptom_decode","refusal","comparison","how_it_works"];

function tokenOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const B = new Set(b);
  let shared = 0;
  for (const t of a) if (B.has(t)) shared++;
  return shared / Math.min(a.length, b.length);
}

/**
 * Compare a candidate against recent pieces.
 *
 * ★ SUBJECT + CLAIM SHAPE TOGETHER is the cousin test. Subject alone would ban
 * the page from ever mentioning brakes twice, which is absurd for a shop whose
 * revenue IS brakes and suspension. Claim shape alone would ban running the
 * "hidden cause" move on two unrelated parts, which is a format, not a
 * repetition. Only the PAIR means the audience has seen this piece.
 */
export function assessNovelty(candidate: string, priors: string[]): NoveltyVerdict {
  const fc = fingerprint(candidate);
  let best = { sim: 0, prior: "", collisions: [] as string[] };

  for (const prior of priors) {
    const fp = fingerprint(prior);
    const collisions: string[] = [];
    let sim = 0;

    // Subject OVERLAP, not equality — see the Fingerprint.subjects note. A piece
    // about potholes-and-alignment collides with one about potholes-and-steering
    // because they share `pothole`, which is what a viewer notices.
    const shared = fc.subjects.filter((x) => fp.subjects.includes(x));
    const shapeSame = fc.claimShape === fp.claimShape && fc.claimShape !== "unclassified";
    if (shared.length > 0) { sim += 0.45; collisions.push(`subject:${shared.join("+")}`); }
    if (shapeSame) { sim += 0.35; collisions.push(`claim:${fc.claimShape}`); }
    // Wording overlap is the tiebreak, never the driver — two pieces can share
    // no long words and still be the same idea, which is the whole defect.
    const overlap = tokenOverlap(fc.tokens, fp.tokens);
    if (overlap >= 0.5) { sim += 0.2; collisions.push(`wording:${Math.round(overlap * 100)}%`); }

    // `>=` on the first comparison so the nearest prior is ALWAYS reported, even
    // at similarity 0. "Nothing resembled this" and "I did not look" must not
    // render identically in the operator queue.
    if (sim > best.sim || best.prior === "") best = { sim, prior, collisions };
  }

  const isCousin = best.sim >= 0.75;
  const suggestions: string[] = [];
  if (isCousin) {
    const unused = ALL_SHAPES.filter((s) => s !== fc.claimShape);
    suggestions.push(`change the claim shape — try ${unused.slice(0, 3).join(", ")}`);
    if (fc.subject !== "unclassified") suggestions.push(`or keep the shape and move to a different subject than "${fc.subject}"`);
    suggestions.push("or change the audience/emotion while holding the subject");
  }

  return {
    similarity: Math.round(Math.min(1, best.sim) * 100) / 100,
    isCousin,
    collisions: best.collisions,
    suggestions,
    ...(best.prior ? { nearest: best.prior } : {}),
  };
}
