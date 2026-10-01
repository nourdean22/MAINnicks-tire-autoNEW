/**
 * UI v2 grammar gate (2026-10-01 · docs/design/ui-v2/SYSTEM.md).
 *
 * Pins the parts of the Precision Material Cockpit that a well-meaning edit
 * could quietly undo: gold must stay a signal, element defaults must stay
 * sentence-case Geist, the dead effects classes must stay dead, and the two
 * keyframes that inline `style.animation` strings reference must stay defined
 * (the near-miss that produced this test: a census-driven prune dropped
 * `sparkline-draw` and `slideUpSheet`, which no `.tsx` references by CLASS but
 * two reference by NAME inside a style string).
 *
 * Positive control: every assertion below fails on `c8e3287c` (#2864), the
 * last production grammar — gold scrollbar, uppercase h1 default, 76 dead
 * effects classes, no data-ui lane.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const tokens = read("app/styles/tokens.css");
const base = read("app/styles/base.css");
const effects = read("app/styles/effects.css");
const layout = read("app/layout.tsx");

/** base.css / tokens.css without the `:root[data-ui="v1"]` comparison lane (which legitimately keeps the old gold). */
const baseV2 = base.split("UI v1 comparison lane")[0];
const tokensV2 = tokens.split("UI v1 comparison lane")[0];

describe("UI v2 grammar", () => {
  it("declares the semantic surface roles and keeps the legacy aliases pointing at them", () => {
    for (const t of ["--canvas", "--workspace", "--surface", "--surface-raised", "--surface-interactive", "--edge-subtle", "--edge-strong", "--accent", "--radius-control", "--motion-state", "--focus-ring"]) {
      expect(tokens, `${t} missing`).toMatch(new RegExp(`^\\s*${t}:`, "m"));
    }
    expect(tokens).toMatch(/--bg-void:\s*var\(--canvas\)/);
    expect(tokens).toMatch(/--gold:\s*var\(--accent\)/);
  });

  it("gold is a signal: no gold scrollbar, no gold glow, no gold in any shadow token", () => {
    // Gold BORDERS on active / focus / doing states are sanctioned signals
    // (.neural-glass-active, .neural-glass:focus-within, task-doing-breath);
    // gold scrollbars and gold glows are decoration.
    expect(effects).toMatch(/::-webkit-scrollbar-thumb \{ background: rgba\(255, 255, 255/);
    expect(effects).not.toMatch(/scrollbar-thumb \{[^}]*253, 185, 19/);
    expect(effects).not.toMatch(/box-shadow: 0 0 40px rgba\(253, 185, 19/);
    for (const line of tokensV2.split("\n").filter((l) => /^\s*--shadow-/.test(l))) {
      expect(line, "a shadow token carries gold").not.toMatch(/253,\s*185,\s*19/);
    }
  });

  it("element headings are Geist and sentence case by default (uppercase is opt-in via eyebrow/verdict)", () => {
    const h1 = baseV2.match(/^h1 \{[^}]*\}/m)?.[0] ?? "";
    expect(h1, "h1 rule missing").not.toBe("");
    expect(h1).not.toContain("uppercase");
    expect(baseV2).toMatch(/h1, h2, h3 \{ font-family: var\(--font-body\)/);
    expect(baseV2).toMatch(/\.page-title \{[^}]*text-transform: none/);
    expect(baseV2).toMatch(/\.vt-verdict \{[^}]*font-family: var\(--font-display\)/);
  });

  it("the dead effects classes stay dead", () => {
    for (const cls of ["nick-orb-idle", "neon-gold", "hud-shimmer", "particle-burst", "glitch-text", "btn-gold", "data-stream", "float-particle"]) {
      expect(effects, `.${cls} is back`).not.toMatch(new RegExp(`^\\.${cls}(?![\\w-])`, "m"));
    }
    // the ones that LOOK dead to a class census but are built dynamically or are library selectors
    expect(effects).toMatch(/^\.state-aura-drift/m);
    expect(effects).toMatch(/^\.recharts-dot/m);
  });

  it("keyframes referenced from inline style strings survive pruning", () => {
    expect(effects).toMatch(/@keyframes sparkline-draw\s*\{/);
    expect(effects).toMatch(/@keyframes slideUpSheet\s*\{/);
    expect(read("components/ui/sparkline.tsx")).toContain("sparkline-draw");
    expect(read("components/chat/message-action-sheet.tsx")).toContain("slideUpSheet");
  });

  it("the v1 comparison lane exists and the layout stamps data-ui from the cookie", () => {
    expect(tokens).toContain(':root[data-ui="v1"]');
    expect(base).toContain(':root[data-ui="v1"]');
    expect(layout).toMatch(/data-ui=\{/);
    expect(layout).toMatch(/cookies\(\)\)\.get\(UI_VERSION_COOKIE\)/);
    expect(read("components/ui/ui-version-switch.tsx")).toContain('UI_VERSION_COOKIE = "statenour_ui"');
    expect(layout).toContain("<UiVersionSwitch />");
  });

  it("content never gets translucent material; only the ui-material class does", () => {
    expect(baseV2).toMatch(/\.ui-material \{[^}]*backdrop-filter/);
    const glass = baseV2.match(/\.glass-card \{[^}]*\}/)?.[0] ?? "";
    expect(glass).not.toContain("backdrop-filter");
  });
});
