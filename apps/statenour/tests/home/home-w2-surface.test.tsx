/**
 * Home W2a (2026-10-30, home-pulse). Nour: "let's get rid of that degraded system shit on the top... make
 * it all pretty, include some cards, some shortcuts". Pinned here, against antislop-ui:
 *  · the NOW sentence reads in sentence case, not an all-caps poster, and is capped at three lines
 *    (his task titles ran seven lines at 390 px);
 *  · the decorative gold notch beside "Now" is gone (it marked no state, by its own comment);
 *  · the Nick's Tire card has three states and never shows $0 for a failed read;
 *  · every shortcut goes somewhere real, at a 44 px target.
 */
import { describe, expect, it } from "vitest";
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
    expect(hero).toMatch(/\bnormal-case\b/);
    expect(hero).toMatch(/\bline-clamp-3\b/);
  });

  it("has no decorative notch", () => {
    expect(html).not.toMatch(/class="notch/);
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
