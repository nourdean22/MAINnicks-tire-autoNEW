/**
 * DOMAIN-ROUTED MODEL SELECTION.
 *
 * v6 · BATCH 3 · Apr 28. Routes a given task to the best-fit model
 * based on the *domain* of the request (code vs marketing vs strategy
 * vs vision vs reasoning). Different models have wildly different
 * cost/latency/quality profiles per domain — using one model for
 * everything wastes capacity.
 *
 * Routing matrix: detectDomain() classifies the message into a taskType;
 * the actual provider/model order per taskType is owned by
 * getPreferredOrderForTask() in provider.ts (env-driven Ollama -> Gemini ->
 * OpenAI -> Anthropic). Venice was retired (PRs #235/#237/#239), so the old
 * per-domain Venice primaries no longer apply.
 *
 * Detection: detectDomain() reads the user message + chat-mode signals
 * and returns the domain classification. Used by chat route to pass
 * the right `taskType` and `preferLargeContext` to getModel().
 */

export type Domain =
  | "marketing"   // Cleveland-brand content, captions, hashtags
  | "code"        // TypeScript, SQL, Prisma migrations, deploys
  | "strategy"    // long-form planning, second-order reasoning
  | "vision"      // photo/image analysis, multimodal
  | "fast-classify" // yes/no, intent detection, lightweight
  | "creative"    // brainstorming, copy variations, alt-angles
  | "summary"     // compression, distillation, recap
  | "general";    // default conversational chat

export interface DomainRoute {
  domain: Domain;
  taskType: "fast" | "reason" | "deep" | "vision" | "code" | "creative" | "summary" | "classify" | "extract" | "math" | "sql";
  preferLargeContext: boolean;
  /** Human label for debug logging */
  label: string;
}

const PATTERNS: Array<{ test: RegExp; route: DomainRoute }> = [
  // ── CODE — JS/TS/SQL/DSL keywords + stack traces + GitHub mentions ──
  {
    test: /\b(typescript|javascript|prisma|sql|migration|deploy|next\.js|react\s+component|tsx?\s+file|\.ts|github|pull\s+request|merge\s+conflict|stack\s+trace|TypeError|ReferenceError|fix\s+the\s+bug|refactor|implement|wire\s+up|hook\s+up)\b/i,
    route: {
      domain: "code",
      taskType: "code",
      preferLargeContext: true, // Ollama qwen3-coder has 1M context for big repos
      label: "code → ollama qwen3-coder",
    },
  },
  // ── VISION — image upload, photo analysis, OCR ──
  {
    test: /\b(this\s+image|this\s+photo|the\s+photo|caption\s+this|describe\s+this\s+image|ocr|read\s+the\s+(text|sign)|what's\s+in\s+(this|the)\s+(image|photo))\b/i,
    route: {
      domain: "vision",
      taskType: "vision",
      preferLargeContext: true, // qwen3-vl for native multimodal
      label: "vision → ollama qwen3-vl",
    },
  },
  // ── STRATEGY — multi-step planning, war-room, long-form ──
  {
    test: /\b(strategy|strategic|plan\s+(my\s+(week|month|quarter)|the\s+launch)|second-order|opportunity\s+cost|trade-off|war\s+room|10[\s-]year|long[\s-]term\s+plan|moat|competitive\s+advantage)\b/i,
    route: {
      domain: "strategy",
      taskType: "deep",
      preferLargeContext: true,
      label: "strategy → ollama deepseek-v4-pro",
    },
  },
  // ── MARKETING — content gen, captions, copy, hashtags ──
  {
    test: /\b(caption|instagram|reel|story|tiktok|hashtag|post\s+for|write\s+a\s+(post|caption|ad)|marketing|gbp|google\s+business|ad\s+copy|landing\s+page\s+copy|cta|hook\s+for)\b/i,
    route: {
      domain: "marketing",
      taskType: "creative",
      preferLargeContext: false,
      label: "marketing",
    },
  },
  // ── CREATIVE — brainstorm, alt angles, variations ──
  {
    test: /\b(brainstorm|alt(ernate)?\s+angle|variation|riff\s+on|come\s+up\s+with|out[\s-]of[\s-]the[\s-]box|unconventional|wild\s+ideas?)\b/i,
    route: {
      domain: "creative",
      taskType: "creative",
      preferLargeContext: false,
      label: "creative",
    },
  },
  // ── FAST-CLASSIFY — yes/no, intent, single-word ──
  {
    test: /^(yes|no|y|n|sure|ok|stop|cancel|skip|next|done|got\s+it|tldr|tl;dr)\.?\s*$/i,
    route: {
      domain: "fast-classify",
      taskType: "classify",
      preferLargeContext: false,
      label: "fast-classify",
    },
  },
  // ── SUMMARY — compress, recap, tl;dr ──
  {
    test: /\b(summari[sz]e|recap|tl;dr|brief\s+me|what\s+happened|catch\s+me\s+up|distill|condense)\b/i,
    route: {
      domain: "summary",
      taskType: "summary",
      preferLargeContext: false,
      label: "summary",
    },
  },
];

/**
 * Classify the message into a domain. Falls through to "general" when
 * no specific pattern matches. Caller passes the route to getModel().
 *
 * v8.6 BATCH 34 — `hasImageAttachments` short-circuits to the vision
 * route regardless of text content. Closes the gap where a user
 * uploads an image but says nothing (or just "?", "what is this",
 * etc.) and the text-only classifier would route to the wrong model.
 */
export function detectDomain(
  message: string,
  options: { hasImageAttachments?: boolean } = {},
): DomainRoute {
  // Image attachment beats text patterns — the user clearly wants
  // the model to SEE something.
  if (options.hasImageAttachments) {
    return {
      domain: "vision",
      taskType: "vision",
      preferLargeContext: true,
      label: "vision → ollama qwen3-vl (auto-detected from attachment)",
    };
  }
  if (!message) {
    return {
      domain: "general",
      taskType: "reason",
      preferLargeContext: false,
      label: "general → default",
    };
  }
  for (const { test, route } of PATTERNS) {
    if (test.test(message)) return route;
  }
  return {
    domain: "general",
    taskType: "reason",
    preferLargeContext: false,
    label: "general → default",
  };
}
