/**
 * VOICE KERNEL — the single source of truth for Nick's brand voice.
 *
 * THE PROBLEM IT SOLVES
 * Nick's voice was defined in SIX places and no two agreed:
 *
 *   1. docs/brand/VOICE.md                      15 kill entries + 7 positive patterns
 *   2. .claude/brand-voice-guidelines.md §3     16 kill entries (cited as canonical by the linter)
 *   3. scripts/lint-brand-voice.mjs             ~26 regexes (the CI gate)
 *   4. server/services/igAutopost.ts (generator) 13 words, inline in the prompt string
 *   5. server/services/igAutopost.ts (critic)    10 words, inline in a DIFFERENT prompt string
 *   6. server/voice-compliance.test.ts          a narrower set + FCFS positioning bans
 *
 * The two documents that each call themselves canonical disagreed on 17 of the
 * 24 union entries. Verified consequences at the time this file was written:
 *   - "reliable" is killed by VOICE.md and banned in BOTH igAutopost prompts, but
 *     the CI linter had no pattern for it — so it shipped to the public site.
 *   - "comprehensive" is blocked by the linter but the IG generator was never told.
 *   - "family-owned" is banned by the generator at igAutopost.ts and the critic in
 *     the SAME FILE was not told, so it scored those captions at full voice marks.
 *
 * This is the third instance of a failure class this app has already paid for:
 * ROS-042 (SMS persona drifted between serving and the fine-tune corpus) and
 * ROS-043 (warranty facts drifted across prompts, templates and constants). Both
 * were fixed the same way — one typed module, imported by every consumer, pinned
 * by a parity test. See `nickSmsPersona.ts` and `businessFacts.ts` for precedent.
 *
 * HOW TO USE IT
 * - Linting copy?            `findVoiceViolations(text, { surface })`
 * - Writing an LLM prompt?   `renderBannedWordsForPrompt()` / `renderVoiceRulesForPrompt()`
 * - Grading generated copy?  `renderCriticRubricForPrompt()`
 *
 * Do NOT re-inline a word list anywhere. `voiceKernelParity.test.ts` fails the
 * build if a consumer grows its own copy, and fails if either governing document
 * asserts a kill entry this kernel does not carry.
 *
 * PROVENANCE: every rule records which sources asserted it, in the same spirit as
 * `businessFacts.ts`. When the two docs disagreed, the union wins and the
 * disagreement is recorded in `note` rather than silently resolved.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Where a piece of copy lives. Determines which rules apply. */
export type VoiceSurface =
  | "web" // public site pages + components
  | "meta" // <title> / meta description / JSON-LD — robotic on purpose
  | "sms" // outbound customer SMS
  | "voice" // VAPI receptionist speech
  | "social" // IG / GBP captions
  | "admin"; // internal operator UI — voice rules do not apply

/** Which document or code surface asserted a rule. */
export type VoiceSource =
  | "VOICE.md"
  | "brand-voice-guidelines.md"
  | "lint-brand-voice"
  | "igAutopost.generator"
  | "igAutopost.critic"
  | "voice-compliance";

/** Why a phrase is banned — drives how the fix is explained. */
export type KillReason =
  | "cliche" // empty marketing filler
  | "archetype" // HERO/RULER/SAGE invasion of a CAREGIVER+EVERYMAN brand
  | "llm-tell" // ChatGPT/Claude-ism that marks copy as AI-written
  | "bot-speak" // customer-service-script phrasing
  | "positioning"; // contradicts a standing operator directive (FCFS, payment programs)

export interface KillRule {
  /** Stable slug. Referenced by tests and suppression comments — never renumber. */
  id: string;
  /**
   * Match pattern. Stored WITHOUT the `g` flag on purpose: a shared global regex
   * carries mutable `lastIndex` between callers, which is exactly the class of
   * cross-consumer state bug this kernel exists to prevent. `findVoiceViolations`
   * builds a fresh global copy per scan.
   */
  pattern: RegExp;
  /** The short label used in prompts and reports. */
  label: string;
  why: string;
  fix: string;
  reason: KillReason;
  /** `block` fails the pre-commit gate. `warn` reports without failing. */
  severity: "block" | "warn";
  /** Substrings that make an otherwise-matching hit legitimate. Case-insensitive. */
  allow?: string[];
  /** Surfaces this rule does NOT apply to. */
  exempt?: VoiceSurface[];
  /** Which sources asserted this rule. */
  sources: VoiceSource[];
  /** Recorded disagreement or deliberate narrowing. */
  note?: string;
}

export interface VoiceViolation {
  ruleId: string;
  match: string;
  index: number;
  line: number;
  label: string;
  why: string;
  fix: string;
  severity: "block" | "warn";
}

// ─── Shared allowlists ──────────────────────────────────────────────────────

/**
 * "Grounded & Reliable" is the internal name of the 2026-05-02 positioning memo
 * and appears in code comments, strategy headers and the v1.7 silo. It is a
 * proper noun, not a claim about the shop.
 */
const GROUNDED_AND_RELIABLE = ["grounded & reliable", "grounded and reliable"];

/**
 * Query-target language we genuinely rank for. The kill list governs how the
 * shop describes ITSELF; blog titles and URL slugs that mirror a real search
 * query are intentional SEO inventory. Ported verbatim from the allowlist that
 * already lived in voice-compliance.test.ts — do not trim without checking GSC.
 */
const CHEAP_QUERY_TARGETS = [
  "cheap tires near me",
  "cheap tires cleveland",
  "cheap tire shop",
  "cheap brake repair",
  "cheap oil change",
  "cheap car repair",
  "cheap auto repair",
  "best cheap tires",
];

/**
 * Superlative phrasings that are real search queries the blog silo targets and
 * ranks for. Same principle as CHEAP_QUERY_TARGETS: the archetype rule governs
 * how the shop describes ITSELF, not a title that mirrors what a person typed
 * into Google. Verify against GSC before adding or removing an entry.
 */
const SUPERLATIVE_QUERY_TARGETS = [
  "best tires for",
  "best auto repair shop",
  "best tire shop",
  "best used tires",
];

/**
 * "quality" in its ordinary noun senses. VOICE.md and the guidelines both ban
 * the word specifically as an ADJECTIVE LABEL ("quality service") — ride quality
 * and installation quality are technical nouns, not marketing filler.
 * "quality used tires" and "OEM-quality" were already allowlisted in
 * voice-compliance.test.ts as industry part-tier language; preserved here.
 */
const QUALITY_NOUN_SENSES = [
  "ride quality",
  "installation quality",
  "build quality",
  "air quality",
  "quality of work",
  "quality of your",
  "quality used tires",
  "quality aftermarket",
  "oem-quality",
  "oem quality",
];

/**
 * "premium" naming a literal product tier the shop actually sells, which the
 * rule's own rationale exempts. Same treatment as "premium synthetic" for oil.
 */
const PREMIUM_PRODUCT_TIERS = [
  "premium synthetic",
  "premium / performance",
  "premium/performance",
  "premium (",
  "premium feel",
  // Tire tiers. The shop genuinely stocks three: used, new economy, and
  // premium (Michelin / Bridgestone / Continental). Naming the tier a customer
  // is choosing between is information, not self-praise.
  "premium tire",
  "premium tires",
  "premium brand",
  "premium all-season",
  "premium touring",
  "premium build quality",
];

// ─── The kill list ──────────────────────────────────────────────────────────

/**
 * The union of all six historical sources. Ordered by category so a reader can
 * audit a section against its governing document.
 */
export const KILL_RULES: readonly KillRule[] = Object.freeze([
  // ─── Cliché adjective labels (VOICE.md §kill list + guidelines §3) ────────
  {
    id: "cliche.trusted",
    pattern: /\btrusted\b/i,
    label: "trusted",
    why: "Don't claim trust — reviews do that",
    fix: "Show it: '4.9★ on 1,700+ reviews'",
    reason: "cliche",
    severity: "block",
    sources: [
      "VOICE.md",
      "brand-voice-guidelines.md",
      "lint-brand-voice",
      "igAutopost.generator",
      "igAutopost.critic",
      "voice-compliance",
    ],
    note: "voice-compliance only caught \"Cleveland's trusted\" / \"the trusted\"; bare 'trusted' passed there. Unified to the bare form, which the linter already used.",
  },
  {
    id: "cliche.expert",
    pattern: /\bexperts?\b/i,
    label: "expert / experts",
    why: "Confident shops don't claim expertise",
    fix: "'we do this every day' or '7 days a week'",
    reason: "cliche",
    severity: "block",
    allow: ["industry experts", "industry-experts"],
    sources: [
      "VOICE.md",
      "brand-voice-guidelines.md",
      "lint-brand-voice",
      "igAutopost.generator",
      "igAutopost.critic",
      "voice-compliance",
    ],
    note: "'industry experts' allowed for the ASE certification explainer, per the existing voice-compliance allowlist.",
  },
  {
    id: "cliche.quality",
    pattern: /\bquality\b/i,
    label: "quality",
    why: "Empty — shows nothing",
    fix: "Name a concrete spec, or interpolate the price band from BUSINESS (shared/business.ts). Never hardcode a dollar figure in copy.",
    reason: "cliche",
    severity: "block",
    allow: QUALITY_NOUN_SENSES,
    sources: [
      "VOICE.md",
      "brand-voice-guidelines.md",
      "lint-brand-voice",
      "igAutopost.generator",
      "igAutopost.critic",
    ],
  },
  {
    id: "cliche.premium",
    pattern: /\bpremium\b/i,
    label: "premium",
    why: "Fake-corporate unless naming a literal product tier",
    fix: "Use a concrete spec",
    reason: "cliche",
    severity: "block",
    allow: PREMIUM_PRODUCT_TIERS,
    sources: [
      "brand-voice-guidelines.md",
      "lint-brand-voice",
      "igAutopost.generator",
      "igAutopost.critic",
    ],
    note: "'premium synthetic' is a real oil tier and 'Premium / Performance' is a real tire tier (Michelin/Bridgestone/Continental). The rule targets the empty adjective, which its own rationale already exempts for literal tiers.",
  },
  {
    id: "cliche.top-notch",
    pattern: /\btop.notch\b/i,
    label: "top-notch",
    why: "Pure filler",
    fix: "Show a star rating or a review quote",
    reason: "cliche",
    severity: "block",
    sources: [
      "VOICE.md",
      "brand-voice-guidelines.md",
      "lint-brand-voice",
      "igAutopost.generator",
      "igAutopost.critic",
      "voice-compliance",
    ],
  },
  {
    id: "cliche.reliable",
    pattern: /\b(?:reliable|dependable)\b/i,
    label: "reliable / dependable",
    why: "Tells the reader nothing",
    fix: "Replace with the specific proof: 'same-day on most jobs', 'we've done 12,000+ of these'",
    reason: "cliche",
    severity: "block",
    allow: GROUNDED_AND_RELIABLE,
    exempt: ["admin"],
    sources: ["VOICE.md", "igAutopost.generator", "igAutopost.critic"],
    note: "THE DRIFT CASE. Killed by VOICE.md and banned in both igAutopost prompts, but scripts/lint-brand-voice.mjs never carried a pattern for it, so it reached the public site. Adding it here is what closes the gap. 'Grounded & Reliable' is allowlisted as the internal strategy name.",
  },
  {
    id: "cliche.comprehensive",
    pattern: /\bcomprehensive\b/i,
    label: "comprehensive",
    why: "Fake-corporate",
    fix: "List what you actually do",
    reason: "cliche",
    severity: "block",
    sources: ["brand-voice-guidelines.md", "lint-brand-voice"],
    note: "Blocked by the linter but the IG generator was never told about it — the drift running the other direction.",
  },
  {
    id: "cliche.state-of-the-art",
    pattern: /\bstate.of.the.art\b/i,
    label: "state-of-the-art",
    why: "Marketing cliché",
    fix: "Name the actual equipment or skip it",
    reason: "cliche",
    severity: "block",
    sources: [
      "VOICE.md",
      "brand-voice-guidelines.md",
      "lint-brand-voice",
      "igAutopost.generator",
      "voice-compliance",
    ],
    note: "The igAutopost CRITIC was never given this word, so a caption containing it scored full voice marks.",
  },
  {
    id: "cliche.hassle-free",
    pattern: /\bhassle.?free\b/i,
    label: "hassle-free",
    why: "Marketing cliché",
    fix: "'walk in, drop it off, we'll text you when it's ready'",
    reason: "cliche",
    severity: "block",
    sources: [
      "VOICE.md",
      "brand-voice-guidelines.md",
      "lint-brand-voice",
      "igAutopost.generator",
      "igAutopost.critic",
      "voice-compliance",
    ],
  },
  {
    id: "cliche.family-owned",
    pattern: /\b(?:family|locally).?owned\b/i,
    label: "family-owned / locally-owned",
    why: "Every shop says this",
    fix: "Named-person specificity: 'Moe's been running this since 2019'. Or VOICE.md's replacement: 'We close at 6 because we have families.'",
    reason: "cliche",
    severity: "block",
    sources: ["VOICE.md", "lint-brand-voice", "igAutopost.generator"],
    note: "The linter only matched 'family-owned' when followed within 30 chars by operated/business/shop, so the bare form passed CI. Widened to the bare form, which is what VOICE.md and the IG generator already banned. Customer testimonials quoting a real reviewer are data, not shop copy, and are out of lint scope.",
  },
  {
    id: "cliche.pride-ourselves",
    pattern: /\bwe pride ourselves\b/i,
    label: "we pride ourselves on",
    why: "Stop",
    fix: "Show the thing you're proud of",
    reason: "cliche",
    severity: "block",
    sources: ["VOICE.md"],
    note: "VOICE.md-only entry with no enforcement anywhere before this kernel.",
  },
  {
    id: "cliche.customer-satisfaction",
    pattern: /\bcustomer satisfaction\b/i,
    label: "customer satisfaction",
    why: "Empty",
    fix: "Replace with a specific number",
    reason: "cliche",
    severity: "block",
    sources: ["VOICE.md"],
    note: "VOICE.md-only entry, previously unenforced.",
  },
  {
    id: "cliche.satisfaction-guaranteed",
    pattern: /\bsatisfaction.guaranteed\b/i,
    label: "satisfaction guaranteed",
    why: "Means nothing, and 'guaranteed' collides with claim-safety rules",
    fix: "Specific promise: 'free re-do if anything we touched isn't right'",
    reason: "cliche",
    severity: "block",
    sources: ["lint-brand-voice"],
  },
  {
    id: "cliche.service-with-a-smile",
    pattern: /\bservice with a smile\b/i,
    label: "service with a smile",
    why: "Visual, not copy",
    fix: "Show it in a photo",
    reason: "cliche",
    severity: "block",
    sources: ["VOICE.md"],
    note: "VOICE.md-only entry, previously unenforced.",
  },
  {
    id: "cliche.friendly-staff",
    pattern: /\bfriendly staff\b/i,
    label: "friendly staff",
    why: "Visual — or let the reviews say it",
    fix: "Quote a review that says it",
    reason: "cliche",
    severity: "block",
    sources: ["VOICE.md"],
    note: "VOICE.md-only entry, previously unenforced.",
  },
  {
    id: "cliche.welcome-to",
    pattern: /\bwelcome to\b/i,
    label: "Welcome to...",
    why: "Visitors didn't ask",
    fix: "Open with the thing they came for",
    reason: "cliche",
    severity: "block",
    sources: ["VOICE.md"],
    note: "VOICE.md-only entry, previously unenforced.",
  },
  {
    id: "cliche.our-commitment",
    pattern: /\bour commitment to\b/i,
    label: "our commitment to...",
    why: "Show, don't tell",
    fix: "State the actual practice",
    reason: "cliche",
    severity: "block",
    sources: ["VOICE.md"],
    note: "VOICE.md-only entry, previously unenforced.",
  },
  {
    id: "cliche.same-great-service",
    pattern: /\bsame great service\b/i,
    label: "same great service",
    why: "Generic",
    fix: "'same shop, same line, same fair price'",
    reason: "cliche",
    severity: "block",
    sources: ["lint-brand-voice"],
  },

  // ─── Customer-service bot-speak (guidelines §3 + linter) ──────────────────
  {
    id: "bot.rest-assured",
    pattern: /\brest assured\b/i,
    label: "rest assured",
    why: "Patronizing",
    fix: "Direct promise: 'free check, written quote'",
    reason: "bot-speak",
    severity: "block",
    sources: [
      "VOICE.md",
      "brand-voice-guidelines.md",
      "lint-brand-voice",
      "voice-compliance",
    ],
  },
  {
    id: "bot.per-your-inquiry",
    pattern: /\bper your inquiry\b/i,
    label: "per your inquiry",
    why: "Customer-service-bot phrase",
    fix: "Be direct",
    reason: "bot-speak",
    severity: "block",
    sources: ["brand-voice-guidelines.md", "lint-brand-voice"],
  },
  {
    id: "bot.how-may-i-assist",
    pattern: /\bhow may I assist\b/i,
    label: "how may I assist",
    why: "Customer-service-bot phrase",
    fix: "Be direct",
    reason: "bot-speak",
    severity: "block",
    sources: ["brand-voice-guidelines.md", "lint-brand-voice"],
  },
  {
    id: "bot.have-a-great-day",
    pattern: /\bhave a (?:great|nice|good) day\b/i,
    label: "have a great day",
    why: "Generic sign-off",
    fix: "Be specific: 'drive safe'",
    reason: "bot-speak",
    severity: "block",
    sources: ["brand-voice-guidelines.md"],
    note: "Guidelines-only entry, previously unenforced. The guidelines name 'drive safe' as the approved replacement.",
  },
  {
    id: "bot.free-inspection",
    pattern: /\bfree inspection\b/i,
    label: "free inspection",
    why: "Customers say 'check', not 'inspection'",
    fix: "'free check'",
    reason: "bot-speak",
    severity: "block",
    sources: ["brand-voice-guidelines.md", "lint-brand-voice"],
    note: "The guidelines ban bare 'inspection'; the linter deliberately narrowed it to 'free inspection' because Ohio safety-inspection language is legitimate elsewhere. Narrowing preserved.",
  },
  {
    id: "bot.diagnostic-fee",
    pattern: /\bdiagnostic fee\b/i,
    label: "diagnostic fee",
    why: "Customer language is 'we'll tell you what's wrong'",
    fix: "'free check'",
    reason: "bot-speak",
    severity: "block",
    sources: ["brand-voice-guidelines.md", "lint-brand-voice"],
    note: "The guidelines ban bare 'diagnostic'; the linter narrowed it to 'diagnostic fee' because the shop runs real diagnostics pages and a /diagnostics route. Narrowing preserved.",
  },
  {
    id: "bot.without-your-approval",
    pattern: /\bwithout your approval\b/i,
    label: "without your approval",
    why: "Formal/procedural — softer than the brand voice",
    fix: "'you don't pay until you say yes'",
    reason: "bot-speak",
    severity: "block",
    sources: ["brand-voice-guidelines.md", "lint-brand-voice"],
    note: "Guidelines ban bare 'approval'; linter narrowing preserved.",
  },
  {
    id: "bot.no-surprises",
    pattern: /\bno surprises\b/i,
    label: "no surprises",
    why: "Passive — frame it actively",
    fix: "'we tell you the cost before we touch anything'",
    reason: "bot-speak",
    severity: "block",
    sources: ["brand-voice-guidelines.md", "lint-brand-voice"],
  },

  // ─── Archetype invasions (linter) ─────────────────────────────────────────
  // Nick's is CAREGIVER + EVERYMAN: neighborhood shop, takes care of you,
  // regular-guy-fair-deal. HERO swagger and SAGE authority read as incongruent
  // even when the customer can't name why, and trust drops.
  {
    id: "archetype.hero-superlative",
    pattern: /\b(?:best|#1|number one|leading|world.?class|industry.?leader)\s+(?:tire|auto|shop|mechanic|service)/i,
    label: "best / #1 / leading / world-class + noun",
    why: "HERO archetype invasion — Nick's is CAREGIVER, not the dominant champion",
    fix: "Replace with proof: '4.9★ on 1,700+ reviews' — let the data say best",
    reason: "archetype",
    severity: "block",
    allow: [...CHEAP_QUERY_TARGETS, ...SUPERLATIVE_QUERY_TARGETS],
    sources: ["lint-brand-voice", "igAutopost.generator", "igAutopost.critic"],
    note: "igAutopost bans bare 'best', '#1' and 'world-class'; the linter only caught them before a shop noun. Kept the linter's narrower form for site copy so SEO query targets like 'best cheap tires' survive, and allowlisted those targets explicitly.",
  },
  {
    id: "archetype.ruler",
    pattern: /\b(?:dominant|elite|exclusive|prestigious|luxury)\b/i,
    label: "dominant / elite / exclusive / prestigious / luxury",
    why: "RULER archetype invasion — Nick's is everyman, not the gatekeeper",
    fix: "'fair price' or 'straight deal'",
    reason: "archetype",
    severity: "block",
    sources: ["lint-brand-voice"],
  },
  {
    id: "archetype.hero-swagger",
    pattern: /\b(?:unmatched|unparalleled|second.to.none)\b/i,
    label: "unmatched / unparalleled / second-to-none",
    why: "HERO swagger — breaks Caregiver tone",
    fix: "Specific proof point: 'same-day on most jobs'",
    reason: "archetype",
    severity: "block",
    allow: [
      // "unmatched" has a strong, legitimate technical meaning in this
      // codebase that has nothing to do with swagger: METRICS-CONTRACT.md
      // defines "Unmatched paid revenue" as a canonical metric, the admin
      // shows unmatched estimate/lead rows, and "unmatched treads" is the
      // tire term for mismatched tires across an axle.
      "unmatched row",
      "unmatched rows",
      "unmatched est",
      "unmatched lead",
      "unmatched paid",
      "unmatched invoice",
      "unmatched tread",
    ],
    sources: ["lint-brand-voice"],
  },
  {
    id: "archetype.sage-research",
    pattern: /\b(?:research shows|studies prove|scientifically proven|clinically.tested)\b/i,
    label: "research shows / studies prove",
    why: "SAGE archetype invasion — Caregiver listens, doesn't lecture",
    fix: "First-person and specific: 'we've seen this 100x — here's what causes it'",
    reason: "archetype",
    severity: "block",
    sources: ["lint-brand-voice"],
  },
  {
    id: "archetype.certified-technicians",
    pattern: /\bcertified.{0,20}(?:technicians?|mechanics?|professionals?)\b/i,
    label: "certified technicians",
    why: "Corporate-credential framing — Nick's is regular guys who do this every day",
    fix: "'same crew who's been turning wrenches here since 2019'",
    reason: "archetype",
    severity: "block",
    allow: [
      "ase certified mechanics",
      "ase-certified mechanics",
      "ase certified technicians",
      "ase-certified technicians",
      "ase certified professionals",
      "ase-certified professionals",
    ],
    sources: ["lint-brand-voice", "igAutopost.generator", "igAutopost.critic"],
    note: "ASE is a credential the shop actually holds; BUSINESS.ase carries the approved wording ('ASE-certified technicians', never 'ASE Master Certified' and never a count). The rule targets invented credential framing, not the real one.",
  },
  {
    id: "archetype.empowering",
    pattern: /\b(?:empowering|empowered) (?:you|our customers|drivers)\b/i,
    label: "empowering you / our customers",
    why: "Corporate-coach speak — Caregiver does the work for you",
    fix: "Action verb: 'we tell you what's wrong before anything happens'",
    reason: "archetype",
    severity: "block",
    sources: ["lint-brand-voice"],
  },
  {
    id: "archetype.award-winning",
    pattern: /\b(?:award.winning|highly.rated|five.?star) (?:shop|service|team)/i,
    label: "award-winning / highly-rated / five-star + noun",
    why: "Fake-corporate self-praise — show proof, don't claim status",
    fix: "Show the rating with a source and year: '4.9★ on Google'",
    reason: "archetype",
    severity: "block",
    sources: ["lint-brand-voice"],
  },
  {
    id: "archetype.trust-me",
    pattern: /\b(?:experience|professional) (?:you can trust|driven|first)\b/i,
    label: "experience you can trust",
    why: "Trust-me-bro phrase — Caregiver shows up, doesn't beg trust",
    fix: "Show: '4.9★ / 1,700+ reviews'",
    reason: "archetype",
    severity: "block",
    sources: ["lint-brand-voice"],
  },

  // ─── LLM output tells (linter · unslop port) ──────────────────────────────
  {
    id: "llm.preamble",
    pattern: /\b(?:let'?s|let us)\s+(?:dive in|dive into|get started|break (?:it|this) down|explore|unpack|tackle)\b/i,
    label: "let's dive in / unpack / break it down",
    why: "LLM preamble — humans don't announce before writing",
    fix: "Cut the preamble, start with the point",
    reason: "llm-tell",
    severity: "block",
    sources: ["lint-brand-voice"],
  },
  {
    id: "llm.heres-the-thing",
    pattern: /\bhere'?s the thing\b/i,
    label: "here's the thing",
    why: "LLM pivot phrase",
    fix: "Just state the thing",
    reason: "llm-tell",
    severity: "block",
    sources: ["lint-brand-voice"],
  },
  {
    id: "llm.closing-tic",
    pattern: /\b(?:in conclusion|to wrap up|to summarize|in summary)\b/i,
    label: "in conclusion / to wrap up",
    why: "LLM closing tic",
    fix: "End on the punchline",
    reason: "llm-tell",
    severity: "block",
    sources: ["lint-brand-voice"],
  },
  {
    id: "llm.hedge-stack",
    pattern: /\b(?:it'?s worth (?:noting|mentioning)|it should be noted)\b/i,
    label: "it's worth noting",
    why: "Hedge-stacking weakens the claim",
    fix: "Make the claim directly",
    reason: "llm-tell",
    severity: "block",
    sources: ["lint-brand-voice"],
  },
  {
    id: "llm.happy-to-help",
    pattern: /\b(?:i'?d be happy to|i'?m happy to|happy to help)\b/i,
    label: "happy to help",
    why: "Performative service-bot reassurance",
    fix: "Just do the thing",
    reason: "llm-tell",
    severity: "block",
    sources: ["lint-brand-voice"],
  },
  {
    id: "llm.feel-free",
    pattern: /\b(?:feel free to|don'?t hesitate to|please don'?t hesitate)\b/i,
    label: "feel free to / don't hesitate",
    why: "Performative permission",
    fix: "Direct: 'Call us', 'Text us', 'Walk in'",
    reason: "llm-tell",
    severity: "block",
    sources: ["lint-brand-voice"],
  },
  {
    id: "llm.robotic-transition",
    pattern: /\b(?:furthermore|moreover|additionally|consequently)\b/i,
    label: "furthermore / moreover / additionally",
    why: "Robotic transition",
    fix: "'plus', 'and', 'so' — or start a new sentence",
    reason: "llm-tell",
    severity: "block",
    sources: ["lint-brand-voice"],
  },
  {
    id: "llm.forced-enthusiasm",
    pattern: /\b(?:buckle up|fasten your seatbelt|hold onto your hat)\b/i,
    label: "buckle up / hold onto your hat",
    why: "Forced-enthusiasm tic",
    fix: "Let the content carry the energy",
    reason: "llm-tell",
    severity: "block",
    sources: ["lint-brand-voice"],
  },
  {
    id: "llm.lecturing",
    pattern: /\b(?:it'?s important to remember|remember that|keep in mind that)\b/i,
    label: "it's important to remember / keep in mind",
    why: "Lecturing pose",
    fix: "Drop the meta-instruction",
    reason: "llm-tell",
    severity: "block",
    sources: ["lint-brand-voice"],
  },
  {
    id: "llm.todays-world",
    pattern: /\bin today'?s (?:fast.paced|digital|modern) (?:world|landscape|age)\b/i,
    label: "in today's fast-paced world",
    why: "Filler opener that marks AI output instantly",
    fix: "Cut it, start with the concrete claim",
    reason: "llm-tell",
    severity: "block",
    sources: ["lint-brand-voice"],
  },
  {
    id: "llm.wide-range",
    pattern: /\b(?:a wide (?:range|variety|array) of|a plethora of|a multitude of)\b/i,
    label: "a wide range of / a plethora of",
    why: "LLM elaboration",
    fix: "List the actual things",
    reason: "llm-tell",
    severity: "block",
    sources: ["lint-brand-voice"],
  },
  {
    id: "llm.unleash",
    pattern: /\b(?:unleash|unlock|empower|elevate) (?:your|the)\b/i,
    label: "unleash / unlock / elevate your...",
    why: "Squarespace-template verb",
    fix: "Concrete verb: fix, replace, install, check",
    reason: "llm-tell",
    severity: "block",
    sources: ["lint-brand-voice"],
  },

  // ─── Positioning directives (voice-compliance) ────────────────────────────
  // These are standing operator directives, not style preferences. The shop is
  // first-come-first-served with a drop-off model; appointment language and
  // "financing" contradict live operating reality and compliance posture.
  {
    id: "positioning.appointment-language",
    pattern: /\b(?:Book|Reserve|Hold Your Spot)\s+(?:Appointment|Online|Your Spot|a Bay)\b/i,
    label: "Book Appointment / Reserve / Hold Your Spot",
    why: "The shop is first-come-first-served — appointment language is banned",
    fix: "'Schedule Drop-Off' or 'Hold a bay' per the CTA library",
    reason: "positioning",
    severity: "block",
    exempt: ["admin"],
    sources: ["voice-compliance"],
  },
  {
    id: "positioning.schedule-appointment",
    pattern: /\bSchedule\s+(?:Appointment|a Time|Time Slot)\b/i,
    label: "Schedule Appointment / Schedule a Time",
    why: "Appointment scheduling is banned — FCFS only",
    fix: "'Schedule Drop-Off'",
    reason: "positioning",
    severity: "block",
    allow: ["schedule drop-off"],
    exempt: ["admin"],
    sources: ["voice-compliance"],
  },
  {
    id: "positioning.waiting-room",
    pattern: /\bwaiting\s+room\b/i,
    label: "waiting room",
    why: "Drop-off model — there is no waiting room",
    fix: "Describe the drop-off flow instead",
    reason: "positioning",
    severity: "block",
    exempt: ["admin"],
    sources: ["voice-compliance"],
  },
  {
    id: "positioning.cheap",
    pattern: /\b(?:affordable|cheap)\s+(?:tires|repair|service|auto|brake|prices?)\b/i,
    label: "affordable / cheap as a price descriptor",
    why: "Signals weakness when the shop says it about itself",
    fix: "State the actual price band from BUSINESS (shared/business.ts)",
    reason: "positioning",
    severity: "block",
    allow: CHEAP_QUERY_TARGETS,
    exempt: ["admin"],
    sources: ["voice-compliance"],
    note: "Allowlisted query targets are SEO inventory the site genuinely ranks for — the rule governs self-description, not search-intent mirroring.",
  },
  {
    id: "positioning.financing",
    pattern: /\bWe\s+Offer\s+Financing\b/i,
    label: "We Offer Financing",
    why: "Standing directive: the approved term is 'Payment Programs'",
    fix: "'Payment Programs Available'",
    reason: "positioning",
    severity: "block",
    exempt: ["admin"],
    sources: ["voice-compliance"],
  },
  {
    id: "positioning.acima-credit-language",
    pattern:
      /\bacima['’]?s?\s+(?:financing|finance|credit|loans?)\b|\b(?:financing|finance|credit|loans?)\s+(?:through|via|with|from)\s+acima\b/i,
    label: "Acima described as financing / credit / a loan",
    why:
      "Acima is lease-to-own, not credit. Its merchant terms prohibit presenting the program as credit, and FTC Regulation M governs the trigger terms — the doctrine lives in client/src/components/payments/AcimaLeaseStrip.tsx and client/src/lib/acima.ts",
    fix: "'Acima lease-to-own' — the only approved vocabulary is 'Lease-to-Own', 'Weekly Lease Payment', 'Initial Payment'",
    reason: "positioning",
    severity: "block",
    exempt: ["admin"],
    sources: ["voice-compliance"],
    note:
      "Deliberately scoped to DIRECT conflation ('Acima financing', 'credit via Acima'). Provider lists naming Acima beside real lenders are governed by shared/financing.ts's product-accuracy header, not this rule — lender names themselves are intentional customer copy, not violations.",
  },
]);

// ─── The positive half — previously enforced NOWHERE ────────────────────────

export interface VoicePattern {
  id: string;
  name: string;
  description: string;
  examples: readonly string[];
}

/**
 * The 7 patterns from VOICE.md. Deploy any of them; never the same one twice on
 * a page. Before this kernel these lived only as prose, so no generator was ever
 * told what a GOOD line looks like — only which words were forbidden. That is
 * why generated copy trends bland even when it passes the kill list.
 */
export const VOICE_PATTERNS: readonly VoicePattern[] = Object.freeze([
  {
    id: "mundane-comparison",
    name: "Mundane comparisons",
    description: "Replace abstract speed/quality with a weirdly specific real-world unit.",
    examples: [
      "faster than your phone finds a signal",
      "before your podcast hits the next ad break",
    ],
  },
  {
    id: "anti-promise",
    name: "Anti-promises",
    description: "Other shops compete on what they DO. Name what we WON'T.",
    examples: [
      "We won't replace pads that pass inspection.",
      "We won't quote a fix without showing you the broken part.",
    ],
  },
  {
    id: "tricolon",
    name: "Tricolon escalation",
    description: "Three-item list where item 3 breaks the pattern.",
    examples: ["Free install · free coffee · free opinions."],
  },
  {
    id: "math-argument",
    name: "Math-as-argument",
    description: "Two numbers, a contrast, a punchline.",
    examples: ["$50 belt prevents a $500 tow."],
  },
  {
    id: "footnote-asterisk",
    name: "Footnote asterisks",
    description: "Honest caveat that sounds like a friend whispering.",
    examples: ["Same-day service*  ·  * Unless the part has to come from Cincinnati. We'll call."],
  },
  {
    id: "generational-pivot",
    name: "Generational pivots",
    description: "Span 50+ years in 12 words and land on competence.",
    examples: ["We've serviced cars older than YouTube and newer than your phone."],
  },
  {
    id: "mock-formal",
    name: "Mock-formal in unexpected places",
    description: "Dignified tone where you'd expect breezy.",
    examples: ['Cookie banner: "We use cookies. Browsers do that. Carry on."'],
  },
]);

/**
 * The three-part test every landed line passes at once (VOICE.md §the recipe).
 * A line fails because one of the three is missing.
 */
export const VOICE_RECIPE = Object.freeze([
  "Surprises — phrasing the reader didn't expect from an auto shop",
  "Specifies — there's a concrete point underneath the wordplay",
  "Reveals — sounds like a person thinking, not a brand communicating",
] as const);

/** At most one absurd line per three paragraphs of straight copy. */
export const ABSURDITY_RATIO = Object.freeze({
  absurdLines: 1,
  perStraightParagraphs: 3,
  why: "More than this and the voice becomes a parody of itself.",
});

/**
 * Surfaces where the 7 patterns must NOT be deployed. The kill list still
 * applies everywhere; this governs where playful voice is forbidden outright.
 */
export const SURFACE_RULES: readonly { surface: string; rule: string }[] = Object.freeze([
  { surface: "Pricing pages", rule: "Clear > clever. People comparing prices need them readable." },
  { surface: "Booking confirmation flow", rule: "Post-form the customer is committed. Don't break the moment." },
  { surface: "FAQ answers", rule: "The question can be playful. The answer cannot." },
  { surface: "Error / payment failures", rule: "Never. Frustration + humor = anger." },
  { surface: "Warranty terms", rule: "Legal text. Boring on purpose." },
  { surface: "Phone, address, hours", rule: "Always plain. Never style." },
  { surface: "<title> / meta description", rule: "SEO is robotic. Save voice for body copy." },
  { surface: "Schema / JSON-LD", rule: "Same — robotic." },
]);

/** Replace generic CTAs with what the customer would actually say. */
export const CTA_LIBRARY: readonly { context: string; generic: string; voiced: string }[] =
  Object.freeze([
    { context: "Hero on /brakes", generic: "BOOK NOW", voiced: "Hold a bay" },
    { context: "Hero on /tires", generic: "ORDER NOW", voiced: "See my size" },
    { context: "Hero on /diagnostics", generic: "BOOK NOW", voiced: "Read my codes" },
    { context: "Bottom of FAQ", generic: "GET IN TOUCH", voiced: "Talk to a real human" },
    { context: "Financing", generic: "APPLY NOW", voiced: "See if I qualify" },
    { context: "Booking form submit", generic: "SUBMIT", voiced: "Hold my spot" },
    { context: "Newsletter capture", generic: "SUBSCRIBE", voiced: "Send me one email a month" },
  ]);

// ─── The one matcher ────────────────────────────────────────────────────────

export interface FindOptions {
  /** Surface the copy lives on. Rules exempting this surface are skipped. */
  surface?: VoiceSurface;
  /** Include `warn`-severity rules. Default true. */
  includeWarnings?: boolean;
  /** Rule ids to skip (for a reviewed, documented exception). */
  skipRuleIds?: readonly string[];
}

/**
 * The single matcher every consumer uses — linter, tests, runtime critics.
 *
 * Allowlist semantics: a hit is suppressed when an allow phrase occurs in the
 * surrounding window and that phrase itself contains the match. This is what
 * lets "Grounded & Reliable" survive while "reliable braking" does not.
 */
export function findVoiceViolations(text: string, opts: FindOptions = {}): VoiceViolation[] {
  const { surface, includeWarnings = true, skipRuleIds = [] } = opts;
  const out: VoiceViolation[] = [];
  const lower = text.toLowerCase();

  for (const rule of KILL_RULES) {
    if (skipRuleIds.includes(rule.id)) continue;
    if (!includeWarnings && rule.severity === "warn") continue;
    if (surface && rule.exempt?.includes(surface)) continue;

    // Fresh regex per rule per scan — never share `lastIndex` across callers.
    const rx = new RegExp(rule.pattern.source, rule.pattern.flags.includes("i") ? "gi" : "g");
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      if (m[0].length === 0) {
        rx.lastIndex++;
        continue;
      }
      if (rule.allow && isAllowed(lower, m.index, m[0].length, rule.allow)) continue;
      out.push({
        ruleId: rule.id,
        match: m[0],
        index: m.index,
        line: text.slice(0, m.index).split("\n").length,
        label: rule.label,
        why: rule.why,
        fix: rule.fix,
        severity: rule.severity,
      });
    }
  }

  return out.sort((a, b) => a.index - b.index);
}

function isAllowed(
  lowerText: string,
  matchIndex: number,
  matchLength: number,
  allow: readonly string[],
): boolean {
  for (const phrase of allow) {
    const needle = phrase.toLowerCase();
    // The allow phrase must overlap the match, not merely appear on the page.
    let from = lowerText.indexOf(needle);
    while (from !== -1) {
      const to = from + needle.length;
      if (from <= matchIndex && to >= matchIndex + matchLength) return true;
      from = lowerText.indexOf(needle, from + 1);
    }
  }
  return false;
}

// ─── Prompt rendering — so an LLM prompt can never hold its own list ────────

/**
 * The banned-word line for a GENERATOR prompt. `igAutopost` used to hand-write
 * 13 words here and 10 in its critic; both now render from this function, so the
 * thing that writes copy and the thing that grades it can never disagree again.
 */
export function renderBannedWordsForPrompt(opts: { surface?: VoiceSurface } = {}): string {
  const labels = KILL_RULES.filter(
    (r) => r.severity === "block" && !(opts.surface && r.exempt?.includes(opts.surface)),
  ).map((r) => r.label);
  return `NEVER use these words or phrases anywhere: ${labels.join("; ")}. They are banned brand-voice phrases.`;
}

/** The positive half, for a generator prompt. */
export function renderVoiceRulesForPrompt(): string {
  const recipe = VOICE_RECIPE.map((r) => `  - ${r}`).join("\n");
  const patterns = VOICE_PATTERNS.map(
    (p) => `  - ${p.name}: ${p.description} e.g. "${p.examples[0]}"`,
  ).join("\n");
  return [
    "Every line that lands does these three at once:",
    recipe,
    "",
    "Deploy one of these patterns — never the same one twice in a piece:",
    patterns,
    "",
    `Ratio: at most ${ABSURDITY_RATIO.absurdLines} absurd line per ${ABSURDITY_RATIO.perStraightParagraphs} paragraphs of straight copy. ${ABSURDITY_RATIO.why}`,
  ].join("\n");
}

/** The voice dimension of a critic rubric. Mirrors the generator exactly. */
export function renderCriticRubricForPrompt(): string {
  return [
    "does it surprise + specify + reveal a human voice? Concrete numbers, named services, real places?",
    `Score 0.0 if it contains ANY banned phrase (${KILL_RULES.filter((r) => r.severity === "block")
      .map((r) => r.label)
      .join("; ")}) or an LLM tell.`,
  ].join(" ");
}

/** Stable ids, for tests and reports. */
export const KILL_RULE_IDS: readonly string[] = Object.freeze(KILL_RULES.map((r) => r.id));
