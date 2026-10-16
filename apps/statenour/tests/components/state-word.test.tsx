/**
 * UI v3 W1a: the state word as rendered. One quiet status line in the mastery chrome, replacing the
 * aura. Rendered with renderToString, the server path: a window, Date or localStorage read in the
 * component would throw here, and the first client render uses the same default state, so there is no
 * text for hydration to disagree about.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { NourState } from "@/lib/state/nour-state";

const h = vi.hoisted(() => ({ state: {} as Partial<NourState>, path: "/missions" }));
vi.mock("@/lib/state/nour-state", () => ({ useNourState: () => h.state }));
vi.mock("next/navigation", () => ({ usePathname: () => h.path }));

import { StateWord } from "@/components/hud/state-word";

const base = { currentState: "normal", isLoading: false, error: null, systemStatus: "ok", failedFeeds: 0 } as const;
const html = (over: Partial<NourState>) => {
  h.state = { ...base, ...over };
  return renderToString(<StateWord />);
};

describe("StateWord", () => {
  it("is a status line, not a control", () => {
    const out = html({ currentState: "drift" });
    expect(out).toContain('role="status"');
    expect(out).not.toMatch(/<(button|a)[ >]/);
    expect(out).not.toContain("tabindex");
  });

  it("shows the word with the signal notch when the state is a signal", () => {
    const out = html({ currentState: "drift" });
    expect(out).toContain("Drifting");
    expect(out).toMatch(/class="notch"[^>]*aria-hidden="true"/);
  });

  it("shows a calm word with no gold when nothing is wrong", () => {
    const out = html({ currentState: "normal" });
    expect(out).toContain("Steady");
    expect(out).not.toContain("notch");
  });

  it("reserves its row but prints no word while loading", () => {
    const out = html({ isLoading: true, systemStatus: "loading" });
    expect(out).toContain('role="status"');
    expect(out).toContain("h-5");
    expect(out).not.toMatch(/Steady|Drifting|unknown/i);
    expect(out).not.toContain("notch");
  });

  it("says unknown, with no notch and no Steady, when the health feed was not read", () => {
    const out = html({ currentState: "normal", systemStatus: "unknown" });
    expect(out).toContain("State unknown");
    expect(out).not.toContain("Steady");
    expect(out).not.toContain("notch");
  });

  it("does not glow, pulse or animate", () => {
    const out = html({ currentState: "on_fire" });
    expect(out).not.toMatch(/animate-|pulse|glow|shadow|gradient|transition/);
  });

  it("keeps a readable size and the tertiary text token", () => {
    const out = html({ currentState: "scattered" });
    expect(out).toContain("text-[12px]");
    expect(out).toContain("text-fg-tertiary");
  });

  it("renders nothing on /chat, whose fixed shell paints over the band (review round 2, item 11)", () => {
    h.path = "/chat";
    try {
      expect(html({ currentState: "drift" })).toBe("");
    } finally {
      h.path = "/missions";
    }
  });
});
