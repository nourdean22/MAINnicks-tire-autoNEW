/**
 * robots.txt — one policy, one builder, one test.
 *
 * The rules that shaped it, all from vendor documentation read 2026-09-07:
 *
 * - Google: "User agent specific groups and global groups (*) are not
 *   combined" — a crawler obeys only its most specific group. So a named group
 *   exists ONLY to block a crawler outright. Every allowed crawler stays on the
 *   `*` group and inherits the private-path Disallows. Never write
 *   `User-agent: OAI-SearchBot / Allow: /` — that strips /admin for it.
 * - Google: "Don't use the robots.txt file for canonicalization purposes";
 *   a disallowed URL can still be indexed, without its content. The old
 *   `Disallow: /*?utm_*` lines are gone: every path already gets a query-free
 *   canonical injected server-side (spaFallback.ts), which is the tool for it.
 * - Google ignores Crawl-delay. Bing honours it, 1 is its "Slow" tier, and Bing
 *   says a delay "will only reduce the amount and the freshness of the content
 *   placed into the index". Removed — 300-odd URLs need no throttle.
 * - Training vs answering are SEPARATE user agents at OpenAI (GPTBot vs
 *   OAI-SearchBot / ChatGPT-User), Anthropic (ClaudeBot vs Claude-SearchBot /
 *   Claude-User), Apple (Applebot-Extended vs Applebot), Mistral
 *   (MistralAI-Training vs -Index / -User) and Common Crawl (CCBot, no answer
 *   surface at all). Each vendor documents that blocking the training token
 *   leaves its search / answer surface untouched. Google-Extended, Amazonbot and
 *   Meta-ExternalAgent are NOT in the training list: each bundles training with
 *   a product surface (Gemini-app grounding, Alexa, Meta AI), so they stay an
 *   explicit owner decision rather than part of a switch.
 * - The training block is an OPERATOR SWITCH (`ROBOTS_BLOCK_AI_TRAINING_CRAWLERS`),
 *   default off, because whether being in a model's training set helps or hurts
 *   a local shop's representation is undocumented either way. The switch makes
 *   the decision reversible in one env edit and keeps the answer-engine agents
 *   out of it structurally (see the disjointness test).
 */

// The four policy lists below are deliberately NOT exported: the knip orphan
// gate counts an export consumed only by its own test as an orphan, and the
// contract is pinned by literals in server/robotsTxt.test.ts instead — which
// is the stronger shape anyway (a silent edit to a list fails the test).

/** Paths no crawler should fetch. Shared by every group that allows anything. */
const PRIVATE_PATH_DISALLOWS = [
  "/admin",
  "/admin/",
  "/my-garage",
  "/portal",
  "/api/",
  "/status/",
  "/inspection/",
] as const;

/**
 * Crawlers blocked outright: no answer surface a Cleveland tire shop can be
 * cited on, and either no reachable documentation (Bytespider) or a vendor
 * statement that it runs no crawler at all (Cohere: "do not use Cohere bots
 * or user agents"), so the token is an unknown operator wearing the name.
 */
const ALWAYS_BLOCKED_CRAWLERS = ["Bytespider", "cohere-ai"] as const;

/**
 * Documented training-only tokens. The answer / search agents of the same
 * vendors are deliberately NOT here — see the ANSWER_ENGINE_AGENTS list pinned
 * in server/robotsTxt.test.ts.
 */
const AI_TRAINING_CRAWLERS = [
  "GPTBot", // OpenAI — "may be used in training our generative AI foundation models"
  "ClaudeBot", // Anthropic — content that "could potentially contribute to their training"
  "CCBot", // Common Crawl — open archive, no answer surface
  "Applebot-Extended", // Apple — opt-out from foundation-model training; search unaffected
  "MistralAI-Training", // Mistral — dataset crawl
] as const;

// Agents that produce or index a customer-facing answer about the shop
// (Googlebot, Bingbot, OAI-SearchBot, ChatGPT-User, PerplexityBot,
// Perplexity-User, Claude-SearchBot, Claude-User, Applebot, DuckAssistBot,
// Amzn-SearchBot, Amzn-User, MistralAI-Index, MistralAI-User,
// Meta-ExternalFetcher) must never appear in a block group in either mode.
// The test pins that list so a future "complete the set" edit fails.

const SITEMAP_PATHS = [
  "/sitemap.xml",
  "/sitemap-services.xml",
  "/sitemap-locations.xml",
  "/sitemap-images.xml",
] as const;

export interface RobotsOptions {
  siteUrl: string;
  /** `ROBOTS_BLOCK_AI_TRAINING_CRAWLERS === "true"` in production. Default off. */
  blockAiTrainingCrawlers: boolean;
}

function blockGroup(agent: string): string {
  return `User-agent: ${agent}\nDisallow: /`;
}

export function buildRobotsTxt(opts: RobotsOptions): string {
  const sections: string[] = [];

  sections.push(
    [
      "User-agent: *",
      "Allow: /",
      "",
      "# Admin, auth and private pages",
      ...PRIVATE_PATH_DISALLOWS.map((p) => `Disallow: ${p}`),
    ].join("\n"),
  );

  sections.push(
    [
      "# Scrapers with no answer surface for this shop and no documented compliance",
      ...ALWAYS_BLOCKED_CRAWLERS.map(blockGroup),
    ].join("\n\n"),
  );

  if (opts.blockAiTrainingCrawlers) {
    sections.push(
      [
        "# AI model-training crawlers (operator switch ROBOTS_BLOCK_AI_TRAINING_CRAWLERS).",
        "# Search and answer agents (OAI-SearchBot, ChatGPT-User, Claude-SearchBot,",
        "# Claude-User, PerplexityBot, Applebot, Googlebot, Bingbot ...) are unaffected.",
        ...AI_TRAINING_CRAWLERS.map(blockGroup),
      ].join("\n\n"),
    );
  }

  sections.push(SITEMAP_PATHS.map((p) => `Sitemap: ${opts.siteUrl}${p}`).join("\n"));

  return `${sections.join("\n\n")}\n`;
}
