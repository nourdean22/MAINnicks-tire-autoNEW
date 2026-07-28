/**
 * Instagram + Facebook Autonomous Poster — Nick's Tire & Auto
 *
 * The Meta sibling of `gbpAutoPost.ts`. Same cron + fire-now + durable-log
 * spine, but the hardcoded template bank is REPLACED by an LLM-generated,
 * source-grounded content brain plus a dual eval gate.
 *
 * Pipeline per run (runIgAutopost):
 *   1. SIGNAL BRIEF  — pull from the shop's OWN data (reviews, declined
 *      work, aggregated call/SMS question-patterns, IG analytics, specials,
 *      services, Cleveland season). Each source is resilient: an error
 *      skips that signal, never fails the run. PRIVACY: call/SMS signals
 *      are AGGREGATED pattern counts only — no individual name, quote, or
 *      PII ever reaches a post.
 *   2. GENERATE      — invokeLLM writes a hook-first caption + a pro-image
 *      prompt + hashtags, grounded in the brief and the playbook voice,
 *      biased toward formats that have performed. Anti-repetition: a random
 *      dial combination + the last ~30 posts' concept-keys are fed in as a
 *      "do NOT repeat" list.
 *   3. IMAGE         — generatePostImage(prompt) → JPEG public URL (IG
 *      rejects PNG; see generatePostImage). Prompt forces professional craft.
 *   4. DUAL EVAL     — LLM-as-judge scores the caption on a weighted rubric
 *      (viral shape · voice · price-compliance · novelty · no-fabrication);
 *      the vision analyzer scores the image's pro-look (skipped gracefully
 *      if REPLICATE_API_KEY is unset). Weighted score must clear 0.7 or we
 *      regenerate (≤2×) then ABORT.
 *   5. POST / DRYRUN — dryRun (default TRUE via IG_AUTOPOST_DRYRUN) logs +
 *      sends a Telegram PREVIEW. Live posts to IG (JPEG) + FB and captures
 *      ids/errors.
 *   6. LOG           — every run lands in ig_autopost_log for the variety
 *      guard + admin review.
 *
 * SAFETY: this posts to a LIVE business account. dryRun is TRUE unless
 * IG_AUTOPOST_DRYRUN is explicitly "false". No kill-list voice words live
 * in this file's strings or comments (the brand-voice lint scans copy).
 */

import { BUSINESS } from "@shared/business";
import { renderBannedWordsForPrompt, renderCriticRubricForPrompt } from "@shared/voice";
import { createLogger } from "../lib/logger";
import { db } from "../lib/db-helper";
import { igAutopostLog, algEstimates, smsConversations, smsMessages, specials } from "../../drizzle/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { invokeLLM } from "../_core/llm";
import { isEnabled } from "./featureFlags";
import { ensureHiggsfieldBinary } from "./higgsfieldBinary";

const log = createLogger("ig-autopost");

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export type IgSlot = "morning" | "midday" | "evening";
/** Content angle the LLM writes toward. Doubles as the log's archetype. */
export type IgArchetype = "proof" | "anti" | "math" | "seasonal" | "question" | "process";
export type IgStatus = "dryrun" | "posted" | "failed" | "aborted";
export type IgSource = "cron" | "admin";

interface SignalBrief {
  reviews: Array<{ rating: number; text: string }>;
  declinedPatterns: string[];
  questionPatterns: string[];
  igInsight: { topType: string | null; topFormatsNote: string };
  activeSpecials: Array<{ title: string; code: string | null }>;
  season: { label: string; note: string };
  recentConceptKeys: string[];
}

interface GeneratedPost {
  archetype: IgArchetype;
  caption: string;
  hashtags: string[];
  imagePrompt: string;
  conceptKey: string;
  visualConcept: string;
}

interface CaptionEval {
  viralShape: number;     // 0-1 — viral-content-engine 4-element shape
  voice: number;          // 0-1 — VOICE.md 6-question grade
  priceCompliance: number; // 0-1 — HARD gate, only advertisable prices, no repair $
  novelty: number;        // 0-1 — distinct vs recentConceptKeys
  noFabrication: number;  // 0-1 — no invented reviews / fake customers / fake stats
  notes: string;
}

export interface IgEvalScores {
  caption: CaptionEval;
  captionWeighted: number;
  image: { proLook: number | null; skipped: boolean; note: string };
  overall: number;
  passed: boolean;
}

export interface RunIgAutopostResult {
  recordsProcessed: number;
  details: string;
  status: IgStatus;
  archetype?: IgArchetype;
  conceptKey?: string;
  scores?: IgEvalScores;
  igPostId?: string | null;
  fbPostId?: string | null;
  dryRun: boolean;
}

// ─────────────────────────────────────────────────────────
// CONSTANTS — eval rubric weights + thresholds (single source of truth)
// ─────────────────────────────────────────────────────────

const PASS_THRESHOLD = 0.7;
const MAX_REGEN_ATTEMPTS = 2; // generate once, then up to 2 retries = 3 LLM passes max
const RECENT_CONCEPT_LIMIT = 30;
const IMAGE_PRO_LOOK_MIN = 0.6; // when the image WAS scored, it must clear this

// Caption rubric weights (sum to 1.0). priceCompliance + noFabrication are
// weighted heavy because they are correctness/safety dims, not taste dims.
const CAPTION_WEIGHTS: Record<keyof Omit<CaptionEval, "notes">, number> = {
  viralShape: 0.25,
  voice: 0.2,
  priceCompliance: 0.25,
  novelty: 0.1,
  noFabrication: 0.2,
};

// The ONLY prices that may ever appear in an autopost. Anything else —
// especially a repair price — is a hard compliance failure. Mirrors the
// shop's advertisable-price policy.
const ADVERTISABLE_PRICES = [
  "used tires from $60 installed",
  "oil change $49",
  "synthetic oil change $80",
];

// Anti-repetition dials. The generator picks one of each at random so two
// runs rarely share a creative skeleton. These are PROMPT INPUTS, not
// output templates — the model writes original copy around them.
const DIALS = {
  angle: [
    "a real customer outcome (no invented names — describe the situation, not a person)",
    "an anti-promise: name something the shop refuses to do that other shops do",
    "math-as-argument: a small number today vs a big number later",
    "a Cleveland-season hook tied to what the weather does to a car",
    "the single most-asked question this month, answered plainly",
    "process transparency: show one step of how the work actually happens",
  ],
  visualConcept: [
    "bold editorial poster — one oversized number or word, high-contrast, magazine cover energy",
    "cinematic concept shot — dramatic single-subject lighting, shallow depth, moody garage atmosphere",
    "clean product hero — a single part or tire on a seamless studio backdrop, crisp and minimal",
    "stylized 3D render — a tire/brake rotor as a sculptural object, soft shadows, premium catalog look",
  ],
  hookStyle: [
    "a specific surprising number in the first 5 words",
    "a flat counterintuitive statement (not a question)",
    "a tiny scene-set: day, weather, one concrete detail",
    "a blunt admission a competitor would never make",
  ],
  clevelandHook: [
    "road salt and what it does under the car",
    "potholes after the thaw on a named East Side street",
    "the first 90-degree day and what it reveals",
    "winter mornings and cold-weather failures",
    "an I-90 / I-271 commute detail",
  ],
  tone: [
    "dry and confident, one wink of humor max",
    "plainspoken neighbor giving real advice",
    "deadpan, slightly absurd but genuinely useful",
  ],
  // ONE call-to-action per post — never stacked. IG captions can't carry a
  // clickable link, so saves/sends/DMs/calls/bio-link are the real moves.
  cta: [
    "SAVE trigger: end with a 'save this for the next cold snap / when that light comes on' line, then a soft drop-offs-welcome",
    "SEND trigger: end with 'send this to the friend whose car makes that noise', then a walk-in line",
    "DM driver: invite a DM with their year/make/model + the symptom for a straight, no-pressure answer",
    "CALL driver: a direct call-now line using the shop's phone number, tied to the exact problem it solves",
    "BIO-LINK: point to the booking/estimate link in bio, plus drop-offs welcome",
  ],
};

// ─────────────────────────────────────────────────────────
// SLOT GATING (cron fires every ~15 min; we self-gate to a slot window)
// ─────────────────────────────────────────────────────────

const SLOT_HOURS: Record<IgSlot, number> = { morning: 8, midday: 13, evening: 20 };
const SLOT_MINUTE = 7; // off-:00 to dodge the top-of-hour cron stampede
const SLOT_WINDOW_MIN = 12; // fire if within ±12 min of the slot minute

function etParts(now: Date): { hour: number; minute: number } {
  const hour = parseInt(
    now.toLocaleString("en-US", { timeZone: BUSINESS.timezone, hour: "numeric", hour12: false }),
    10,
  );
  const minute = parseInt(now.toLocaleString("en-US", { timeZone: BUSINESS.timezone, minute: "numeric" }), 10);
  return { hour, minute };
}

/** Which slot (if any) the current ET time falls into. Null = not slot time. */
function currentSlot(now: Date): IgSlot | null {
  const { hour, minute } = etParts(now);
  for (const slot of Object.keys(SLOT_HOURS) as IgSlot[]) {
    if (hour === SLOT_HOURS[slot] && Math.abs(minute - SLOT_MINUTE) <= SLOT_WINDOW_MIN) {
      return slot;
    }
  }
  return null;
}

/** ET calendar date (YYYY-MM-DD) — used to dedupe one post per slot per day. */
function etDateKey(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone }); // en-CA → ISO-like
}

/**
 * Have we already posted (or dry-ran) THIS slot today? Guards the 15-min
 * cron cadence from double-posting inside a single slot window. Counts
 * dryrun + posted, ignores failed/aborted so a transient failure can retry
 * on the next tick inside the window.
 */
async function alreadyRanSlotToday(slot: IgSlot, now: Date): Promise<boolean> {
  try {
    const d = await db();
    if (!d) return false; // DB down — fail-open so the slot can still fire once
    const dayKey = etDateKey(now);
    const rows = await d
      .select({ id: igAutopostLog.id })
      .from(igAutopostLog)
      .where(
        and(
          eq(igAutopostLog.slot, slot),
          eq(igAutopostLog.slotDate, dayKey),
          // A CAP HOLD IS TERMINAL FOR THE SLOT. (Review catch, P2.)
          //
          // `aborted` covers two very different outcomes: an eval-gate failure,
          // where a later tick SHOULD retry because a fresh draft might pass;
          // and a daily-cap hold, where retrying cannot possibly succeed —
          // the cap does not fall during the day. Without this, every
          // subsequent tick in the slot re-ran the whole pipeline and re-sent
          // the Telegram notice, so a capped day burned generation spend
          // repeatedly and spammed the operator.
          //
          // Matched on the error text rather than a new status: the `status`
          // column is a 4-value enum and widening it is a migration, which is
          // not worth it to distinguish two flavours of the same outcome.
          sql`(${igAutopostLog.status} IN ('dryrun','posted')
               OR (${igAutopostLog.status} = 'aborted' AND ${igAutopostLog.error} LIKE 'Blocked by content governor%'))`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    log.warn("alreadyRanSlotToday check failed — fail-open", { err: errMsg(err) });
    return false;
  }
}

// ─────────────────────────────────────────────────────────
// SIGNAL BRIEF — pull from the shop's OWN data (each source resilient)
// ─────────────────────────────────────────────────────────

async function buildSignalBrief(): Promise<SignalBrief> {
  const [reviews, declinedPatterns, questionPatterns, igInsight, activeSpecials, recentConceptKeys] =
    await Promise.all([
      fetchRecentReviews(),
      fetchDeclinedPatterns(),
      fetchQuestionPatterns(),
      fetchIgInsight(),
      fetchActiveSpecials(),
      fetchRecentConceptKeys(),
    ]);
  return {
    reviews,
    declinedPatterns,
    questionPatterns,
    igInsight,
    activeSpecials,
    season: pickSeason(),
    recentConceptKeys,
  };
}

/** Real, public Google reviews. Real quotes are allowed (they are public). */
async function fetchRecentReviews(): Promise<Array<{ rating: number; text: string }>> {
  try {
    const { getGoogleReviews } = await import("../google-reviews");
    const data = await getGoogleReviews();
    if (!data?.reviews?.length) return [];
    return data.reviews
      .filter((r) => r.rating >= 4 && r.text && r.text.trim().length > 20)
      .slice(0, 6)
      .map((r) => ({ rating: r.rating, text: r.text.trim().slice(0, 280) }));
  } catch (err) {
    log.warn("review signal skipped", { err: errMsg(err) });
    return [];
  }
}

/**
 * Declined-work / objection patterns from alg_estimates. We surface the
 * SERVICE category language only (no customer names) so the post can speak
 * to the objection ("dealer quoted $X for brakes") without exposing anyone.
 */
async function fetchDeclinedPatterns(): Promise<string[]> {
  try {
    const d = await db();
    if (!d) return [];
    const since = new Date(Date.now() - 120 * 86400000);
    const rows = await d
      .select({ service: algEstimates.serviceDescription, amount: algEstimates.estimatedAmount })
      .from(algEstimates)
      .where(and(gte(algEstimates.estimateDate, since), sql`${algEstimates.matchedInvoiceId} IS NULL`))
      .orderBy(desc(algEstimates.estimateDate))
      .limit(40);
    const counts = new Map<string, number>();
    for (const r of rows) {
      const key = normalizeServiceTopic(r.service);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic, n]) => `${topic} (declined ${n}×)`);
  } catch (err) {
    log.warn("declined-pattern signal skipped", { err: errMsg(err) });
    return [];
  }
}

/**
 * Aggregated top customer question-patterns from inbound SMS. PRIVACY: we
 * NEVER read or surface an individual message body or a customer name. We
 * bucket inbound messages into broad service topics by keyword and return
 * COUNTS only. Call (VAPI) questions fold into the same topic buckets when
 * present, but the same aggregate-only rule applies.
 */
async function fetchQuestionPatterns(): Promise<string[]> {
  try {
    const d = await db();
    if (!d) return [];
    const since = new Date(Date.now() - 60 * 86400000);
    // Read ONLY inbound message bodies, bucket by topic, discard the text.
    const rows = await d
      .select({ body: smsMessages.body })
      .from(smsMessages)
      .innerJoin(smsConversations, eq(smsMessages.conversationId, smsConversations.id))
      .where(and(eq(smsMessages.direction, "inbound"), gte(smsMessages.createdAt, since)))
      .limit(500);
    const counts = new Map<string, number>();
    for (const r of rows) {
      const topic = bucketQuestionTopic(r.body);
      if (!topic) continue;
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic, n]) => `${topic} (asked ${n}×)`);
  } catch (err) {
    log.warn("question-pattern signal skipped", { err: errMsg(err) });
    return [];
  }
}

/** IG analytics → bias toward what has performed (engagement by type + top posts). */
async function fetchIgInsight(): Promise<{ topType: string | null; topFormatsNote: string }> {
  try {
    const { getEngagementByType, getTopPosts } = await import("../pipelines/instagram-data");
    const [byType, top] = await Promise.all([getEngagementByType(), getTopPosts({ limit: 5 })]);

    // SIGNAL GUARD. This string is injected VERBATIM into the live content
    // generation prompt, so naming a "top-performing format" tells the model to
    // bias real posts toward it.
    //
    // Measured in production: instagram_analytics has 34 rows. engagementRate
    // is exactly 0 on 26 of them (76%), comments is 0 on all 34, and the entire
    // dataset contains NINE likes. IMAGE (29 posts, avg 0.83) "beat" VIDEO
    // (5 posts, avg 0.60) on the strength of a single post that got 2 likes.
    // `byType[0]?.type` took that as a verdict.
    //
    // Ranking noise is worse here than having no ranking: an unfounded
    // preference gets laundered through the prompt into every future post.
    const MIN_POSTS_PER_TYPE = 5;
    const MIN_TYPES_TO_COMPARE = 2;
    const withSignal = byType.filter((t) => t.postCount >= MIN_POSTS_PER_TYPE && t.avgEngagementRate > 0);
    const haveSignal = withSignal.length >= MIN_TYPES_TO_COMPARE;
    const topType = haveSignal ? withSignal[0].type : null;

    const themes = [...new Set(top.flatMap((p) => p.themes))].slice(0, 6);
    const formatClause = topType
      ? `Top-performing format is ${topType}`
      : `Not enough engagement data to say which format performs — do NOT bias toward one`;
    const note = themes.length
      ? `${formatClause}; recurring high-engagement themes: ${themes.join(", ")}.`
      : `${formatClause} (limited history — lean on craft).`;
    return { topType, topFormatsNote: note };
  } catch (err) {
    log.warn("ig-insight signal skipped", { err: errMsg(err) });
    return { topType: null, topFormatsNote: "No IG analytics yet — lean on craft and the playbook." };
  }
}

async function fetchActiveSpecials(): Promise<Array<{ title: string; code: string | null }>> {
  try {
    const d = await db();
    if (!d) return [];
    const rows = await d
      .select({ title: specials.title, code: specials.couponCode })
      .from(specials)
      .where(
        and(
          eq(specials.isActive, true),
          eq(specials.displayOnWebsite, true),
          sql`(${specials.expiresAt} IS NULL OR ${specials.expiresAt} > NOW())`,
        ),
      )
      .limit(3);
    return rows.map((r: { title: string; code: string | null }) => ({ title: r.title, code: r.code }));
  } catch (err) {
    log.warn("specials signal skipped", { err: errMsg(err) });
    return [];
  }
}

/** Last ~30 concept-keys, so the model can be told what NOT to repeat. */
export async function fetchRecentConceptKeys(): Promise<string[]> {
  try {
    const d = await db();
    if (!d) return [];
    const rows = await d
      .select({ key: igAutopostLog.conceptKey })
      .from(igAutopostLog)
      .orderBy(desc(igAutopostLog.createdAt))
      .limit(RECENT_CONCEPT_LIMIT);
    return rows.map((r: { key: string | null }) => r.key).filter((k: string | null): k is string => !!k);
  } catch (err) {
    log.warn("recent-concept signal skipped", { err: errMsg(err) });
    return [];
  }
}

// ─── topic bucketing (keyword → broad service topic; no PII retained) ──

const TOPIC_KEYWORDS: Array<{ topic: string; rx: RegExp }> = [
  { topic: "brakes", rx: /\bbrak|rotor|caliper|pad(s)?\b/i },
  { topic: "tires", rx: /\btire|tyre|tread|flat|patch|rotat|alignment\b/i },
  { topic: "oil change", rx: /\boil change|oil\b/i },
  { topic: "engine light / diagnostics", rx: /\bcheck engine|engine light|code(s)?|diagnos|misfire|stall/i },
  { topic: "E-Check / emissions", rx: /\be.?check|emission|smog/i },
  { topic: "AC / heating", rx: /\b(a\/?c|air condition|heat|blower|refrigerant)\b/i },
  { topic: "battery / starting", rx: /\bbattery|won.?t start|no start|jump|alternator/i },
  { topic: "pricing / quote", rx: /\bhow much|price|quote|cost|estimate|\$/i },
  { topic: "hours / walk-in", rx: /\bopen|hours|walk.?in|appointment|today|sunday/i },
];

function bucketQuestionTopic(body: string | null): string | null {
  if (!body) return null;
  for (const { topic, rx } of TOPIC_KEYWORDS) {
    if (rx.test(body)) return topic;
  }
  return null;
}

function normalizeServiceTopic(service: string | null): string | null {
  if (!service) return null;
  const t = bucketQuestionTopic(service);
  if (t) return t;
  const trimmed = service.trim().toLowerCase();
  return trimmed ? trimmed.slice(0, 40) : null;
}

// ─── Cleveland season (mirrors the playbook's seasonal logic) ──────

function pickSeason(): { label: string; note: string } {
  const month = new Date().getMonth(); // 0=Jan
  if (month === 2 || month === 3)
    return { label: "early-spring thaw", note: "Salt-truck season just ended; scarred roads, potholes, knocked-out alignment." };
  if (month >= 5 && month <= 6)
    return { label: "early summer", note: "First hot days expose winter-cracked AC O-rings and weak blower motors." };
  if (month === 7 || month === 8)
    return { label: "late summer / road-trip", note: "Long-haul drives reveal bald tires and dying batteries before a trip." };
  if (month === 9 || month === 10)
    return { label: "fall winter-prep", note: "First frost weeks out; battery failure rate climbs as temps drop." };
  if (month >= 11 || month === 0 || month === 1)
    return { label: "deep winter", note: "Road salt corrodes brake lines and accelerates frame rust right now." };
  return { label: "mid-season", note: "Routine maintenance is cheaper than the emergency it prevents." };
}

// ─────────────────────────────────────────────────────────
// GENERATION (LLM)
// ─────────────────────────────────────────────────────────

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function archetypeFromAngle(angle: string): IgArchetype {
  if (angle.startsWith("an anti-promise")) return "anti";
  if (angle.startsWith("math-as-argument")) return "math";
  if (angle.startsWith("a Cleveland-season")) return "seasonal";
  if (angle.startsWith("the single most-asked")) return "question";
  if (angle.startsWith("process transparency")) return "process";
  return "proof";
}

/** Map a forced archetype back to its dial angle so the admin button can steer. */
function angleForArchetype(a: IgArchetype): string {
  const map: Record<IgArchetype, number> = { proof: 0, anti: 1, math: 2, seasonal: 3, question: 4, process: 5 };
  return DIALS.angle[map[a]] ?? DIALS.angle[0];
}

/** Bump when the gen/eval prompts change · stamped on every ig_autopost_log
 * row so a content-quality shift can be tied to the prompt edit that caused it. */
// 2026-07-27 — Voice Kernel wave. The emitted prompt text changed even though
// the intent did not: the generator's banned-phrase line and the critic's voice
// rubric now RENDER from shared/voice.ts instead of being two hand-written
// lists that disagreed, and the critic's price line interpolates the BUSINESS
// SSOT instead of hardcoding "used tires from $60 installed". Scoring will shift
// (drafts containing family-owned / state-of-the-art now fail voice; captions
// stating the correct "from $25 installed" stop failing price-compliance), so
// the version is bumped to keep that shift attributable in igAutopostLog.
export const PROMPT_VERSION = "2026-07-27";

function buildGenSystemPrompt(): string {
  return [
    "You are the social copywriter and creative director for Nick's Tire & Auto, a neighborhood auto + tire shop on Euclid Ave in Cleveland, Ohio.",
    "You write Instagram captions that get shared because they are specific, surprising, and grounded in this shop's real world — never generic, never the kind of post any other shop could run.",
    "",
    "HOUSE VOICE (from the brand guide):",
    "- Every line that lands does three things at once: surprises (phrasing you would not expect from an auto shop), specifies (a concrete point underneath), reveals (sounds like a person thinking, not a brand communicating).",
    "- Use concrete numbers, named services, real Cleveland places, and time anchors.",
    "- One absurd/funny line per post MAXIMUM. Delightfully odd is good; stacked jokes cancel out.",
    // Rendered from the Voice Kernel (shared/voice.ts), never hand-listed here.
    // This line and the critic's banned-word line at buildEvalSystemPrompt used
    // to be two hand-written lists in this same file that disagreed: the
    // generator banned state-of-the-art / family-owned / world-class and the
    // critic did not, so captions containing them scored full voice marks.
    `- ${renderBannedWordsForPrompt({ surface: "social" })}`,
    "",
    "VIRAL SHAPE (the post must have all four, in order):",
    "1. HOOK — first sentence: a specific, concrete, surprising claim. NOT a question, NOT a teaser. It MUST land inside the first ~125 characters (Instagram hides the rest behind '...more'), so put the hook AND its most surprising specific up top — no slow build.",
    "2. PROOF — the body: specific, named, sourced. Numbers, the situation, the part, the contrast.",
    "3. TURN — one near-the-end sentence that re-contextualizes the proof (the line someone repeats at dinner).",
    "4. TAKE-AWAY — ONE call-to-action, never stacked: execute the CTA / engagement move given in the brief (save, send, DM, call, or link-in-bio), with friction removed (drop-offs welcome, free check, you don't pay until you say yes).",
    "",
    "REACH: include at least one line worth SAVING or SENDING — a keep-it/forward-it payoff (a number, a checklist beat, a 'screenshot this'). On a local feed, saves and shares are what actually spread a post.",
    "",
    "PRICE RULES (hard):",
    `- The ONLY prices you may state are: ${ADVERTISABLE_PRICES.join("; ")}.`,
    "- NEVER state a price for any repair (brakes, diagnostics, AC, batteries, alignment, exhaust, etc.). You may reference a vague dealer quote ('a four-figure dealer quote') but never quote OUR repair price.",
    "",
    "TRUTH RULES (hard):",
    "- Do NOT invent customer names, fake quotes, or fake statistics. If you reference a customer outcome, describe the SITUATION generically (no name).",
    "- You MAY quote a provided real Google review verbatim if one is supplied in the brief; never fabricate one.",
    "",
    "OUTPUT a single raw JSON object only — no markdown code fences, nothing before or after the JSON.",
  ].join("\n");
}

function buildGenUserPrompt(
  brief: SignalBrief,
  dials: { angle: string; visualConcept: string; hookStyle: string; clevelandHook: string; tone: string; cta: string },
  customConcept?: string
): string {
  const reviewLines = brief.reviews.length
    ? brief.reviews.map((r) => `- "${r.text}" (${r.rating}star, real Google review — may be quoted verbatim)`).join("\n")
    : "- (no fresh reviews available — do NOT invent one)";
  const declined = brief.declinedPatterns.length ? brief.declinedPatterns.join("; ") : "(none)";
  const questions = brief.questionPatterns.length ? brief.questionPatterns.join("; ") : "(none)";
  const specialsLine = brief.activeSpecials.length
    ? brief.activeSpecials.map((s) => `${s.title}${s.code ? ` [${s.code}]` : ""}`).join("; ")
    : "(none active)";
  const avoid = brief.recentConceptKeys.length ? brief.recentConceptKeys.join(" | ") : "(none yet)";

  const promptParts = [
    "Write ONE Instagram post for Nick's Tire & Auto. Ground it in the shop's real signals below. Be original — this must not resemble any recent post.",
    "",
  ];

  if (customConcept) {
    promptParts.push(
      "CRITICAL DIRECTIVE FROM THE OPERATOR (steer the post around this custom mood, theme, or idea):",
      `>>> CUSTOM IDEA: ${customConcept} <<<`,
      "You MUST write the caption's hook, story angle, and art-direction/image prompt directly centered around this custom idea while still maintaining the playbook voice guidelines and advertisable price compliance.",
      ""
    );
  }

  promptParts.push(
    "CREATIVE DIALS for THIS post (combine them; do not name them in the copy):",
    `- Angle: ${dials.angle}`,
    `- Hook style: ${dials.hookStyle}`,
    `- Cleveland hook: ${dials.clevelandHook}`,
    `- Tone: ${dials.tone}`,
    `- CTA / engagement move (use exactly one, do not stack): ${dials.cta}`,
    `- Visual concept for the image: ${dials.visualConcept}`,
    "",
    "SHOP SIGNALS (real data — use what fits the angle):",
    `- Recent real reviews:\n${reviewLines}`,
    `- Most-declined work (objections to speak to, no names): ${declined}`,
    `- Most-asked customer questions (aggregated topics, no names): ${questions}`,
    `- Active specials: ${specialsLine}`,
    `- Cleveland season: ${brief.season.label} — ${brief.season.note}`,
    `- What performs on our IG: ${brief.igInsight.topFormatsNote}`,
    "",
    "DO NOT REPEAT — recent concept-keys (pick a clearly different idea):",
    avoid,
    "",
    "SHOP FACTS you may use:",
    `- Address: ${BUSINESS.address.full}. Phone: ${BUSINESS.phone.display}. Open 7 days.`,
    `- Advertisable prices ONLY: ${ADVERTISABLE_PRICES.join("; ")}.`,
    "",
    "Return JSON with exactly these fields:",
    "- caption: the full IG caption (hook -> proof -> turn -> take-away). 60-150 words. FRONT-LOAD: the hook AND its single most surprising/useful specific MUST land in the first ~125 characters — Instagram hides everything after that behind '...more'. Include at least one save-worthy or send-worthy line (a number, a beat someone would screenshot or forward). End with exactly ONE call-to-action, executed per the CTA / engagement move dial above — do NOT stack CTAs. No hashtags inside the caption.",
    "- hashtags: array of 6-10 lowercase hashtags WITHOUT the # sign. Mix: 2-3 Cleveland-local (e.g. cleveland, euclidohio, clevelandcars), 2-3 service tags specific to THIS post's topic, 1-2 broad auto tags, and ALWAYS include the branded tag 'nickstireauto'. No banned words.",
    "- imagePrompt: a vivid art-direction prompt for an image generator that realizes the visual concept above. Professional craft: cinematic or studio lighting, sharp focus, clean composition. If (and only if) the visual concept is the editorial-poster style, you MAY render ONE short bold text element — a single number or one word, spelled exactly, integrated as design; for every other concept keep the image text-free. NEVER render sentences/paragraphs/captions in the image, and NO photoreal human faces/hands/crowds. 1-3 sentences.",
    "- conceptKey: a short 3-6 word kebab-case slug capturing THIS post's unique idea (for dedupe), e.g. 'salt-eats-brake-lines-winter'."
  );

  return promptParts.join("\n");
}

const GEN_SCHEMA = {
  name: "ig_post",
  strict: true,
  schema: {
    type: "object",
    properties: {
      caption: { type: "string" },
      hashtags: { type: "array", items: { type: "string" } },
      imagePrompt: { type: "string" },
      conceptKey: { type: "string" },
    },
    required: ["caption", "hashtags", "imagePrompt", "conceptKey"],
    additionalProperties: false,
  },
} as const;

/**
 * Parse a JSON object out of an LLM text response. Venice's llama-3.3-70b
 * rejects response_format (json_object AND json_schema both 400 "not supported
 * by this model"), so we instruct JSON in the prompt and parse defensively
 * here: strip an optional markdown code fence, then isolate the outermost
 * {...} before JSON.parse so leading/trailing prose can't break it.
 */
function parseJsonObject<T>(raw: string): T {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return JSON.parse(s) as T;
}

/**
 * Phase 6 (feed-wide): turn a post into a 2-line branded-poster headline + sub
 * for the adRender "garage poster" layout. Claim-safe (no prices except the
 * exact phrase "free check", no guarantees/superlatives — sell the visit).
 * THROWS if it can't produce usable, claim-safe copy, so generatePostImage
 * falls back to an AI image rather than ship a blank or non-compliant poster.
 */
async function derivePosterCopy(text: string): Promise<{ hookYellow: string; hookWhite: string; hookSub: string }> {
  const prompt = `You are a graphic designer for Nick's Tire & Auto, a Cleveland-area neighborhood tire & auto shop.
Turn this Instagram post into a bold poster headline.
POST: "${text.slice(0, 600)}"

Return ONLY JSON: {"hookYellow": string, "hookWhite": string, "hookSub": string}
- hookYellow + hookWhite together form a 2-part headline; each 1-3 words, punchy, ALL CAPS (e.g. "BALD TIRES" / "CAN'T STOP."). hookYellow grabs attention, hookWhite finishes the thought.
- hookSub: ONE sentence (<=120 chars) that pays it off and invites a visit.
- HARD RULES: no prices, no "%", no guarantees, no "best/cheapest/#1", no "free" except the exact phrase "free check". No medical/legal claims. Sell the visit, never quote a price.`;
  const result = await invokeLLM({ messages: [{ role: "user", content: prompt }], maxTokens: 2048 });
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("derivePosterCopy: no LLM content");
  const p = parseJsonObject<{ hookYellow?: unknown; hookWhite?: unknown; hookSub?: unknown }>(content);
  const hookYellow = String(p.hookYellow ?? "").toUpperCase().trim().slice(0, 22);
  const hookWhite = String(p.hookWhite ?? "").toUpperCase().trim().slice(0, 22);
  const hookSub = String(p.hookSub ?? "").trim().slice(0, 140);
  if (!hookYellow || !hookWhite) throw new Error("derivePosterCopy: empty headline");
  // Defense-in-depth claim guard: never let a poster ship a price/guarantee.
  if (/\$|%|guarantee|warranty|cheapest|lowest price|\bbest\b/i.test(`${hookYellow} ${hookWhite} ${hookSub}`)) {
    throw new Error("derivePosterCopy: claim-unsafe copy rejected");
  }
  return { hookYellow, hookWhite, hookSub };
}

async function generatePost(brief: SignalBrief, forceArchetype?: IgArchetype, customConcept?: string): Promise<GeneratedPost> {
  const angle = forceArchetype ? angleForArchetype(forceArchetype) : pick(DIALS.angle);
  const visualConcept = pick(DIALS.visualConcept);
  const dials = {
    angle,
    visualConcept,
    hookStyle: pick(DIALS.hookStyle),
    clevelandHook: pick(DIALS.clevelandHook),
    tone: pick(DIALS.tone),
    cta: pick(DIALS.cta),
  };

  const res = await invokeLLM({
    messages: [
      { role: "system", content: buildGenSystemPrompt() },
      { role: "user", content: buildGenUserPrompt(brief, dials, customConcept) },
    ],
    // gemini-2.5-flash spends a large, variable share of tokens on internal
    // "thinking" BEFORE emitting output. With the full system+brief prompt,
    // 1200 truncated the caption JSON mid-object ("```json {" -> JSON.parse
    // failure). 4096 leaves ample headroom for thinking + the completed JSON.
    max_tokens: 4096,
  });

  const content = res.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("LLM returned no caption content");
  }
  const parsed = parseJsonObject<{
    caption: string; hashtags: string[]; imagePrompt: string; conceptKey: string;
  }>(content);

  const hashtags = (Array.isArray(parsed.hashtags) ? parsed.hashtags : [])
    .map((h) => h.replace(/^#/, "").trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);

  return {
    archetype: archetypeFromAngle(angle),
    caption: parsed.caption.trim(),
    hashtags,
    imagePrompt: parsed.imagePrompt.trim(),
    conceptKey: (parsed.conceptKey || "untitled").trim().toLowerCase().replace(/\s+/g, "-").slice(0, 64),
    visualConcept,
  };
}

// ─────────────────────────────────────────────────────────
// IMAGE — generatePostImage abstracts the provider; always returns JPEG
// ─────────────────────────────────────────────────────────

/**
 * Generate a post image and return a PUBLIC JPEG url.
 *
 * Provider switch via IG_AUTOPOST_IMAGE_PROVIDER (default "openai" → the
 * OpenAI-compatible/Venice endpoint behind server/_core/imageGeneration.ts,
 * which hosts a PNG). A "higgsfield" branch is stubbed for a later swap.
 *
 * IG REQUIREMENT: the Meta IG media container rejects PNG, so we always
 * convert the generated PNG to JPEG and re-host it, then hand the JPEG url
 * to Instagram. Facebook tolerates either; we use the same JPEG for both.
 */
// @deprecated — unreachable since Phase 6 (higgsfield now routes to the branded poster); removal candidate.
async function generatePostImageHiggsfield(prompt: string): Promise<string> {
  const { spawn } = await import("child_process");
  const fs = await import("fs");
  const path = await import("path");
  const os = await import("os");

  return new Promise<string>(async (resolve, reject) => {
    try {
      const binPath = await ensureHiggsfieldBinary();
      const spawnEnv: NodeJS.ProcessEnv = { ...process.env };
      let tempCredsFile: string | null = null;

      // Resolve dynamic credentials override or fall back to env
      const { getHiggsfieldCredentialsJson } = await import("./higgsfieldStudio");
      const credentialsJson = await getHiggsfieldCredentialsJson();

      if (credentialsJson) {
        try {
          const tempDir = os.tmpdir();
          tempCredsFile = path.join(tempDir, `hg-creds-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`);
          fs.writeFileSync(tempCredsFile, credentialsJson, "utf8");
          spawnEnv.HIGGSFIELD_CREDENTIALS_PATH = tempCredsFile;
          log.info("wired HIGGSFIELD_CREDENTIALS_PATH via temp file from Higgsfield credentials");
        } catch (err) {
          log.warn("failed to write Higgsfield credentials to temp file", { err: err instanceof Error ? err.message : String(err) });
        }
      }

      log.info("generating image via higgsfield...", { prompt });
      
      const child = spawn(binPath, [
        "generate",
        "create",
        "gpt_image_2",
        "--prompt",
        prompt,
        "--aspect_ratio",
        "1:1",
        "--resolution",
        "2k",
        "--wait",
        "--json"
      ], {
        env: {
          ...spawnEnv,
          HIGGSFIELD_INSTALL_METHOD: "npm",
          HIGGSFIELD_PACKAGE_MANAGER: "pnpm",
        }
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        // Cleanup temp file if created
        if (tempCredsFile && fs.existsSync(tempCredsFile)) {
          try {
            fs.unlinkSync(tempCredsFile);
          } catch (_) {}
        }

        if (code !== 0) {
          reject(new Error(`Higgsfield CLI exited with code ${code}. Stderr: ${stderr.trim()}`));
          return;
        }

        // Try parsing JSON output
        try {
          const parsed = JSON.parse(stdout);
          const urls: string[] = [];
          const findUrls = (obj: any) => {
            if (!obj) return;
            if (typeof obj === "string") {
              if (obj.startsWith("http://") || obj.startsWith("https://")) {
                urls.push(obj);
              }
            } else if (Array.isArray(obj)) {
              obj.forEach(findUrls);
            } else if (typeof obj === "object") {
              Object.values(obj).forEach(findUrls);
            }
          };
          findUrls(parsed);
          
          const imageOrVideoUrl = urls.find(u => 
            u.endsWith(".png") || u.endsWith(".jpg") || u.endsWith(".jpeg") || u.endsWith(".webp") || u.includes("cloudfront.net")
          );
          if (imageOrVideoUrl) {
            resolve(imageOrVideoUrl);
            return;
          }
        } catch (_) {}

        // Regex fallback
        const urlRegex = /https?:\/\/[^\s"',]+/g;
        const matches = stdout.match(urlRegex) || [];
        const imageOrVideoUrl = matches.find(u => 
          u.endsWith(".png") || u.endsWith(".jpg") || u.endsWith(".jpeg") || u.endsWith(".webp") || u.includes("cloudfront.net")
        );
        if (imageOrVideoUrl) {
          resolve(imageOrVideoUrl);
          return;
        }

        reject(new Error(`Could not extract image URL from Higgsfield stdout: ${stdout}`));
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generate a post image and return a PUBLIC JPEG url.
 *
 * Provider switch via IG_AUTOPOST_IMAGE_PROVIDER (default "openai" → the
 * OpenAI-compatible/Venice endpoint behind server/_core/imageGeneration.ts,
 * which hosts a PNG).
 *
 * IG REQUIREMENT: the Meta IG media container rejects PNG, so we always
 * convert the generated PNG to JPEG and re-host it, then hand the JPEG url
 * to Instagram. Facebook tolerates either; we use the same JPEG for both.
 */
async function generatePostImageGeminiDirect(prompt: string): Promise<{ url: string; mimeType: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const model = "gemini-3.1-flash-image";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  log.info("Generating image via Gemini Direct...", { model, promptLen: prompt.length });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        // TEXT+IMAGE prevents silent failures when safety filters block IMAGE-only
        responseModalities: ["TEXT", "IMAGE"],
      },
    }),
    signal: AbortSignal.timeout(60_000), // image gen can take 30-50s
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    log.error("Gemini Direct image API error", { status: response.status, errorText: errorText.slice(0, 500) });
    throw new Error(`Gemini Direct image generation failed (${response.status} ${response.statusText}): ${errorText.slice(0, 300)}`);
  }

  const data = (await response.json()) as any;
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  let b64: string | undefined;
  let mimeType = "image/png";
  for (const p of parts) {
    if (p.inlineData?.data) {
      b64 = p.inlineData.data;
      if (p.inlineData.mimeType) mimeType = p.inlineData.mimeType;
      break;
    }
  }

  if (!b64) {
    // Log what we DID get back -- often text-only when the image was blocked
    const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text).join(" ");
    log.error("Gemini Direct returned no image data", {
      partsCount: parts.length,
      textResponse: textParts.slice(0, 200),
      finishReason: data.candidates?.[0]?.finishReason,
    });
    throw new Error(`Gemini Direct image generation failed: no inlineData in response (finishReason: ${data.candidates?.[0]?.finishReason || "unknown"})`);
  }

  const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";
  const buffer = Buffer.from(b64, "base64");
  const { storagePut } = await import("../storage");
  const { url: uploadedUrl } = await storagePut(
    `generated/${Date.now()}.${ext}`,
    buffer,
    mimeType
  );
  if (!uploadedUrl) throw new Error("storagePut returned no url for Gemini image");
  log.info("Gemini image generated", { mimeType, bytes: buffer.length });
  return { url: uploadedUrl, mimeType };
}


async function generateImageOpenRouter(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const model = "google/gemini-3.1-flash-image";
  const url = "https://openrouter.ai/api/v1/chat/completions";

  log.info("Generating image via OpenRouter...", { model, prompt });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "user", content: prompt }
      ],
      modalities: ["image"]
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`OpenRouter image generation failed (${response.status} ${response.statusText}): ${errorText}`);
  }

  const data = (await response.json()) as any;
  const message = data.choices?.[0]?.message;
  const images = message?.images ?? [];
  let base64Url: string | undefined;

  for (const img of images) {
    if (img.image_url?.url && img.image_url.url.startsWith("data:image/")) {
      base64Url = img.image_url.url;
      break;
    }
  }

  if (!base64Url) {
    throw new Error("OpenRouter response did not contain image data");
  }

  const match = base64Url.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) {
    throw new Error("Invalid base64 URL format from OpenRouter");
  }
  const mimeType = match[1];
  const b64Data = match[2];
  const buffer = Buffer.from(b64Data, "base64");

  const { storagePut } = await import("../storage");
  const { url: uploadedUrl } = await storagePut(
    `generated/${Date.now()}.png`,
    buffer,
    mimeType
  );

  if (!uploadedUrl) throw new Error("storagePut returned no url for OpenRouter image");
  return uploadedUrl;
}

export async function generatePostImage(
  prompt: string,
  ctx?: { caption?: string },
): Promise<{ url: string; format: "jpeg"; kind: "poster" | "ai" }> {
  let provider = "adrender";
  try {
    const { db } = await import("../lib/db-helper");
    const d = await db();
    if (d) {
      const { appSecretKv } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const rows = await d.select().from(appSecretKv).where(eq(appSecretKv.k, "ig_autopost_image_provider")).limit(1);
      provider = rows.length && rows[0].v ? rows[0].v : process.env.IG_AUTOPOST_IMAGE_PROVIDER || "adrender";
    } else {
      provider = process.env.IG_AUTOPOST_IMAGE_PROVIDER || "adrender";
    }
  } catch (err) {
    log.warn("failed to load image provider from db overrides, using env fallback", { err });
    provider = process.env.IG_AUTOPOST_IMAGE_PROVIDER || "adrender";
  }
  provider = provider.toLowerCase();

  // Phase 6 (feed-wide): the branded "garage poster" is the DEFAULT visual.
  // Only an explicit AI provider opts out. "higgsfield" was a deprecated stub
  // that silently resolved to the poster — an operator selecting it in Settings
  // got a different image than the UI claimed. Re-wired 2026-07-16 (plan
  // re-funded): it now routes to the real Higgsfield generator below. A poster
  // failure falls through to AI gen so a post is never imageless.
  const aiProviders = new Set(["openai", "gemini", "openrouter", "higgsfield"]);
  if (!aiProviders.has(provider)) {
    try {
      const h = await derivePosterCopy(ctx?.caption?.trim() || prompt);
      const copy = {
        ...h,
        valueWhite: "", valueYellow: "", valueTicks: ["", "", ""] as [string, string, string],
        offerYellow: "", offerWhite: "", offerSub: "", caption: "",
      };
      const { renderBrandedPoster } = await import("./adStudio/adRender");
      const url = await renderBrandedPoster(copy);
      return { url, format: "jpeg", kind: "poster" };
    } catch (err) {
      log.warn("branded poster failed — falling back to AI image", { err: err instanceof Error ? err.message : String(err) });
      // Route the fallback to the most reliably-keyed AI path (GEMINI_API_KEY is
      // set in prod) so a poster failure still yields an image, not a missed post.
      if (process.env.GEMINI_API_KEY) provider = "gemini";
      // fall through to AI generation
    }
  }

  let pngUrl: string;
  let alreadyJpeg = false;
  if (provider === "higgsfield") {
    try {
      // Returns a Higgsfield-hosted URL (gpt_image_2, 1:1, 2k) — the shared
      // convert/re-host tail below moves it onto our permanent storage, same
      // as the carousel route does with storagePut.
      const { generateCarouselSlideImage } = await import("./higgsfieldStudio");
      pngUrl = await generateCarouselSlideImage(prompt);
    } catch (err) {
      log.warn("Higgsfield image generation failed — falling back", {
        err: err instanceof Error ? err.message : String(err),
      });
      pngUrl = await generatePostImageFallback(prompt);
    }
  } else if (provider === "gemini") {
    try {
      if (process.env.GEMINI_API_KEY) {
        try {
          const result = await generatePostImageGeminiDirect(prompt);
          pngUrl = result.url;
          // If Gemini returned JPEG, skip the expensive sharp conversion
          alreadyJpeg = result.mimeType.includes("jpeg") || result.mimeType.includes("jpg");
        } catch (geminiErr) {
          log.warn("Gemini Direct image generation failed, falling back to OpenRouter", {
            err: geminiErr instanceof Error ? geminiErr.message : String(geminiErr),
          });
          pngUrl = await generateImageOpenRouter(prompt);
        }
      } else {
        pngUrl = await generateImageOpenRouter(prompt);
      }
    } catch (err) {
      log.warn("Gemini/OpenRouter image generation failed, falling back to fallback provider", {
        err: err instanceof Error ? err.message : String(err),
      });
      pngUrl = await generatePostImageFallback(prompt);
    }
  } else {
    pngUrl = await generatePostImageFallback(prompt);
  }

  // Skip conversion if Gemini already returned JPEG — saves a sharp import + double upload
  if (alreadyJpeg) {
    return { url: pngUrl, format: "jpeg", kind: "ai" };
  }
  const jpegUrl = await convertHostedPngToJpeg(pngUrl);
  return { url: jpegUrl, format: "jpeg", kind: "ai" };
}

async function generatePostImageFallback(prompt: string): Promise<string> {
  const isOpenRouter = (process.env.OPENAI_BASE_URL || "").includes("openrouter.ai");

  if (isOpenRouter) {
    try {
      log.info("OpenAI base URL is OpenRouter (no image support). Using OpenRouter Gemini fallback...");
      return await generateImageOpenRouter(prompt);
    } catch (err) {
      log.error("OpenRouter Gemini image generation fallback failed", { err: err instanceof Error ? err.message : String(err) });
    }

    if (process.env.HF_API_KEY) {
      try {
        log.info("Trying Hugging Face fallback...");
        return await generateImageHuggingFace(prompt);
      } catch (err) {
        log.error("Hugging Face image generation fallback failed", { err: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  // Otherwise, default to the existing OpenAI generator (DALL-E 3)
  const { generateImage } = await import("../_core/imageGeneration");
  const res = await generateImage({ prompt });
  if (!res.url) throw new Error("Fallback image generation (openai) returned no url");
  return res.url;
}

async function generateImageHuggingFace(prompt: string): Promise<string> {
  const apiKey = process.env.HF_API_KEY;
  if (!apiKey) throw new Error("HF_API_KEY is not configured");

  const model = "black-forest-labs/FLUX.1-schnell";
  const url = `https://router.huggingface.co/hf-inference/models/${model}`;

  log.info("Generating image via Hugging Face...", { model, prompt });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inputs: prompt }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Hugging Face image generation failed (${response.status} ${response.statusText}): ${errorText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const { storagePut } = await import("../storage");
  const { url: uploadedUrl } = await storagePut(
    `generated/${Date.now()}.png`,
    buffer,
    "image/png"
  );
  if (!uploadedUrl) throw new Error("storagePut returned no url for HF image");
  return uploadedUrl;
}

/**
 * Fetch a hosted PNG, transcode to JPEG with sharp, re-host via storagePut.
 * Generic — independent of the image provider. JPEG quality 90, white
 * background flatten (IG shows feed photos on white; transparent PNG areas
 * would otherwise go black).
 */
async function convertHostedPngToJpeg(pngUrl: string): Promise<string> {
  let pngBuf: Buffer;

  if (pngUrl.includes("/generated/")) {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const filename = path.basename(pngUrl);
      const localPath = path.join(process.cwd(), "data", "generated", filename);
      if (fs.existsSync(localPath)) {
        pngBuf = fs.readFileSync(localPath);
      } else {
        const resp = await fetch(pngUrl, { signal: AbortSignal.timeout(20000) });
        if (!resp.ok) throw new Error(`failed to fetch generated image: HTTP ${resp.status}`);
        pngBuf = Buffer.from(await resp.arrayBuffer());
      }
    } catch (err) {
      log.warn("Failed to read generated PNG locally, falling back to fetch...", {
        err: err instanceof Error ? err.message : String(err)
      });
      const resp = await fetch(pngUrl, { signal: AbortSignal.timeout(20000) });
      if (!resp.ok) throw new Error(`failed to fetch generated image: HTTP ${resp.status}`);
      pngBuf = Buffer.from(await resp.arrayBuffer());
    }
  } else {
    const resp = await fetch(pngUrl, { signal: AbortSignal.timeout(20000) });
    if (!resp.ok) throw new Error(`failed to fetch generated image: HTTP ${resp.status}`);
    pngBuf = Buffer.from(await resp.arrayBuffer());
  }

  const sharp = (await import("sharp")).default;
  const jpegBuf = await sharp(pngBuf)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .jpeg({ quality: 90 })
    .toBuffer();

  const { storagePut } = await import("../storage");
  const { url } = await storagePut(`generated/${Date.now()}.jpg`, jpegBuf, "image/jpeg");
  if (!url) throw new Error("storagePut returned no url for JPEG");
  return url;
}

// ─────────────────────────────────────────────────────────
// DUAL EVAL GATE
// ─────────────────────────────────────────────────────────

function buildEvalSystemPrompt(): string {
  return [
    "You are a strict social-content judge for Nick's Tire & Auto. Score an Instagram caption on five dimensions, each 0.0 to 1.0. Be harsh — most drafts should not score above 0.8 unless they are genuinely strong.",
    "",
    "DIMENSIONS:",
    "1. viralShape — does it have, in order: a concrete surprising HOOK that lands within the first ~125 characters (not a question), specific PROOF with numbers/specifics, a TURN that re-contextualizes, and a TAKE-AWAY that is exactly ONE friction-removed call-to-action (not stacked)? Bonus: is there a clearly save-worthy or send-worthy line? Missing any of the four ordered elements caps this at 0.5.",
    // Rendered from the same Voice Kernel the generator uses, so the thing that
    // writes the caption and the thing that grades it cannot drift apart.
    `2. voice — ${renderCriticRubricForPrompt()}`,
    // Prices interpolate the BUSINESS SSOT. They used to be hardcoded here as
    // "used tires from $60 installed", the exact fabricated floor ROS-058
    // removed from the SMS catalog as a reinfection vector. The consequence ran
    // one way: this judge scored the SSOT-correct "from $25 installed" as 0.0
    // price-compliance and passed the drifted $60. Never restate a price here.
    `3. priceCompliance — 1.0 ONLY if every price stated is one of the allowed prices and NO repair price is quoted. If it quotes a price for brakes/diagnostics/AC/battery/alignment/exhaust or any non-allowed price, score 0.0. Allowed prices: ${BUSINESS.usedTires.explanation}; conventional oil change ${BUSINESS.oilChange.conventionalPrice}; synthetic oil change ${BUSINESS.oilChange.syntheticPrice}. No price stated at all = 1.0.`,
    "4. novelty — is the core idea clearly distinct from the supplied recent concept-keys? Near-duplicate of a recent idea = below 0.4.",
    "5. noFabrication — 1.0 if no invented customer names, fake quotes, or fake statistics. A quote that matches a supplied real review is fine. Any invented name/quote/stat = 0.0.",
    "",
    "Return a single raw JSON object only — keys: viralShape, voice, priceCompliance, novelty, noFabrication (each a number 0.0-1.0) and notes (string). No markdown fences, no prose before or after.",
  ].join("\n");
}

const EVAL_SCHEMA = {
  name: "caption_eval",
  strict: true,
  schema: {
    type: "object",
    properties: {
      viralShape: { type: "number" },
      voice: { type: "number" },
      priceCompliance: { type: "number" },
      novelty: { type: "number" },
      noFabrication: { type: "number" },
      notes: { type: "string" },
    },
    required: ["viralShape", "voice", "priceCompliance", "novelty", "noFabrication", "notes"],
    additionalProperties: false,
  },
} as const;

function clamp01(n: unknown): number {
  const x = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(1, x));
}

async function evalCaption(post: GeneratedPost, brief: SignalBrief): Promise<CaptionEval> {
  const reviewList = brief.reviews.length
    ? brief.reviews.map((r) => `"${r.text}"`).join(" | ")
    : "(none supplied)";
  const res = await invokeLLM({
    messages: [
      { role: "system", content: buildEvalSystemPrompt() },
      {
        role: "user",
        content: [
          `CAPTION:\n${post.caption}`,
          `\nHASHTAGS: ${post.hashtags.join(", ")}`,
          `\nSUPPLIED REAL REVIEWS (the only quotes that are NOT fabrication): ${reviewList}`,
          `\nRECENT CONCEPT-KEYS to be distinct from: ${brief.recentConceptKeys.join(" | ") || "(none)"}`,
          `\nALLOWED PRICES: ${ADVERTISABLE_PRICES.join("; ")}`,
        ].join("\n"),
      },
    ],
    // 600 truncated the eval JSON under gemini-2.5-flash's thinking overhead
    // (same root cause as generatePost) — give it the same headroom.
    max_tokens: 4096,
  });
  const content = res.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("eval LLM returned no content");
  }
  const p = parseJsonObject<Record<string, unknown>>(content);
  return {
    viralShape: clamp01(p.viralShape),
    voice: clamp01(p.voice),
    priceCompliance: clamp01(p.priceCompliance),
    novelty: clamp01(p.novelty),
    noFabrication: clamp01(p.noFabrication),
    notes: typeof p.notes === "string" ? p.notes.slice(0, 500) : "",
  };
}

function weightCaption(c: CaptionEval): number {
  return (
    c.viralShape * CAPTION_WEIGHTS.viralShape +
    c.voice * CAPTION_WEIGHTS.voice +
    c.priceCompliance * CAPTION_WEIGHTS.priceCompliance +
    c.novelty * CAPTION_WEIGHTS.novelty +
    c.noFabrication * CAPTION_WEIGHTS.noFabrication
  );
}

/**
 * Score the generated image's professional look with the vision analyzer
 * (qwen2-vl). If REPLICATE_API_KEY is unset, skip gracefully — the dryrun
 * Telegram review is the gate in that case. Never fails the run.
 */
async function evalImage(imageUrl: string): Promise<{ proLook: number | null; skipped: boolean; note: string }> {
  if (!process.env.REPLICATE_API_KEY) {
    log.info("image-eval skipped (no REPLICATE_API_KEY) — dryrun review is the gate");
    return { proLook: null, skipped: true, note: "image-eval skipped (no REPLICATE_API_KEY) — dryrun review is the gate" };
  }
  try {
    const { analyzePhoto } = await import("./vision-analyzer");
    const prompt =
      "Rate this image as a professional Instagram post graphic for an auto shop. " +
      "Consider: lighting, sharpness, composition, and whether it looks studio/cinematic-grade vs amateur or AI-glitchy. " +
      "Penalize garbled text, distorted hands/faces, or muddy composition. " +
      "End with exactly one line: SCORE: <0-100>.";
    // analyzePhoto is feature-flagged for the SMS damage-assess use case;
    // call its Replicate backend directly so this works regardless of that flag.
    const r = await analyzePhoto({ photoUrl: imageUrl, prompt, provider: "replicate" });
    if (!r.ok) {
      log.warn("image-eval call failed — treating as skip", { reason: r.reason, error: r.error });
      return { proLook: null, skipped: true, note: `image-eval unavailable (${r.reason}) — dryrun review is the gate` };
    }
    const m = r.description.match(/SCORE:\s*(\d{1,3})/i);
    const raw = m ? Math.min(100, Math.max(0, parseInt(m[1], 10))) : 65;
    return { proLook: raw / 100, skipped: false, note: r.description.slice(0, 300) };
  } catch (err) {
    log.warn("image-eval threw — treating as skip", { err: errMsg(err) });
    return { proLook: null, skipped: true, note: "image-eval error — dryrun review is the gate" };
  }
}

function combineScores(caption: CaptionEval, image: { proLook: number | null; skipped: boolean; note: string }): IgEvalScores {
  const captionWeighted = weightCaption(caption);
  // Caption must clear the bar AND any non-hard dim that is a true gate.
  // priceCompliance + noFabrication are HARD: if either is < 1.0 the post fails
  // outright regardless of the weighted average (safety over taste).
  const hardOk = caption.priceCompliance >= 1 && caption.noFabrication >= 1;
  const captionPass = hardOk && captionWeighted >= PASS_THRESHOLD;
  // When the image was scored, require it to clear IMAGE_PRO_LOOK_MIN; when
  // skipped, the image dim does not block (dryrun review covers it).
  const imagePass = image.skipped || image.proLook === null ? true : image.proLook >= IMAGE_PRO_LOOK_MIN;
  // Overall = caption weighted, nudged down if the (scored) image is weak.
  const overall = image.proLook === null ? captionWeighted : captionWeighted * 0.8 + image.proLook * 0.2;
  return {
    caption,
    captionWeighted: round2(captionWeighted),
    image,
    overall: round2(overall),
    passed: captionPass && imagePass,
  };
}

// ─────────────────────────────────────────────────────────
// LOG
// ─────────────────────────────────────────────────────────

async function logRun(row: {
  archetype: IgArchetype;
  conceptKey: string;
  slot: IgSlot | null;
  slotDate: string;
  scores: IgEvalScores | null;
  status: IgStatus;
  caption: string;
  hashtags: string[];
  imagePrompt: string;
  imageUrl: string | null;
  igPostId: string | null;
  fbPostId: string | null;
  error: string | null;
  source: IgSource;
}): Promise<void> {
  try {
    const d = await db();
    if (!d) return;
    await d.insert(igAutopostLog).values({
      archetype: row.archetype,
      conceptKey: row.conceptKey.slice(0, 64),
      slot: row.slot ?? "manual",
      slotDate: row.slotDate,
      evalScoresJson: row.scores ? JSON.stringify(row.scores) : null,
      captionWeighted: row.scores ? Math.round(row.scores.captionWeighted * 100) : null,
      overallScore: row.scores ? Math.round(row.scores.overall * 100) : null,
      status: row.status,
      caption: row.caption.slice(0, 2200),
      hashtags: row.hashtags.join(" "),
      imagePrompt: row.imagePrompt.slice(0, 1000),
      imageUrl: row.imageUrl ? row.imageUrl.slice(0, 1000) : null,
      igPostId: row.igPostId,
      fbPostId: row.fbPostId,
      error: row.error ? row.error.slice(0, 500) : null,
      source: row.source,
      promptVersion: PROMPT_VERSION,
    });
  } catch (err) {
    log.warn("igAutopostLog insert failed (non-critical)", { err: errMsg(err) });
  }
}

// ─────────────────────────────────────────────────────────
// PUBLIC ENTRYPOINTS
// ─────────────────────────────────────────────────────────

export interface RunIgAutopostOpts {
  /** Override the dryrun default. When omitted, IG_AUTOPOST_DRYRUN !== "false" (i.e. dryrun unless explicitly disabled). */
  dryRun?: boolean;
  /** Slot label (for cron + logging). Omit for one-off admin runs. */
  slot?: IgSlot;
  /** Force a content angle/archetype (admin "Fire Now" can steer). */
  forceArchetype?: IgArchetype;
  source?: IgSource;
  /** Custom mood, theme, or idea to steer the co-pilot post generation. */
  customConcept?: string;
}

/**
 * The core run. Builds the brief, generates + evals (regenerating up to
 * MAX_REGEN_ATTEMPTS), then posts or dry-runs. Always returns a result and
 * always logs. Throwing is avoided — failures are captured as status:"failed".
 */
export async function runIgAutopost(opts: RunIgAutopostOpts = {}): Promise<RunIgAutopostResult> {
  const now = new Date();
  const legacyLive = await isEnabled("legacy_autopost_live");
  const dryRun = !legacyLive || (opts.dryRun ?? (process.env.IG_AUTOPOST_DRYRUN !== "false"));
  const source: IgSource = opts.source ?? (opts.slot ? "cron" : "admin");
  const slot = opts.slot ?? null;
  const slotDate = etDateKey(now);

  /**
   * PREFLIGHT THE CAP BEFORE SPENDING ANYTHING. (Review catch, P2.)
   *
   * The assertion further down runs only AFTER buildSignalBrief and up to three
   * full generate → render → evaluate attempts. On a capped day that is real
   * LLM and image spend bought to produce a post that cannot be published, and
   * the previous tick's `aborted` row did not stop the next tick repeating it.
   *
   * This checks first, so a capped day costs nothing. The later assertion STAYS:
   * generation takes minutes, and another door can consume the last slot while
   * this run is working — the preflight saves money, the final check is what
   * actually enforces.
   *
   * Dry runs skip it entirely. A dry run publishes nothing, so the cap has no
   * opinion about it, and the Telegram preview is still worth producing.
   */
  if (!dryRun) {
    try {
      const { assertPublishCadence } = await import("./contentGovernor");
      await assertPublishCadence({ format: "photo" });
    } catch (err) {
      const denied = err instanceof Error && err.message.startsWith("Blocked by content governor");
      if (!denied) throw err;
      await logRun({
        archetype: opts.forceArchetype ?? "proof", conceptKey: "cap-hold",
        slot, slotDate, scores: null, status: "aborted",
        caption: "", hashtags: [], imagePrompt: "", imageUrl: null,
        igPostId: null, fbPostId: null, error: errMsg(err), source,
      });
      try {
        const { sendTelegram } = await import("./telegram");
        await sendTelegram(
          `IG AUTOPOST — HELD BY THE DAILY CAP (before generating)\n${errMsg(err)}\n` +
          `Nothing was generated, so nothing was spent. Raise the policy limit if this is wrong.`,
        );
      } catch (e) {
        log.warn("cap-preflight notify failed", { error: errMsg(e) });
      }
      return {
        recordsProcessed: 0,
        details: `Aborted before generation — ${errMsg(err)}`,
        status: "aborted",
        igPostId: null, fbPostId: null, dryRun: false,
      };
    }
  }

  try {
    const brief = await buildSignalBrief();

    // Generate → eval, regenerating until pass or attempts exhausted.
    let best: { post: GeneratedPost; image: { url: string; format: "jpeg" }; scores: IgEvalScores } | null = null;
    let lastScores: IgEvalScores | null = null;
    let lastPost: GeneratedPost | null = null;

    for (let attempt = 0; attempt <= MAX_REGEN_ATTEMPTS; attempt++) {
      const post = await generatePost(brief, opts.forceArchetype, opts.customConcept);
      lastPost = post;
      const image = await generatePostImage(post.imagePrompt, { caption: post.caption });
      const [captionEval, imageEval] = await Promise.all([
        evalCaption(post, brief),
        // A branded poster is a deterministic, approved template — not an AI
        // gamble — so the pro-look vision eval (which scores photos) is skipped.
        image.kind === "poster"
          ? Promise.resolve({ proLook: null, skipped: true, note: "branded poster — deterministic template, eval skipped" })
          : evalImage(image.url),
      ]);
      const scores = combineScores(captionEval, imageEval);
      lastScores = scores;
      log.info("ig-autopost eval", {
        attempt,
        archetype: post.archetype,
        conceptKey: post.conceptKey,
        captionWeighted: scores.captionWeighted,
        overall: scores.overall,
        passed: scores.passed,
        imageSkipped: scores.image.skipped,
      });
      if (scores.passed) {
        best = { post, image, scores };
        break;
      }
    }

    // No draft cleared the gate → ABORT (never post a sub-threshold draft).
    if (!best) {
      const reason = lastScores?.caption.notes || "eval below threshold";
      await logRun({
        archetype: lastPost?.archetype ?? (opts.forceArchetype ?? "proof"),
        conceptKey: lastPost?.conceptKey ?? "aborted",
        slot, slotDate, scores: lastScores, status: "aborted",
        caption: lastPost?.caption ?? "", hashtags: lastPost?.hashtags ?? [],
        imagePrompt: lastPost?.imagePrompt ?? "", imageUrl: null,
        igPostId: null, fbPostId: null,
        error: `aborted after ${MAX_REGEN_ATTEMPTS + 1} attempts: ${reason}`,
        source,
      });
      await notifyAbort(lastScores, reason);
      return {
        recordsProcessed: 0,
        details: `Aborted — no draft cleared ${PASS_THRESHOLD} after ${MAX_REGEN_ATTEMPTS + 1} attempts`,
        status: "aborted",
        scores: lastScores ?? undefined,
        dryRun,
      };
    }

    const { post, image, scores } = best;
    const caption = composeCaption(post);

    // ── DRYRUN ── log + Telegram preview, never touch Meta.
    if (dryRun) {
      await logRun({
        archetype: post.archetype, conceptKey: post.conceptKey, slot, slotDate,
        scores, status: "dryrun", caption, hashtags: post.hashtags,
        imagePrompt: post.imagePrompt, imageUrl: image.url,
        igPostId: null, fbPostId: null, error: null, source,
      });
      await notifyPreview(post, image.url, scores, slot);
      return {
        recordsProcessed: 1,
        details: `DRYRUN (${post.archetype}) — preview to Telegram, not posted`,
        status: "dryrun",
        archetype: post.archetype, conceptKey: post.conceptKey, scores,
        igPostId: null, fbPostId: null, dryRun: true,
      };
    }

    // ── LIVE ── post to IG (JPEG url) + FB, capture ids/errors.
    //
    // THE EMERGENCY STOP APPLIES HERE TOO.
    // This branch called postToInstagram/postToFacebook directly, so the
    // operator's autonomy kill switch — global, publishing, or per-platform —
    // did not stop the one publisher that runs with NO human in the loop.
    // Every other path to Meta goes through publishToSocial, which checks it;
    // this was the exception, and it is the autonomous one. A stop that does
    // not stop the unattended publisher is the worst possible exception.
    //
    // It shares the check rather than re-implementing it. It does NOT route
    // through publishToSocial wholesale, because that would also apply the
    // feed cap — a live policy question this autoposter currently exceeds, and
    // one for the operator to answer, not for this change to decide silently.
    //
    // Zero behaviour change while no switch is thrown (all four were false in
    // the live policy when this was written).
    const { killSwitchBlockedPlatforms, KILL_SWITCH_ERROR } = await import("./socialPublish");
    // "automated" = fail CLOSED when the switch state cannot be read. Nobody
    // is watching this run, so "we could not check" must not mean "publish".
    const blocked = await killSwitchBlockedPlatforms(
      ["instagram", "facebook"],
      { caller: "igAutopost", slot, archetype: post.archetype },
      "automated",
    );
    const igBlocked = blocked.includes("instagram");
    const fbBlocked = blocked.includes("facebook");

    /**
     * THE CAP COUNTED THIS DOOR BUT COULD NOT STOP IT.
     *
     * #1129 taught the content governor to COUNT ig_autopost_log, so the
     * autoposter finally consumed budget alongside the Queue, reels and
     * scheduled posts. But only `publishToSocial` ever calls
     * assertPublishCadence, and this cron posts to Meta directly — so the door
     * responsible for roughly 84% of all publishing was the one door the brake
     * could not apply to. It spent everyone else's budget and was never
     * itself refused.
     *
     * Measured consequence: 2026-06-17 saw 32 autopost publishes in a single
     * day (source=admin). Under the policy in force today that would STILL not
     * have been stopped, because nothing asked.
     *
     * SAFE BY MEASUREMENT: policy v8 allows 20 feed posts/day; the autoposter
     * does 3 and the busiest normal day across ALL four doors is 5. This
     * changes nothing about ordinary operation and makes the runaway case
     * actually stop at 20.
     *
     * A cadence READ failure must not take publishing down — assertPublishCadence
     * already fails open internally on infra errors and throws GovernorDenial
     * only on a real breach, so only the breach is handled here.
     */
    try {
      const { assertPublishCadence } = await import("./contentGovernor");
      await assertPublishCadence({ format: "photo" });
    } catch (err) {
      const denied = err instanceof Error && err.message.startsWith("Blocked by content governor");
      if (!denied) throw err;
      await logRun({
        archetype: post.archetype, conceptKey: post.conceptKey, slot, slotDate,
        scores, status: "aborted", caption, hashtags: post.hashtags,
        imagePrompt: post.imagePrompt, imageUrl: image.url,
        igPostId: null, fbPostId: null, error: errMsg(err), source,
      });
      try {
        const { sendTelegram } = await import("./telegram");
        await sendTelegram(
          `IG AUTOPOST — HELD BY THE DAILY CAP\n${errMsg(err)}\n` +
          `The draft cleared its eval gate and was NOT posted. Raise the policy limit if this is wrong.`,
        );
      } catch (e) {
        log.warn("cap-hold notify failed", { error: errMsg(e) });
      }
      return {
        recordsProcessed: 0,
        details: `Aborted — ${errMsg(err)}`,
        status: "aborted",
        archetype: post.archetype, conceptKey: post.conceptKey, scores,
        igPostId: null, fbPostId: null, dryRun: false,
      };
    }

    if (igBlocked && fbBlocked) {
      await logRun({
        archetype: post.archetype, conceptKey: post.conceptKey, slot, slotDate,
        scores, status: "aborted", caption, hashtags: post.hashtags,
        imagePrompt: post.imagePrompt, imageUrl: image.url,
        igPostId: null, fbPostId: null, error: KILL_SWITCH_ERROR, source,
      });
      try {
        // notifyAbort() hardcodes "no draft cleared the eval gate" — the
        // opposite of what happened here. The draft PASSED and was withheld.
        const { sendTelegram } = await import("./telegram");
        await sendTelegram(
          `IG AUTOPOST — STOPPED\n${KILL_SWITCH_ERROR}\n` +
          `The draft cleared its eval gate and was deliberately NOT posted.`,
        );
      } catch (err) {
        log.warn("kill-switch abort notify failed", { error: errMsg(err) });
      }
      return {
        recordsProcessed: 0,
        details: `Aborted — ${KILL_SWITCH_ERROR}`,
        status: "aborted",
        archetype: post.archetype, conceptKey: post.conceptKey, scores,
        igPostId: null, fbPostId: null, dryRun: false,
      };
    }

    const { postToInstagram, postToFacebook } = await import("./metaSocial");
    const ig = igBlocked
      ? { success: false, postId: undefined, error: KILL_SWITCH_ERROR }
      : await postToInstagram({ imageUrl: image.url, caption });
    const fb = fbBlocked
      ? { success: false, postId: undefined, error: KILL_SWITCH_ERROR }
      : await postToFacebook({ message: caption, imageUrl: image.url });
    const igPostId = ig.success ? ig.postId ?? null : null;
    const fbPostId = fb.success ? fb.postId ?? null : null;
    const anyOk = ig.success || fb.success;
    const errParts = [ig.success ? null : `IG: ${ig.error}`, fb.success ? null : `FB: ${fb.error}`].filter(Boolean);

    await logRun({
      archetype: post.archetype, conceptKey: post.conceptKey, slot, slotDate,
      scores, status: anyOk ? "posted" : "failed",
      caption, hashtags: post.hashtags, imagePrompt: post.imagePrompt, imageUrl: image.url,
      igPostId, fbPostId, error: errParts.length ? errParts.join(" · ") : null, source,
    });
    await notifyPosted(post, image.url, scores, { ig, fb });

    return {
      recordsProcessed: anyOk ? 1 : 0,
      details: anyOk
        ? `Posted (${post.archetype}) — IG:${ig.success ? "ok" : "fail"} FB:${fb.success ? "ok" : "fail"}`
        : `Post failed — ${errParts.join(" · ")}`,
      status: anyOk ? "posted" : "failed",
      archetype: post.archetype, conceptKey: post.conceptKey, scores,
      igPostId, fbPostId, dryRun: false,
    };
  } catch (err) {
    const message = errMsg(err);
    log.error("ig-autopost run failed", { error: message });
    await logRun({
      archetype: opts.forceArchetype ?? "proof", conceptKey: "run-error",
      slot, slotDate, scores: null, status: "failed",
      caption: "", hashtags: [], imagePrompt: "", imageUrl: null,
      igPostId: null, fbPostId: null, error: message, source,
    });
    return { recordsProcessed: 0, details: `Failed: ${message}`, status: "failed", dryRun };
  }
}

/**
 * Cron entrypoint. Self-gates to a slot window (the cron tier fires every
 * ~15 min; we only act inside an 8:07 / 13:07 / 20:07 ET window) and dedupes
 * one post per slot per day. Returns the standard cron result shape.
 */
export async function runIgAutopostCron(): Promise<{ recordsProcessed: number; details: string }> {
  const now = new Date();
  const slot = currentSlot(now);
  if (!slot) {
    return { recordsProcessed: 0, details: "Skip — not within a posting-slot window" };
  }
  if (await alreadyRanSlotToday(slot, now)) {
    return { recordsProcessed: 0, details: `Skip — ${slot} slot already ran today` };
  }
  const res = await runIgAutopost({ slot, source: "cron" });
  // runIgAutopost reports a hard failure (OpenRouter 402, unparseable LLM JSON)
  // via `status: "failed"` rather than by throwing. This wrapper used to re-wrap
  // only recordsProcessed + details and DROP that field, so scheduler.runTier
  // saw a normal return and wrote status='completed' to cron_log. The operator
  // read "ig-autopost completed" on a slot where nothing was posted, and the
  // run was invisible to both runCronFailureObserver and safetyMonitor's
  // cronFailureRate — the two things whose whole job is noticing this.
  if (res.status === "failed") {
    throw new Error(`[${slot}] ${res.details}`);
  }
  return { recordsProcessed: res.recordsProcessed, details: `[${slot}] ${res.details}` };
}

/** Admin "Fire Now" entrypoint. One-off, optionally steered to an archetype and custom concept. */
export async function runIgAutopostOneOff(forceArchetype?: IgArchetype, customConcept?: string): Promise<RunIgAutopostResult> {
  return runIgAutopost({ forceArchetype, customConcept, source: "admin" });
}

// ─────────────────────────────────────────────────────────
// COMPOSE + NOTIFY
// ─────────────────────────────────────────────────────────

/** Final caption = LLM caption + a blank line + hashtags (IG convention). */
function composeCaption(post: GeneratedPost): string {
  const tags = post.hashtags.map((h) => `#${h}`).join(" ");
  const body = post.caption.trim();
  const full = tags ? `${body}\n\n${tags}` : body;
  return full.slice(0, 2200); // IG caption hard limit
}

function scoreLines(s: IgEvalScores): string {
  const c = s.caption;
  return [
    `viral ${pct(c.viralShape)} · voice ${pct(c.voice)} · price ${pct(c.priceCompliance)} · novelty ${pct(c.novelty)} · no-fab ${pct(c.noFabrication)}`,
    `caption ${pct(s.captionWeighted)} · image ${s.image.skipped ? "skipped" : pct(s.image.proLook ?? 0)} · overall ${pct(s.overall)}`,
  ].join("\n");
}

async function notifyPreview(post: GeneratedPost, imageUrl: string, scores: IgEvalScores, slot: IgSlot | null): Promise<void> {
  try {
    const { sendTelegram } = await import("./telegram");
    const caption = composeCaption(post);
    await sendTelegram(
      `IG AUTOPOST PREVIEW${slot ? ` (${slot})` : ""} — DRYRUN, not posted\n` +
      `Angle: ${post.archetype} · concept: ${post.conceptKey}\n` +
      `Visual: ${post.visualConcept}\n` +
      `─────────────────\n` +
      `${caption}\n` +
      `─────────────────\n` +
      `Image: ${imageUrl}\n` +
      `Image prompt: ${post.imagePrompt}\n` +
      `─────────────────\n` +
      `${scoreLines(scores)}`,
    );
  } catch (err) {
    log.warn("preview telegram failed", { err: errMsg(err) });
  }
}

async function notifyPosted(
  post: GeneratedPost,
  imageUrl: string,
  scores: IgEvalScores,
  meta: { ig: { success: boolean; postId?: string; error?: string }; fb: { success: boolean; postId?: string; error?: string } },
): Promise<void> {
  try {
    const { sendTelegram } = await import("./telegram");
    await sendTelegram(
      `IG AUTOPOST — LIVE\n` +
      `Angle: ${post.archetype} · concept: ${post.conceptKey}\n` +
      `IG: ${meta.ig.success ? `posted ${meta.ig.postId ?? ""}` : `FAILED ${meta.ig.error ?? ""}`}\n` +
      `FB: ${meta.fb.success ? `posted ${meta.fb.postId ?? ""}` : `FAILED ${meta.fb.error ?? ""}`}\n` +
      `Image: ${imageUrl}\n` +
      `${scoreLines(scores)}`,
    );
  } catch (err) {
    log.warn("posted telegram failed", { err: errMsg(err) });
  }
}

async function notifyAbort(scores: IgEvalScores | null, reason: string): Promise<void> {
  try {
    const { sendTelegram } = await import("./telegram");
    await sendTelegram(
      `IG AUTOPOST — ABORTED (no draft cleared the eval gate)\n` +
      `Reason: ${reason}\n` +
      (scores ? scoreLines(scores) : "no scores"),
    );
  } catch (err) {
    log.warn("abort telegram failed", { err: errMsg(err) });
  }
}

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

log.info("IG autopost loaded");
