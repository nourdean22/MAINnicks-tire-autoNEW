/**
 * robots.txt policy contract — server/_core/robots.ts.
 *
 * Both directions are asserted: what must be blocked IS blocked, and what
 * must stay reachable (every answer-engine agent, in BOTH modes) is not in any
 * block group. The disjointness test is the canary against a future
 * "complete the set" edit that drops OAI-SearchBot next to GPTBot.
 *
 * ROLLBACK: restore the literal template in server/_core/index.ts's
 * /robots.txt handler. No data or deploy step is involved.
 */
import { describe, expect, it } from "vitest";

import {
  AI_TRAINING_CRAWLERS,
  ALWAYS_BLOCKED_CRAWLERS,
  ANSWER_ENGINE_AGENTS,
  PRIVATE_PATH_DISALLOWS,
  buildRobotsTxt,
} from "./_core/robots";

const SITE = "https://nickstire.org";

/** User agents that own a `Disallow: /` group in the rendered file. */
function fullyBlockedAgents(txt: string): string[] {
  const out: string[] = [];
  const re = /User-agent: ([^\n]+)\nDisallow: \/\n/g;
  for (const m of txt.matchAll(re)) out.push(m[1].trim());
  return out;
}

describe("buildRobotsTxt — default mode (switch off)", () => {
  const txt = buildRobotsTxt({ siteUrl: SITE, blockAiTrainingCrawlers: false });

  it("keeps the global allow group with every private path disallowed", () => {
    expect(txt.startsWith("User-agent: *\nAllow: /\n")).toBe(true);
    for (const p of PRIVATE_PATH_DISALLOWS) expect(txt).toContain(`Disallow: ${p}\n`);
  });

  it("no longer carries Crawl-delay or query-parameter disallows", () => {
    expect(txt).not.toMatch(/crawl-delay/i);
    expect(txt).not.toContain("utm_");
    expect(txt).not.toContain("fbclid");
    expect(txt).not.toContain("gclid");
    expect(txt).not.toContain("?ref=");
  });

  it("blocks the always-blocked scrapers and nothing else", () => {
    expect(fullyBlockedAgents(txt).sort()).toEqual([...ALWAYS_BLOCKED_CRAWLERS].sort());
  });

  it("does NOT block the training crawlers while the switch is off", () => {
    for (const agent of AI_TRAINING_CRAWLERS) expect(txt).not.toContain(`User-agent: ${agent}`);
  });

  it("lists all four sitemaps", () => {
    expect(txt).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    expect(txt).toContain(`Sitemap: ${SITE}/sitemap-services.xml`);
    expect(txt).toContain(`Sitemap: ${SITE}/sitemap-locations.xml`);
    expect(txt).toContain(`Sitemap: ${SITE}/sitemap-images.xml`);
  });
});

describe("buildRobotsTxt — training block ON", () => {
  const txt = buildRobotsTxt({ siteUrl: SITE, blockAiTrainingCrawlers: true });

  it("adds a Disallow: / group for every documented training-only crawler", () => {
    const blocked = fullyBlockedAgents(txt);
    for (const agent of AI_TRAINING_CRAWLERS) expect(blocked, agent).toContain(agent);
    for (const agent of ALWAYS_BLOCKED_CRAWLERS) expect(blocked, agent).toContain(agent);
  });

  it("still keeps the global allow group and private disallows intact", () => {
    expect(txt.startsWith("User-agent: *\nAllow: /\n")).toBe(true);
    expect(txt).toContain("Disallow: /admin\n");
  });
});

describe("answer-engine agents are never blocked, in either mode", () => {
  it.each([false, true])("blockAiTrainingCrawlers=%s", (on) => {
    const txt = buildRobotsTxt({ siteUrl: SITE, blockAiTrainingCrawlers: on });
    const blocked = fullyBlockedAgents(txt).map((a) => a.toLowerCase());
    for (const agent of ANSWER_ENGINE_AGENTS) {
      // Exact-token match: "Applebot" must not be tripped by "Applebot-Extended".
      expect(blocked, agent).not.toContain(agent.toLowerCase());
    }
  });

  it("the training list and the answer-engine list are disjoint (structural canary)", () => {
    const lower = new Set(ANSWER_ENGINE_AGENTS.map((a) => a.toLowerCase()));
    for (const agent of [...AI_TRAINING_CRAWLERS, ...ALWAYS_BLOCKED_CRAWLERS]) {
      expect(lower.has(agent.toLowerCase()), agent).toBe(false);
    }
  });

  it("the bundled-purpose tokens are not in the switch (owner decisions, not defaults)", () => {
    for (const bundled of ["Google-Extended", "Amazonbot", "Meta-ExternalAgent"]) {
      expect(AI_TRAINING_CRAWLERS as readonly string[]).not.toContain(bundled);
    }
  });
});
