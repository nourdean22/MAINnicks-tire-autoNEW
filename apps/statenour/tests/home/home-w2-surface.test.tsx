/**
 * Home W2a (2026-10-30, home-pulse). Nour: "let's get rid of that degraded system shit on the top... make
 * it all pretty, include some cards, some shortcuts". Pinned here, against antislop-ui:
 *  · the NOW sentence reads in sentence case, not an all-caps poster, and is capped at three lines
 *    (his task titles ran seven lines at 390 px);
 *  · the Nick's Tire card has three states and never shows $0 for a failed read;
 *  · every shortcut goes somewhere real, at a 44 px target.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { BriefStateLine } from "@/components/home/brief-state-line";
import { ShopTodayCardView } from "@/components/home/shop-today-card";
import { HomeShortcuts, HOME_SHORTCUTS } from "@/components/home/home-shortcuts";
import type { BriefStateSection } from "@/lib/home/operator-brief";

const state = (over: Partial<BriefStateSection> = {}): BriefStateSection => ({
  health: { state: "healthy", detail: "all green" },
  summary: "You're mid-execution on a long demo task title.",
  queues: { measured: true, clear: false, inbox: 1, captures: 0, approvals: 0 },
  ...over,
});

describe("the NOW sentence", () => {
  const html = renderToStaticMarkup(<BriefStateLine state={state()} loading={false} unreadable={false} />);
  const hero = html.match(/<p class="vt-verdict[^"]*"/)?.[0] ?? "";

  it("is sentence case and capped at three lines", () => {
    expect(hero, "the hero did not render").not.toBe("");
    expect(hero).toMatch(/\bvt-verdict-sentence\b/);
    expect(hero).toMatch(/\bline-clamp-3\b/);
  });

  // Codex P1 on #3405: `.vt-verdict` is UNLAYERED in app/styles/base.css, so a layered Tailwind utility
  // (normal-case, text-*, leading-*) loses to its uppercase and sizes and never renders. The sentence case
  // must come from an unlayered rule too. Read the stylesheet: the rule exists at layer depth 0 and turns
  // text-transform off.
  it("the sentence-case rule is unlayered, so it beats .vt-verdict's uppercase", () => {
    const css = readFileSync(resolve(__dirname, "../../app/styles/base.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    let depth = 0;
    let found = "";
    for (const line of css.split("\n")) {
      if (depth === 0 && /\.vt-verdict\.vt-verdict-sentence\s*\{/.test(line)) found = line;
      if (found && depth <= 1 && found !== line && /text-transform:\s*none/.test(line)) found = "ok";
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      if (found === "ok") break;
    }
    expect(found, "no unlayered .vt-verdict.vt-verdict-sentence rule with text-transform: none").toBe("ok");
  });
});

describe("Nick's Tire card", () => {
  it("measured sales show dollars and jobs", () => {
    const html = renderToStaticMarkup(
      <ShopTodayCardView read={{ status: "ok", dollars: 1240, jobs: 6, asOf: "2026-10-30T18:00:00Z" }} />,
    );
    expect(html).toContain("$1,240");
    expect(html).toContain("6 jobs");
  });

  it("a failed read says unknown and never $0", () => {
    for (const read of [{ status: "unknown", reason: "bridge down" } as const, "error" as const]) {
      const html = renderToStaticMarkup(<ShopTodayCardView read={read} />);
      expect(html.toLowerCase()).toContain("unknown");
      expect(html).not.toContain("$0");
    }
  });

  it("control: a measured zero shows $0", () => {
    const html = renderToStaticMarkup(
      <ShopTodayCardView read={{ status: "ok", dollars: 0, jobs: 0, asOf: "2026-10-30T13:00:00Z" }} />,
    );
    expect(html).toContain("$0");
  });

  it("loading is a skeleton, not a number", () => {
    const html = renderToStaticMarkup(<ShopTodayCardView read="loading" />);
    expect(html).not.toContain("$");
    expect(html).toContain('aria-busy="true"');
  });
});

describe("shortcuts", () => {
  it("every shortcut has a real destination and a 44px target", () => {
    const html = renderToStaticMarkup(<HomeShortcuts />);
    const links = html.match(/<a [^>]*>/g) ?? [];
    expect(links.length).toBe(HOME_SHORTCUTS.length);
    for (const a of links) {
      expect(a).toMatch(/href="(\/(people|brain|stats|system)|https:\/\/nickstire\.org\/admin)"/);
      expect(a).toMatch(/\bmin-h-11\b/);
    }
  });
});
