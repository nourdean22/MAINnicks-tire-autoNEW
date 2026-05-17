/**
 * CONTENT-MULTI — multi-output content engine.
 *
 * v6 · BATCH 3 · Apr 28. Powers the slash commands `/all`, `/ab`,
 * `/reformat`, `/twopass`, `/carousel`. Takes a single subject and a
 * mode and returns a structured response the chat surface renders as
 * cards (one per output).
 *
 * Modes:
 *   · ALL — Instagram post + Reel caption + Story copy in one ask.
 *     Uses 3 different shape templates so each lands on the right
 *     channel.
 *   · AB — 2 versions of the same subject with different angles
 *     (e.g., Cialdini scarcity vs FOMO; pain vs reward; story vs stat).
 *   · REFORMAT — takes existing post + target platform, rewrites with
 *     platform-aware formatting (FB = longer, conversational; Twitter
 *     = punchy ≤280; TikTok = hook-first; GBP = factual + offer-driven).
 *   · TWOPASS — generates with one model, critiques with another, then
 *     emits the better version. Uses Ollama (1M context) for the gen
 *     pass and Venice for the critique pass — different models = harder
 *     to hide cliches because each has its own weakness profile.
 *   · CAROUSEL — 4-8 sequential image scenes about a single subject
 *     (story arc: hook → problem → reveal → action → close).
 *
 * Detection: detectMultiMode() reads the user's message for trigger
 * phrases and slash commands. Returns null when no multi-mode detected.
 */

export type MultiMode = "all" | "ab" | "reformat" | "twopass" | "carousel" | null;

export interface MultiContext {
  mode: MultiMode;
  subject: string;
  /** REFORMAT only — target platform */
  targetPlatform?: "facebook" | "twitter" | "tiktok" | "gbp" | null;
  /** AB only — number of variations to generate (default 2) */
  variations?: number;
  /** CAROUSEL only — number of scenes (default 5) */
  scenes?: number;
}

/**
 * Detect whether the user message wants a multi-output response.
 * Returns the mode + extracted subject, or null if single-output.
 */
export function detectMultiMode(message: string): MultiContext | null {
  if (!message) return null;
  const m = message.toLowerCase();

  // /all + variants
  if (/^\/all\s/.test(m) || /\b(post.*reel.*story|reel.*post.*story|all\s+three\s+platforms|instagram\s+post.*reel.*story)\b/.test(m)) {
    return { mode: "all", subject: stripSlashAndKeyword(message, /^\/all\s+/i, /generate\s+(?:instagram\s+post,?\s+reel\s+caption,?\s+and\s+story\s+copy\s+for):?\s*/i) };
  }

  // /ab + variants
  if (/^\/ab\s/.test(m) || /\b(2\s+versions?|two\s+versions?|a\/b\s+test|give\s+me\s+two|two\s+different\s+angles?)\b/.test(m)) {
    const matches = /(\d+)\s+versions?/.exec(m);
    const variations = matches ? Math.min(5, Math.max(2, parseInt(matches[1], 10))) : 2;
    return {
      mode: "ab",
      subject: stripSlashAndKeyword(message, /^\/ab\s+/i, /(?:give\s+me\s+)?\d+\s+(?:different\s+)?versions?,?\s+(?:[a-z]\s+and\s+[a-z]\s+with\s+different\s+angles?,?\s+)?of:?\s*/i),
      variations,
    };
  }

  // /reformat
  if (/^\/reformat\s/.test(m) || /\breformat\s+(?:this\s+)?for\s+(facebook|fb|twitter|x|tiktok|gbp|google\s+business)/i.test(message)) {
    const platMatch = /\b(facebook|fb|twitter|x|tiktok|gbp|google\s+business)\b/i.exec(message);
    let targetPlatform: MultiContext["targetPlatform"] = null;
    if (platMatch) {
      const p = platMatch[1].toLowerCase();
      targetPlatform = p === "fb" ? "facebook"
        : p === "x" ? "twitter"
        : p === "google business" || p === "gbp" ? "gbp"
        : (p as MultiContext["targetPlatform"]);
    }
    return {
      mode: "reformat",
      subject: stripSlashAndKeyword(message, /^\/reformat\s+/i, /reformat\s+(?:this\s+)?for\s+\[?[^\]]*\]?\s*[—-]?\s*(?:pick\s+the\s+platform\s+and\s+rewrite:?\s*)?/i),
      targetPlatform,
    };
  }

  // /twopass
  if (/^\/twopass\s/.test(m) || /\btwo[\s-]pass\b/i.test(m)) {
    return {
      mode: "twopass",
      subject: stripSlashAndKeyword(message, /^\/twopass\s+/i, /two[\s-]pass\s+content\s+with\s+self[\s-]critique\s+for:?\s*/i),
    };
  }

  // /carousel
  if (/^\/carousel\s/.test(m) || /\b(carousel|\d+[\s-]scene\s+image|image\s+carousel)\b/i.test(m)) {
    const matches = /(\d+)[\s-]scene/.exec(m);
    const scenes = matches ? Math.min(10, Math.max(3, parseInt(matches[1], 10))) : 5;
    return {
      mode: "carousel",
      subject: stripSlashAndKeyword(message, /^\/carousel\s+/i, /generate\s+a\s+\d+[\s-]scene\s+image\s+carousel\s+about:?\s*/i),
      scenes,
    };
  }

  return null;
}

function stripSlashAndKeyword(message: string, ...patterns: RegExp[]): string {
  let out = message.trim();
  for (const p of patterns) {
    out = out.replace(p, "").trim();
  }
  return out;
}

/**
 * Build the system-prompt addendum for a multi-output mode. The chat
 * route appends this to the existing system prompt when detectMultiMode
 * returns non-null, so the model knows the expected output shape.
 */
export function buildMultiPromptAddendum(ctx: MultiContext): string {
  switch (ctx.mode) {
    case "all":
      return `
═══ MULTI-OUTPUT MODE — POST + REEL + STORY ═══
The user wants ONE subject formatted for THREE channels. Output exactly
this structure (one block per channel, separated by ---):

📸 INSTAGRAM POST (4:5, 1500-2200 chars including hashtags)
[caption with PAS structure, 5-7 hashtags including #Cleveland and 1 service tag, CTA in last 2 lines]

---

🎬 REEL CAPTION (≤200 chars + 3-5 hashtags)
[short, hook-first, conversational. assume the visual carries the story]

---

📱 STORY COPY (≤80 chars per slide, 3 slides)
Slide 1 — [hook]
Slide 2 — [reveal/proof]
Slide 3 — [CTA + sticker prompt]

Subject: ${ctx.subject || "(not specified)"}
`.trim();

    case "ab":
      return `
═══ A/B VARIATIONS — ${ctx.variations ?? 2} VERSIONS ═══
The user wants ${ctx.variations ?? 2} different angles on the SAME subject.
Each version uses a different persuasion lever so we can A/B test which
resonates. Output structure (one block per version, separated by ---):

🅰️ VERSION A — [angle name, e.g. SCARCITY / FOMO / SOCIAL PROOF / PAIN-RELIEF / STORY]
[full caption with hashtags + CTA]

---

🅱️ VERSION B — [different angle name]
[full caption with hashtags + CTA]

${ctx.variations && ctx.variations > 2 ? "...and so on through version " + String.fromCharCode(64 + ctx.variations) : ""}

Subject: ${ctx.subject || "(not specified)"}
Each version MUST use a different angle. No repetition.
`.trim();

    case "reformat":
      const platformGuide = {
        facebook: "FACEBOOK — longer (300-600 chars), conversational, full sentences, link-friendly, end with question to drive comments",
        twitter: "TWITTER (X) — ≤280 chars, punchy hook in first 12 chars, 1-2 hashtags max, no links unless essential",
        tiktok: "TIKTOK — hook-first ≤120 chars, trend-aware, ALL CAPS for emphasis is OK, 3-5 hashtags including 1 trending sound reference",
        gbp: "GOOGLE BUSINESS PROFILE — factual, offer-driven, 150-300 chars, include phone (216) 631-5870 + offer details + dates",
      }[ctx.targetPlatform ?? "facebook"];
      return `
═══ CROSS-PLATFORM REFORMAT — TARGET: ${ctx.targetPlatform?.toUpperCase() ?? "PICK ONE"} ═══
${platformGuide}

If user didn't specify a platform, output 4 versions (FB, Twitter, TikTok, GBP), one per platform, separated by ---.

Source content: ${ctx.subject || "(not specified)"}
`.trim();

    case "twopass":
      return `
═══ TWO-PASS CONTENT — GEN + CRITIQUE + REVISE ═══
This output runs in 3 visible passes. Output structure:

PASS 1 — DRAFT (write the first version cold, no second-guessing)
[full caption]

---

PASS 2 — CRITIQUE (be ruthless: which line is weakest? which CTA is generic? which hashtag is wrong? would Nour ship this?)
[bullet list of specific weaknesses]

---

PASS 3 — REVISED (apply the critique, ship the better version)
[final caption]

Subject: ${ctx.subject || "(not specified)"}
`.trim();

    case "carousel":
      return `
═══ ${ctx.scenes ?? 5}-SCENE IMAGE CAROUSEL ═══
The user wants a sequential image carousel — one image per scene that
together tell a story. Output ${ctx.scenes ?? 5} scene descriptions,
one per slide, with a story arc: HOOK → PROBLEM → REVEAL → ACTION → CLOSE.

Output structure (one block per scene, separated by ---):

SCENE 1/${ctx.scenes ?? 5} — [scene title]
Image prompt: [detailed visual description for image gen]
Caption: [≤60 chars text overlay]

---

SCENE 2/${ctx.scenes ?? 5} — ...

(...continue for all ${ctx.scenes ?? 5} scenes)

Subject: ${ctx.subject || "(not specified)"}
`.trim();

    default:
      return "";
  }
}

/**
 * Format a friendly preview line the interceptor can prepend to the
 * stream so Nour sees what mode is firing before tokens arrive.
 */
export function formatMultiPreview(ctx: MultiContext): string {
  switch (ctx.mode) {
    case "all":
      return "_⚡ Multi-output: post + reel + story_";
    case "ab":
      return `_⚡ A/B variations · ${ctx.variations ?? 2} versions_`;
    case "reformat":
      return `_⚡ Reformat → ${ctx.targetPlatform ?? "all platforms"}_`;
    case "twopass":
      return "_⚡ Two-pass: draft → critique → revise_";
    case "carousel":
      return `_⚡ Carousel · ${ctx.scenes ?? 5} scenes_`;
    default:
      return "";
  }
}
