/**
 * 2026-08-12 · PulseFeedSheet exit-animation regression (PR #1526 sibling).
 *
 * THE DEFECT CLASS THIS PINS. The feed sheet mounted/unmounted on the same
 * frame `open` flipped — no motion either way; every close path (backdrop
 * tap, Close, row pick, Escape) visibly SNAPPED. The fix copies the
 * more-sheet.tsx reference machine: `mounted` trails `open` by one exit
 * animation and unmount rides animationend. That machine has a silent
 * failure mode all its own: if the exit class is typo'd, renamed, or its
 * keyframes are deleted from effects.css, NO animation runs, animationend
 * NEVER fires, and the "closed" sheet never unmounts — a permanent ghost
 * overlay. Tailwind-v4-style silence (cf. __tests__/theme-token-utilities
 * .test.ts): zero CSS, zero errors, zero visual clue in review.
 *
 * Vitest runs in environment "node" (no jsdom — see observability-tiles
 * .test.tsx for the precedent), so the client-side close transition itself
 * can't be exercised here. What CAN be pinned:
 *   1. open sheet renders with the ENTER utility (and not the exit one)
 *   2. a closed sheet renders nothing on first paint
 *   3. BOTH utilities and their @keyframes exist in effects.css — the
 *      ghost-sheet guard
 *   4. the mounted-gate refactor didn't drop existing content (commitment
 *      rows keep their Done/Drop resolve buttons)
 * The rapid-reopen edge (animation-name swap cancels without animationend)
 * is hand-traced in more-sheet.tsx, the reference implementation.
 */
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  PulseFeedSheet,
  PULSE_FEED_SHEET_ANIMATION,
} from "@/components/ultron/bottom-pulse-ticker";

const ROOT = join(__dirname, "..", "..");

const noop = () => {};

const ITEMS = [
  {
    id: "commit-1",
    kind: "commitment" as const,
    glyph: "*",
    label: "PROMISE",
    text: "ship the weekly review",
    tone: "warn" as const,
    commitmentId: 42,
  },
  {
    id: "info-1",
    kind: "win" as const,
    glyph: "+",
    label: "WIN",
    text: "streak held",
    tone: "win" as const,
    href: "/journal",
  },
];

function render(open: boolean): string {
  return renderToString(
    <PulseFeedSheet
      open={open}
      items={ITEMS}
      activeIdx={0}
      onClose={noop}
      onDismiss={noop}
      onResolve={noop}
      resolvingId={null}
      onPick={noop}
    />,
  );
}

describe("PulseFeedSheet — exit-animation machine", () => {
  it("renders the open sheet with the enter utility, not the exit one", () => {
    const html = render(true);
    expect(html).toContain(PULSE_FEED_SHEET_ANIMATION.enter);
    expect(html).not.toContain(PULSE_FEED_SHEET_ANIMATION.exit);
    expect(html).toContain("ship the weekly review");
  });

  it("renders nothing on first paint when closed (mounted trails open)", () => {
    expect(render(false)).toBe("");
  });

  it("pins both animation utilities + keyframes in effects.css (ghost-sheet guard)", () => {
    const css = readFileSync(join(ROOT, "app/styles/effects.css"), "utf8");
    for (const cls of Object.values(PULSE_FEED_SHEET_ANIMATION)) {
      expect(css).toMatch(new RegExp(`\\.${cls}\\s*\\{`));
      const keyframes = cls.replace(/^animate-/, "");
      expect(css).toMatch(new RegExp(`@keyframes ${keyframes}\\s*\\{`));
    }
  });

  it("mounted-gate refactor keeps commitment rows' Done/Drop buttons", () => {
    const html = render(true);
    expect(html).toContain("Mark this promise done");
    expect(html).toContain("Drop this promise");
  });
});
