// Mutation receipt (2026-09-15): inspector-frame.tsx `if (presentation === "panel")` -> `|| presentation === "sheet"` (sheet rendered as the panel):
// 1 failed | 8 passed; red: "sheet is a modal dialog" expected '<aside role="complementary" aria-labe...' to match /^<div[^>]*role="dialog".../. Restored byte-for-byte (sha256 6aa3ccb1).
/**
 * InspectorFrame: one chrome, two presentations, two modes (2026-09-15).
 *
 * The frame replaced twenty bespoke overlays. What it owns is the a11y role,
 * the modal contract, the phone tap-target floor on the sheet, and the peek
 * eyebrow. Each is asserted on RENDERED MARKUP: a panel that quietly claimed
 * `aria-modal`, a sheet whose close button lost its 44px floor, or a peek
 * that rendered as a plain inspect would each go red here. Presentational
 * component, no hooks, no stores: nothing to mock.
 *
 * Node env, no DOM: `renderToStaticMarkup` is the house pattern
 * (tests/components/wisdom-evolution-panel-states.test.tsx).
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { InspectorFrame, type InspectorFrameProps } from "@/components/inspector/inspector-frame";

const noop = () => {};

function render(props: Partial<InspectorFrameProps> = {}): string {
  return renderToStaticMarkup(
    <InspectorFrame kind="task" mode="inspect" presentation="panel" onClose={noop} {...props}>
      <p data-testid="body">the object</p>
    </InspectorFrame>,
  );
}

/** HTML entities get in the way of plain-string assertions. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

describe("InspectorFrame / presentation", () => {
  it("panel is a non-modal complementary landmark", () => {
    const html = render({ presentation: "panel" });
    expect(html).toMatch(
      /^<aside role="complementary"[^>]*data-inspector="panel"[^>]*data-inspector-mode="inspect"[^>]*data-inspector-kind="task"/,
    );
    expect(html).not.toContain("aria-modal");
    expect(html).toContain('data-testid="body"');
  });

  it("sheet is a modal dialog", () => {
    const html = render({ presentation: "sheet" });
    expect(html).toMatch(/^<div[^>]*role="dialog"[^>]*aria-modal="true"[^>]*data-inspector="sheet"/);
    expect(html).toContain('data-inspector-mode="inspect"');
    expect(html).toContain('data-inspector-kind="task"');
    expect(html).toContain('data-testid="body"');
  });

  it("panel and sheet do not render the same", () => {
    expect(render({ presentation: "panel" })).not.toEqual(render({ presentation: "sheet" }));
  });
});

describe("InspectorFrame / close button", () => {
  it("is labelled on both presentations", () => {
    expect(render({ presentation: "panel" })).toContain('aria-label="Close inspector"');
    expect(render({ presentation: "sheet" })).toContain('aria-label="Close inspector"');
  });

  it("carries the 44px tap-target floor on the sheet, and not on the panel", () => {
    expect(render({ presentation: "sheet" })).toContain("min-h-[44px]");
    expect(render({ presentation: "panel" })).not.toContain("min-h-[44px]");
  });
});

describe("InspectorFrame / mode", () => {
  it("peek shows the eyebrow word and the keyboard hint", () => {
    const html = render({ mode: "peek" });
    expect(html).toContain('data-inspector-mode="peek"');
    expect(html).toContain(">peek<");
    const body = text(html);
    expect(body).toContain("Enter opens");
    expect(body).toContain("Esc closes");
  });

  it("POSITIVE CONTROL: inspect shows neither", () => {
    const html = render({ mode: "inspect" });
    expect(html).toContain('data-inspector-mode="inspect"');
    expect(html).not.toContain(">peek<");
    const body = text(html);
    expect(body).not.toContain("Enter opens");
    expect(body).not.toContain("Esc closes");
  });
});

describe("InspectorFrame / kind and footer", () => {
  it("a known kind is the eyebrow; kind={null} falls back to 'object' and an unknown kind attribute", () => {
    const task = render({ kind: "task" });
    expect(task).toContain('data-inspector-kind="task"');
    expect(task).toContain(">task<");
    expect(task).not.toContain(">object<");

    const none = render({ kind: null });
    expect(none).toContain('data-inspector-kind="unknown"');
    expect(none).toContain(">object<");
    expect(none).not.toContain(">task<");
  });

  it("renders `actions` inside the footer after the body, and no footer without them", () => {
    const withActions = render({ actions: <button data-testid="act">Complete</button> });
    expect(withActions).toContain('data-testid="act"');
    expect(withActions).toMatch(/<div class="border-t border-glass[^"]*"><button data-testid="act"/);
    expect(withActions.indexOf('data-testid="act"')).toBeGreaterThan(withActions.indexOf('data-testid="body"'));

    const without = render();
    expect(without).not.toContain('data-testid="act"');
    expect(without).not.toContain("border-t border-glass");
  });
});

describe("InspectorFrame / sheet a11y (review 2026-09-15)", () => {
  it("names exactly ONE close control; the scrim is out of the tab order and hidden from AT", () => {
    const html = render({ presentation: "sheet" });
    expect(html.split('aria-label="Close inspector"').length - 1).toBe(1);
    expect(html).toMatch(/<button[^>]*aria-hidden="true"[^>]*tabindex="-1"[^>]*class="absolute inset-0/);
  });
});
