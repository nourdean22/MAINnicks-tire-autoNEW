/**
 * Chat fast-path · detection regex patterns
 *
 * Lives in handlers/ (next to the handlers that strip these prefixes)
 * so individual handler files can import the exact pattern they were
 * triggered by without depending on interceptors.ts (which would
 * create a static circular import — interceptors.ts already imports
 * the handlers themselves).
 *
 * interceptors.ts re-exports every symbol from this file at the
 * `@/lib/ai/chat/interceptors` boundary so existing tests + callers
 * see no change in public API.
 */

// ── Image-intent detection ──────────────────────────────────────
// Apr 27 — broadened from the previous strict template that demanded
// the noun immediately followed the article. That made
// "make me a simple image of X" miss (because of "simple") which is
// exactly how a normal user phrases a request. The AI then tried to
// satisfy the ask by hallucinating `![Generated Image](...)` markdown
// with fake IDs that 404'd at render. Now the regex matches when:
//   · a generation verb anywhere in the line (generate / make /
//     create / draw / render / use X to make)
//   AND
//   · an image noun anywhere in the line
// The negative lookahead in EARLY_IMAGE_NEG still rejects metaphors
// ("image plan", "picture summary"). The two pieces in conjunction
// catch wide phrasing without drift.
export const EARLY_NL_IMAGE_VERB =
  /\b(generate|gen|make|create|draw|render|design|mock\s*up|whip\s+up|cook\s+up|show\s+me|give\s+me|use\s+\S+\s+to\s+(?:generate|make|create|draw|render|design))\b/i;
// Apr 27 v2 — added common typos ("picutre" / "pictrue") + abbreviations
// (img / pics / graphic / mockup / wallpaper / thumbnail). Real users
// type fast and misspell — losing the fast-path on a typo means the
// LLM tries to fake a tool call. Cheaper to be lenient.
//
// v10.0.392 · DROPPED ambiguous nouns: 'cover', 'flyer', 'banner'.
// 'cover' matches "cover the cost", "cover for me", "cover that
// shift" — none of which mean image generation. 'flyer' and 'banner'
// have non-marketing meanings ("frequent flyer", "banner year") that
// triggered false positives. Operator can still say "make me a
// banner image" — the explicit /image command path handles the rare
// real banner-design ask.
export const EARLY_NL_IMAGE_NOUN =
  /\b(image|images|img|imgs|pic|pics|picture|pictures|picutre|pictrue|pictur|photo|photos|photoo|illustration|illustrations|rendering|renderings|render|artwork|visual|visuals|graphic|graphics|drawing|drawings|sketch|sketches|mockup|mockups|mock-up|wallpaper|wallpapers|thumbnail|thumbnails|logo|logos|icon|icons|avatar|avatars|poster|posters)\b/i;
// Kept for backwards-compat with any test still importing the old
// single regex — falls through to the conjunction shape used above.
export const EARLY_NL_IMAGE =
  /\b(generate|make|create|draw|show\s+me|give\s+me)\s+(me\s+)?(an?\s+|the\s+)?(image|picture|photo|pic|illustration|rendering|artwork|visual)\b/i;

/**
 * Negative lookahead phrases that LOOK like image asks but are
 * actually metaphor: "image of a roadmap", "picture summary", etc.
 * Without this guard, "give me an image plan" → tries to render.
 */
export const EARLY_IMAGE_NEG =
  /\b(image|picture|photo|pic|illustration|rendering|artwork|visual|graphic|drawing|sketch)\s+(plan|plans|roadmap|strategy|map|breakdown|outline|framework|summary|overview|guide|of\s+(the\s+)?(situation|problem|issue|status))\b/i;

/**
 * v10.0.475 · IDEATION-NEGATIVE
 * v10.0.483 · LOOSENED · the strict noun list (idea/concept/angle/...)
 *   missed "Come up with a scroll-stopping Instagram post" because
 *   "Instagram post" wasn't in the noun list. Now the trigger phrase
 *   alone is enough — collaborative-ideation framing wins regardless
 *   of what noun follows. The LLM still has the generateImage tool
 *   available, so prompts that ALSO want an image (like "concept +
 *   caption + generate the picture") can call the tool inline within
 *   the chat reply.
 *
 * Triggers (any one of these anywhere in the message → suppress
 * image-gen interceptor, let LLM handle in chat mode):
 *   · "come up with X"
 *   · "brainstorm X"
 *   · "help me [think/plan/draft/write/figure/figure out/come up/
 *      brainstorm/cook up]"
 *   · "ideate"
 *   · "what would/could/should be [a/some/the] [adjective]" (rhetorical
 *     ideation · "what would be a good angle for this post")
 *   · multi-part request markers · "(1) ... (2) ... (3)" (clearly
 *     compositional · the LLM needs to assemble multiple parts)
 *
 * Operator can still force image gen with /img · /image · or a direct
 * ask without ideation framing ("generate a picture of X").
 */
export const EARLY_IDEATION_NEG =
  /(\bcome\s+up\s+with\b|\bbrainstorm\b|\bhelp\s+me\s+(?:come\s+up|brainstorm|think|figure|plan|draft|write|cook\s+up|figure\s+out)\b|\bideate\b|\bwhat\s+(?:would|could|should)\s+be\b|\(1\)\s.+?\(2\)\s.+?\(3\))/i;

// ── Decision / brain-dump / save / intensity ────────────────────

// v10.0.392 · TIGHTENED. Pre-fix matched bare "decided to X" / "I've
// decided to Y" anywhere on a line · over-fired on conversational
// reflective phrasing ("I decided to take a different angle"). Now
// requires EXPLICIT log-trigger framing · 'log decision' / 'decision:'
// prefix is unambiguous; bare "I decided to" goes through the LLM
// path so Nick can decide whether to capture it (or ask).
export const EARLY_DECISION =
  /^(log\s+(this|a|my)?\s*decision\s*:?\s*|decision\s*:\s*|my\s+decision\s*(is|:)\s*)/i;

// Apr 26 fix · `journal\s+` was too strict — required whitespace
// between "journal" and the colon, but the user-facing error message
// documents the shape as "journal: <thought>" (no space). Loosened
// to `journal\s*` so both "journal:" and "journal : " work, matching
// the docs + matching how `note` is already handled in this regex.
// `capture\s+` also tightened similarly for the same reason.
export const EARLY_BRAIN_DUMP =
  /^(remember\s+(this\s*:?\s*|that\s+|:\s*)|note\s*(this\s*:?\s*|that\s+|:\s*)|capture\s*(this\s*:?\s*|:\s*)|journal\s*(this\s*:?\s*|:\s*)|brain\s*dump\s*:\s*)/i;

// v10.0.488 · INTENSITY override commands
export const EARLY_STRICT = /^\/strict\b|\b(stay focused|just answer|no suggestions|no elevation|cut the fluff)\b/i;
export const EARLY_CHILL  = /^\/chill\b|\b(chill mode|go easy|less intense|relax)\b/i;

// AG-30 · /spar prefix — explicit opt-in to the diverge→attack→converge
// thought-partner directive (lib/ai/prompt/policy/spar-mode.ts). Single
// source of truth for the prefix: finalize-system-prompt (injection) and
// persist-assistant-turn (unconditional adversarial critic) both import it.
export const EARLY_SPAR = /^\/spar\b/i;

/**
 * v10.0.143 · /save — explicit user-triggered ingest. Heuristic-only
 * categorization (no LLM call), writes to BrainMemory, returns a
 * fast confirmation. Lighter than the journal-ingest path which runs
 * AI extraction.
 *
 * Forms accepted (anchored at line start so it can't trigger
 * mid-sentence):
 *   /save <content>
 *   /save: <content>
 *   /save <multi-line content>
 *   /remember <content>
 *   /ingest <content>
 */
export const EARLY_SLASH_SAVE = /^\/(save|remember|ingest)(\s|:)/i;

// ── Image follow-up + multi-option clarification ────────────────

/**
 * Apr 27 · IMAGE-FOLLOWUP DETECTION
 *
 * Phrases like "another one", "switch it up", "again", "different one"
 * are clearly image follow-ups when the previous assistant turn was
 * an image generation. Without this, those follow-ups fall through to
 * the LLM path which can't generate images and just sits there
 * forever (or hallucinates fake markdown).
 *
 * Fires only when previousAssistantWasImage=true so casual "again"
 * after a text reply doesn't accidentally trigger image gen.
 */
export const EARLY_IMAGE_FOLLOWUP =
  /^(another\s+(one|image|picture|version)?|again|do\s+(it\s+)?again|one\s+more|different(\s+(one|version|style))?|switch\s+it\s+up|new\s+one|try\s+again|retry|regen(erate)?|make\s+another|the\s+\w+\s+one|the\s+\w+\s+(?:post|option|idea|draft)|option\s*\d+|post\s*\d+|idea\s*\d+|the\s+(?:first|second|third|fourth|last))\b/i;

/**
 * v10.0.513 · Regex for the multi-option image clarification text.
 * When the prior assistant turn matches this, the user's next message
 * is treated as a follow-up to the clarification · same fast-path
 * as previousAssistantWasImage, so "the technicians one" routes to
 * image generation instead of falling through to streamText (which
 * then hallucinates a fake markdown image URL · the 2026-05-12
 * "echanic,cars 404" bug).
 */
export const MULTI_OPTION_CLARIFICATION_RE =
  /^Which one do you want imaged\?/i;
