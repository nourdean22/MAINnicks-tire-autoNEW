/**
 * Quality benchmark prompt registry · v10.0.345 · Phase 4 of glitch
 * taxonomy hardening (Category 7 · quality regressions).
 *
 * Curated set of gold-standard prompts that represent the real Nour
 * use cases. The benchmark runner (`scripts/run-quality-bench.ts`)
 * fires each prompt against the current model + sanitizer + critic,
 * then verifies the output passes deterministic checks.
 *
 * Why deterministic checks (not just critic indices) · the critic is a
 * deterministic heuristic and can drift when its detectors/thresholds change.
 * The independent regex + length + must-mention + forbidden checks make those
 * changes visible instead of treating the critic as an oracle.
 *
 * When to run:
 *   · After any model version change (lib/ai/provider.ts model IDs)
 *   · After any system prompt change (lib/ai/system-prompt.ts)
 *   · After any output-sanitizer change
 *   · Weekly via cron (planned)
 *
 * When a prompt fails:
 *   · Investigate WHY (model regression vs prompt change vs critic drift)
 *   · Either fix the underlying issue OR update the gold-standard
 *   · NEVER lower the score floor without a documented reason in the
 *     commit message + provider.ts model changelog comment
 */

export interface QualityCheck {
  /** Substring or pattern that MUST appear in the output (case-insensitive). */
  mustMention?: Array<string | RegExp>;
  /** Substring or pattern that MUST NOT appear in the output. */
  mustNotContain?: Array<string | RegExp>;
  /** Minimum word count · prevents stub replies. */
  minWords?: number;
  /** Maximum word count · prevents runaway output. */
  maxWords?: number;
  /** Critic-overall heuristic index floor (0-100) · lib/ai/output-critic.ts. */
  minCriticOverall?: number;
  /**
   * Canonical Nour-voice specificity marker density per 100 words.
   * Same unit/function as lib/ai/nour-voice-profile.ts specificityDensity().
   */
  minSpecificityMarkerDensity?: number;
}

export interface QualityPrompt {
  /** Stable id · include in commits referencing this prompt. */
  id: string;
  /** What this prompt tests · one-line description. */
  description: string;
  /** Category from docs/glitch-taxonomy.md (7 = quality regression). */
  cat: number;
  /** Real user input (or close approximation). */
  user: string;
  /** Optional prior-turn context · simulates multi-turn flows. */
  priorAssistant?: string;
  /** Optional intent hint for the critic. */
  intent?: "creative" | "factual" | "actionable" | "summary";
  /** What the output MUST satisfy. */
  checks: QualityCheck;
  /** Notes on why this prompt was selected (e.g. real glitch source). */
  notes?: string;
}

export const QUALITY_PROMPTS: QualityPrompt[] = [
  // ── Post creation · the cmou6xugm regression bay ─────────────────
  {
    id: "post-creation-instagram-social-proof",
    description: "Instagram post for Nick's Tire · social-proof angle",
    cat: 7,
    user: "Help me come up with a creative Instagram post for Nick's Tire — social proof angle",
    intent: "creative",
    checks: {
      mustMention: [
        /nick'?s tire/i, // must reference the brand
        /(customer|review|testimonial|trust|client|recommend)/i, // social proof signal
      ],
      mustNotContain: [
        /<request>/i,
        /<instruction>/i,
        /<think>/i,
        /^certainly/i,
        /^as an ai/i,
        /i hope this helps/i,
      ],
      minWords: 20,
      maxWords: 200,
      minCriticOverall: 70,
    },
    notes:
      "From cmou6xugm · the original ask that produced glitches downstream. The post itself was clean (turn 4) · this prompt locks that quality in.",
  },
  {
    id: "post-creation-with-cleveland-brand-anchor",
    description: "Marketing copy that should anchor on Cleveland location",
    cat: 7,
    user: "Write a 3-sentence promo for Nick's Tire & Auto in Cleveland for fall winterization",
    intent: "creative",
    checks: {
      mustMention: [
        /cleveland/i,
        /nick'?s tire/i,
        /(winter|fall|cold|snow|tire|safety)/i,
      ],
      mustNotContain: [
        /<request>/i,
        /<instruction>/i,
        /^certainly/i,
        /^as an ai/i,
      ],
      minWords: 20,
      maxWords: 100,
      minCriticOverall: 70,
    },
    notes: "Brand-anchor + location + seasonal · all three must land.",
  },

  // ── Image-prompt synthesis (Cat 3 detector validation) ───────────
  {
    id: "image-synth-from-prior-post",
    description:
      "Synth path · user says 'now generate the picture' after a written post",
    cat: 7,
    user: "now generate the picture",
    priorAssistant:
      "Here's the social-proof post for Nick's Tire: At Nick's Tire, every car receives care like our family vehicle. Recent customer Ali shared: \"My ride handled flawlessly thanks to their expert service!\" Book now for peace of mind. 🔧🚘 #CarCareWithCare",
    intent: "actionable",
    checks: {
      // The synth output is the IMAGE PROMPT, not direct user-facing text.
      // This prompt validates the synth pulls relevant subject from prior.
      mustMention: [/(car|tire|shop|service|customer|repair|nick)/i],
      mustNotContain: [
        /<request>/i,
        /<instruction>/i,
        /now generate/i, // shouldn't echo the user's referential phrase
      ],
      minWords: 8,
      maxWords: 80,
    },
    notes:
      "Synth path validates that 'now generate the picture' pulls visual subject from the prior assistant turn (the post about Nick's Tire). Feeds image generator.",
  },

  // ── Image regen · the v10.0.332 glitch bay ────────────────────────
  {
    id: "image-regen-from-quality-complaint",
    description:
      "Regen path · user complains about prior image, wants refined version",
    cat: 7,
    user:
      "The image you generated has a few glitches and looks a little generic go do it again make sure it's professional looking and very high quality",
    priorAssistant:
      "**Prompt:** A clean, organized infographic against a light blue background features icons of a tire gauge, oil can, headlight, brake caliper, and tread depth tool, each labeled with a seasonal maintenance tip\n**Model:** seedream-v4 · 512x512",
    intent: "actionable",
    checks: {
      // The refined-prompt output should preserve the original subject
      // (infographic with auto maintenance icons) while adding quality
      // adjectives. Most importantly · MUST NOT contain the user's
      // complaint text.
      mustMention: [
        /(infographic|illustration|graphic|poster|chart)/i,
        /(tire|maintenance|automotive|auto)/i,
      ],
      mustNotContain: [
        /glitches/i, // user's complaint word should NOT be in the prompt
        /go do it again/i,
        /<request>/i,
      ],
      minWords: 15,
      maxWords: 150,
    },
    notes:
      "Real user complaint from cmou6xugm turn 16. v10.0.332 fix · synth detects regen ask + extracts prior image prompt + refines. This test locks in that fix.",
  },

  // ── Operational reply · price/inventory query ────────────────────
  {
    id: "operational-tire-price-quote",
    description: "Customer asks tire price · should be direct, no fluff",
    cat: 7,
    user: "what's the price for 4 new tires for a 2018 honda civic",
    intent: "factual",
    checks: {
      mustMention: [
        /(\$|price|quote|tire|stock|installation|appointment)/i,
      ],
      mustNotContain: [
        /^certainly/i,
        /^of course/i,
        /^happy to help/i,
        /as an ai/i,
        /i hope this helps/i,
        /<request>/i,
      ],
      minWords: 15,
      maxWords: 150,
      minCriticOverall: 70,
    },
    notes:
      "Operational queries should be direct. Filler phrases break Nick's voice.",
  },

  // ── Brain query · personal · should not refuse ───────────────────
  {
    id: "brain-query-recent-decisions",
    description: "Operator queries brain for context · should NOT refuse",
    cat: 7,
    user: "what decisions did I make last week about hiring",
    intent: "factual",
    checks: {
      mustNotContain: [
        /^as an ai i (cannot|can'?t)/i,
        /^i don'?t have access/i,
        /^as a language model/i,
        /<request>/i,
        /<instruction>/i,
      ],
      minWords: 5,
      maxWords: 250,
    },
    notes:
      "Refusal pattern · over-refusal is a Cat 7 quality regression. Nick has access to brain memory for queries like this.",
  },

  // ── Daily brief · summary mode ───────────────────────────────────
  {
    id: "summary-morning-brief",
    description: "Morning brief generation · structured summary format",
    cat: 7,
    user:
      "Give me my morning brief: 3 urgent leads waiting, 2 estimates aging > 24h, $2400 revenue today vs $3000 yesterday, weather rainy",
    intent: "summary",
    checks: {
      mustMention: [/(urgent|aging|revenue|today)/i],
      mustNotContain: [
        /<request>/i,
        /<instruction>/i,
        /^certainly/i,
        /as an ai/i,
        /i hope this helps/i,
      ],
      minWords: 30,
      maxWords: 300,
      minCriticOverall: 65, // summaries get a slightly lower floor
      // Unit migration from the retired lexical-percentage proxy (30) to the
      // canonical marker density used by production. >=2/100w is the live
      // critic's "grounded" band; this is not a weakened threshold.
      minSpecificityMarkerDensity: 2.0,
    },
    notes:
      "Canonical specificity-marker-density check · summaries with no measurable anchors violate the operator-grade tone.",
  },

  // ── Action claim · the fabrication-rewriter target zone ──────────
  {
    id: "action-claim-publish-without-tool",
    description: "User asks to publish · model must NOT claim publish without tool fire",
    cat: 7,
    user: "post the social-proof draft to instagram now",
    priorAssistant:
      "Here's the draft: At Nick's Tire, every car receives care like our family vehicle...",
    intent: "actionable",
    checks: {
      // If the model is going to claim "I'll publish it" / "I posted it"
      // WITHOUT firing a tool, that's a fabrication. Production should
      // route to /social with a button OR fire the publishToInstagram tool.
      mustNotContain: [
        // These phrases without a tool-call would be fabrication
        /^i'?ve (posted|published|scheduled) it/i,
        /^posted/i,
        /^done.*posted/i,
      ],
      minWords: 5,
      maxWords: 200,
    },
    notes:
      "Action-claim guard. The fabrication-rewriter (lib/ai/chat/fabrication-rewriter.ts) catches these post-stream · this prompt verifies the L1 system-prompt rule prevents them at generation time.",
  },
];
