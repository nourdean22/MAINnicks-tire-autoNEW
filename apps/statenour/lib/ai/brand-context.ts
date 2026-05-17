/**
 * Brand context for AI image generation
 *
 * Apr 27 v2 · Promoted from "append a paragraph" to a context-aware
 * visual control engine. Three-stage pipeline:
 *
 *   1. isMarketingIntent(prompt) — should we brand at all?
 *      Personal asks ("yellow circle on black", "my dog at the beach")
 *      skip branding entirely. Only fires on prompts that mention
 *      tire/shop/mechanic/instagram/post/customer/Nick's etc.
 *
 *   2. classifyDetail(prompt) — how much guidance does the prompt need?
 *      · "vague" (short, undirected): inject the FULL system —
 *        identity, color, lighting, composition, environment,
 *        humans, cleveland, mood, avoid list. The model has nothing
 *        to anchor on, so we hand-hold the entire frame.
 *      · "partial" (medium-detail): inject identity + color + lighting
 *        + environment + humans + avoid. Skip composition/cleveland/
 *        mood since those are usually implied by the prompt.
 *      · "specific" (highly detailed): respect the prompt. Inject
 *        ONLY identity + color + avoid list. The user already wrote
 *        the composition; don't trample it.
 *
 *   3. Each block is concrete and prompt-engineered for image models —
 *      hex codes, color temperatures (3000-3500K), specific car
 *      models (Civic/F-150/Camry not "everyday cars"), measurable
 *      compositions (4:5, 16:9). Image models weight specifics
 *      heavily; abstract marketing-speak ("premium feel") gets ignored.
 *
 *   4. Negative-list (AVOID) is always injected because image models
 *      give huge weight to what NOT to do.
 *
 * Why three tiers and not just "stuff everything in"?
 *   The previous one-paragraph dump was 2275ch and the model started
 *   ignoring the back half. Tiered injection means a vague prompt
 *   gets full coverage, a specific prompt doesn't get its detailed
 *   composition overwritten by our defaults.
 */

// ── Detection ─────────────────────────────────────────────────────
// Single keyword test — no fancy NLP. If any of these tokens appear
// in the prompt (case-insensitive), Nour is thinking about Nick's
// Tire's marketing/social/customer-facing imagery and brand context
// gets injected. Personal prompts ("yellow circle on black", "my dog
// at the beach", "abstract vaporwave gradient") skip the branding
// entirely.

// Whole-word tokens — matched with \b boundaries so "ad" doesn't
// match "gradient", "post" doesn't match "deposit", "brake" doesn't
// match "breakroom", etc.
const MARKETING_WORDS = [
  // Social/marketing surfaces
  "instagram", "facebook", "tiktok", "youtube", "social", "post", "posts",
  "story", "stories", "reel", "reels", "ad", "ads", "marketing", "market",
  "campaign", "promo", "promotion", "flyer", "banner", "poster",
  "billboard", "thumbnail", "advertisement", "advertising",
  // Subject matter
  "tire", "tires", "shop", "garage", "mechanic", "mechanics", "alignment",
  "brake", "brakes", "rotor", "rotors", "tune-up", "tuneup",
  // Customer/business
  "customer", "customers", "client", "clients", "branding", "brand",
];

// Multi-word phrases — substring match (these are unambiguous).
const MARKETING_PHRASES = [
  "nick's tire", "nicks tire", "nick's auto", "nicks auto",
  "auto labor guide",
  "auto repair", "auto shop", "oil change", "lift bay", "service bay",
];

const WORDS_RE = new RegExp(
  `\\b(${MARKETING_WORDS.map((w) => w.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|")})\\b`,
  "i",
);

export function isMarketingIntent(prompt: string): boolean {
  if (!prompt) return false;
  const lower = prompt.toLowerCase();
  if (MARKETING_PHRASES.some((p) => lower.includes(p))) return true;
  return WORDS_RE.test(lower);
}

// ── Detail-level classification ───────────────────────────────────
// Decides how much of the brand system to inject. Heuristic blends
// word count with signal-detection (does the prompt already specify
// composition, lighting, color, vehicle, etc.?).
//
//   vague     →  full system injection (model has nothing to anchor on)
//   partial   →  enrich without overwriting (medium-detail prompts)
//   specific  →  respect prompt, inject only identity/color/avoid
//
// Word count alone undercounts a short-but-specific prompt like
// "Honda Civic on a lift, gold accent strip, 4:5 vertical" (8 words,
// 3 specific signals). So we count specifics too.

const DETAIL_SIGNALS = [
  // Composition signals
  /\b(4:5|16:9|9:16|1:1|portrait|landscape|vertical|horizontal|square|aspect)\b/i,
  /\b(close[-\s]?up|wide[-\s]?shot|overhead|low[-\s]?angle|over[-\s]?the[-\s]?shoulder|rule of thirds|framing|composition)\b/i,
  // Lighting signals
  /\b(rim[-\s]?light|backlight|tungsten|3000k|3500k|low[-\s]?key|cinematic|directional|key[-\s]?light|fill[-\s]?light|golden[-\s]?hour)\b/i,
  // Color signals (hex or named)
  /#[0-9a-f]{3,6}\b/i,
  /\b(gold|black|graphite|amber|warm|cool)\s+(accent|background|tone|palette)\b/i,
  // Vehicle specificity
  /\b(civic|accord|camry|f-?150|silverado|cherokee|equinox|cr-?v|tundra|tacoma|ram\s+1500|honda|toyota|ford|chevy|jeep|subaru)\b/i,
  // Environment specificity
  /\b(epoxy|polished[-\s]?floor|led[-\s]?strip|tool[-\s]?wall|tire[-\s]?stack|alignment[-\s]?rack|lift[-\s]?bay)\b/i,
  // Subject specificity
  /\b(technician|tech|customer|mechanic)\s+(installing|inspecting|holding|standing|kneeling|under|next to)\b/i,
];

export type DetailLevel = "vague" | "partial" | "specific";

export function classifyDetail(prompt: string): DetailLevel {
  const cleaned = prompt.trim();
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  const signalCount = DETAIL_SIGNALS.reduce(
    (acc, re) => acc + (re.test(cleaned) ? 1 : 0),
    0,
  );
  // Effective detail = word count weighted by specific signals
  const effective = wordCount + signalCount * 5;
  if (effective < 10) return "vague";
  if (effective < 30) return "partial";
  return "specific";
}

// ── Brand system blocks ───────────────────────────────────────────
// Each constant is one self-contained, prompt-engineered block.
// Image models prefer comma-separated specifics over bullet lists
// or marketing copy, so each block reads like dense prose with
// concrete nouns and measurable values.

// Always injected — defines the brand's positioning.
const BRAND_CORE =
  "Brand: Nick's Tire & Auto, Cleveland OH independent auto repair shop. Premium-execution + blue-collar-credibility positioning — Tesla-grade visual discipline applied to a real working shop. NOT a dealership, franchise, or budget shack. The place people go when they want it done right the first time.";

// Always injected — strict color hierarchy with hex values.
const BRAND_COLOR =
  "Color hierarchy (strict): primary accent gold #FDB913 used for edges, highlights, reflections, light streaks, headlines, brand marks; dominant background deep black #0A0A0A; secondary surfaces and walls warm graphite #1F1F1F; neutrals white and brushed steel for text and tool reflections. HARD BAN on dominant red, corporate blues, rainbow or neon palettes.";

// Vague + partial — lighting recipe.
const BRAND_LIGHTING =
  "Lighting: low-key cinematic contrast, strong directional light from one side or top, warm rim light at 3000-3500K kissing the subject's edges, controlled specular reflections on tires, paint, and metal tools. Reference: automotive magazine cover photography, high-end car commercials. AVOID flat lighting, on-camera flash, overexposed white environments.";

// Vague only — full composition spec.
const BRAND_COMPOSITION =
  "Composition: 4:5 (Instagram) or 16:9 (cinematic) aspect ratios, rule-of-thirds framing enforced, sharp foreground with background depth-of-field falloff into the bay, intentional negative space reserved for text overlays. Framing hierarchy: hero subject (tire, mechanic, car front, brake) → supporting shop bay → atmospheric depth.";

// Vague + partial — shop environment realism.
const BRAND_ENVIRONMENT =
  "Shop environment realism (where AI outputs typically fail — fix this): epoxy or polished concrete floors, LED strip and bay lighting, organized tool walls, clean tire stacks with visible tread patterns, two-post and four-post lifts, alignment racks, diagnostic tablets, gold accent stripes on shop walls. Vehicles are Midwest-realistic everyday cars: Honda Civic, Honda Accord, Toyota Camry, Ford F-150, Chevy Silverado, Jeep Cherokee, Chevy Equinox, Honda CR-V — NEVER supercars unless explicitly requested. AVOID empty sterile garages, chaotic clutter, unrealistic floating layouts.";

// Vague + partial — human realism.
const BRAND_HUMANS =
  "People: local, competent, grounded, age 25-60, Cleveland-Midwest mix. Technicians are focused mid-action, clean-but-working uniforms, hands actually on tools or under cars — no 'grease monkey' caricature. Customers stand calm, reassured, natural posture, slight smile at most — never overly grinning. AVOID stock-photo smiles, exaggerated expressions, AI-deformed hands, warped faces, extra fingers.";

// Vague only — Cleveland identity (subtle anchor).
const BRAND_CLEVELAND =
  "Cleveland identity, exactly ONE anchor element per image (never multiple): wet pavement reflections, salt residue on car panels in winter shots, weathered industrial brick wall, Lake Erie horizon line, Midwest overcast sky tone. AVOID skyline overload, tourist-postcard landmarks, lake-effect snow as the primary subject.";

// Conditional — only when prompt mentions text, copy, headline, or overlay.
const BRAND_TYPOGRAPHY =
  "Typography (when text is rendered): bold uppercase sans-serif, tight tracking, gold #FDB913 or white on black background, generous padding, max two type sizes per layout. AVOID cursive, serif, grunge fonts, cluttered multi-font layouts.";

// Vague only — emotional tone.
const BRAND_MOOD =
  "Mood calibration: confidence HIGH, flashiness LOW, trust VERY HIGH, energy CONTROLLED, realism MAXIMUM. The viewer should feel 'this place knows exactly what they are doing.' Premium-but-grounded — the customer feels in control, the technician feels respected, the shop feels worth its price.";

// Always injected — image models weight negative lists heavily.
const BRAND_AVOID =
  "HARD AVOID: cartoon or illustration style, clip-art, neon cyberpunk or anime aesthetics, red-heavy visuals, corporate-blue ad design, cheesy handshakes, thumbs-up poses, floating objects on white backgrounds, AI-warped faces or anatomy, extra fingers, low-resolution compression artifacts, watermarks, text logos, overdesigned flyer clutter, generic stock-photo composition.";

// ── Tiered assembly ───────────────────────────────────────────────
// Pulls together the right blocks for the detected detail level.
// Typography is opt-in based on text-related keywords in the prompt.

const TYPE_KEYWORDS_RE = /\b(text|copy|headline|caption|overlay|title|tagline|cta|call[-\s]?to[-\s]?action|words|lettering|logo)\b/i;

function buildContext(prompt: string, level: DetailLevel): string {
  const blocks: string[] = [BRAND_CORE, BRAND_COLOR];

  if (level === "vague") {
    blocks.push(
      BRAND_LIGHTING,
      BRAND_COMPOSITION,
      BRAND_ENVIRONMENT,
      BRAND_HUMANS,
      BRAND_CLEVELAND,
      BRAND_MOOD,
    );
  } else if (level === "partial") {
    blocks.push(BRAND_LIGHTING, BRAND_ENVIRONMENT, BRAND_HUMANS);
  }
  // "specific" gets only CORE + COLOR + AVOID (typography conditional below)

  if (TYPE_KEYWORDS_RE.test(prompt)) {
    blocks.push(BRAND_TYPOGRAPHY);
  }

  blocks.push(BRAND_AVOID);
  return blocks.join(" ");
}

// Exposed for tests/debugging — also useful if any caller wants to
// preview what's about to be injected without firing an image gen.
export const BRAND_BLOCKS = {
  CORE: BRAND_CORE,
  COLOR: BRAND_COLOR,
  LIGHTING: BRAND_LIGHTING,
  COMPOSITION: BRAND_COMPOSITION,
  ENVIRONMENT: BRAND_ENVIRONMENT,
  HUMANS: BRAND_HUMANS,
  CLEVELAND: BRAND_CLEVELAND,
  TYPOGRAPHY: BRAND_TYPOGRAPHY,
  MOOD: BRAND_MOOD,
  AVOID: BRAND_AVOID,
} as const;

// Back-compat: keep BRAND_CONTEXT exported as the full vague-tier
// context, since other code may import the legacy constant.
export const BRAND_CONTEXT = buildContext("", "vague");

// ── Public helper ─────────────────────────────────────────────────
// Single call site for both interceptors and the generateImage tool.
// Returns either the original prompt unchanged (personal) or the
// prompt + tiered brand context separated by a clear delimiter.

export function brandedPrompt(prompt: string): string {
  const cleaned = prompt.trim();
  if (!isMarketingIntent(cleaned)) return cleaned;
  const level = classifyDetail(cleaned);
  const context = buildContext(cleaned, level);
  return `${cleaned}\n\n--- ${context}`;
}
