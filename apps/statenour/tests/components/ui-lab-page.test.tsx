// Mutation receipt (2026-09-15): ui-lab/page.tsx with the `not-found` InspectorNotice line deleted ->
// 1 failed | 3 passed; red: "missing inspector state not-found". Restored byte-for-byte from the scratchpad copy.
/**
 * /system/ui-lab renders every primitive it exists to show (2026-09-15).
 *
 * The lab is the gallery for the object grammar's primitives, split from
 * /system/chat-states because that page is pinned by full-page screenshot
 * baselines. A gallery that silently drops a section is worse than none —
 * the operator eyeballs it after a change and sees nothing missing. This
 * pins the SUBJECT: the four inspector states, the four metric statuses
 * (two measured, one out of range, one stale, one unavailable) and one
 * evidence chip per ladder class, all against the frozen fixture clock.
 *
 * Rendered with `renderToStaticMarkup` (Node, no DOM — the house pattern).
 * The real zustand store serves its initial snapshot to a static render,
 * so Reality Mode is off and the marks are chips; the frame sheet is closed
 * by default, so its `role="dialog"` must be ABSENT (the negative control —
 * a page that opened the sheet on load would trap every visit).
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The fixture rows open the inspector through useInspector(), which reads
// the app router — absent in a static render (the other inspector tests
// stub it the same way).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/system/ui-lab",
  useSearchParams: () => new URLSearchParams(""),
}));

import UiLabPage from "@/app/(mastery)/system/ui-lab/page";

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("/system/ui-lab · the gallery shows every primitive", () => {
  const html = renderToStaticMarkup(<UiLabPage />);

  it("shows the four inspector non-content states, each distinguishable", () => {
    for (const state of ["loading", "error", "not-found", "unknown-kind"]) {
      expect(html, `missing inspector state ${state}`).toContain(`data-inspector-state="${state}"`);
    }
    // The error notice carries the compact code, never a raw message.
    expect(html).toContain("P2024");
  });

  it("shows measured, out-of-range, stale and unavailable metrics", () => {
    // describeMetric's vocabulary, not MetricResult's: ok → measured, degraded → stale.
    // Two measured on the page (contact gap · sleep); the frame body's third is closed.
    expect(count(html, 'data-metric-status="measured"')).toBe(2);
    expect(count(html, 'data-metric-status="stale"')).toBe(1);
    expect(count(html, 'data-metric-status="unavailable"')).toBe(1);
    expect(count(html, "data-metric-out-of-range")).toBe(1);
    // Unavailable is "unknown" + the code, never a zero.
    expect(html).toContain("unknown");
    expect(html).toContain("ECONNRESET");
  });

  it("shows one evidence chip per ladder class, chips not inline (Reality Mode off)", () => {
    expect(count(html, 'data-evidence-mark="chip"')).toBe(8);
    expect(html).not.toContain('data-evidence-mark="inline"');
    for (const word of ["you stated", "receipt", "observed", "external", "inferred", "prediction", "weak signal", "summary"]) {
      expect(html, `missing ladder word ${word}`).toContain(word);
    }
    expect(html).toContain('aria-pressed="false"');
  });

  it("carries four fixture rows in a selection scope for the keyboard grammar (the e2e subject)", () => {
    expect(html).toContain('data-selection-scope="ui-lab-fixtures"');
    expect(count(html, 'data-entity="content:fx-')).toBe(4);
    expect(count(html, 'role="button" tabindex="0" data-entity="content:')).toBe(4);
  });

  it("NEGATIVE CONTROL: the frame sheet is closed on load", () => {
    expect(html).not.toContain('data-inspector="sheet"');
    expect(html).not.toContain('role="dialog"');
  });
});
