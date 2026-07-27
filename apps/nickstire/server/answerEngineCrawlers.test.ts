/**
 * Answer-engine crawler coverage — contract test for the prerender bot list.
 *
 * `server/prerender-middleware.ts` is PROTECTED CORE ("Prerender generation and
 * bot-serving middleware"), so its change carries a targeted test and a rollback
 * note. This is the test.
 *
 * WHAT WAS WRONG
 * BOT_PATTERNS was built for search engines. It carried `gptbot` — OpenAI's
 * MODEL TRAINING crawler — and treated that as AI coverage. It is not: the
 * agents that produce a customer-facing answer are different user agents
 * (`OAI-SearchBot` indexes for ChatGPT Search, `ChatGPT-User` fetches a page
 * live when someone asks about it), and none of them were in the list. Same for
 * Perplexity, Google's Gemini grounding agent and Meta AI. Those crawlers got
 * the empty React shell while Googlebot got fully rendered HTML.
 *
 * ROLLBACK
 * This change is additive to a string array — no behaviour changes for any UA
 * already covered, and a UA that matches nothing still falls through to the SPA
 * exactly as before. To revert: delete the "Answer-engine crawlers" block in
 * BOT_PATTERNS and this file. No data, migration or deploy step is involved.
 *
 * The real-file assertions below deliberately read the middleware source rather
 * than importing a constant: BOT_PATTERNS is module-private, and pinning the
 * literal is what makes an accidental deletion fail.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(join(process.cwd(), "server/prerender-middleware.ts"), "utf-8");

/**
 * User agents that must receive prerendered HTML, with the real-world question
 * each one is answering when it shows up. Tokens are the vendor-published UA
 * strings; the middleware lowercases and substring-matches.
 */
const ANSWER_ENGINE_AGENTS: { token: string; why: string }[] = [
  { token: "oai-searchbot", why: "OpenAI · indexes pages for ChatGPT Search results" },
  { token: "chatgpt-user", why: "OpenAI · live fetch when a user asks about this shop" },
  { token: "perplexity-user", why: "Perplexity · live fetch on a user question" },
  { token: "perplexitybot", why: "Perplexity · index" },
  { token: "claude-user", why: "Anthropic · live fetch on a user question" },
  { token: "claude-searchbot", why: "Anthropic · search indexing" },
  { token: "google-extended", why: "Google · Gemini and AI Overviews grounding" },
  { token: "meta-externalagent", why: "Meta AI" },
  { token: "amazonbot", why: "Amazon / Alexa" },
  { token: "duckassistbot", why: "DuckDuckGo AI answers" },
];

/** Search crawlers that were already covered and must stay covered. */
const PRE_EXISTING_AGENTS = [
  "googlebot",
  "bingbot",
  "applebot",
  "gptbot",
  "claudebot",
  "facebookexternalhit",
];

/** Extract BOT_PATTERNS entries from the source so a deletion is visible. */
function botPatterns(): string[] {
  const start = SOURCE.indexOf("const BOT_PATTERNS");
  expect(start, "BOT_PATTERNS not found — did the middleware get restructured?").toBeGreaterThan(-1);
  const block = SOURCE.slice(start, SOURCE.indexOf("];", start));
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("prerender bot list — answer engines", () => {
  const patterns = botPatterns();

  it.each(ANSWER_ENGINE_AGENTS)("covers $token ($why)", ({ token }) => {
    expect(patterns).toContain(token);
  });

  it.each(PRE_EXISTING_AGENTS)("still covers the pre-existing crawler %s", (token) => {
    expect(patterns).toContain(token);
  });

  it("distinguishes OpenAI's training crawler from its answering crawlers", () => {
    // The whole point of the change. GPTBot alone is not AI coverage: it feeds
    // model training, not the answer a customer reads. If a future cleanup
    // decides GPTBot already covers OpenAI and drops these, this fails.
    expect(patterns).toContain("gptbot");
    expect(patterns).toContain("oai-searchbot");
    expect(patterns).toContain("chatgpt-user");
  });

  it("has no duplicate patterns", () => {
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it("stores every pattern lowercase (the matcher lowercases the UA)", () => {
    // A capitalised entry can never match, and would look like coverage.
    for (const p of patterns) expect(p, `${p} must be lowercase`).toBe(p.toLowerCase());
  });

  it("matches realistic full user-agent strings, not just bare tokens", () => {
    const isBot = (ua: string) => patterns.some((p) => ua.toLowerCase().includes(p));
    const REAL_UAS = [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36; compatible; ChatGPT-User/1.0; +https://openai.com/bot",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot",
      "Mozilla/5.0 (compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
      "Mozilla/5.0 (compatible; meta-externalagent/1.1; +https://developers.facebook.com/docs/sharing/webmasters/crawler)",
    ];
    for (const ua of REAL_UAS) expect(isBot(ua), ua).toBe(true);
  });

  it("does not capture ordinary human browsers", () => {
    const isBot = (ua: string) => patterns.some((p) => ua.toLowerCase().includes(p));
    const HUMANS = [
      // iPhone Safari — the operator's own PWA and most customer traffic.
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    ];
    for (const ua of HUMANS) expect(isBot(ua), ua).toBe(false);
  });
});
